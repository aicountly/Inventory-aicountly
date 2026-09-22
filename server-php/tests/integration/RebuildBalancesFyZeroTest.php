<?php

namespace Tests\Integration;

use App\Commands\InventoryRebuildBalances;
use App\Services\StockBalanceService;
use CodeIgniter\CLI\CLI;
use Tests\Support\IntegrationTestCase;

require_once __DIR__ . '/../../app/Commands/InventoryRebuildBalances.php';

/**
 * fy_id = 0 is the legitimate "inception, no year-end close yet" sentinel (see
 * inv_item_openings' schema comment), not an absence of data. `inventory:rebuild-balances`
 * used to treat `latestFyId() <= 0` as "nothing to rebuild" and silently skip the rebuild
 * entirely for any company still in its first year — leaving inv_stock_balances empty (or
 * holding only migrated legacy bucket rows, always at on_hand_qty=0) while the item master
 * still lists every item. This is the mechanism behind a Stock Balance screen showing far
 * fewer records than a company's real item roster.
 *
 * @group integration
 */
final class RebuildBalancesFyZeroTest extends IntegrationTestCase
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

    private function runCommand(array $options): ?int
    {
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $options);

        return (new \ReflectionClass(InventoryRebuildBalances::class))->newInstanceWithoutConstructor()->run([]);
    }

    private function balanceRow(int $cmpId, int $itemId): ?array
    {
        return $this->db->table('inv_stock_balances')->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getRowArray() ?: null;
    }

    public function testRebuildsFromInceptionOpeningsWhenTheCompanyHasNoCarryForwardYet(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs);
        // Only a master_inception (fy_id=0) opening -- no carry-forward, no movements. Before the
        // fix, latestFyId() resolves to 0 and the old guard skipped rebuildOnHand() entirely.
        $this->setOpening($item, $pcs, 10, 100, 0, $wh);

        $exit = $this->runCommand(['cmp' => (string) $this->cmpId]);

        self::assertSame(0, $exit);
        $row = $this->balanceRow($this->cmpId, $item);
        self::assertNotNull($row, 'a company stuck at fy_id=0 must still get a real balance row, not a silent no-op');
        self::assertEqualsWithDelta(10.0, (float) $row['on_hand_qty'], 0.0001);
    }

    public function testStillRebuildsCorrectlyWhenACarryForwardYearAlreadyExists(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs);
        $targetFy = $this->fyId + 1;
        $this->db->table('inv_fy_carryforward_status')->insert([
            'cmp_id' => $this->cmpId, 'source_fy_id' => $this->fyId, 'target_fy_id' => $targetFy, 'bo_id' => 0, 'status' => 'completed',
        ]);
        $this->setOpening($item, $pcs, 25, 150, $targetFy, $wh);

        $exit = $this->runCommand(['cmp' => (string) $this->cmpId]);

        self::assertSame(0, $exit);
        $row = $this->balanceRow($this->cmpId, $item);
        self::assertNotNull($row);
        self::assertEqualsWithDelta(25.0, (float) $row['on_hand_qty'], 0.0001);
    }

    public function testACompanyWithTrulyNoDataDoesNotErrorAndWritesNothing(): void
    {
        $exit = $this->runCommand(['cmp' => (string) $this->cmpId]);

        self::assertSame(0, $exit);
        self::assertSame(0, $this->db->table('inv_stock_balances')->where('cmp_id', $this->cmpId)->countAllResults());
    }

    public function testCompanyAllRebuildsEveryCompanyIncludingOnesStuckAtFyZero(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item1 = $this->makeItem('Widget A', $pcs);
        $this->setOpening($item1, $pcs, 10, 100, 0, $wh);

        $otherCmp = 202;
        $this->db->table('inv_company_settings')->insert(['cmp_id' => $otherCmp, 'default_valuation_method' => 'FIFO', 'valuation_scope' => 'company', 'negative_stock_policy' => 'allow', 'created_at' => date('Y-m-d H:i:s')]);
        $this->db->table('inv_uom')->insert(['cmp_id' => $otherCmp, 'unit_name' => 'Pcs', 'unit_symbol' => 'Pcs', 'print_name' => 'Pcs', 'uqc_gst' => 'PCS', 'is_active' => 1]);
        $unit2 = (int) $this->db->insertID();
        $this->db->table('inv_items')->insert(['cmp_id' => $otherCmp, 'item_name' => 'Widget B', 'unit_id' => $unit2, 'valuation_method' => 'FIFO', 'is_active' => 1]);
        $item2 = (int) $this->db->insertID();
        $this->db->table('inv_item_uoms')->insert(['cmp_id' => $otherCmp, 'item_id' => $item2, 'unit_id' => $unit2, 'is_default' => 1, 'conversion_factor' => 1]);
        $this->db->table('inv_item_openings')->insert([
            'cmp_id' => $otherCmp, 'fy_id' => 0, 'item_id' => $item2, 'unit_id' => $unit2, 'warehouse_id' => null,
            'opening_qty' => 7, 'opening_valuation_rate' => 50, 'opening_value' => 350, 'source_kind' => 'master_inception',
        ]);

        $exit = $this->runCommand(['cmp' => 'all']);

        self::assertSame(0, $exit);
        $row1 = $this->balanceRow($this->cmpId, $item1);
        $row2 = $this->balanceRow($otherCmp, $item2);
        self::assertNotNull($row1, 'company 101 (fy_id=0) must be rebuilt by --cmp=all');
        self::assertNotNull($row2, 'company 202 (fy_id=0) must be rebuilt by --cmp=all too, not just the first one');
        self::assertEqualsWithDelta(10.0, (float) $row1['on_hand_qty'], 0.0001);
        self::assertEqualsWithDelta(7.0, (float) $row2['on_hand_qty'], 0.0001);
    }

    public function testCompanyAllRejectsAnExplicitFyYear(): void
    {
        $exit = $this->runCommand(['cmp' => 'all', 'fy' => (string) $this->fyId]);

        self::assertSame(1, $exit);
    }

    public function testCompanyAllIsolatesOneCompanysFailureFromTheRest(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100, 0, $wh);

        $failingCmp = 909;
        $this->db->table('inv_company_settings')->insert(['cmp_id' => $failingCmp, 'default_valuation_method' => 'FIFO', 'valuation_scope' => 'company', 'negative_stock_policy' => 'allow', 'created_at' => date('Y-m-d H:i:s')]);

        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, ['cmp' => 'all']);
        $exit = (new class ($failingCmp) extends InventoryRebuildBalances {
            public function __construct(private int $failingCmp)
            {
            }

            protected function runForCompany(int $cmpId, ?int $fyId): array
            {
                if ($cmpId === $this->failingCmp) {
                    throw new \RuntimeException('simulated failure for cmp ' . $cmpId);
                }

                return parent::runForCompany($cmpId, $fyId);
            }
        })->run([]);

        self::assertSame(1, $exit, '--cmp=all must report a non-zero exit when any company errored');
        self::assertNotNull($this->balanceRow($this->cmpId, $item), 'company 101 must still be rebuilt even though company 909 threw');
    }
}
