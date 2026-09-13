<?php

namespace App\Commands;

use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:purge-company --company 3 [--apply --confirm 3] [--restore --schema NAME]
 *
 * Removes every row belonging to one company, after copying them into a dated archive schema.
 *
 * This exists for companies deleted in Manage whose data survived here. Manage hard-deletes the
 * ghm_company row and cascades only within its own database; nothing tells Books or Inventory,
 * so the items, documents and stock stay. They are invisible — no Manage record means the company cannot
 * be opened — but they are still a customer's data after the customer asked for it to be gone,
 * and they keep appearing in the nightly reconciliation as an unexplained difference for a
 * company nobody can see.
 *
 * Every table in the public schema carrying a cmp_id column is included, discovered at run time
 * rather than listed, because a hard-coded list silently misses whatever was added since.
 *
 * Order of operations, all inside one transaction:
 *   1. copy each table's rows for the company into the archive schema
 *   2. delete them, retrying in passes so foreign keys resolve themselves
 *   3. if any table still holds rows after the passes, roll everything back
 *
 * Nothing happens without BOTH --apply and --confirm <the same company id>. The archive schema
 * makes it reversible with --restore until you drop it.
 */
class InventoryPurgeCompany extends BaseCommand
{
    protected $group       = 'Inventory';
    protected $name        = 'inventory:purge-company';
    protected $description = 'Archive and remove every row of one company (for companies deleted in Manage).';
    protected $usage       = 'inventory:purge-company --company N [--apply --confirm N] [--restore --schema NAME]';
    protected $options     = [
        '--company' => 'Company id to purge (required)',
        '--apply'   => 'Actually archive and delete. Requires --confirm with the same id',
        '--confirm' => 'Repeat the company id. Deliberate second step for an irreversible-looking operation',
        '--restore' => 'Put the rows back from the archive schema',
        '--schema'  => 'Archive schema name (default orphan_archive_c<id>_<today>)',
    ];

    public function run(array $params)
    {
        foreach ($_SERVER['argv'] ?? [] as $arg) {
            if (is_string($arg) && str_starts_with($arg, '--') && str_contains($arg, '=')) {
                [$k, $v] = explode('=', ltrim($arg, '-'), 2);
                $ref = new \ReflectionProperty(CLI::class, 'options');
                $ref->setAccessible(true);
                $opts = $ref->getValue();
                $opts[$k] ??= $v;
                $ref->setValue(null, $opts);
            }
        }

        $cmpId = (int) (CLI::getOption('company') ?? 0);
        if ($cmpId <= 0) {
            CLI::error('--company is required');

            return EXIT_ERROR;
        }
        $db = \Config\Database::connect();
        if ($db->DBDriver !== 'Postgre') {
            CLI::error('This command is PostgreSQL only.');

            return EXIT_ERROR;
        }

        $schema = trim((string) (CLI::getOption('schema') ?? '')) ?: 'orphan_archive_c' . $cmpId . '_' . date('Ymd');
        if (preg_match('/^[a-z_][a-z0-9_]{0,62}$/', $schema) !== 1) {
            CLI::error('--schema must be a plain lowercase identifier.');

            return EXIT_ERROR;
        }

        if (CLI::getOption('restore') !== null) {
            return $this->restore($db, $cmpId, $schema);
        }

        return $this->purge($db, $cmpId, $schema);
    }

    /** @return list<string> every public table carrying a cmp_id column */
    private function tablesWithCompany($db): array
    {
        $rows = $db->query(
            "SELECT table_name FROM information_schema.columns
             WHERE table_schema = 'public' AND column_name = 'cmp_id'
             ORDER BY table_name",
        )->getResultArray();

        return array_column($rows, 'table_name');
    }

    /**
     * Transactions are driven with raw BEGIN / COMMIT / ROLLBACK rather than CodeIgniter's
     * helpers. transStatus() marks a transaction failed on any query error, and this command
     * deliberately provokes errors: a delete that violates a foreign key is rolled back to its
     * savepoint and retried on a later pass. Through the helpers that bookkeeping makes every
     * run abort at the end, having changed nothing.
     */
    private function purge($db, int $cmpId, string $schema): int
    {
        $tables = $this->tablesWithCompany($db);
        if ($tables === []) {
            CLI::error('No table in this database has a cmp_id column.');

            return EXIT_ERROR;
        }

        $counts = [];
        $total = 0;
        foreach ($tables as $t) {
            $n = (int) ($db->query('SELECT COUNT(*) AS n FROM public."' . $t . '" WHERE cmp_id = ?', [$cmpId])
                ->getRowArray()['n'] ?? 0);
            if ($n > 0) {
                $counts[$t] = $n;
                $total += $n;
            }
        }

        CLI::write(sprintf('Company %d: %d table(s) of %d hold rows, %s row(s) in total',
            $cmpId, count($counts), count($tables), number_format($total)));
        foreach ($counts as $t => $n) {
            CLI::write(sprintf('  %-44s %10s', $t, number_format($n)));
        }
        if ($counts === []) {
            CLI::write('Nothing to purge.', 'green');

            return EXIT_SUCCESS;
        }

        $apply = CLI::getOption('apply') !== null;
        $confirm = (int) (CLI::getOption('confirm') ?? 0);
        if (!$apply) {
            CLI::write('');
            CLI::write('Dry run. Nothing was archived or deleted.', 'yellow');
            CLI::write(sprintf('To perform it: --apply --confirm %d', $cmpId));

            return EXIT_SUCCESS;
        }
        if ($confirm !== $cmpId) {
            CLI::error(sprintf('--apply needs --confirm %d as well. Nothing was touched.', $cmpId));

            return EXIT_ERROR;
        }

        $db->query('BEGIN');
        try {
            $db->query('CREATE SCHEMA IF NOT EXISTS "' . $schema . '"');
            foreach (array_keys($counts) as $t) {
                $db->query('CREATE TABLE "' . $schema . '"."' . $t . '" AS SELECT * FROM public."' . $t . '" WHERE cmp_id = ' . $cmpId);
            }
            CLI::write(sprintf('  archived %d table(s) into "%s"', count($counts), $schema), 'green');

            // Delete in passes with a savepoint each. A table whose rows are still referenced
            // fails, is rolled back to its savepoint and retried next pass, by which time its
            // dependants may be gone. This resolves ordering without hard-coding a dependency
            // graph that would rot the moment a table is added.
            $remaining = array_keys($counts);
            $pass = 0;
            while ($remaining !== [] && $pass < 12) {
                $pass++;
                $stuck = [];
                foreach ($remaining as $t) {
                    $db->query('SAVEPOINT sp_purge');
                    try {
                        $db->query('DELETE FROM public."' . $t . '" WHERE cmp_id = ' . $cmpId);
                        $db->query('RELEASE SAVEPOINT sp_purge');
                    } catch (\Throwable) {
                        $db->query('ROLLBACK TO SAVEPOINT sp_purge');
                        $stuck[] = $t;
                    }
                }
                if (count($stuck) === count($remaining)) {
                    // A whole pass with no progress: the rest are mutually dependent and no
                    // ordering will clear them. Better to abort than leave a half-purged company.
                    $db->query('ROLLBACK');
                    CLI::error('Could not delete these tables in any order — nothing was changed:');
                    foreach ($stuck as $t) {
                        CLI::write('  ' . $t, 'red');
                    }

                    return EXIT_ERROR;
                }
                $remaining = $stuck;
            }

            $db->query('COMMIT');
        } catch (\Throwable $e) {
            $db->query('ROLLBACK');
            CLI::error('Rolled back: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        CLI::write('');
        CLI::write(sprintf('Purged company %d: %s row(s) archived into "%s" and removed from public, in %d pass(es).',
            $cmpId, number_format($total), $schema, $pass), 'green');
        CLI::write('Reverse with: --restore --schema ' . $schema);
        CLI::write('Keep the schema until you are satisfied, then dump it and drop it.');

        return EXIT_SUCCESS;
    }

    private function restore($db, int $cmpId, string $schema): int
    {
        $rows = $db->query(
            'SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
            [$schema],
        )->getResultArray();
        $tables = array_column($rows, 'table_name');
        if ($tables === []) {
            CLI::error("Schema \"{$schema}\" is empty or does not exist.");

            return EXIT_ERROR;
        }
        CLI::write(sprintf('%d archived table(s) in "%s"', count($tables), $schema));

        if (CLI::getOption('apply') === null) {
            CLI::write('Dry run. Add --apply to put the rows back.', 'yellow');

            return EXIT_SUCCESS;
        }

        $db->query('BEGIN');
        try {
            // Insert in passes for the same reason the delete used them: a row whose parent is
            // not back yet fails, and succeeds on a later pass once it is.
            $remaining = $tables;
            $pass = 0;
            $restored = 0;
            while ($remaining !== [] && $pass < 12) {
                $pass++;
                $stuck = [];
                foreach ($remaining as $t) {
                    $db->query('SAVEPOINT sp_restore');
                    try {
                        $db->query('INSERT INTO public."' . $t . '" SELECT * FROM "' . $schema . '"."' . $t . '"');
                        $db->query('RELEASE SAVEPOINT sp_restore');
                        $restored++;
                    } catch (\Throwable) {
                        $db->query('ROLLBACK TO SAVEPOINT sp_restore');
                        $stuck[] = $t;
                    }
                }
                if (count($stuck) === count($remaining)) {
                    $db->query('ROLLBACK');
                    CLI::error('Could not restore these tables in any order — nothing was changed:');
                    foreach ($stuck as $t) {
                        CLI::write('  ' . $t, 'red');
                    }

                    return EXIT_ERROR;
                }
                $remaining = $stuck;
            }
            $db->query('COMMIT');
        } catch (\Throwable $e) {
            $db->query('ROLLBACK');
            CLI::error('Rolled back: ' . $e->getMessage());

            return EXIT_ERROR;
        }

        CLI::write(sprintf('Restored %d table(s) for company %d from "%s".', $restored, $cmpId, $schema), 'green');

        return EXIT_SUCCESS;
    }
}
