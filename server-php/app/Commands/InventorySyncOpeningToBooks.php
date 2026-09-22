<?php

namespace App\Commands;

use App\Services\OpeningValueSyncService;
use App\Services\ReconciliationService;
use App\Services\StockBalanceService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:sync-opening-to-books --company 1,2 [--dry-run]
 * php spark inventory:sync-opening-to-books --all [--dry-run]
 *
 * One-time / on-demand backfill: pushes each company's current opening-stock value to Books for
 * companies whose gap already exists (Books never got an opening because the company predates
 * this sync, or its opening was entered before Books had anything to receive it into). The
 * ongoing case — a company entering openings for the first time from now on — is handled
 * automatically by ItemsController::writeOpenings() calling OpeningValueSyncService on every
 * save; this command exists only to catch up companies that are already live.
 *
 * Deliberately NOT a cron target: this is a manual catch-up tool for a known, small set of
 * companies, not a recurring sweep. Do not add it to crontab.
 *
 * Books decides on its own, per company/FY, whether it is safe to apply the pushed value — it
 * never overwrites an opening a human already entered, whatever the pushed figure says. This
 * command cannot make that unsafe; the worst it can do is enqueue a push Books goes on to ignore.
 */
class InventorySyncOpeningToBooks extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:sync-opening-to-books';
    protected $description = 'Push each company\'s current opening-stock value to Books\' Stock-in-Hand FY opening (fills a missing one only; never overwrites a human entry).';
    protected $usage       = 'inventory:sync-opening-to-books [--company 1,2 | --all] [--dry-run]';
    protected $options     = [
        '--company'  => 'Comma separated cmp_ids',
        '--all'      => 'Every company that has documents, in one run',
        '--dry-run'  => 'Print the resolved value per company without enqueueing anything',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        $db = \Config\Database::connect();

        $companies = array_values(array_filter(array_map('intval', explode(',', (string) (CLI::getOption('company') ?? '')))));
        if ($companies === [] && CLI::getOption('all') !== null) {
            $companies = array_map(static fn ($r) => (int) $r['cmp_id'], $db->query('SELECT DISTINCT cmp_id FROM inv_documents ORDER BY cmp_id')->getResultArray());
        }
        if ($companies === []) {
            CLI::error('Give --company=1,2 or --all');

            return EXIT_USER_INPUT;
        }

        $dryRun = CLI::getOption('dry-run') !== null;
        $balances = new StockBalanceService();
        $reconciliation = new ReconciliationService();
        $sync = new OpeningValueSyncService();
        $skipped = 0;

        foreach ($companies as $cmpId) {
            $fyId = $balances->latestFyId($cmpId);
            if ($fyId <= 0) {
                CLI::write(sprintf('  cmp %d: no financial year with documents, skipped', $cmpId), 'yellow');
                $skipped++;
                continue;
            }
            if ($dryRun) {
                $value = round($reconciliation->inventoryOpeningValue($cmpId, $fyId, 0), 4);
                CLI::write(sprintf('  cmp %d fy %d: would push opening_value=%s', $cmpId, $fyId, number_format($value, 2, '.', '')));
                continue;
            }
            $sync->syncIfChanged($cmpId, $fyId);
            CLI::write(sprintf('  cmp %d fy %d: enqueued (Books applies it only if it has no opening there yet)', $cmpId, $fyId), 'green');
        }

        CLI::write(sprintf(
            'inventory:sync-opening-to-books: %d compan%s processed, %d skipped (no financial year)%s',
            count($companies) - $skipped,
            count($companies) - $skipped === 1 ? 'y' : 'ies',
            $skipped,
            $dryRun ? ' — dry run, nothing enqueued' : '',
        ));

        return EXIT_SUCCESS;
    }
}
