<?php

namespace Tests\Integration;

use App\Commands\InventoryPurgeCompany;
use CodeIgniter\CLI\CLI;
use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Database\Config as Db;
use Tests\Support\IntegrationTestCase;

require_once __DIR__ . '/../../app/Commands/InventoryPurgeCompany.php';

/**
 * The purge against a real PostgreSQL, on a connection configured the way production is.
 *
 * The unit test models PostgreSQL's aborted-transaction behaviour; this one uses it. It is the
 * test that would have caught the original defect, and it needs two things the rest of the suite
 * does not do:
 *
 *   - DBDebug off, as it is in every deployed environment. The `tests` group turns it on, which
 *     is what hid the bug: with it on CodeIgniter throws and the command's old error handling
 *     worked, with it off query() returns false and nothing noticed.
 *   - a foreign key the first DELETE cannot satisfy, which is the ordinary case for a company
 *     with documents and lines. The tables are named so the parent sorts first, because the
 *     command deletes in the order information_schema returns.
 *
 * @group integration
 */
final class PurgeCompanyTest extends IntegrationTestCase
{
    private const COMPANY = 9901;
    private const OTHER_COMPANY = 9902;
    private const SCHEMA = 'orphan_archive_purge_test';

    private BaseConnection $raw;

    /** @var array<string, mixed>|null */
    private $savedOptions;

    protected function setUp(): void
    {
        parent::setUp();

        // Same server, same database, but DBDebug off: the production contract, where a failing
        // statement is a false return rather than an exception.
        $config = (new \Config\Database())->tests;
        $config['DBDebug'] = false;
        $this->raw = Db::connect($config, false);
        $this->raw->initialize();

        $this->dropFixture();
        $this->raw->query('CREATE TABLE zz_purge_a_parent (id serial PRIMARY KEY, cmp_id int NOT NULL, label text)');
        $this->raw->query('CREATE TABLE zz_purge_b_child (id serial PRIMARY KEY, cmp_id int NOT NULL, parent_id int NOT NULL REFERENCES zz_purge_a_parent (id))');

        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $this->savedOptions = $ref->getValue();
        $ref->setValue(null, ['company' => self::COMPANY, 'apply' => true, 'confirm' => self::COMPANY]);
    }

    protected function tearDown(): void
    {
        $this->dropFixture();

        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $this->savedOptions ?? []);

        parent::tearDown();
    }

    private function dropFixture(): void
    {
        $this->raw->query('ROLLBACK');
        $this->raw->query('DROP TABLE IF EXISTS zz_purge_b_child');
        $this->raw->query('DROP TABLE IF EXISTS zz_purge_a_parent');
        $this->raw->query('DROP SCHEMA IF EXISTS "' . self::SCHEMA . '" CASCADE');
    }

    private function seed(int $childCompany): void
    {
        $this->raw->query('INSERT INTO zz_purge_a_parent (cmp_id, label) VALUES (' . self::COMPANY . ", 'kept')");
        $parentId = (int) $this->raw->query('SELECT id FROM zz_purge_a_parent ORDER BY id DESC LIMIT 1')->getRowArray()['id'];
        for ($i = 0; $i < 3; $i++) {
            $this->raw->query('INSERT INTO zz_purge_b_child (cmp_id, parent_id) VALUES (' . $childCompany . ', ' . $parentId . ')');
        }
    }

    private function rows(string $sql): int
    {
        $res = $this->raw->query($sql);

        return $res === false ? -1 : (int) ($res->getRowArray()['n'] ?? 0);
    }

    private function purge(): int
    {
        $command = (new \ReflectionClass(InventoryPurgeCompany::class))->newInstanceWithoutConstructor();
        $method  = new \ReflectionMethod(InventoryPurgeCompany::class, 'purge');
        $method->setAccessible(true);

        return (int) $method->invoke($command, $this->raw, self::COMPANY, self::SCHEMA);
    }

    public function testArchivesAndRemovesEveryRowThroughTheForeignKey(): void
    {
        $this->seed(self::COMPANY);

        $this->assertSame(EXIT_SUCCESS, $this->purge());

        $this->assertSame(0, $this->rows('SELECT COUNT(*) AS n FROM zz_purge_a_parent WHERE cmp_id = ' . self::COMPANY));
        $this->assertSame(0, $this->rows('SELECT COUNT(*) AS n FROM zz_purge_b_child WHERE cmp_id = ' . self::COMPANY));
        $this->assertSame(1, $this->rows('SELECT COUNT(*) AS n FROM "' . self::SCHEMA . '".zz_purge_a_parent'));
        $this->assertSame(3, $this->rows('SELECT COUNT(*) AS n FROM "' . self::SCHEMA . '".zz_purge_b_child'));
    }

    public function testFailsAndChangesNothingWhenAnotherCompanyStillReferencesTheRows(): void
    {
        // The parent belongs to the company being purged, the children to another one, so the
        // foreign key can never be satisfied. Before the fix this printed that it had archived
        // and removed everything, and had committed nothing.
        $this->seed(self::OTHER_COMPANY);

        $this->assertSame(EXIT_ERROR, $this->purge(), 'a purge that cannot delete must not report success');

        $this->assertSame(1, $this->rows('SELECT COUNT(*) AS n FROM zz_purge_a_parent WHERE cmp_id = ' . self::COMPANY),
            'the rows must still be there');
        $this->assertSame(3, $this->rows('SELECT COUNT(*) AS n FROM zz_purge_b_child WHERE cmp_id = ' . self::OTHER_COMPANY),
            "the other company's rows must be untouched");
        $this->assertSame(0, $this->rows(
            "SELECT COUNT(*) AS n FROM information_schema.schemata WHERE schema_name = '" . self::SCHEMA . "'",
        ), 'the archive schema must have been rolled back with everything else');
    }
}
