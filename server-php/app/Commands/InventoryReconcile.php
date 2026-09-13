<?php

namespace App\Commands;

use App\Services\ReconciliationService;
use App\Services\StockBalanceService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:reconcile [--company 1,2 | --all] [--as-of YYYY-MM-DD] [--bo 0]
 *
 * Runs the Inventory ↔ Books reconciliation for the latest financial year of each company
 * and prints the unexplained difference. Schedule nightly; non-zero exit when any company
 * has an unexplained difference or Books was unreachable.
 */
class InventoryReconcile extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:reconcile';
    protected $description = 'Reconcile Inventory closing stock value with the Books Stock-in-Hand ledger per company.';
    protected $usage       = 'inventory:reconcile [--company 1,2 | --all] [--as-of YYYY-MM-DD] [--bo 0]';
    protected $options     = [
        '--company' => 'Comma separated cmp_ids',
        '--all'     => 'Every company that has documents',
        '--as-of'   => 'Closing date (default today)',
        '--bo'      => 'Branch (default 0 = consolidated)',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        foreach ($_SERVER['argv'] ?? [] as $arg) {
            if (is_string($arg) && str_starts_with($arg, '--') && str_contains($arg, '=')) {
                [$k, $v] = explode('=', ltrim($arg, '-'), 2);
                $ref = new \ReflectionProperty(CLI::class, 'options');
                $ref->setAccessible(true);
                $opts = $ref->getValue();
                $opts[$k] = $v;
                $ref->setValue(null, $opts);
            }
        }
        $db = \Config\Database::connect();
        $companies = array_values(array_filter(array_map('intval', explode(',', (string) (CLI::getOption('company') ?? '')))));
        if ($companies === [] && CLI::getOption('all') !== null) {
            $companies = array_map(static fn ($r) => (int) $r['cmp_id'], $db->query('SELECT DISTINCT cmp_id FROM inv_documents ORDER BY cmp_id')->getResultArray());
        }
        if ($companies === []) {
            CLI::error('Give --company=1,2 or --all');

            return EXIT_USER_INPUT;
        }
        $asOf = (string) (CLI::getOption('as-of') ?? date('Y-m-d'));
        $boId = (int) (CLI::getOption('bo') ?? 0);
        $svc = new ReconciliationService();
        $balances = new StockBalanceService();
        $bad = 0;
        foreach ($companies as $cmpId) {
            $fyId = $balances->latestFyId($cmpId);
            if ($fyId <= 0) {
                CLI::write(sprintf('  cmp %d: no financial year with documents, skipped', $cmpId), 'yellow');
                continue;
            }
            try {
                $r = $svc->run($cmpId, $fyId, $boId, $asOf, 'cli:inventory-reconcile');
                $status = (string) ($r['status'] ?? '?');
                $unexplained = (float) ($r['breakdown']['buckets']['unexplained']['amount'] ?? 0);
                $ok = $status === 'COMPLETED' && abs($unexplained) < 0.005;
                $bad += $ok ? 0 : 1;
                CLI::write(sprintf('  cmp %d fy %d: %s inventory=%s books=%s difference=%s unexplained=%s', $cmpId, $fyId, $status, $r['inventory_closing_value'] ?? '?', $r['books_stock_ledger_balance'] ?? 'n/a', $r['difference'] ?? 'n/a', number_format($unexplained, 2, '.', '')), $ok ? 'green' : 'red');
                if (!$ok && !empty($r['breakdown']['books']['error'])) {
                    CLI::write('    books: ' . $r['breakdown']['books']['error'], 'yellow');
                }
            } catch (\Throwable $e) {
                $bad++;
                CLI::error(sprintf('  cmp %d: %s', $cmpId, $e->getMessage()));
            }
        }

        return $bad > 0 ? EXIT_ERROR : EXIT_SUCCESS;
    }
}
