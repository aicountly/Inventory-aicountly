<?php

namespace App\Commands;

use App\Services\StockBalanceService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:rebuild-balances --cmp=ID [--fy=ID]
 *
 * Rebuilds the materialised on-hand quantities (inv_stock_balances.on_hand_qty) of a company from
 * the authoritative walk: financial-year opening + posted stock movements. Status buckets
 * (reserved, packed, in transit ...) are preserved. Without --fy the latest year with movements
 * or openings is used.
 */
class InventoryRebuildBalances extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:rebuild-balances';
    protected $description = 'Rebuild materialised on-hand stock balances from openings + movements.';
    protected $usage       = 'inventory:rebuild-balances --cmp=ID [--fy=ID]';
    protected $options     = [
        '--cmp' => 'Company id (required).',
        '--fy'  => 'Financial year id (default: latest year with movements or openings).',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        $cmpId = (int) (CLI::getOption('cmp') ?? $params['cmp'] ?? 0);
        if ($cmpId <= 0) {
            CLI::error('--cmp=ID is required.');
            CLI::write($this->usage);

            return EXIT_ERROR;
        }
        $fyOpt = CLI::getOption('fy') ?? $params['fy'] ?? null;
        $fyId = $fyOpt !== null && $fyOpt !== '' ? (int) $fyOpt : null;
        if ($fyId !== null && $fyId <= 0) {
            CLI::error('--fy must be a positive financial year id.');

            return EXIT_ERROR;
        }

        $service = new StockBalanceService();
        $started = microtime(true);
        try {
            $effectiveFy = $fyId ?? $service->latestFyId($cmpId);
            if ($effectiveFy <= 0) {
                CLI::write(sprintf('Company %d has no openings or movements; nothing to rebuild.', $cmpId), 'yellow');

                return EXIT_SUCCESS;
            }
            CLI::write(sprintf('Rebuilding on-hand balances for cmp=%d fy=%d ...', $cmpId, $effectiveFy));
            $rows = $service->rebuildOnHand($cmpId, $effectiveFy);
        } catch (\Throwable $e) {
            CLI::error('Rebuild failed: ' . $e->getMessage());

            return EXIT_ERROR;
        }
        CLI::write(sprintf('Done. %d item/warehouse balance row(s) written for cmp=%d fy=%d (%ss).', $rows, $cmpId, $effectiveFy, round(microtime(true) - $started, 2)), 'green');

        return EXIT_SUCCESS;
    }
}
