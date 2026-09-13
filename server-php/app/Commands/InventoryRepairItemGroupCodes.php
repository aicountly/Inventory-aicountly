<?php

namespace App\Commands;

use App\Services\MasterMirrorService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:repair-item-group-codes --company 16 --target 177 [--apply] [--undo RUN]
 *
 * Repairs a company whose item groups are product codes rather than a classification.
 *
 * Company 16 (Galorekart) is the case this was written for. An import in June 2026 wrote each
 * item's product code into the item group field instead of into item_sku, leaving 11,495 groups
 * holding exactly one item each, 2,297 holding none, and the items themselves with no SKU. One
 * real group, "Main", holds the remaining 5,968 items. The master move copied all of this
 * faithfully — the rows are stamped June and none were touched at cutover — so this repairs the
 * source data, not the migration.
 *
 * Three steps, in one transaction:
 *   1. the code in grp_name goes into the item's item_sku, where it belonged
 *   2. the item moves to the target group
 *   3. the emptied group is soft-deleted, along with groups that already held nothing
 *
 * Nothing is written without --apply. Everything written is recorded in inv_repair_group_codes_log
 * with the previous values, and --undo puts a run back exactly as it was.
 *
 * Safety rules, all of which abort the run rather than guess:
 *   - an item that already has a SKU is skipped, never overwritten
 *   - a code that collides with another item's SKU, or with another code in the same batch, stops
 *     the run: Inventory rejects duplicate SKUs on save, so a repair that created them would leave
 *     items that can no longer be edited
 *   - a code longer than item_sku's 64 characters stops the run
 *   - the target group must exist, be active, and belong to the company
 */
class InventoryRepairItemGroupCodes extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:repair-item-group-codes';
    protected $description = 'Move per-item group codes into item_sku, re-point the items, and retire the emptied groups.';
    protected $usage       = 'inventory:repair-item-group-codes --company N --target N [--apply] [--undo RUN]';
    protected $options     = [
        '--company' => 'Company id to repair (required)',
        '--target'  => 'Item group id the repaired items move to (required unless --undo)',
        '--apply'   => 'Actually write. Without it nothing is changed and the plan is printed',
        '--undo'    => 'Reverse a previous run by its run id',
    ];

    private const LOG_TABLE = 'inv_repair_group_codes_log';

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();

        $cmpId = (int) (CLI::getOption('company') ?? 0);
        if ($cmpId <= 0) {
            CLI::error('--company is required');

            return EXIT_ERROR;
        }

        $db = \Config\Database::connect();
        $this->ensureLogTable($db);

        $undo = CLI::getOption('undo');
        if ($undo !== null && $undo !== true) {
            return $this->undo($db, $cmpId, (string) $undo);
        }

        $targetId = (int) (CLI::getOption('target') ?? 0);
        if ($targetId <= 0) {
            CLI::error('--target is required: the item group the repaired items move to');

            return EXIT_ERROR;
        }
        $apply = CLI::getOption('apply') !== null;

        $target = $db->table('inv_item_groups')->where('cmp_id', $cmpId)->where('item_grp_id', $targetId)
            ->where('deleted_at', null)->get()->getRowArray();
        if (!$target) {
            CLI::error("Target group {$targetId} does not exist in company {$cmpId}, or is deleted.");

            return EXIT_ERROR;
        }
        CLI::write(sprintf('Target group: %d "%s"', $targetId, (string) $target['grp_name']));

        $plan = $this->buildPlan($db, $cmpId, $targetId);
        if ($plan === null) {
            return EXIT_ERROR;
        }
        [$moves, $emptyGroupIds, $skipped] = $plan;

        CLI::write('');
        CLI::write(sprintf('  %d item(s) get their code back as item_sku and move to the target', count($moves)));
        CLI::write(sprintf('  %d group(s) are emptied by that and retired', count($moves)));
        CLI::write(sprintf('  %d group(s) already held nothing and are retired', count($emptyGroupIds)));
        if ($skipped !== []) {
            CLI::write(sprintf('  %d item(s) skipped because they already carry a SKU', count($skipped)), 'yellow');
            foreach (array_slice($skipped, 0, 10) as $s) {
                CLI::write('    item ' . $s['item_id'] . ' keeps sku "' . $s['item_sku'] . '"');
            }
        }

        if (!$apply) {
            CLI::write('');
            CLI::write('Dry run. Nothing was written. Add --apply to perform it.', 'yellow');
            foreach (array_slice($moves, 0, 5) as $m) {
                CLI::write(sprintf('  e.g. item %d "%s" -> sku "%s", group %d -> %d, retire group %d', $m['item_id'], $m['item_name'], $m['code'], $m['old_grp'], $targetId, $m['old_grp']));
            }

            return EXIT_SUCCESS;
        }

        $runId = date('Ymd-His') . '-' . bin2hex(random_bytes(3));
        $now = date('Y-m-d H:i:s');
        $actor = 'repair:' . $runId;

        $db->transBegin();
        try {
            foreach (array_chunk($moves, 500) as $chunk) {
                $log = [];
                foreach ($chunk as $m) {
                    $db->table('inv_items')->where('item_id', $m['item_id'])->where('cmp_id', $cmpId)->update([
                        'item_sku'    => $m['code'],
                        'item_grp_id' => $targetId,
                        'updated_by'  => $actor,
                        'updated_at'  => $now,
                    ]);
                    $log[] = [
                        'run_id'      => $runId,
                        'cmp_id'      => $cmpId,
                        'item_id'     => $m['item_id'],
                        'old_grp_id'  => $m['old_grp'],
                        'old_item_sku' => $m['old_sku'],
                        'new_grp_id'  => $targetId,
                        'new_item_sku' => $m['code'],
                        'retired_grp_id' => $m['old_grp'],
                        'created_at'  => $now,
                    ];
                }
                $db->table(self::LOG_TABLE)->insertBatch($log);
            }

            $retire = array_values(array_unique(array_merge(array_column($moves, 'old_grp'), $emptyGroupIds)));
            foreach (array_chunk($retire, 1000) as $chunk) {
                $db->table('inv_item_groups')->whereIn('item_grp_id', $chunk)->where('cmp_id', $cmpId)->update([
                    'deleted_at' => $now,
                    'deleted_by' => $actor,
                    'is_active'  => 0,
                    'updated_at' => $now,
                ]);
                $rows = [];
                foreach ($chunk as $gid) {
                    if (in_array($gid, $emptyGroupIds, true)) {
                        $rows[] = ['run_id' => $runId, 'cmp_id' => $cmpId, 'item_id' => null, 'old_grp_id' => null,
                            'old_item_sku' => null, 'new_grp_id' => null, 'new_item_sku' => null,
                            'retired_grp_id' => $gid, 'created_at' => $now];
                    }
                }
                if ($rows !== []) {
                    $db->table(self::LOG_TABLE)->insertBatch($rows);
                }
            }

            if ($db->transStatus() === false) {
                $db->transRollback();
                CLI::error('The repair failed and was rolled back. Nothing changed.');

                return EXIT_ERROR;
            }
            $db->transCommit();
        } catch (\Throwable $e) {
            $db->transRollback();
            CLI::error('Rolled back: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        CLI::write('');
        CLI::write(sprintf('Applied. Run id %s — reverse with --undo %s', $runId, $runId), 'green');

        // Books keeps a copy of the item master and follows Inventory through the outbox. Groups
        // are not mirrored, so only the items need publishing; Books reads groups live.
        $this->publishItems($cmpId, array_column($moves, 'item_id'));

        return EXIT_SUCCESS;
    }

    /**
     * @return array{0: list<array<string, mixed>>, 1: list<int>, 2: list<array<string, mixed>>}|null
     */
    private function buildPlan($db, int $cmpId, int $targetId): ?array
    {
        // Every group in the company with its live item count, in one pass.
        $counts = [];
        foreach ($db->table('inv_items')->select('item_grp_id, COUNT(*) AS n')
            ->where('cmp_id', $cmpId)->where('deleted_at', null)->where('item_grp_id IS NOT NULL', null, false)
            ->groupBy('item_grp_id')->get()->getResultArray() as $r) {
            $counts[(int) $r['item_grp_id']] = (int) $r['n'];
        }
        $groups = $db->table('inv_item_groups')->select('item_grp_id, grp_name')
            ->where('cmp_id', $cmpId)->where('deleted_at', null)->get()->getResultArray();

        $singles = [];
        $emptyGroupIds = [];
        foreach ($groups as $g) {
            $gid = (int) $g['item_grp_id'];
            if ($gid === $targetId) {
                continue;
            }
            $n = $counts[$gid] ?? 0;
            if ($n === 0) {
                $emptyGroupIds[] = $gid;
            } elseif ($n === 1) {
                $singles[$gid] = trim((string) $g['grp_name']);
            }
        }
        if ($singles === [] && $emptyGroupIds === []) {
            CLI::write('Nothing to repair: no single-item or empty groups outside the target.', 'green');

            return [[], [], []];
        }

        $moves = [];
        $skipped = [];
        foreach (array_chunk(array_keys($singles), 1000) as $chunk) {
            foreach ($db->table('inv_items')->select('item_id, item_name, item_sku, item_grp_id')
                ->where('cmp_id', $cmpId)->where('deleted_at', null)->whereIn('item_grp_id', $chunk)
                ->get()->getResultArray() as $item) {
                $gid = (int) $item['item_grp_id'];
                $existing = trim((string) ($item['item_sku'] ?? ''));
                if ($existing !== '') {
                    $skipped[] = ['item_id' => (int) $item['item_id'], 'item_sku' => $existing];
                    continue;
                }
                $moves[] = [
                    'item_id'   => (int) $item['item_id'],
                    'item_name' => (string) $item['item_name'],
                    'old_grp'   => $gid,
                    'old_sku'   => null,
                    'code'      => $singles[$gid],
                ];
            }
        }

        return $this->verifyCodes($db, $cmpId, $moves) ? [$moves, $emptyGroupIds, $skipped] : null;
    }

    /**
     * A repair that creates duplicate SKUs leaves items that Inventory will refuse to save the
     * next time anyone edits them, and the damage is only discovered months later. Check before
     * writing, and stop rather than produce it.
     *
     * @param list<array<string, mixed>> $moves
     */
    private function verifyCodes($db, int $cmpId, array $moves): bool
    {
        $problems = [];
        $seen = [];
        foreach ($moves as $m) {
            $code = (string) $m['code'];
            if ($code === '') {
                $problems[] = "item {$m['item_id']}: its group has an empty name, so there is no code to restore";
                continue;
            }
            if (mb_strlen($code) > 64) {
                $problems[] = "item {$m['item_id']}: code \"{$code}\" is longer than item_sku's 64 characters";
            }
            $key = mb_strtolower($code);
            if (isset($seen[$key])) {
                $problems[] = "code \"{$code}\" would be given to item {$m['item_id']} and item {$seen[$key]}";
            }
            $seen[$key] = $m['item_id'];
        }

        $codes = array_column($moves, 'code');
        $movingIds = array_column($moves, 'item_id');
        foreach (array_chunk(array_values(array_unique($codes)), 1000) as $chunk) {
            $b = $db->table('inv_items')->select('item_id, item_sku')->where('cmp_id', $cmpId)
                ->where('deleted_at', null)->whereIn('LOWER(item_sku)', array_map('mb_strtolower', $chunk));
            if ($movingIds !== []) {
                $b->whereNotIn('item_id', $movingIds);
            }
            foreach ($b->get()->getResultArray() as $clash) {
                $problems[] = "code \"{$clash['item_sku']}\" is already item {$clash['item_id']}'s SKU";
            }
        }

        if ($problems === []) {
            CLI::write(sprintf('  %d code(s) checked: none collide, none too long', count($codes)), 'green');

            return true;
        }
        CLI::write('');
        CLI::error(sprintf('%d problem(s) — nothing was written:', count($problems)));
        foreach (array_slice($problems, 0, 25) as $p) {
            CLI::write('  ' . $p, 'red');
        }
        if (count($problems) > 25) {
            CLI::write('  ... and ' . (count($problems) - 25) . ' more', 'red');
        }

        return false;
    }

    private function undo($db, int $cmpId, string $runId): int
    {
        $rows = $db->table(self::LOG_TABLE)->where('run_id', $runId)->where('cmp_id', $cmpId)->get()->getResultArray();
        if ($rows === []) {
            CLI::error("No run \"{$runId}\" recorded for company {$cmpId}.");

            return EXIT_ERROR;
        }
        $now = date('Y-m-d H:i:s');
        $actor = 'undo:' . $runId;
        $items = array_values(array_filter($rows, static fn (array $r) => $r['item_id'] !== null));
        $groups = array_values(array_unique(array_filter(array_column($rows, 'retired_grp_id'))));

        $db->transBegin();
        try {
            foreach (array_chunk($groups, 1000) as $chunk) {
                $db->table('inv_item_groups')->whereIn('item_grp_id', $chunk)->where('cmp_id', $cmpId)->update([
                    'deleted_at' => null, 'deleted_by' => null, 'is_active' => 1, 'updated_at' => $now,
                ]);
            }
            foreach ($items as $r) {
                $db->table('inv_items')->where('item_id', (int) $r['item_id'])->where('cmp_id', $cmpId)->update([
                    'item_sku'    => $r['old_item_sku'],
                    'item_grp_id' => $r['old_grp_id'] === null ? null : (int) $r['old_grp_id'],
                    'updated_by'  => $actor,
                    'updated_at'  => $now,
                ]);
            }
            if ($db->transStatus() === false) {
                $db->transRollback();
                CLI::error('Undo failed and was rolled back.');

                return EXIT_ERROR;
            }
            $db->transCommit();
        } catch (\Throwable $e) {
            $db->transRollback();
            CLI::error('Undo rolled back: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        $db->table(self::LOG_TABLE)->where('run_id', $runId)->where('cmp_id', $cmpId)->delete();
        CLI::write(sprintf('Reversed run %s: %d item(s) and %d group(s) restored.', $runId, count($items), count($groups)), 'green');
        $this->publishItems($cmpId, array_map(static fn (array $r) => (int) $r['item_id'], $items));

        return EXIT_SUCCESS;
    }

    /** @param list<int> $itemIds */
    private function publishItems(int $cmpId, array $itemIds): void
    {
        if ($itemIds === []) {
            return;
        }
        $mirror = new MasterMirrorService();
        $failed = 0;
        foreach ($itemIds as $itemId) {
            try {
                $mirror->publishItem($cmpId, $itemId);
            } catch (\Throwable) {
                $failed++;
            }
        }
        CLI::write(sprintf(
            '  queued %d item event(s) for Books%s — the outbox cron delivers them',
            count($itemIds) - $failed,
            $failed ? ", {$failed} could not be queued" : '',
        ));
    }

    private function ensureLogTable($db): void
    {
        if ($db->tableExists(self::LOG_TABLE)) {
            return;
        }
        $db->query('CREATE TABLE ' . self::LOG_TABLE . ' (
            id BIGSERIAL PRIMARY KEY,
            run_id VARCHAR(40) NOT NULL,
            cmp_id BIGINT NOT NULL,
            item_id BIGINT NULL,
            old_grp_id BIGINT NULL,
            old_item_sku VARCHAR(64) NULL,
            new_grp_id BIGINT NULL,
            new_item_sku VARCHAR(64) NULL,
            retired_grp_id BIGINT NULL,
            created_at TIMESTAMP NOT NULL
        )');
        $db->query('CREATE INDEX idx_' . self::LOG_TABLE . '_run ON ' . self::LOG_TABLE . ' (cmp_id, run_id)');
    }
}
