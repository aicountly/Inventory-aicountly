<?php

namespace App\Commands;

use App\Services\Migration\BooksSource;
use App\Services\Migration\ControlTotals;
use App\Services\Migration\MigrationLog;
use App\Services\Migration\Migrator;
use App\Services\Migration\Precheck;
use App\Services\Migration\SequenceResetter;
use App\Services\Migration\TableMap;
use App\Services\Migration\Validator;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:migrate-books --stage=precheck|migrate|validate|sequences|cutover|postcheck|rollback
 *      [--run-id=ID] [--company=1,2,3] [--dry-run] [--replace] [--tolerance=0.01]
 *
 * Source: Books PostgreSQL (BOOKS_DB_* env). Destination: this API's database.default.
 * Every stage writes writable/migration/<run-id>/<stage>.jsonl and <stage>.summary.json.
 */
class InventoryMigrateBooks extends BaseCommand
{
    protected $group       = 'Inventory';
    protected $name        = 'inventory:migrate-books';
    protected $description = 'Migrate inventory-owned data from the Books database (rehearsable, idempotent, logged).';
    protected $usage       = 'inventory:migrate-books --stage=precheck|migrate|validate|sequences|cutover|postcheck|rollback [--run-id=] [--company=] [--dry-run] [--replace]';
    private ?string $booksSnapshotDir = null;

    protected $options     = [
        '--stage'     => 'precheck | migrate | validate | sequences | cutover | postcheck | rollback',
        '--run-id'    => 'Run identifier (default: date-time). Reuse it across stages of one migration.',
        '--company'   => 'Comma separated cmp_ids (default: every company found in Books).',
        '--dry-run'   => 'migrate: run inside a transaction and roll back. sequences: report only.',
        '--replace'   => 'migrate: delete the company\'s previously migrated rows first (rehearsal only).',
        '--tolerance' => 'Money tolerance for validate (default 0.01).',
        '--yes'       => 'rollback: confirm deletion of migrated rows for the given run-id.',
        '--books-snapshot' => 'validate/postcheck/cutover: directory of JSON files from `php spark books:export-inventory-snapshot` to compare item-wise closing qty and valuation.',
    ];

    public function run(array $params)
    {
        $this->normaliseOptions();
        $stage = strtolower((string) (CLI::getOption('stage') ?? ''));
        $runId = (string) (CLI::getOption('run-id') ?? date('Ymd-His'));
        $companies = array_values(array_filter(array_map('intval', explode(',', (string) (CLI::getOption('company') ?? '')))));
        $dryRun = CLI::getOption('dry-run') !== null;
        $replace = CLI::getOption('replace') !== null;
        $tolerance = (float) (CLI::getOption('tolerance') ?? 0.01);
        $this->booksSnapshotDir = CLI::getOption('books-snapshot') !== null ? (string) CLI::getOption('books-snapshot') : null;
        if (!in_array($stage, ['precheck', 'migrate', 'validate', 'sequences', 'cutover', 'postcheck', 'rollback'], true)) {
            CLI::error('Unknown --stage. Use precheck | migrate | validate | sequences | cutover | postcheck | rollback');

            return EXIT_USER_INPUT;
        }
        $log = new MigrationLog($runId, $stage);
        CLI::write("Inventory migration run {$runId} — stage {$stage}", 'yellow');
        CLI::write('Logs: ' . $log->dir());
        try {
            $code = match ($stage) {
                'precheck' => $this->precheck($log, $companies),
                'migrate' => $this->migrate($log, $runId, $companies, $dryRun, $replace),
                'validate', 'postcheck' => $this->validate($log, $companies, $tolerance),
                'sequences' => $this->sequences($log, $dryRun),
                'cutover' => $this->cutover($log, $companies, $tolerance),
                'rollback' => $this->rollback($log, $runId, CLI::getOption('yes') !== null),
            };
        } catch (\Throwable $e) {
            $log->event('stage_exception', ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()], 'error');
            $log->finish('failed');
            CLI::error('Stage failed: ' . $e->getMessage());

            return EXIT_ERROR;
        }
        $path = $log->finish($code === EXIT_SUCCESS ? 'ok' : 'failed');
        CLI::write('Summary: ' . $path, $code === EXIT_SUCCESS ? 'green' : 'red');

        return $code;
    }

    /**
     * CodeIgniter's CLI parser only understands `--opt value`; runbooks (and
     * muscle memory) use `--opt=value`. Accept both so a mistyped stage never
     * silently falls back to "unknown".
     */
    private function normaliseOptions(): void
    {
        foreach ($_SERVER['argv'] ?? [] as $arg) {
            if (!is_string($arg) || strpos($arg, '--') !== 0 || strpos($arg, '=') === false) {
                continue;
            }
            [$key, $value] = explode('=', ltrim($arg, '-'), 2);
            if (CLI::getOption($key) === null) {
                $options = CLI::getOptions();
                $options[$key] = $value;
                $ref = new \ReflectionProperty(CLI::class, 'options');
                $ref->setAccessible(true);
                $ref->setValue(null, $options);
            }
        }
    }

    private function precheck(MigrationLog $log, array $companies): int
    {
        $books = BooksSource::connection();
        $result = (new Precheck($books, $log))->run($companies);
        $log->set('table_map', ['masters' => TableMap::MASTERS, 'transactions' => TableMap::TRANSACTIONS, 'retained_in_books' => TableMap::RETAINED_IN_BOOKS]);
        foreach ($result['row_counts'] as $t => $n) {
            CLI::write(sprintf('  %-45s %10d', $t, $n));
        }
        foreach ($result['orphans'] as $k => $v) {
            if ($v['count'] > 0) {
                CLI::write(sprintf('  orphan %-40s %8d %s', $k, $v['count'], $v['blocking'] ? 'BLOCKING' : 'warning'), $v['blocking'] ? 'red' : 'yellow');
            }
        }
        foreach ($result['duplicates'] as $k => $v) {
            if ($v['count'] > 0) {
                CLI::write(sprintf('  duplicate %-37s %8d', $k, $v['count']), 'yellow');
            }
        }
        foreach ($result['consistency'] ?? [] as $k => $v) {
            if ($v['count'] > 0) {
                CLI::write(sprintf('  consistency %-35s %8d  (review before cutover; see precheck.jsonl)', $k, $v['count']), 'yellow');
            }
        }
        if ($result['blocking'] !== []) {
            foreach ($result['blocking'] as $b) {
                CLI::error('  BLOCKING: ' . $b);
            }
            CLI::error('PRECHECK failed — resolve blocking findings (or document an approved exception) before MIGRATE.');

            return EXIT_ERROR;
        }
        CLI::write('PRECHECK ok — baselines recorded.', 'green');

        return EXIT_SUCCESS;
    }

    private function migrate(MigrationLog $log, string $runId, array $companies, bool $dryRun, bool $replace): int
    {
        $books = BooksSource::connection();
        $inv = \Config\Database::connect();
        $m = new Migrator($books, $inv, $log, $runId, $dryRun, $replace);
        if ($companies === []) {
            $companies = $m->discoverCompanies();
        }
        $log->set('companies', $companies);
        $log->set('dry_run', $dryRun);
        $all = [];
        $failed = [];
        foreach ($companies as $cmpId) {
            CLI::write("  company {$cmpId} ...");
            try {
                $stats = $m->migrateCompany($cmpId);
                $all[$cmpId] = $stats;
                $docs = $stats['tables']['inv_documents']['inserted'] ?? 0;
                $lines = $stats['tables']['inv_document_lines']['inserted'] ?? 0;
                $items = $stats['tables']['inv_items']['inserted'] ?? 0;
                CLI::write("    items {$items}, documents {$docs}, lines {$lines}" . ($stats['warnings'] ? ', warnings ' . count($stats['warnings']) : ''), 'green');
            } catch (\Throwable $e) {
                $failed[$cmpId] = $e->getMessage();
                CLI::error("    FAILED: " . $e->getMessage());
            }
        }
        $log->set('per_company', $all);
        $log->set('failed', $failed);
        if (!$dryRun && $failed === []) {
            $seq = (new SequenceResetter($inv))->resetAll();
            $log->set('sequences', $seq);
            CLI::write('  sequences reset: ' . count($seq), 'green');
        }
        if ($failed !== []) {
            return EXIT_ERROR;
        }
        CLI::write($dryRun ? 'MIGRATE dry run complete (rolled back).' : 'MIGRATE complete.', 'green');

        return EXIT_SUCCESS;
    }

    private function validate(MigrationLog $log, array $companies, float $tolerance): int
    {
        $books = BooksSource::connection();
        $inv = \Config\Database::connect();
        $result = (new Validator($books, $inv, $log))->run($companies, $tolerance, 0.0001, $this->booksSnapshotDir);
        foreach ($result['warnings'] as $w) {
            CLI::write('  warning: ' . $w, 'yellow');
        }
        foreach ($result['failures'] as $f) {
            CLI::write('  FAIL: ' . $f, 'red');
        }
        if (!$result['ok']) {
            CLI::error('VALIDATE failed — every difference above must be explained and approved before cutover.');

            return EXIT_ERROR;
        }
        CLI::write('VALIDATE ok — all control totals reconcile.', 'green');

        return EXIT_SUCCESS;
    }

    private function sequences(MigrationLog $log, bool $dryRun): int
    {
        $inv = \Config\Database::connect();
        $r = new SequenceResetter($inv);
        $rows = $r->resetAll('inv_', $dryRun);
        $log->set('sequences', $rows);
        foreach ($rows as $s) {
            CLI::write(sprintf('  %-32s max %10d  seq %10d -> %10d  next %d', $s['table'], $s['max_id'], $s['before'], $s['after'], $s['next']));
        }
        $probe = $r->probe();
        $log->set('probe', $probe);
        $bad = array_filter($probe, static fn ($p) => !$p['ok']);
        if ($bad !== []) {
            CLI::error('Sequence probe failed for: ' . implode(', ', array_map(static fn ($p) => $p['table'], $bad)));

            return EXIT_ERROR;
        }
        CLI::write('Sequences ok.', 'green');

        return EXIT_SUCCESS;
    }

    /** CUTOVER = final validate + sequences + marker row; the runbook drives maintenance mode / deploys around it. */
    private function cutover(MigrationLog $log, array $companies, float $tolerance): int
    {
        $v = $this->validate($log, $companies, $tolerance);
        if ($v !== EXIT_SUCCESS) {
            return $v;
        }
        $s = $this->sequences($log, false);
        if ($s !== EXIT_SUCCESS) {
            return $s;
        }
        $inv = \Config\Database::connect();
        $inv->query('CREATE TABLE IF NOT EXISTS inv_migration_runs (run_id VARCHAR(64) PRIMARY KEY, stage VARCHAR(32) NOT NULL, companies_json JSONB NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
        $inv->query('INSERT INTO inv_migration_runs (run_id, stage, companies_json) VALUES (?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET stage = EXCLUDED.stage, companies_json = EXCLUDED.companies_json, created_at = CURRENT_TIMESTAMP', [basename($log->dir()), 'cutover', json_encode($companies)]);
        CLI::write('CUTOVER checks passed and recorded. Switch Books INVENTORY_MODE=live and deploy per DB_MIGRATION_RUNBOOK.md.', 'green');

        return EXIT_SUCCESS;
    }

    /** Remove every row this run wrote to the Inventory database (source Books is untouched by design). */
    private function rollback(MigrationLog $log, string $runId, bool $confirmed): int
    {
        if (!$confirmed) {
            CLI::error('Rollback deletes all rows migrated under run-id ' . $runId . ' from the Inventory database. Re-run with --yes to confirm.');

            return EXIT_USER_INPUT;
        }
        $inv = \Config\Database::connect();
        $rows = $inv->table('inv_legacy_id_map')->select('cmp_id, target_table, target_id')->where('migration_run_id', $runId)->get()->getResultArray();
        $byTable = [];
        foreach ($rows as $r) {
            $byTable[$r['target_table']][] = (int) $r['target_id'];
        }
        $pk = ['inv_items' => 'item_id', 'inv_item_groups' => 'item_grp_id', 'inv_stock_categories' => 'stock_cat_id', 'inv_uom' => 'unit_id', 'inv_warehouse_groups' => 'warehouse_group_id', 'inv_warehouses' => 'warehouse_id', 'inv_item_uoms' => 'item_unit_line_id', 'inv_bom_headers' => 'bom_id', 'inv_bom_lines' => 'bom_line_id', 'inv_item_openings' => 'opening_id', 'inv_fy_carryforward_status' => 'id', 'inv_documents' => 'document_id', 'inv_document_lines' => 'line_id', 'inv_cost_layers' => 'layer_id', 'inv_stock_balances' => 'balance_id', 'inv_stock_status_movements' => 'ledger_id', 'inv_pending_quantities' => 'pending_id', 'inv_pending_settlements' => 'settlement_id', 'inv_document_snapshots' => 'snap_id'];
        $order = ['inv_stock_movements', 'inv_pending_settlements', 'inv_pending_quantities', 'inv_packing_meta', 'inv_document_snapshots', 'inv_cost_layer_consumptions', 'inv_cost_layers', 'inv_stock_status_movements', 'inv_stock_balances', 'inv_document_lines', 'inv_documents', 'inv_item_openings', 'inv_fy_carryforward_status', 'inv_bom_lines', 'inv_bom_headers', 'inv_item_uoms', 'inv_items', 'inv_warehouses', 'inv_warehouse_groups', 'inv_uom', 'inv_stock_categories', 'inv_item_groups'];
        $companies = array_values(array_unique(array_map(static fn ($r) => (int) $r['cmp_id'], $rows)));
        $inv->transStart();
        $deleted = [];
        $docIds = $byTable['inv_documents'] ?? [];
        foreach ($order as $t) {
            // Derived rows carry no legacy id: movements are stamped with the run, the
            // rest hang off the run's documents. Never touch rows a live document wrote.
            if ($t === 'inv_stock_movements') {
                if ($companies !== []) {
                    $inv->table($t)->whereIn('cmp_id', $companies)->where('created_by', 'migration:' . $runId)->delete();
                    $deleted[$t] = ($deleted[$t] ?? 0) + (int) $inv->affectedRows();
                }
                continue;
            }
            if ($t === 'inv_cost_layer_consumptions' || $t === 'inv_packing_meta') {
                foreach (array_chunk($docIds, 1000) as $chunk) {
                    $inv->table($t)->whereIn('document_id', $chunk)->delete();
                    $deleted[$t] = ($deleted[$t] ?? 0) + (int) $inv->affectedRows();
                }
                continue;
            }
            if (empty($byTable[$t])) {
                continue;
            }
            foreach (array_chunk($byTable[$t], 1000) as $chunk) {
                $inv->table($t)->whereIn($pk[$t], $chunk)->delete();
                $deleted[$t] = ($deleted[$t] ?? 0) + count($chunk);
            }
        }
        if ($companies !== []) {
            // WAC state was copied 1:1 from Books for these companies; the run owns it.
            $inv->table('inv_wac_state')->whereIn('cmp_id', $companies)->where('warehouse_id', 0)->delete();
            $deleted['inv_wac_state'] = (int) $inv->affectedRows();
            // On-hand balance rows are materialised from the run's movements (no legacy id).
            // Remove them only for companies with no live (non-migrated) documents left.
            foreach ($companies as $cmpId) {
                $live = (int) $inv->table('inv_documents')->where('cmp_id', $cmpId)->where('legacy_source_table', null)->countAllResults();
                if ($live > 0) {
                    CLI::write("  company {$cmpId}: keeping materialised balances (has {$live} live documents)", 'yellow');
                    continue;
                }
                $inv->table('inv_stock_balances')->where('cmp_id', $cmpId)->where('legacy_source_id', null)->delete();
                $deleted['inv_stock_balances.materialised'] = ($deleted['inv_stock_balances.materialised'] ?? 0) + (int) $inv->affectedRows();
            }
        }
        $inv->table('inv_legacy_id_map')->where('migration_run_id', $runId)->delete();
        $inv->transComplete();
        (new SequenceResetter($inv))->resetAll();
        $log->set('deleted', $deleted);
        $log->set('companies', $companies);
        foreach ($deleted as $t => $n) {
            CLI::write(sprintf('  deleted %-30s %8d', $t, $n));
        }
        CLI::write('ROLLBACK complete for run ' . $runId . '. Books was never written; restore its snapshot only if Books code was cut over.', 'green');

        return EXIT_SUCCESS;
    }
}
