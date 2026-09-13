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
 * rather than listed, because a hard-coded list silently misses whatever was added since — except
 * the audit tables, which are retained deliberately. See RETAINED.
 *
 * Order of operations, all inside one transaction:
 *   1. copy each table's rows for the company into the archive schema
 *   2. delete them, retrying in passes so foreign keys resolve themselves
 *   3. if any table still holds rows after the passes, roll everything back
 *   4. after committing, read the rows back and prove they moved
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

    /**
     * Tables a company purge must not touch.
     *
     * Nothing here is append-only today. Books keeps its audit trail under an eight-year
     * statutory retention, enforced by a BEFORE DELETE trigger in the database; this database
     * has no equivalent, so the list is empty.
     *
     * Empty is not the same as absent. appendOnlyTables() below reads the catalogue on every
     * run, and if a table here is ever hardened without being added to this list, the purge
     * refuses rather than deleting records something went to the trouble of protecting.
     */
    private const RETAINED = [];

    /**
     * Tables the database protects with an append-only trigger.
     *
     * Read from the catalogue rather than trusted from RETAINED, so the two can be compared. A
     * table hardened after this list was written would otherwise be purged, and a guard dropped
     * from a table still listed here would hide that the protection is gone.
     *
     * @return list<string>
     */
    private function appendOnlyTables($db): array
    {
        $res = $db->query(
            "SELECT DISTINCT c.relname AS table_name
               FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE n.nspname = 'public'
                AND NOT t.tgisinternal
                AND (t.tgtype & 8) <> 0
                AND p.proname LIKE '%deny_mutation%'",
        );

        return $res === false ? [] : array_column($res->getResultArray(), 'table_name');
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
     * Run one statement and say whether it worked.
     *
     * A failing query does not necessarily raise anything. CodeIgniter only throws when DBDebug
     * is on, and it is off in both apps outside the test suite; with it off, query() returns
     * false. Catching the exception alone therefore missed every real failure: a DELETE blocked
     * by a foreign key looked like a success, its savepoint was never rolled back, the
     * transaction sat in PostgreSQL's aborted state where nothing else could run — and COMMIT on
     * an aborted transaction is accepted and silently performs a ROLLBACK. The command printed
     * that it had purged the company and had changed nothing. Every statement here goes through
     * this method, and the result is checked.
     */
    private function exec($db, string $sql): bool
    {
        try {
            return $db->query($sql) !== false;
        } catch (\Throwable) {
            return false;
        }
    }

    private function lastError($db): string
    {
        $err = $db->error();
        $msg = trim((string) ($err['message'] ?? ''));

        return $msg !== '' ? preg_replace('/\s+/', ' ', $msg) : 'the driver gave no message';
    }

    /** Count rows for the company, or -1 if the table cannot be read at all. */
    private function countIn($db, string $schema, string $table, ?int $cmpId): int
    {
        $sql = 'SELECT COUNT(*) AS n FROM "' . $schema . '"."' . $table . '"'
            . ($cmpId !== null ? ' WHERE cmp_id = ' . $cmpId : '');
        try {
            $res = $db->query($sql);
        } catch (\Throwable) {
            return -1;
        }

        return $res === false ? -1 : (int) ($res->getRowArray()['n'] ?? 0);
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

        $protected = $this->appendOnlyTables($db);
        $undeclared = array_values(array_diff($protected, self::RETAINED));
        if ($undeclared !== []) {
            CLI::error('These tables are append-only in the database but are not listed in RETAINED:');
            foreach ($undeclared as $t) {
                CLI::write('  ' . $t, 'red');
            }
            CLI::write('Purging them would fail halfway, or worse, succeed. Add them to RETAINED with');
            CLI::write('the reason they are protected, or remove the trigger. Nothing was touched.');

            return EXIT_ERROR;
        }

        $found = [];
        foreach ($tables as $t) {
            $n = $this->countIn($db, 'public', $t, $cmpId);
            if ($n > 0) {
                $found[$t] = $n;
            }
        }
        $keep = array_flip(self::RETAINED);
        $counts = array_diff_key($found, $keep);
        $retained = array_intersect_key($found, $keep);
        $total = array_sum($counts);

        CLI::write(sprintf('Company %d: %d table(s) of %d hold rows to purge, %s row(s) in total',
            $cmpId, count($counts), count($tables), number_format($total)));
        foreach ($counts as $t => $n) {
            CLI::write(sprintf('  %-44s %10s', $t, number_format($n)));
        }
        if ($retained !== []) {
            CLI::write('');
            CLI::write(sprintf('Retained, not purged — append-only under statutory retention, %s row(s):',
                number_format(array_sum($retained))), 'yellow');
            foreach ($retained as $t => $n) {
                CLI::write(sprintf('  %-44s %10s', $t, number_format($n)), 'yellow');
            }
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

        if (!$this->exec($db, 'BEGIN')) {
            CLI::error('Could not open a transaction: ' . $this->lastError($db));

            return EXIT_ERROR;
        }

        if (!$this->exec($db, 'CREATE SCHEMA IF NOT EXISTS "' . $schema . '"')) {
            return $this->abort($db, 'Could not create schema "' . $schema . '": ' . $this->lastError($db));
        }
        foreach (array_keys($counts) as $t) {
            $sql = 'CREATE TABLE "' . $schema . '"."' . $t . '" AS SELECT * FROM public."' . $t . '" WHERE cmp_id = ' . $cmpId;
            if (!$this->exec($db, $sql)) {
                return $this->abort($db, 'Could not archive ' . $t . ': ' . $this->lastError($db));
            }
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
                if (!$this->exec($db, 'SAVEPOINT sp_purge')) {
                    return $this->abort($db, 'Could not set a savepoint before deleting from ' . $t . ': ' . $this->lastError($db));
                }
                if ($this->exec($db, 'DELETE FROM public."' . $t . '" WHERE cmp_id = ' . $cmpId)) {
                    if (!$this->exec($db, 'RELEASE SAVEPOINT sp_purge')) {
                        return $this->abort($db, 'Deleted from ' . $t . ' but could not release the savepoint: ' . $this->lastError($db));
                    }

                    continue;
                }
                // Read the reason before rolling back: the rollback clears it, and the reason is
                // the only thing that distinguishes "retry next pass" from "this will never work".
                $stuck[$t] = $this->lastError($db);
                if (!$this->exec($db, 'ROLLBACK TO SAVEPOINT sp_purge')) {
                    return $this->abort($db, 'Could not recover the transaction after ' . $t . ' failed: ' . $this->lastError($db));
                }
            }
            if (count($stuck) === count($remaining)) {
                // A whole pass with no progress: the rest are mutually dependent and no
                // ordering will clear them. Better to abort than leave a half-purged company.
                $this->exec($db, 'ROLLBACK');
                CLI::error('Could not delete these tables in any order — nothing was changed:');
                foreach ($stuck as $t => $why) {
                    CLI::write('  ' . $t . ': ' . $why, 'red');
                }

                return EXIT_ERROR;
            }
            $remaining = array_keys($stuck);
        }
        if ($remaining !== []) {
            $this->exec($db, 'ROLLBACK');
            CLI::error(sprintf('Still %d table(s) undeleted after %d passes — nothing was changed:', count($remaining), $pass));
            foreach ($remaining as $t) {
                CLI::write('  ' . $t, 'red');
            }

            return EXIT_ERROR;
        }

        // PostgreSQL accepts COMMIT on an aborted transaction and rolls back instead. Asking for
        // one trivial row first tells us which of the two we are about to get.
        if (!$this->exec($db, 'SELECT 1')) {
            $this->exec($db, 'ROLLBACK');
            CLI::error('The transaction was in an aborted state before committing, so nothing was changed.');

            return EXIT_ERROR;
        }
        if (!$this->exec($db, 'COMMIT')) {
            $this->exec($db, 'ROLLBACK');
            CLI::error('The commit failed and nothing was changed: ' . $this->lastError($db));

            return EXIT_ERROR;
        }

        return $this->verify($db, $cmpId, $schema, $counts, $retained, $total, $pass);
    }

    /** Roll back, say why, and fail. */
    private function abort($db, string $why): int
    {
        $this->exec($db, 'ROLLBACK');
        CLI::error('Rolled back, nothing was changed: ' . $why);

        return EXIT_ERROR;
    }

    /**
     * Read the rows back after committing.
     *
     * Everything above can fail without raising: a statement that returns false instead of
     * throwing, or a COMMIT that PostgreSQL downgrades to a rollback. A purge that reports
     * success it did not achieve is worse than one that fails, because the next thing anyone
     * does is stop looking. The only evidence worth printing is the rows themselves.
     *
     * @param array<string, int> $counts
     * @param array<string, int> $retained
     */
    private function verify($db, int $cmpId, string $schema, array $counts, array $retained, int $total, int $pass): int
    {
        $stillLive = [];
        $notArchived = [];
        foreach ($counts as $t => $n) {
            $live = $this->countIn($db, 'public', $t, $cmpId);
            if ($live !== 0) {
                $stillLive[$t] = $live;
            }
            $kept = $this->countIn($db, $schema, $t, null);
            if ($kept !== $n) {
                $notArchived[$t] = $kept;
            }
        }

        if ($stillLive !== [] || $notArchived !== []) {
            CLI::error('The purge reported no error but the rows did not move. Treat this database as untouched and investigate before retrying.');
            foreach ($stillLive as $t => $n) {
                CLI::write(sprintf('  %-44s %s still in public', $t, $n < 0 ? 'unreadable' : number_format($n) . ' row(s)'), 'red');
            }
            foreach ($notArchived as $t => $n) {
                CLI::write(sprintf('  %-44s archive holds %s, expected %s', $t,
                    $n < 0 ? 'no table' : number_format($n), number_format($counts[$t])), 'red');
            }

            return EXIT_ERROR;
        }

        CLI::write('');
        CLI::write(sprintf('Purged company %d: %s row(s) archived into "%s" and removed from public, in %d pass(es).',
            $cmpId, number_format($total), $schema, $pass), 'green');
        CLI::write(sprintf('Verified: %d table(s) now hold 0 rows for the company, and the archive holds every row.', count($counts)), 'green');
        if ($retained !== []) {
            CLI::write(sprintf('%s audit row(s) across %d table(s) were deliberately left in place under their retention policy.',
                number_format(array_sum($retained)), count($retained)), 'yellow');
        }
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

        $expected = [];
        foreach ($tables as $t) {
            $expected[$t] = $this->countIn($db, $schema, $t, null);
        }

        if (!$this->exec($db, 'BEGIN')) {
            CLI::error('Could not open a transaction: ' . $this->lastError($db));

            return EXIT_ERROR;
        }

        // Insert in passes for the same reason the delete used them: a row whose parent is
        // not back yet fails, and succeeds on a later pass once it is.
        $remaining = $tables;
        $pass = 0;
        $restored = 0;
        while ($remaining !== [] && $pass < 12) {
            $pass++;
            $stuck = [];
            foreach ($remaining as $t) {
                if (!$this->exec($db, 'SAVEPOINT sp_restore')) {
                    return $this->abort($db, 'Could not set a savepoint before restoring ' . $t . ': ' . $this->lastError($db));
                }
                if ($this->exec($db, 'INSERT INTO public."' . $t . '" SELECT * FROM "' . $schema . '"."' . $t . '"')) {
                    if (!$this->exec($db, 'RELEASE SAVEPOINT sp_restore')) {
                        return $this->abort($db, 'Restored ' . $t . ' but could not release the savepoint: ' . $this->lastError($db));
                    }
                    $restored++;

                    continue;
                }
                $stuck[$t] = $this->lastError($db);
                if (!$this->exec($db, 'ROLLBACK TO SAVEPOINT sp_restore')) {
                    return $this->abort($db, 'Could not recover the transaction after ' . $t . ' failed: ' . $this->lastError($db));
                }
            }
            if (count($stuck) === count($remaining)) {
                $this->exec($db, 'ROLLBACK');
                CLI::error('Could not restore these tables in any order — nothing was changed:');
                foreach ($stuck as $t => $why) {
                    CLI::write('  ' . $t . ': ' . $why, 'red');
                }

                return EXIT_ERROR;
            }
            $remaining = array_keys($stuck);
        }
        if ($remaining !== []) {
            $this->exec($db, 'ROLLBACK');
            CLI::error(sprintf('Still %d table(s) unrestored after %d passes — nothing was changed.', count($remaining), $pass));

            return EXIT_ERROR;
        }

        if (!$this->exec($db, 'SELECT 1')) {
            $this->exec($db, 'ROLLBACK');
            CLI::error('The transaction was in an aborted state before committing, so nothing was changed.');

            return EXIT_ERROR;
        }
        if (!$this->exec($db, 'COMMIT')) {
            $this->exec($db, 'ROLLBACK');
            CLI::error('The commit failed and nothing was changed: ' . $this->lastError($db));

            return EXIT_ERROR;
        }

        $short = [];
        foreach ($expected as $t => $n) {
            $back = $this->countIn($db, 'public', $t, $cmpId);
            if ($back < $n) {
                $short[$t] = $back;
            }
        }
        if ($short !== []) {
            CLI::error('The restore reported no error but the rows are not back. Investigate before retrying.');
            foreach ($short as $t => $back) {
                CLI::write(sprintf('  %-44s public holds %s, archive holds %s', $t,
                    $back < 0 ? 'unreadable' : number_format($back), number_format($expected[$t])), 'red');
            }

            return EXIT_ERROR;
        }

        CLI::write(sprintf('Restored %d table(s) for company %d from "%s", and read the rows back.', $restored, $cmpId, $schema), 'green');

        return EXIT_SUCCESS;
    }
}
