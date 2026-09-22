<?php

namespace Tests\Integration;

use App\Commands\InventoryReconcile;
use CodeIgniter\CLI\CLI;
use Tests\Support\IntegrationTestCase;

require_once __DIR__ . '/../../app/Commands/InventoryReconcile.php';

/**
 * `inventory:reconcile --due=N` exists so a nightly `--all` sweep (one Books HTTP round-trip
 * plus a valuation snapshot per company, sequentially, in one process) doesn't have to become an
 * hours-long job as the company count grows. It reconciles only the N companies least recently
 * reconciled instead of everyone in one pass, and relies on that ordering — never on skipping a
 * company for having no new Inventory activity, since Books can post a manual journal straight
 * onto its stock ledger with no Inventory-side signal at all (ReconciliationService's
 * manual_journal bucket exists for exactly that). These tests cover the selection query and the
 * option-validation guards; the actual per-company reconciliation run is covered elsewhere
 * (ReconciliationBreakdownTest) and isn't re-exercised here, since it needs a reachable Books.
 *
 * @group integration
 */
final class ReconcileDueBatchTest extends IntegrationTestCase
{
    /** @var array<string, mixed>|null */
    private $savedOptions;

    protected function setUp(): void
    {
        parent::setUp();
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $this->savedOptions = $ref->getValue();
    }

    protected function tearDown(): void
    {
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $this->savedOptions ?? []);
        parent::tearDown();
    }

    private function command(): InventoryReconcile
    {
        return (new \ReflectionClass(InventoryReconcile::class))->newInstanceWithoutConstructor();
    }

    private function runCommand(array $options): int
    {
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $options);

        return (int) $this->command()->run([]);
    }

    /** A company just needs one row in inv_documents to be in the --all / --due universe. */
    private function makeCompanyWithDocument(int $cmpId): void
    {
        $this->db->table('inv_company_settings')->insert([
            'cmp_id' => $cmpId, 'default_valuation_method' => 'FIFO', 'valuation_scope' => 'company',
            'negative_stock_policy' => 'allow', 'created_at' => date('Y-m-d H:i:s'),
        ]);
        $this->db->table('inv_documents')->insert([
            'cmp_id' => $cmpId, 'fy_id' => $this->fyId, 'document_type' => 'PHYSICAL_ADJUSTMENT', 'document_date' => '2026-04-05',
        ]);
    }

    private function recordReconciliationRun(int $cmpId, string $createdAt): void
    {
        $this->db->table('inv_reconciliation_runs')->insert([
            'cmp_id' => $cmpId, 'fy_id' => $this->fyId, 'bo_id' => 0, 'as_of_date' => '2026-09-20',
            'inventory_closing_value' => 0, 'inventory_closing_qty' => 0, 'status' => 'COMPLETED', 'created_at' => $createdAt,
        ]);
    }

    public function testNeverReconciledCompaniesSortFirstInStableCmpIdOrder(): void
    {
        // cmpId 101 already exists from IntegrationTestCase::setUp(); give it a document too.
        $this->db->table('inv_documents')->insert(['cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'document_type' => 'PHYSICAL_ADJUSTMENT', 'document_date' => '2026-04-05']);
        $this->makeCompanyWithDocument(202);
        $this->makeCompanyWithDocument(303);

        $due = $this->command()->dueCompanies(2);

        self::assertSame([101, 202], $due, 'none of the three has ever been reconciled, so the two lowest cmp_id break the tie');
    }

    public function testAlreadyReconciledCompaniesRotateOldestFirst(): void
    {
        $this->db->table('inv_documents')->insert(['cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'document_type' => 'PHYSICAL_ADJUSTMENT', 'document_date' => '2026-04-05']);
        $this->makeCompanyWithDocument(202);
        $this->makeCompanyWithDocument(303);
        // 101 checked 3 days ago, 303 checked 2 days ago, 202 checked 1 hour ago -- 202 is the
        // freshest, so it must be the one left out of a batch of 2.
        $this->recordReconciliationRun($this->cmpId, date('Y-m-d H:i:s', strtotime('-3 days')));
        $this->recordReconciliationRun(303, date('Y-m-d H:i:s', strtotime('-2 days')));
        $this->recordReconciliationRun(202, date('Y-m-d H:i:s', strtotime('-1 hour')));

        $due = $this->command()->dueCompanies(2);

        self::assertSame([101, 303], $due, 'the two least recently reconciled companies, oldest first');
    }

    public function testACompanyNeverReconciledOutranksOneCheckedLongAgo(): void
    {
        $this->db->table('inv_documents')->insert(['cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'document_type' => 'PHYSICAL_ADJUSTMENT', 'document_date' => '2026-04-05']);
        $this->makeCompanyWithDocument(202);
        // 101 was reconciled a year ago; 202 has never been reconciled at all.
        $this->recordReconciliationRun($this->cmpId, date('Y-m-d H:i:s', strtotime('-1 year')));

        $due = $this->command()->dueCompanies(1);

        self::assertSame([202], $due, 'never-reconciled is more overdue than reconciled a year ago');
    }

    public function testDueCannotBeCombinedWithCompany(): void
    {
        $exit = $this->runCommand(['due' => '2', 'company' => '101']);

        self::assertSame(EXIT_USER_INPUT, $exit);
    }

    public function testDueCannotBeCombinedWithAll(): void
    {
        $exit = $this->runCommand(['due' => '2', 'all' => '1']);

        self::assertSame(EXIT_USER_INPUT, $exit);
    }

    public function testDueRejectsZeroOrNegative(): void
    {
        self::assertSame(EXIT_USER_INPUT, $this->runCommand(['due' => '0']));
        self::assertSame(EXIT_USER_INPUT, $this->runCommand(['due' => '-5']));
    }
}
