<?php

namespace App\Commands;

use App\Services\StockBalanceService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:rebuild-balances --cmp=ID|all [--fy=ID]
 *
 * Rebuilds the materialised on-hand quantities (inv_stock_balances.on_hand_qty) of a company from
 * the authoritative walk: financial-year opening + posted stock movements. Status buckets
 * (reserved, packed, in transit ...) are preserved. Without --fy the latest year with movements
 * or openings is used.
 *
 * --cmp=all loops every company id inv_company_settings knows about (the same source
 * inventory:find-orphan-companies and inventory:backfill-opening-value --company all use), running
 * the identical per-company rebuild for each. --fy cannot be combined with --cmp=all, since each
 * company's own latest year is what "rebuild everything" means, not one shared year.
 *
 * THE BUG THIS FIXES: fy_id = 0 is the legitimate "inception, no year-end close has run yet"
 * sentinel (see inv_item_openings' schema comment) — it is real data, not an absence of it. The
 * previous version of this command, and Migrator::buildMovementsAndBalances() during the original
 * cutover, both treated `latestFyId() <= 0` as "nothing to rebuild" and silently skipped the
 * rebuild entirely for any company still in its first year at that moment — leaving
 * inv_stock_balances holding only the handful of legacy status-bucket rows the migration copied
 * separately (packed/job-worker counts, on_hand_qty always 0), which is why the Stock Balance
 * screen for an affected company can show a small fraction of its real item roster. rebuildOnHand()
 * itself has always handled fy_id = 0 correctly (openings are read via source_kind =
 * 'master_inception' at fy_id 0); the bug was purely in this command's — and the migrator's — guard
 * refusing to call it.
 */
class InventoryRebuildBalances extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:rebuild-balances';
    protected $description = 'Rebuild materialised on-hand stock balances from openings + movements.';
    protected $usage       = 'inventory:rebuild-balances --cmp=ID|all [--fy=ID]';
    protected $options     = [
        '--cmp' => 'Company id, or "all" for every company inv_company_settings knows about (required).',
        '--fy'  => 'Financial year id (default: latest year with movements or openings). Not allowed with --cmp=all.',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        $cmpOpt = trim((string) (CLI::getOption('cmp') ?? $params['cmp'] ?? ''));
        if ($cmpOpt === '') {
            CLI::error('--cmp=ID is required, or --cmp=all.');
            CLI::write($this->usage);

            return EXIT_ERROR;
        }
        $fyOpt = CLI::getOption('fy') ?? $params['fy'] ?? null;
        $fyId = $fyOpt !== null && $fyOpt !== '' ? (int) $fyOpt : null;
        if ($fyId !== null && $fyId <= 0) {
            CLI::error('--fy must be a positive financial year id.');

            return EXIT_ERROR;
        }

        if (strtolower($cmpOpt) === 'all') {
            if ($fyId !== null) {
                CLI::error('--fy cannot be combined with --cmp=all — each company uses its own latest year.');

                return EXIT_ERROR;
            }

            return $this->runAllCompanies();
        }

        $cmpId = (int) $cmpOpt;
        if ($cmpId <= 0) {
            CLI::error('--cmp must be a positive company id, or "all".');
            CLI::write($this->usage);

            return EXIT_ERROR;
        }

        [$exit] = $this->runForCompany($cmpId, $fyId);

        return $exit;
    }

    /**
     * Loops the identical per-company rebuild over every company id inv_company_settings knows
     * about. Reported, not thrown: one company's failure never keeps the rest from being tried.
     */
    private function runAllCompanies(): int
    {
        $db = \Config\Database::connect();
        $companyIds = array_map(
            static fn (array $r): int => (int) $r['cmp_id'],
            $db->table('inv_company_settings')->select('cmp_id')->orderBy('cmp_id', 'ASC')->get()->getResultArray()
        );
        if ($companyIds === []) {
            CLI::write('No companies found in inv_company_settings.', 'green');

            return EXIT_SUCCESS;
        }

        CLI::write(sprintf('inventory:rebuild-balances --cmp=all: %d compan%s', count($companyIds), count($companyIds) === 1 ? 'y' : 'ies'));

        $overallExit = EXIT_SUCCESS;
        $totalRows = 0;
        $companiesErrored = 0;
        foreach ($companyIds as $cmpId) {
            try {
                [$exit, $rows] = $this->runForCompany($cmpId, null);
            } catch (\Throwable $e) {
                CLI::error(sprintf('cmp %d: stopped: %s', $cmpId, $e->getMessage()));
                $companiesErrored++;
                $overallExit = EXIT_ERROR;
                continue;
            }
            $totalRows += $rows;
            if ($exit !== EXIT_SUCCESS) {
                $overallExit = EXIT_ERROR;
            }
        }

        CLI::write('');
        CLI::write(sprintf(
            'ALL COMPANIES: %d balance row(s) written across %d compan%s, %d errored.',
            $totalRows,
            count($companyIds),
            count($companyIds) === 1 ? 'y' : 'ies',
            $companiesErrored
        ), $overallExit === EXIT_SUCCESS ? 'green' : 'yellow');

        return $overallExit;
    }

    /**
     * The single-company rebuild — behaviourally identical to this command before --cmp=all
     * existed, aside from no longer treating a resolved fy_id of 0 as "nothing to do."
     *
     * protected (not private) solely so tests can subclass it to prove --cmp=all isolates one
     * company's thrown failure from the rest of the loop, without needing to fabricate a real
     * database-level fault.
     *
     * @return array{0:int, 1:int} exit code, rows written
     */
    protected function runForCompany(int $cmpId, ?int $fyId): array
    {
        $service = new StockBalanceService();
        $started = microtime(true);
        try {
            $effectiveFy = $fyId ?? $service->latestFyId($cmpId);
            CLI::write(sprintf('Rebuilding on-hand balances for cmp=%d fy=%d ...', $cmpId, $effectiveFy));
            $rows = $service->rebuildOnHand($cmpId, $effectiveFy);
        } catch (\Throwable $e) {
            CLI::error('Rebuild failed: ' . $e->getMessage());

            return [EXIT_ERROR, 0];
        }
        if ($rows === 0) {
            CLI::write(sprintf('Company %d: no opening or movement rows found for fy=%d; nothing to rebuild.', $cmpId, $effectiveFy), 'yellow');

            return [EXIT_SUCCESS, 0];
        }
        CLI::write(sprintf('Done. %d item/warehouse balance row(s) written for cmp=%d fy=%d (%ss).', $rows, $cmpId, $effectiveFy, round(microtime(true) - $started, 2)), 'green');

        return [EXIT_SUCCESS, $rows];
    }
}
