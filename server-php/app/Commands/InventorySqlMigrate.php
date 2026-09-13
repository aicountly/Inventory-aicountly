<?php

namespace App\Commands;

use App\Services\InventorySqlMigrationRunner;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:sql-migrate [--status] [--mark-all-applied] [001 002 ...]
 */
class InventorySqlMigrate extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:sql-migrate';
    protected $description = 'Apply pending SQL migrations from database/migrations/';
    protected $usage       = 'inventory:sql-migrate [options] [001] [002] ...';
    protected $arguments   = ['migrations' => 'Optional migration prefixes. Omit to run all pending.'];
    protected $options     = [
        '--status'           => 'List applied vs pending migrations (no changes).',
        '--mark-all-applied' => 'Record all migration files as applied without running SQL.',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        $filters = array_values(array_filter(array_map('trim', $params)));
        try {
            $runner = new InventorySqlMigrationRunner();
        } catch (\Throwable $e) {
            CLI::error($e->getMessage());

            return EXIT_ERROR;
        }

        if (CLI::getOption('status') !== null) {
            $status = $runner->status($filters !== [] ? $filters : null);
            foreach ($status['applied'] as $f) {
                CLI::write("applied  {$f}", 'green');
            }
            foreach ($status['pending'] as $f) {
                CLI::write("pending  {$f}", 'yellow');
            }

            return EXIT_SUCCESS;
        }

        if (CLI::getOption('mark-all-applied') !== null) {
            foreach ($runner->markAllApplied($filters !== [] ? $filters : null) as $f) {
                CLI::write("marked {$f}", 'green');
            }

            return EXIT_SUCCESS;
        }

        $result = $runner->runPending($filters !== [] ? $filters : null);
        foreach ($result['skipped'] as $f) {
            CLI::write("Skip {$f} (already applied)", 'yellow');
        }
        foreach ($result['applied'] as $f) {
            CLI::write("Applied {$f}", 'green');
        }
        if ($result['failed'] !== null) {
            CLI::error('Migration failed: ' . $result['failed']);

            return EXIT_ERROR;
        }
        CLI::write($result['applied'] === [] ? 'Nothing to do.' : 'Done. Applied ' . count($result['applied']) . ' migration(s).', 'green');

        return EXIT_SUCCESS;
    }
}
