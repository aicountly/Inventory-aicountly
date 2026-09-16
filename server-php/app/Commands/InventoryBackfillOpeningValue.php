<?php

namespace App\Commands;

use App\Services\RecalculationService;
use App\Services\ValuationEngine;
use App\Services\ValuationReplayService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:backfill-opening-value --company N [--apply] [--dry-run] [--batch 500]
 *
 * Repairs inv_item_openings rows that carry a real quantity but a zero rate/value.
 *
 * Two independent, unrelated gaps can leave opening_valuation_rate/opening_value at their column
 * default of 0 while opening_qty is genuine:
 *
 *   1. source_kind = 'carry_forward' (fy_id = a carried-forward year): a year-end close whose
 *      writer, at the time it ran, only ever set opening_qty. FyCarryForwardService (this app)
 *      has always computed a real rate from ValuationReplayService's replay of the source year;
 *      the zero-value rows this repairs come from carry-forwards that happened before this app
 *      owned the computation (a historical Books-side gap, migrated in as-is by Migrator.php,
 *      which copies whatever rate/value Books' own row already held — see its copyMaster() call
 *      for books_item_fy_openings) or from any other writer that shared the same defect. Whatever
 *      the origin, the fix does not trust the copied rate/value at all (it may be the very same
 *      zero): it recomputes the source year's closing unit cost the same way FyCarryForwardService
 *      itself would, by replaying that year's own opening layers + posted movements through
 *      ValuationReplayService::unitCostsForItems, and writes only rate/value/valuation_method. The
 *      quantity, which every count in production evidence has matched exactly, is never touched.
 *
 *   2. source_kind = 'master_inception' (fy_id = 0): the company's very first opening, entered on
 *      the item master. There is no prior year inside Inventory to replay from — this row IS the
 *      start of the chain. These are always REPORTED AND LEFT ALONE, never written: inventing an
 *      inception rate is exactly the kind of guess RecalculationService and
 *      inventory:backfill-challan-cost both already refuse to make, and a wrong inception cost
 *      poisons every FIFO/LIFO layer and every WAC average built on top of it, forever. If a true
 *      historical rate can be recovered from Books' item master records (outside this command's
 *      reach — it has no connection to Books), a human can enter it directly; otherwise this is a
 *      product decision (e.g. carry a flag, exclude from valuation, or accept the gap), not a
 *      number this command is positioned to choose.
 *
 * A carry-forward group (one company/target-year/branch) is only repaired when its source year's
 * closing date is known locally (inv_fy_ranges). Nothing is inferred or approximated: a group
 * whose source year's dates were never learned by this app, or whose completed carry-forward
 * status cannot be resolved unambiguously, is reported and left alone rather than guessed at.
 *
 * A row the replay itself still prices at 0 (the source year's own trail has no cost anywhere) is
 * reported separately and left alone — same rule, no invented number.
 *
 * Fixing the stored row does not, by itself, correct valuation already posted on top of the wrong
 * zero. For every item actually repaired:
 *   - no movements yet in that year -> its opening cost layer / WAC state is re-seeded right now
 *     (safe: nothing has consumed the wrong layer yet, exactly ValuationEngine::seedOpeningStock,
 *     the same call FyCarryForwardService makes for an untouched item);
 *   - movements already posted in that year -> a recalculation job is queued (never run inline),
 *     so RecalculationService replays the item from the corrected opening in date order and
 *     publishes inventory.valuation.revised for Books, the same mechanism
 *     inventory:backfill-challan-cost hands off to. Run inventory:recalc-worker afterwards.
 *
 * Nothing is written without --apply; --dry-run is the default and may be passed explicitly.
 * Re-running is safe: only rows whose opening_value is still ~0 are considered, so a repaired row
 * is never touched again and no job is ever queued twice for it. This command never writes to
 * inv_audit_log or any other audit table, and it never touches a row whose value is already
 * non-zero — nothing a user may already be relying on is restated.
 */
class InventoryBackfillOpeningValue extends BaseCommand
{
    use EqualsOptionSyntax;

    private const EPSILON = 0.0001;
    private const ACTOR = 'backfill:opening-value';

    protected $group       = 'Inventory';
    protected $name        = 'inventory:backfill-opening-value';
    protected $description = 'Recompute the opening rate/value of carried-forward opening rows that were written with a real quantity but a zero cost.';
    protected $usage       = 'inventory:backfill-opening-value --company N [--apply] [--dry-run] [--batch 500]';
    protected $options     = [
        '--company' => 'Company id to repair (required)',
        '--apply'   => 'Actually write. Without it nothing is changed and the plan is printed',
        '--dry-run' => 'Explicitly ask for the plan only (the default)',
        '--batch'   => 'Rows per batch (default 500, max 5000)',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();

        $cmpId = (int) (CLI::getOption('company') ?? $params['company'] ?? 0);
        if ($cmpId <= 0) {
            CLI::error('--company is required');
            CLI::write($this->usage);

            return EXIT_ERROR;
        }
        $apply = CLI::getOption('apply') !== null && CLI::getOption('dry-run') === null;
        $batch = (int) (CLI::getOption('batch') ?? $params['batch'] ?? 500);
        $batch = $batch > 0 ? min($batch, 5000) : 500;

        $db = \Config\Database::connect();
        $valuation = new ValuationReplayService();
        $engine = new ValuationEngine();
        $recalc = new RecalculationService();

        $repaired = 0;
        $examples = [];
        $stillZero = [];
        $unresolvedGroups = [];
        $fixedItemsByFy = []; // fy_id => [item_id => true]

        try {
            foreach ($this->carryForwardGroups($db, $cmpId) as $g) {
                $fyId = (int) $g['fy_id'];
                $boId = (int) $g['bo_id'];
                $source = $this->resolveSourceYear($db, $cmpId, $fyId, $boId);
                if ($source === null) {
                    $unresolvedGroups[] = $g + ['reason' => $this->lastUnresolvedReason];
                    continue;
                }
                [$sourceFyId, $sourceFyEnd] = $source;

                $cursor = 0;
                while (true) {
                    $rows = $this->brokenOpeningRows($db, $cmpId, 'carry_forward', $fyId, $boId, $cursor, $batch);
                    if ($rows === []) {
                        break;
                    }
                    $cursor = (int) $rows[count($rows) - 1]['opening_id'];
                    $itemIds = array_values(array_unique(array_map(static fn ($r) => (int) $r['item_id'], $rows)));
                    $costs = $valuation->unitCostsForItems($cmpId, $sourceFyId, $itemIds, $sourceFyEnd, 'AS_PER_MASTER', $boId, null);

                    $updates = [];
                    foreach ($rows as $r) {
                        $itemId = (int) $r['item_id'];
                        $cost = round((float) ($costs[$itemId]['unit_cost'] ?? 0.0), 4);
                        if ($cost <= self::EPSILON) {
                            $stillZero[] = $r;
                            continue;
                        }
                        $qty = (float) $r['opening_qty'];
                        $value = round($qty * $cost, 4);
                        $method = $r['valuation_method'] !== null && $r['valuation_method'] !== ''
                            ? $r['valuation_method']
                            : ($costs[$itemId]['method'] ?? null);
                        $updates[] = [
                            'opening_id' => (int) $r['opening_id'],
                            'opening_valuation_rate' => $cost,
                            'opening_value' => $value,
                            'valuation_method' => $method,
                            'updated_by' => self::ACTOR,
                            'updated_at' => date('Y-m-d H:i:s'),
                        ];
                        $fixedItemsByFy[$fyId][$itemId] = true;
                        $repaired++;
                        if (count($examples) < 5) {
                            $examples[] = sprintf('fy %d item %d: qty %.4f x %.4f = %.4f (source fy %d as of %s, %s)', $fyId, $itemId, $qty, $cost, $value, $sourceFyId, $sourceFyEnd, (string) ($costs[$itemId]['method'] ?? ''));
                        }
                    }
                    if ($apply && $updates !== []) {
                        $this->writeBatch($db, $updates);
                    }
                }
            }
        } catch (\Throwable $e) {
            CLI::error('Stopped: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        $inception = $this->inceptionSummary($db, $cmpId);

        $this->report($repaired, $examples, $stillZero, $unresolvedGroups, $inception);

        if ($repaired === 0) {
            CLI::write('Nothing to repair among carry-forward rows.', 'green');

            return $stillZero === [] && $unresolvedGroups === [] ? EXIT_SUCCESS : EXIT_ERROR;
        }
        if (!$apply) {
            CLI::write('');
            CLI::write(sprintf('Dry run. Nothing was written, and no follow-up valuation work was queued for %d item-year(s). Add --apply to perform it.', $this->countItemYears($fixedItemsByFy)), 'yellow');

            return EXIT_SUCCESS;
        }

        [$jobs, $reseeded] = $this->settleFixedItems($db, $cmpId, $fixedItemsByFy, $recalc, $engine);

        CLI::write('');
        CLI::write(sprintf(
            'Applied to %d opening row(s). %d item(s) with no year movements yet were re-seeded directly. %d recalculation job(s) queued for items with existing movements — run inventory:recalc-worker --cmp=%d to replay them.',
            $repaired,
            $reseeded,
            $jobs,
            $cmpId
        ), 'green');

        return $stillZero === [] && $unresolvedGroups === [] ? EXIT_SUCCESS : EXIT_ERROR;
    }

    // ------------------------------------------------------------------ carry-forward repair

    /**
     * Distinct (fy_id, bo_id) pairs among this company's broken carry-forward opening rows.
     *
     * @return list<array{fy_id:int, bo_id:int, row_count:int}>
     */
    private function carryForwardGroups($db, int $cmpId): array
    {
        $res = $db->query(
            'SELECT fy_id, bo_id, COUNT(*) AS row_count
             FROM inv_item_openings
             WHERE cmp_id = ? AND source_kind = ?
               AND ABS(opening_qty) >= ? AND ABS(opening_value) < ?
             GROUP BY fy_id, bo_id
             ORDER BY fy_id ASC, bo_id ASC',
            [$cmpId, 'carry_forward', self::EPSILON, self::EPSILON]
        );
        if ($res === false) {
            throw new \RuntimeException('Could not read the opening rows to repair');
        }

        return array_map(static fn ($r) => ['fy_id' => (int) $r['fy_id'], 'bo_id' => (int) $r['bo_id'], 'row_count' => (int) $r['row_count']], $res->getResultArray());
    }

    /** @var string set by resolveSourceYear() on failure, read by the caller right after */
    private string $lastUnresolvedReason = '';

    /**
     * The single completed carry-forward that fed (fyId, boId), and the source year's closing
     * date — both required to replay a real cost. Null when either is not unambiguously known.
     *
     * @return array{0:int, 1:string}|null
     */
    private function resolveSourceYear($db, int $cmpId, int $fyId, int $boId): ?array
    {
        $sources = $db->table('inv_fy_carryforward_status')
            ->select('source_fy_id')->distinct()
            ->where('cmp_id', $cmpId)->where('target_fy_id', $fyId)->where('bo_id', $boId)->where('status', 'completed')
            ->get()->getResultArray();
        if (count($sources) === 0) {
            $this->lastUnresolvedReason = 'no completed carry-forward status found for this target year/branch';

            return null;
        }
        if (count($sources) > 1) {
            $this->lastUnresolvedReason = 'more than one source year is recorded as having carried forward into this target year/branch — ambiguous';

            return null;
        }
        $sourceFyId = (int) $sources[0]['source_fy_id'];
        $range = $db->table('inv_fy_ranges')->select('fy_end')->where('cmp_id', $cmpId)->where('fy_id', $sourceFyId)->get()->getRowArray();
        if ($range === null || empty($range['fy_end'])) {
            $this->lastUnresolvedReason = 'source fy ' . $sourceFyId . "'s calendar dates are not recorded locally (inv_fy_ranges) — cannot determine its closing date to replay valuation from";

            return null;
        }

        return [$sourceFyId, substr((string) $range['fy_end'], 0, 10)];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function brokenOpeningRows($db, int $cmpId, string $sourceKind, int $fyId, int $boId, int $afterOpeningId, int $limit): array
    {
        $res = $db->query(
            'SELECT opening_id, item_id, opening_qty, valuation_method
             FROM inv_item_openings
             WHERE cmp_id = ? AND source_kind = ? AND fy_id = ? AND bo_id = ?
               AND ABS(opening_qty) >= ? AND ABS(opening_value) < ? AND opening_id > ?
             ORDER BY opening_id ASC
             LIMIT ?',
            [$cmpId, $sourceKind, $fyId, $boId, self::EPSILON, self::EPSILON, $afterOpeningId, $limit]
        );
        if ($res === false) {
            throw new \RuntimeException('Could not read the opening rows to repair');
        }

        return $res->getResultArray();
    }

    /**
     * @param list<array<string, mixed>> $updates
     */
    private function writeBatch($db, array $updates): void
    {
        $db->transBegin();
        try {
            $db->table('inv_item_openings')->updateBatch($updates, 'opening_id');
            if ($db->transStatus() === false) {
                $db->transRollback();

                throw new \RuntimeException('A batch failed and was rolled back; nothing in it was written');
            }
            $db->transCommit();
        } catch (\Throwable $e) {
            $db->transRollback();

            throw $e;
        }
    }

    /** @param array<int, array<int, true>> $fixedItemsByFy fy_id => item_id => true @return array{0:int,1:int} [jobs queued, items reseeded] */
    private function settleFixedItems($db, int $cmpId, array $fixedItemsByFy, RecalculationService $recalc, ValuationEngine $engine): array
    {
        $jobs = 0;
        $reseeded = 0;
        foreach ($fixedItemsByFy as $fyId => $items) {
            $fyId = (int) $fyId;
            $range = $db->table('inv_fy_ranges')->select('fy_start')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->get()->getRowArray();
            $fyStart = $range !== null && !empty($range['fy_start']) ? substr((string) $range['fy_start'], 0, 10) : null;
            foreach (array_keys($items) as $itemId) {
                $itemId = (int) $itemId;
                $earliest = $db->table('inv_stock_movements')->selectMin('movement_date')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->where('item_id', $itemId)->get()->getRowArray();
                $hasMovements = $earliest !== null && $earliest['movement_date'] !== null;
                if ($hasMovements) {
                    $fromDate = $fyStart ?? substr((string) $earliest['movement_date'], 0, 10);
                    $recalc->enqueue($cmpId, $fyId, $itemId, $fromDate, 'opening_value_backfill', null, self::ACTOR);
                    $jobs++;
                } else {
                    $engine->clearValuationState($cmpId, $itemId);
                    $engine->seedOpeningStock($cmpId, $fyId, $itemId);
                    $reseeded++;
                }
            }
        }

        return [$jobs, $reseeded];
    }

    /** @param array<int, array<int, true>> $fixedItemsByFy */
    private function countItemYears(array $fixedItemsByFy): int
    {
        $n = 0;
        foreach ($fixedItemsByFy as $items) {
            $n += count($items);
        }

        return $n;
    }

    // ------------------------------------------------------------------ master-inception (report only)

    /** @return array{count:int, sample:list<array<string, mixed>>} */
    private function inceptionSummary($db, int $cmpId): array
    {
        $rows = $this->brokenOpeningRows($db, $cmpId, 'master_inception', 0, 0, 0, 25);
        $count = $db->query(
            'SELECT COUNT(*) AS n FROM inv_item_openings
             WHERE cmp_id = ? AND source_kind = ? AND fy_id = 0 AND bo_id = 0
               AND ABS(opening_qty) >= ? AND ABS(opening_value) < ?',
            [$cmpId, 'master_inception', self::EPSILON, self::EPSILON]
        )->getRowArray()['n'] ?? 0;

        return ['count' => (int) $count, 'sample' => $rows];
    }

    // ------------------------------------------------------------------ reporting

    /**
     * @param list<string> $examples
     * @param list<array<string, mixed>> $stillZero
     * @param list<array<string, mixed>> $unresolvedGroups
     * @param array{count:int, sample:list<array<string, mixed>>} $inception
     */
    private function report(int $repaired, array $examples, array $stillZero, array $unresolvedGroups, array $inception): void
    {
        CLI::write('');
        CLI::write(sprintf('  %d carry-forward opening row(s) can be repaired from a real replayed cost', $repaired), $repaired > 0 ? 'green' : null);
        foreach ($examples as $x) {
            CLI::write('    ' . $x);
        }
        if ($stillZero !== []) {
            CLI::write(sprintf('  %d carry-forward opening row(s) replay to a cost of 0 as well — the source year has no cost history either, LEFT ALONE:', count($stillZero)), 'yellow');
            foreach (array_slice($stillZero, 0, 10) as $r) {
                CLI::write(sprintf('    opening_id %d item %d qty %.4f', (int) $r['opening_id'], (int) $r['item_id'], (float) $r['opening_qty']), 'yellow');
            }
            if (count($stillZero) > 10) {
                CLI::write('    ... and ' . (count($stillZero) - 10) . ' more', 'yellow');
            }
        }
        if ($unresolvedGroups !== []) {
            CLI::write(sprintf('  %d fy/branch group(s) could not be resolved to a source year, LEFT ALONE:', count($unresolvedGroups)), 'yellow');
            foreach ($unresolvedGroups as $g) {
                CLI::write(sprintf('    fy %d bo %d (%d row(s)): %s', (int) $g['fy_id'], (int) $g['bo_id'], (int) $g['row_count'], (string) $g['reason']), 'yellow');
            }
        }
        if ($inception['count'] > 0) {
            CLI::write(sprintf('  %d master-inception opening row(s) (fy_id = 0) carry a real quantity and zero value. NEVER WRITTEN by this command:', $inception['count']), 'yellow');
            CLI::write('    there is no prior year inside Inventory to replay a cost from for these — this IS the start of the chain.', 'yellow');
            CLI::write('    recovering a true rate, if one exists, means finding it in Books\' historical item-master records; this command has no reach into Books.', 'yellow');
            CLI::write('    left for manual review — see the product decision this command\'s docblock calls out.', 'yellow');
            foreach ($inception['sample'] as $r) {
                CLI::write(sprintf('    opening_id %d item %d qty %.4f', (int) $r['opening_id'], (int) $r['item_id'], (float) $r['opening_qty']), 'yellow');
            }
            if ($inception['count'] > count($inception['sample'])) {
                CLI::write('    ... and ' . ($inception['count'] - count($inception['sample'])) . ' more', 'yellow');
            }
        }
    }
}
