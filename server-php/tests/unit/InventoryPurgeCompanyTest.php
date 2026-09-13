<?php

use App\Commands\InventoryPurgeCompany;
use CodeIgniter\CLI\CLI;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../app/Commands/InventoryPurgeCompany.php';

/** The rows a stubbed statement hands back. */
final class StubPurgeResult
{
    public function __construct(private array $rows) {}

    public function getResultArray(): array
    {
        return $this->rows;
    }

    public function getRowArray(): ?array
    {
        return $this->rows[0] ?? null;
    }
}

/**
 * A connection that behaves the way the production one does, in the two ways that matter and
 * that the local fixture did not reproduce:
 *
 *   - a failing statement returns false rather than throwing, because CodeIgniter only throws
 *     when DBDebug is on and it is off outside the test suite;
 *   - once a statement inside a transaction fails, PostgreSQL refuses everything else until the
 *     savepoint or the transaction is rolled back, and it accepts COMMIT on an aborted
 *     transaction while silently performing a ROLLBACK.
 *
 * Together those turned a purge that deleted nothing into a purge that reported success. The
 * stub keeps committed and uncommitted state apart so a test can tell those two outcomes apart.
 */
final class StubAbortingPostgres
{
    public string $DBDriver = 'Postgre';

    /** @var list<string> */
    public array $log = [];

    public bool $committed = false;

    /** Set when COMMIT threw the work away, as PostgreSQL does on an aborted transaction. */
    public bool $discarded = false;

    /** @var array<string, int> */
    public array $archive = [];

    private bool $aborted = false;
    private bool $inTransaction = false;

    /** @var array<string, int>|null */
    private ?array $pending = null;

    /** @var array<string, int>|null */
    private ?array $pendingArchive = null;

    /** @var array{0: array<string, int>|null, 1: array<string, int>|null}|null */
    private ?array $savepoint = null;

    /**
     * @param array<string, int>    $rows            live row count per table
     * @param array<string, string> $blockedBy       table => the table whose rows must go first, or '*' for never
     * @param bool                  $discardAtCommit accept COMMIT and keep nothing, as an aborted transaction does
     * @param list<string>          $protected       tables the database guards with an append-only trigger
     */
    public function __construct(
        private array $rows,
        private array $blockedBy = [],
        private bool $discardAtCommit = false,
        private array $protected = [],
    ) {}

    /** @return array<string, int> */
    public function live(): array
    {
        return $this->rows;
    }

    /** @return array{code: string, message: string} */
    public function error(): array
    {
        return [
            'code'    => $this->aborted ? '25P02' : '23503',
            'message' => $this->aborted
                ? 'current transaction is aborted, commands ignored until end of transaction block'
                : 'update or delete on table violates foreign key constraint',
        ];
    }

    public function query(string $sql, $binds = null)
    {
        $this->log[] = $sql;

        if (str_starts_with($sql, 'ROLLBACK TO SAVEPOINT')) {
            $this->aborted = false;
            if ($this->savepoint !== null) {
                [$this->pending, $this->pendingArchive] = $this->savepoint;
            }

            return true;
        }
        if ($sql === 'ROLLBACK') {
            $this->discard();

            return true;
        }
        if ($sql === 'COMMIT') {
            if ($this->aborted || $this->discardAtCommit) {
                $this->discarded = true;
                $this->discard();

                return true;
            }
            $this->rows      = $this->pending ?? $this->rows;
            $this->archive   = $this->pendingArchive ?? $this->archive;
            $this->committed = true;
            $this->discard();

            return true;
        }
        if ($this->aborted) {
            return false;
        }
        if ($sql === 'BEGIN') {
            $this->inTransaction  = true;
            $this->pending        = $this->rows;
            $this->pendingArchive = $this->archive;

            return true;
        }
        if (str_starts_with($sql, 'SAVEPOINT')) {
            $this->savepoint = [$this->pending, $this->pendingArchive];

            return true;
        }
        if (str_starts_with($sql, 'RELEASE SAVEPOINT') || str_starts_with($sql, 'CREATE SCHEMA')) {
            return true;
        }
        if ($sql === 'SELECT 1') {
            return new StubPurgeResult([['?column?' => 1]]);
        }
        if (str_contains($sql, 'pg_trigger')) {
            return new StubPurgeResult(array_map(
                static fn (string $t): array => ['table_name' => $t],
                $this->protected,
            ));
        }
        if (str_contains($sql, 'information_schema.columns')) {
            return new StubPurgeResult(array_map(
                static fn (string $t): array => ['table_name' => $t],
                array_keys($this->rows),
            ));
        }
        if (preg_match('/^CREATE TABLE "[^"]+"\."([^"]+)" AS SELECT/', $sql, $m) === 1) {
            $this->pendingArchive ??= [];
            $this->pendingArchive[$m[1]] = $this->pending[$m[1]] ?? 0;

            return true;
        }
        if (preg_match('/^DELETE FROM public\."([^"]+)"/', $sql, $m) === 1) {
            $blocker = $this->blockedBy[$m[1]] ?? null;
            if ($blocker === '*' || ($blocker !== null && ($this->pending[$blocker] ?? 0) > 0)) {
                $this->aborted = true;

                return false;
            }
            $this->pending ??= [];
            $this->pending[$m[1]] = 0;

            return true;
        }
        if (preg_match('/^SELECT COUNT\(\*\) AS n FROM "?([a-z_][a-z0-9_]*)"?\."([^"]+)"/', $sql, $m) === 1) {
            [, $schema, $table] = $m;
            if ($schema === 'public') {
                $source = $this->inTransaction ? ($this->pending ?? $this->rows) : $this->rows;

                return new StubPurgeResult([['n' => $source[$table] ?? 0]]);
            }
            $source = $this->inTransaction ? ($this->pendingArchive ?? $this->archive) : $this->archive;
            if (! array_key_exists($table, $source)) {
                return false; // relation does not exist
            }

            return new StubPurgeResult([['n' => $source[$table]]]);
        }

        return true;
    }

    private function discard(): void
    {
        $this->aborted        = false;
        $this->inTransaction  = false;
        $this->pending        = null;
        $this->pendingArchive = null;
        $this->savepoint      = null;
    }
}

/**
 * The purge must never report success it did not achieve.
 *
 * Its first sandbox run printed that it had archived thirty-one tables and removed three
 * thousand six hundred rows, and had done neither: a foreign key blocked the first DELETE, the
 * failure arrived as a false return rather than an exception, so the savepoint was never rolled
 * back, and COMMIT on the aborted transaction was a ROLLBACK.
 */
final class InventoryPurgeCompanyTest extends TestCase
{
    private const COMPANY = 3;

    /** @var array<string, mixed>|null */
    private $savedOptions;

    protected function setUp(): void
    {
        $ref = new ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $this->savedOptions = $ref->getValue();
        $ref->setValue(null, ['company' => self::COMPANY, 'apply' => true, 'confirm' => self::COMPANY]);
    }

    protected function tearDown(): void
    {
        $ref = new ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $this->savedOptions ?? []);
    }

    private function purge(StubAbortingPostgres $db): int
    {
        $command = (new ReflectionClass(InventoryPurgeCompany::class))->newInstanceWithoutConstructor();
        $method  = new ReflectionMethod(InventoryPurgeCompany::class, 'purge');
        $method->setAccessible(true);

        return (int) $method->invoke($command, $db, self::COMPANY, 'orphan_archive_test');
    }

    public function testFailsWhenNoOrderOfDeletesClearsTheCompany(): void
    {
        $db = new StubAbortingPostgres(
            ['t_headers' => 223, 't_lines' => 400],
            ['t_headers' => '*', 't_lines' => '*'],
        );

        $this->assertSame(EXIT_ERROR, $this->purge($db), 'a purge that deletes nothing must fail');
        $this->assertFalse($db->committed, 'nothing may be committed');
        $this->assertSame(['t_headers' => 223, 't_lines' => 400], $db->live(), 'the live rows must be untouched');
    }

    public function testRollsBackToTheSavepointWhenADeleteFails(): void
    {
        // The regression. The failure arrives as a false return, not an exception; if it goes
        // unnoticed the savepoint is never rolled back and the transaction is already dead.
        $db = new StubAbortingPostgres(
            ['t_headers' => 223, 't_lines' => 400],
            ['t_headers' => 't_lines'],
        );

        $this->assertSame(EXIT_SUCCESS, $this->purge($db));
        $this->assertContains('ROLLBACK TO SAVEPOINT sp_purge', $db->log,
            'the blocked DELETE must be rolled back to its savepoint');
        $this->assertFalse($db->discarded, 'the commit must not have been downgraded to a rollback');
    }

    public function testArchivesAndRemovesEveryRowOnceTheOrderResolves(): void
    {
        $db = new StubAbortingPostgres(
            ['t_headers' => 223, 't_lines' => 400],
            ['t_headers' => 't_lines'],
        );

        $this->assertSame(EXIT_SUCCESS, $this->purge($db));
        $this->assertTrue($db->committed);
        $this->assertSame(['t_headers' => 0, 't_lines' => 0], $db->live());
        $this->assertSame(['t_headers' => 223, 't_lines' => 400], $db->archive);
    }

    public function testRefusesWhenATableIsAppendOnlyButNotDeclaredRetained(): void
    {
        // A table hardened after RETAINED was written. Purging it would fail halfway through,
        // so the command stops before touching anything rather than finding out mid-transaction.
        $db = new StubAbortingPostgres(
            ['t_headers' => 223],
            [],
            false,
            ['zz_hardened_later'],
        );

        $this->assertSame(EXIT_ERROR, $this->purge($db));
        $this->assertFalse($db->committed);
        $this->assertNotContains('BEGIN', $db->log, 'it must refuse before opening a transaction');
        $this->assertSame(['t_headers' => 223], $db->live());
    }

    public function testLeavesTheAuditTrailWhereItIs(): void
    {
        // Books retains its audit trail for eight years under statute. Inventory owns the stock
        // domain now, so its audit of that domain is the other half of the same record; deleting
        // one while the other is kept leaves a purged company's history half destroyed.
        $db = new StubAbortingPostgres(['inv_audit_log' => 2, 't_documents' => 38]);

        $this->assertSame(EXIT_SUCCESS, $this->purge($db));
        $this->assertSame(['inv_audit_log' => 2, 't_documents' => 0], $db->live(),
            'the audit rows must still be in public');
        $this->assertSame(['t_documents' => 38], $db->archive,
            'the audit rows must not be copied into an archive schema that later gets dropped');
        $this->assertNotContains('DELETE FROM public."inv_audit_log" WHERE cmp_id = 3', $db->log);
    }

    public function testFailsWhenTheCommitKeepsNothing(): void
    {
        // A connection that accepts every statement and throws the work away at COMMIT: what an
        // aborted transaction looks like from PHP. Only reading the rows back catches it.
        $db = new StubAbortingPostgres(['t_headers' => 223], [], true);

        $this->assertSame(EXIT_ERROR, $this->purge($db), 'a discarded commit must not report success');
        $this->assertSame(['t_headers' => 223], $db->live());
    }
}
