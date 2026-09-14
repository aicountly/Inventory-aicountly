<?php

namespace App\Commands;

use App\Services\DocumentPostingService;
use App\Services\RecalculationService;
use App\Services\UnitConversionService;
use App\Services\ValuationEngine;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:backfill-challan-cost --company N [--apply] [--dry-run] [--batch 500]
 *
 * Repairs inward challans posted BEFORE posting valued them.
 *
 * Until this gate opened an INWARD_CHALLAN with stock_effect settle_deferred or physical moved
 * stock into on_hand and wrote no cost: no valuation_rate on the line, no unit_cost on the
 * movement, no cost layer. Those goods are still in on_hand, so the valuation pool has been short
 * by exactly that quantity ever since, and every issue that met the shortfall was priced by
 * ValuationEngine::resolveFallbackUnitCost rather than by what the goods cost.
 *
 * What this writes is only the cost the documents already recorded — the challan's own GRN rate, or
 * for a settled deferred purchase the rate on the purchase's line for the same item, decided by
 * DocumentPostingService so the repair and posting can never disagree. A line that recorded no
 * cost anywhere is REPORTED AND LEFT ALONE: inventing one is exactly what
 * RecalculationService refuses to do, and the invention would be published to Books as a COGS
 * revision in a period that may already be filed.
 *
 * It does not insert cost layers. A layer dated in the past does not undo the issues that already
 * consumed the wrong ones, so the repair hands the work to the mechanism built for it: one
 * recalculation job per (company, FY, item) from the earliest repaired date. The replay rebuilds
 * the layers in date order, rewrites the lines whose cost changed and publishes
 * inventory.valuation.revised so Books adjusts COGS through its own controlled path. Run
 * inventory:recalc-worker (or let the next user action for the company settle them) afterwards.
 *
 * Nothing is written without --apply; --dry-run is the default and may be passed explicitly.
 * Re-running is safe: only lines whose valuation_rate is still NULL are considered.
 */
class InventoryBackfillChallanCost extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:backfill-challan-cost';
    protected $description = 'Write the recorded cost onto inward challans that moved stock before posting valued them.';
    protected $usage       = 'inventory:backfill-challan-cost --company N [--apply] [--dry-run] [--batch 500]';
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
        $posting = new DocumentPostingService();
        $engine = new ValuationEngine();
        $recalc = new RecalculationService();
        $actor = 'backfill:challan-cost';

        $priced = 0;
        $unpriced = [];
        $examples = [];
        $earliest = [];        // "fy:item" => earliest repaired movement_date
        $purchaseCost = [];    // "sourceId:itemId" => ?float, one lookup per purchase line
        $cursor = 0;

        try {
            while (true) {
                $rows = $this->unvaluedMovements($db, $cmpId, $cursor, $batch);
                if ($rows === []) {
                    break;
                }
                $cursor = (int) $rows[count($rows) - 1]['movement_id'];
                $methods = $engine->methodsForItems($cmpId, array_map(static fn ($r) => (int) $r['item_id'], $rows));
                $lineUpdates = [];
                $movementUpdates = [];
                foreach ($rows as $r) {
                    $cost = $this->recordedUnitCost($db, $posting, $cmpId, $r, $purchaseCost);
                    if ($cost === null) {
                        $unpriced[] = $r;
                        continue;
                    }
                    $itemId = (int) $r['item_id'];
                    $baseQty = (float) $r['base_qty'];
                    $key = (int) $r['fy_id'] . ':' . $itemId;
                    $date = substr((string) $r['movement_date'], 0, 10);
                    $earliest[$key] = isset($earliest[$key]) ? min($earliest[$key], $date) : $date;
                    $lineUpdates[] = [
                        'line_id' => (int) $r['line_id'], 'valuation_rate' => $cost,
                        'valuation_amount' => round($baseQty * $cost, 4), 'valuation_method_applied' => $methods[$itemId],
                    ];
                    $movementUpdates[] = [
                        'movement_id' => (int) $r['movement_id'], 'unit_cost' => $cost,
                        'value' => round($baseQty * $cost, 4),
                    ];
                    $priced++;
                    if (count($examples) < 5) {
                        $examples[] = sprintf('document %d line %d item %d: %.4f x %.4f = %.4f (%s)', (int) $r['document_id'], (int) $r['line_id'], $itemId, $baseQty, $cost, $baseQty * $cost, (string) $r['stock_effect']);
                    }
                }
                if ($apply && $lineUpdates !== []) {
                    $this->writeBatch($db, $lineUpdates, $movementUpdates);
                }
            }
        } catch (\Throwable $e) {
            CLI::error('Stopped: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        CLI::write('');
        CLI::write(sprintf('  %d challan line(s) carry a recorded cost and can be repaired', $priced), $priced > 0 ? 'green' : null);
        foreach ($examples as $x) {
            CLI::write('    ' . $x);
        }
        if ($unpriced !== []) {
            CLI::write(sprintf('  %d challan line(s) recorded no cost anywhere and are LEFT ALONE — record a cost on them, or reverse and re-post them:', count($unpriced)), 'yellow');
            foreach (array_slice($unpriced, 0, 25) as $u) {
                CLI::write(sprintf('    document %d line %d item %d (%s)', (int) $u['document_id'], (int) $u['line_id'], (int) $u['item_id'], (string) $u['stock_effect']), 'yellow');
            }
            if (count($unpriced) > 25) {
                CLI::write('    ... and ' . (count($unpriced) - 25) . ' more', 'yellow');
            }
        }
        if ($priced === 0) {
            CLI::write('Nothing to repair.', 'green');

            return $unpriced === [] ? EXIT_SUCCESS : EXIT_ERROR;
        }
        if (!$apply) {
            CLI::write('');
            CLI::write(sprintf('Dry run. Nothing was written, and no recalculation was queued for %d item-year(s). Add --apply to perform it.', count($earliest)), 'yellow');

            return EXIT_SUCCESS;
        }

        // Layers are rebuilt by the replay, not by this command: it is what re-prices the issues
        // that already consumed the wrong ones and tells Books about the COGS it moves.
        $jobs = 0;
        foreach ($earliest as $key => $fromDate) {
            [$fyId, $itemId] = array_map('intval', explode(':', $key));
            $recalc->enqueue($cmpId, $fyId, $itemId, $fromDate, 'challan_cost_backfill', null, $actor);
            $jobs++;
        }
        CLI::write('');
        CLI::write(sprintf('Applied to %d line(s). %d recalculation job(s) queued — run inventory:recalc-worker --cmp=%d to replay them.', $priced, $jobs, $cmpId), 'green');

        return $unpriced === [] ? EXIT_SUCCESS : EXIT_ERROR;
    }

    /**
     * Inward-challan movements that moved stock and whose line never got a cost, oldest first.
     * Reversed movements are skipped: they net to nothing in the ledger and in the replay.
     *
     * @return list<array<string, mixed>>
     */
    private function unvaluedMovements($db, int $cmpId, int $afterMovementId, int $limit): array
    {
        $res = $db->query(
            "SELECT m.movement_id, m.fy_id, m.item_id, m.line_id, m.document_id, m.movement_date,
                    d.stock_effect, d.metadata_json AS doc_metadata_json, d.source_document_id,
                    l.qty AS line_qty, l.base_qty, l.conversion_factor, l.source_transaction_rate, l.source_transaction_amount
             FROM inv_stock_movements m
             JOIN inv_documents d ON d.document_id = m.document_id
             JOIN inv_document_lines l ON l.line_id = m.line_id
             WHERE m.cmp_id = ? AND m.document_type = 'INWARD_CHALLAN' AND m.movement_kind = 'physical'
               AND m.qty > 0 AND m.movement_id > ?
               AND d.status IN ('POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED')
               AND l.valuation_rate IS NULL
               AND NOT EXISTS (SELECT 1 FROM inv_stock_movements r WHERE r.reversal_of_movement_id = m.movement_id)
             ORDER BY m.movement_id ASC
             LIMIT ?",
            [$cmpId, $afterMovementId, $limit]
        );
        if ($res === false) {
            // DBDebug is off in every deployed environment, so a refused query answers false and
            // ->getResultArray() on false is fatal.
            throw new \RuntimeException('Could not read the inward challans to repair');
        }

        return $res->getResultArray();
    }

    /**
     * The cost the documents themselves recorded for this line, in base units, or null when they
     * recorded none. Deliberately stops where posting would fall back to the item's history: a
     * guessed cost written into a closed period and published to Books is the damage, not the fix.
     *
     * @param array<string, mixed> $row
     * @param array<string, float|null> $purchaseCost memo across the run
     */
    private function recordedUnitCost($db, DocumentPostingService $posting, int $cmpId, array $row, array &$purchaseCost): ?float
    {
        if ((string) $row['stock_effect'] === 'settle_deferred') {
            $meta = json_decode((string) ($row['doc_metadata_json'] ?? ''), true);
            $sourceId = (int) ((is_array($meta) ? $meta['linked_source_document_id'] ?? null : null) ?? $row['source_document_id'] ?? 0);
            $key = $sourceId . ':' . (int) $row['item_id'];
            if (!array_key_exists($key, $purchaseCost)) {
                $purchaseCost[$key] = $posting->deferredPurchaseUnitCost($db, $cmpId, $sourceId, (int) $row['item_id']);
            }
            if ($purchaseCost[$key] !== null) {
                return $purchaseCost[$key];
            }
        }
        $rate = UnitConversionService::effectiveRate((float) $row['line_qty'], (float) ($row['source_transaction_rate'] ?? 0), (float) ($row['source_transaction_amount'] ?? 0));
        if ($rate <= 0) {
            return null;
        }

        return UnitConversionService::toBaseUnitCost($rate, (float) ($row['conversion_factor'] ?: 1));
    }

    /**
     * @param list<array<string, mixed>> $lineUpdates
     * @param list<array<string, mixed>> $movementUpdates
     */
    private function writeBatch($db, array $lineUpdates, array $movementUpdates): void
    {
        $db->transBegin();
        try {
            $db->table('inv_document_lines')->updateBatch($lineUpdates, 'line_id');
            $db->table('inv_stock_movements')->updateBatch($movementUpdates, 'movement_id');
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
}
