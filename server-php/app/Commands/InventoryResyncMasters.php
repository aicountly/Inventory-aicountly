<?php

namespace App\Commands;

use App\Services\MasterMirrorService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:resync-masters --company=1,2 | --all
 *
 * Enqueues an inventory.uom.upserted / inventory.warehouse.upserted / inventory.item.upserted
 * outbox event for every live master row of the given companies, so Books' read-only mirror can
 * be (re)built from scratch. Delivery happens through the usual dispatcher
 * (php spark inventory:outbox-dispatch).
 */
class InventoryResyncMasters extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:resync-masters';
    protected $description = 'Enqueue a mirror upsert event for every live item, unit and warehouse (first sync of Books\' mirror).';
    protected $usage       = 'inventory:resync-masters --company=1,2 | --all';
    protected $options     = [
        '--company' => 'Comma separated cmp_ids',
        '--all'     => 'Every company that owns at least one live master row',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        // CodeIgniter's CLI parser only understands `--opt value`; runbooks use `--opt=value`. Accept both.
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
        $service = new MasterMirrorService();
        $companies = array_values(array_filter(array_map('intval', explode(',', (string) (CLI::getOption('company') ?? $params['company'] ?? '')))));
        if ($companies === [] && CLI::getOption('all') !== null) {
            $companies = $service->companiesWithMasters();
        }
        if ($companies === []) {
            CLI::error('Give --company=1,2 or --all');
            CLI::write($this->usage);

            return EXIT_USER_INPUT;
        }
        $failed = 0;
        $total = ['uoms' => 0, 'warehouses' => 0, 'items' => 0];
        foreach ($companies as $cmpId) {
            $started = microtime(true);
            try {
                $counts = $service->resyncCompany($cmpId);
            } catch (\Throwable $e) {
                $failed++;
                CLI::error(sprintf('  cmp %d: %s', $cmpId, $e->getMessage()));
                continue;
            }
            foreach ($counts as $k => $n) {
                $total[$k] += $n;
            }
            CLI::write(sprintf('  cmp %d: units %d, warehouses %d, items %d queued (%ss)', $cmpId, $counts['uoms'], $counts['warehouses'], $counts['items'], round(microtime(true) - $started, 2)), 'green');
        }
        CLI::write(sprintf('Queued %d unit, %d warehouse and %d item events for %d company(ies). Deliver them with inventory:outbox-dispatch.', $total['uoms'], $total['warehouses'], $total['items'], count($companies) - $failed), $failed > 0 ? 'yellow' : 'green');

        return $failed > 0 ? EXIT_ERROR : EXIT_SUCCESS;
    }
}
