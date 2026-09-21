<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\BatchesController;
use Tests\Support\IntegrationTestCase;

/**
 * The Batches workspace's reads, against real SQL.
 *
 * Everything the screen shows above the table is counted by the database over
 * the whole filtered set, so the one thing that must never happen is a figure
 * that disagrees with the rows underneath it. Both come out of
 * `BatchesController::filteredQuery()`, and these tests drive that builder
 * directly — against PostgreSQL, because the parts most likely to be quietly
 * wrong are exactly the parts a stub cannot check: a LEFT JOIN onto a grouped
 * balance subquery, a `CASE WHEN` ladder over a nullable DATE, and a `DATE '…'`
 * comparison that must not fire for a NULL expiry.
 *
 * The four health states are asserted to be mutually exclusive and to exhaust
 * the set, because the donut on the screen draws them as shares of one circle.
 *
 * @group integration
 */
final class BatchWorkspaceTest extends IntegrationTestCase
{
    private int $unitId  = 0;
    private int $groupId = 0;
    private int $catId   = 0;
    private int $itemId  = 0;
    private int $otherItemId = 0;
    private int $mainWarehouse = 0;
    private int $delhiWarehouse = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->db->table('inv_uom')->insert(['cmp_id' => $this->cmpId, 'unit_name' => 'Pieces', 'unit_symbol' => 'pcs', 'decimal_places' => 2]);
        $this->unitId = (int) $this->db->insertID();

        $this->db->table('inv_item_groups')->insert(['cmp_id' => $this->cmpId, 'grp_name' => 'Pharmaceuticals']);
        $this->groupId = (int) $this->db->insertID();

        $this->db->table('inv_stock_categories')->insert(['cmp_id' => $this->cmpId, 'cat_name' => 'Medicine']);
        $this->catId = (int) $this->db->insertID();

        $this->db->table('inv_warehouses')->insert(['cmp_id' => $this->cmpId, 'warehouse_name' => 'Main Warehouse', 'warehouse_code' => 'MW']);
        $this->mainWarehouse = (int) $this->db->insertID();

        $this->db->table('inv_warehouses')->insert(['cmp_id' => $this->cmpId, 'warehouse_name' => 'Delhi Warehouse', 'warehouse_code' => 'DW']);
        $this->delhiWarehouse = (int) $this->db->insertID();

        $this->itemId = $this->item('Paracetamol 500mg', 'SKU-1', $this->groupId, $this->catId);
        $this->otherItemId = $this->item('Tata Salt 1kg', 'SKU-2', null, null);
    }

    private function item(string $name, string $sku, ?int $groupId, ?int $catId): int
    {
        $this->db->table('inv_items')->insert([
            'cmp_id'           => $this->cmpId,
            'item_name'        => $name,
            'item_sku'         => $sku,
            'unit_id'          => $this->unitId,
            'item_grp_id'      => $groupId,
            'stock_cat_id'     => $catId,
            'track_batch'      => 1,
            'track_expiry'     => 1,
            'valuation_method' => 'FIFO',
            'is_active'        => 1,
        ]);

        return (int) $this->db->insertID();
    }

    /** @param array<string, mixed> $row */
    private function batch(array $row): int
    {
        $this->db->table('inv_batches')->insert(array_merge([
            'cmp_id'     => $this->cmpId,
            'item_id'    => $this->itemId,
            'batch_no'   => 'BCH-' . bin2hex(random_bytes(4)),
            'status'     => 'active',
            'created_at' => date('Y-m-d H:i:s'),
        ], $row));

        return (int) $this->db->insertID();
    }

    private function balance(int $batchId, int $warehouseId, float $onHand, ?int $itemId = null): void
    {
        $this->db->table('inv_stock_balances')->insert([
            'cmp_id'       => $this->cmpId,
            'item_id'      => $itemId ?? $this->itemId,
            'warehouse_id' => $warehouseId,
            'batch_id'     => $batchId,
            'on_hand_qty'  => $onHand,
        ]);
    }

    private static function days(int $n): string
    {
        return date('Y-m-d', strtotime(date('Y-m-d') . ' ' . ($n >= 0 ? '+' : '-') . abs($n) . ' days'));
    }

    // ---------------------------------------------------------------- driving

    /**
     * The controller's private query builder, driven by a request carrying the
     * given query parameters.
     *
     * The parameters go in through `setGlobal` rather than by assigning `$_GET`:
     * PHPUnit backs the superglobals up and restores them around every test, and
     * a filter that silently arrives empty on the second test of a run is a test
     * that passes alone and lies in the suite.
     *
     * @param array<string, mixed> $get
     */
    private function controller(array $get): BatchesController
    {
        $request = \Config\Services::request(null, false);
        $request->setGlobal('get', $get);
        $controller = new BatchesController();

        $property = new \ReflectionProperty(\CodeIgniter\Controller::class, 'request');
        $property->setAccessible(true);
        $property->setValue($controller, $request);

        return $controller;
    }

    /** @param array<string, mixed> $get */
    private function filtered(array $get, bool $joinStock = false)
    {
        $controller = $this->controller($get);
        $method = new \ReflectionMethod(BatchesController::class, 'filteredQuery');
        $method->setAccessible(true);

        return [$controller, $method->invoke($controller, $this->cmpId, $joinStock)];
    }

    /**
     * @param array<string, mixed> $get
     * @return list<string>
     */
    private function batchNumbers(array $get, bool $joinStock = false): array
    {
        [, $builder] = $this->filtered($get, $joinStock);
        $rows = $builder->select('b.batch_no', false)->orderBy('b.batch_no', 'ASC')->get()->getResultArray();

        return array_map(static fn ($r) => (string) $r['batch_no'], $rows);
    }

    private function invoke(object $controller, string $name, array $args)
    {
        $method = new \ReflectionMethod(BatchesController::class, $name);
        $method->setAccessible(true);

        return $method->invokeArgs($controller, $args);
    }

    // ------------------------------------------------------------------ tests

    public function testTheListIsScopedToTheCompanyAndCarriesTheItemsOwnLabels(): void
    {
        $this->batch(['batch_no' => 'BCH-1']);
        // Another company's batch must never appear, whatever the filters say.
        $this->batch(['batch_no' => 'BCH-OTHER', 'cmp_id' => $this->cmpId + 1]);

        [, $builder] = $this->filtered([]);
        $rows = $builder->select('b.batch_no, i.item_name, i.item_sku, u.unit_symbol, g.grp_name AS item_group_name, c.cat_name AS stock_category_name', false)->get()->getResultArray();

        $this->assertCount(1, $rows);
        $this->assertSame('BCH-1', $rows[0]['batch_no']);
        // The table's second line and its unit come from the joins, not from a
        // second request per row.
        $this->assertSame('Paracetamol 500mg', $rows[0]['item_name']);
        $this->assertSame('pcs', $rows[0]['unit_symbol']);
        $this->assertSame('Medicine', $rows[0]['stock_category_name']);
        $this->assertSame('Pharmaceuticals', $rows[0]['item_group_name']);
    }

    public function testSearchSweepsBatchLotItemNameAndSku(): void
    {
        $this->batch(['batch_no' => 'BCH-ALPHA']);
        $this->batch(['batch_no' => 'BCH-BETA', 'lot_no' => 'LOT-ALPHA']);
        $this->batch(['batch_no' => 'BCH-GAMMA', 'item_id' => $this->otherItemId]);

        $this->assertSame(['BCH-ALPHA', 'BCH-BETA'], $this->batchNumbers(['q' => 'alpha']));
        // The item name and the SKU are part of the one search box.
        $this->assertSame(['BCH-GAMMA'], $this->batchNumbers(['q' => 'tata salt']));
        $this->assertSame(['BCH-GAMMA'], $this->batchNumbers(['q' => 'SKU-2']));
    }

    public function testStatusTakesACommaSeparatedListAndRefusesAnythingElse(): void
    {
        $this->batch(['batch_no' => 'BCH-A', 'status' => 'active']);
        $this->batch(['batch_no' => 'BCH-Q', 'status' => 'quarantine']);
        $this->batch(['batch_no' => 'BCH-C', 'status' => 'closed']);

        $this->assertSame(['BCH-C', 'BCH-Q'], $this->batchNumbers(['status' => 'quarantine,closed']));

        $this->expectException(\App\Exceptions\InventoryException::class);
        $this->batchNumbers(['status' => 'pending']);
    }

    public function testHealthIsDerivedFromTheCalendarAndTheStatusTogether(): void
    {
        $this->batch(['batch_no' => 'HEALTHY', 'expiry_date' => self::days(400)]);
        $this->batch(['batch_no' => 'NO-EXPIRY', 'expiry_date' => null]);
        $this->batch(['batch_no' => 'SOON', 'expiry_date' => self::days(10)]);
        $this->batch(['batch_no' => 'TODAY', 'expiry_date' => self::days(0)]);
        $this->batch(['batch_no' => 'GONE', 'expiry_date' => self::days(-1)]);
        $this->batch(['batch_no' => 'HELD', 'status' => 'quarantine', 'expiry_date' => self::days(400)]);
        // An expired recall is expired: the calendar outranks the status here.
        $this->batch(['batch_no' => 'RECALLED-GONE', 'status' => 'recalled', 'expiry_date' => self::days(-5)]);
        // A batch the API itself marked expired, with no date to prove it.
        $this->batch(['batch_no' => 'MARKED', 'status' => 'expired', 'expiry_date' => null]);

        $this->assertSame(['HEALTHY', 'NO-EXPIRY'], $this->batchNumbers(['health' => 'active']));
        $this->assertSame(['SOON', 'TODAY'], $this->batchNumbers(['health' => 'expiring']));
        $this->assertSame(['GONE', 'MARKED', 'RECALLED-GONE'], $this->batchNumbers(['health' => 'expired']));
        $this->assertSame(['HELD'], $this->batchNumbers(['health' => 'inactive']));
    }

    public function testTheFourHealthStatesPartitionTheSet(): void
    {
        foreach ([400, -1, 10, 0, 900] as $i => $days) {
            $this->batch(['batch_no' => 'B-' . $i, 'expiry_date' => self::days($days)]);
        }
        $this->batch(['batch_no' => 'B-NULL', 'expiry_date' => null]);
        $this->batch(['batch_no' => 'B-HOLD', 'status' => 'quarantine']);
        $this->batch(['batch_no' => 'B-CLOSED', 'status' => 'closed', 'expiry_date' => self::days(5)]);

        $all = $this->batchNumbers([]);
        $seen = [];
        foreach (BatchesController::HEALTH_STATES as $state) {
            $seen[] = $this->batchNumbers(['health' => $state]);
        }
        $flat = array_merge(...$seen);
        sort($flat);
        $sorted = $all;
        sort($sorted);

        // Every batch lands in exactly one state — which is what lets the donut
        // draw them as four shares of one circle.
        $this->assertSame($sorted, $flat);
        $this->assertCount(count($flat), array_unique($flat));
    }

    public function testTheWarningWindowFollowsNearExpiryDays(): void
    {
        $this->batch(['batch_no' => 'IN-45', 'expiry_date' => self::days(45)]);

        $this->assertSame([], $this->batchNumbers(['health' => 'expiring']));
        $this->assertSame(['IN-45'], $this->batchNumbers(['health' => 'expiring', 'near_expiry_days' => 90]));
        $this->assertSame(['IN-45'], $this->batchNumbers(['health' => 'active']));
        $this->assertSame([], $this->batchNumbers(['health' => 'active', 'near_expiry_days' => 90]));
    }

    public function testExpiryRangeFiltersNeverMatchABatchWithNoExpiryDate(): void
    {
        $this->batch(['batch_no' => 'DATED', 'expiry_date' => self::days(20)]);
        $this->batch(['batch_no' => 'UNDATED', 'expiry_date' => null]);

        $this->assertSame(['DATED'], $this->batchNumbers(['expiry_from' => self::days(0), 'expiry_to' => self::days(30)]));
        $this->assertSame(['DATED'], $this->batchNumbers(['has_expiry' => '1']));
        $this->assertSame(['UNDATED'], $this->batchNumbers(['has_expiry' => '0']));
        $this->assertSame(['DATED'], $this->batchNumbers(['expiring_before' => self::days(30)]));
    }

    public function testABadDateIsRefusedRatherThanIgnored(): void
    {
        $this->expectException(\App\Exceptions\InventoryException::class);
        $this->batchNumbers(['expiry_from' => '31/03/2028']);
    }

    public function testAWarehouseNarrowsTheRowsAndTheOnHandFigureTogether(): void
    {
        $here = $this->batch(['batch_no' => 'HERE']);
        $there = $this->batch(['batch_no' => 'THERE']);
        $nowhere = $this->batch(['batch_no' => 'NOWHERE']);
        $this->balance($here, $this->mainWarehouse, 900);
        $this->balance($here, $this->delhiWarehouse, 350);
        $this->balance($there, $this->delhiWarehouse, 40);

        $this->assertSame(['HERE'], $this->batchNumbers(['in_warehouse_id' => $this->mainWarehouse]));
        $this->assertSame(['HERE', 'THERE'], $this->batchNumbers(['in_warehouse_id' => $this->delhiWarehouse]));
        $this->assertNotContains('NOWHERE', $this->batchNumbers(['in_warehouse_id' => $this->mainWarehouse]));

        // And the quantity is the quantity IN that warehouse, not company-wide.
        [, $builder] = $this->filtered(['in_warehouse_id' => $this->mainWarehouse], true);
        $row = $builder->select('COALESCE(sb.on_hand, 0) AS on_hand', false)->get()->getRowArray();
        $this->assertSame(900.0, round((float) $row['on_hand'], 4));
    }

    public function testAnEmptiedWarehouseStillFindsTheBatchThatPassedThroughIt(): void
    {
        $batchId = $this->batch(['batch_no' => 'EMPTIED']);
        $this->balance($batchId, $this->mainWarehouse, 0);

        // The balance row is the record that it was there. Traceability is the
        // point of a batch master, so it stays findable at zero.
        $this->assertSame(['EMPTIED'], $this->batchNumbers(['in_warehouse_id' => $this->mainWarehouse]));
        $this->assertSame(['EMPTIED'], $this->batchNumbers(['stock' => 'zero'], true));
        $this->assertSame([], $this->batchNumbers(['stock' => 'with'], true));
    }

    public function testStockFiltersSeeABatchWithNoBalanceRowAtAllAsZero(): void
    {
        $withStock = $this->batch(['batch_no' => 'STOCKED']);
        $this->batch(['batch_no' => 'NEVER-RECEIVED']);
        $this->balance($withStock, $this->mainWarehouse, 12.5);

        $this->assertSame(['STOCKED'], $this->batchNumbers(['stock' => 'with'], true));
        $this->assertSame(['NEVER-RECEIVED'], $this->batchNumbers(['stock' => 'zero'], true));
    }

    public function testTheItemsGroupAndCategoryFilterTheBatchesUnderThem(): void
    {
        $this->batch(['batch_no' => 'PHARMA']);
        $this->batch(['batch_no' => 'SALT', 'item_id' => $this->otherItemId]);

        $this->assertSame(['PHARMA'], $this->batchNumbers(['item_grp_id' => $this->groupId]));
        $this->assertSame(['PHARMA'], $this->batchNumbers(['stock_cat_id' => $this->catId]));
        $this->assertSame(['SALT'], $this->batchNumbers(['item_id' => $this->otherItemId]));
    }

    public function testSortingByOnHandUsesTheJoinedAggregate(): void
    {
        $small = $this->batch(['batch_no' => 'SMALL']);
        $big = $this->batch(['batch_no' => 'BIG']);
        $this->batch(['batch_no' => 'NONE']);
        $this->balance($small, $this->mainWarehouse, 5);
        $this->balance($big, $this->mainWarehouse, 500);
        $this->balance($big, $this->delhiWarehouse, 100);

        [, $builder] = $this->filtered([], true);
        $rows = $builder
            ->select('b.batch_no, COALESCE(sb.on_hand, 0) AS sb_on_hand', false)
            ->orderBy('sb_on_hand', 'DESC', false)
            ->get()
            ->getResultArray();

        $this->assertSame(['BIG', 'SMALL', 'NONE'], array_map(static fn ($r) => $r['batch_no'], $rows));
        // The join sums the warehouses; it does not multiply the batch row.
        $this->assertSame(600.0, round((float) $rows[0]['sb_on_hand'], 4));
    }

    /**
     * The whole point of the strip above the table: the figures are the
     * database's answer for the filters, not a sum of the page.
     */
    public function testTheSummaryCountsTheSameRowsTheListWouldReturn(): void
    {
        $healthy = $this->batch(['batch_no' => 'HEALTHY', 'expiry_date' => self::days(400)]);
        $soon = $this->batch(['batch_no' => 'SOON', 'expiry_date' => self::days(10)]);
        $gone = $this->batch(['batch_no' => 'GONE', 'expiry_date' => self::days(-3)]);
        $this->batch(['batch_no' => 'HELD', 'status' => 'quarantine', 'expiry_date' => self::days(400)]);
        $this->balance($healthy, $this->mainWarehouse, 1000);
        $this->balance($soon, $this->mainWarehouse, 250);
        $this->balance($gone, $this->mainWarehouse, 0);

        $agg = $this->summaryRow([]);

        $this->assertSame(4, (int) $agg['total']);
        $this->assertSame(1, (int) $agg['active']);
        $this->assertSame(1, (int) $agg['expiring_soon']);
        $this->assertSame(1, (int) $agg['expired']);
        $this->assertSame(1, (int) $agg['inactive']);
        $this->assertSame(1250.0, round((float) $agg['total_on_hand'], 4));
        $this->assertSame(2, (int) $agg['with_stock']);
        $this->assertSame(2, (int) $agg['zero_stock']);
        // The four states always add up to the total.
        $this->assertSame(
            (int) $agg['total'],
            (int) $agg['active'] + (int) $agg['expiring_soon'] + (int) $agg['expired'] + (int) $agg['inactive'],
        );
    }

    public function testTheExpiryBucketsCoverEveryBatchExactlyOnce(): void
    {
        foreach ([-10, 5, 29, 31, 89, 91, 179, 181, 900] as $i => $days) {
            $this->batch(['batch_no' => 'B-' . $i, 'expiry_date' => self::days($days)]);
        }
        $this->batch(['batch_no' => 'B-NULL', 'expiry_date' => null]);

        $agg = $this->summaryRow([]);
        $buckets = [
            (int) $agg['bucket_expired'],
            (int) $agg['bucket_within_30'],
            (int) $agg['bucket_31_90'],
            (int) $agg['bucket_91_180'],
            (int) $agg['bucket_beyond_180'],
            (int) $agg['no_expiry'],
        ];

        // -10 | 5, 29 | 31, 89 | 91, 179 | 181, 900 | no date — and 180 exactly
        // falls in the 91-180 band, so the bands leave no gap between them.
        $this->assertSame([1, 2, 2, 2, 2, 1], $buckets);
        $this->assertSame((int) $agg['total'], array_sum($buckets));
    }

    public function testTheSummaryNarrowsWithTheFilterTheTableIsShowing(): void
    {
        $this->batch(['batch_no' => 'PHARMA-1', 'expiry_date' => self::days(400)]);
        $this->batch(['batch_no' => 'PHARMA-2', 'expiry_date' => self::days(400)]);
        $this->batch(['batch_no' => 'SALT-1', 'item_id' => $this->otherItemId, 'expiry_date' => self::days(400)]);

        $this->assertSame(3, (int) $this->summaryRow([])['total']);
        $this->assertSame(2, (int) $this->summaryRow(['item_grp_id' => $this->groupId])['total']);
        $this->assertSame(2, count($this->batchNumbers(['item_grp_id' => $this->groupId])));
    }

    public function testThePreviousTotalIsWhatAlreadyExistedAMonthAgo(): void
    {
        $this->batch(['batch_no' => 'OLD', 'created_at' => date('Y-m-d H:i:s', strtotime('-90 days'))]);
        $this->batch(['batch_no' => 'NEW', 'created_at' => date('Y-m-d H:i:s', strtotime('-2 days'))]);
        // A legacy row with no timestamp counts as having always been there,
        // rather than as growth this month that never happened.
        $this->batch(['batch_no' => 'LEGACY', 'created_at' => null]);

        $agg = $this->summaryRow([]);
        $this->assertSame(3, (int) $agg['total']);
        $this->assertSame(2, (int) $agg['previous_total']);
    }

    public function testTheTableNamesTheWarehouseHoldingMostOfTheBatch(): void
    {
        $batchId = $this->batch(['batch_no' => 'SPREAD']);
        $this->balance($batchId, $this->delhiWarehouse, 350);
        $this->balance($batchId, $this->mainWarehouse, 900);

        $controller = $this->controller([]);
        $rows = [['batch_id' => $batchId]];
        $this->invoke($controller, 'attachWarehouses', [$this->cmpId, &$rows, null]);

        $this->assertSame(2, $rows[0]['warehouse_count']);
        $this->assertSame('Main Warehouse', $rows[0]['warehouses'][0]['warehouse_name']);
        $this->assertSame(900.0, $rows[0]['warehouses'][0]['on_hand']);
        $this->assertSame('Delhi Warehouse', $rows[0]['warehouses'][1]['warehouse_name']);
    }

    public function testTheWarehouseRollupNarrowsWithTheWarehouseFilter(): void
    {
        $batchId = $this->batch(['batch_no' => 'SPREAD']);
        $this->balance($batchId, $this->delhiWarehouse, 350);
        $this->balance($batchId, $this->mainWarehouse, 900);

        $controller = $this->controller([]);
        $rows = [['batch_id' => $batchId]];
        $this->invoke($controller, 'attachWarehouses', [$this->cmpId, &$rows, $this->delhiWarehouse]);

        $this->assertSame(1, $rows[0]['warehouse_count']);
        $this->assertSame('Delhi Warehouse', $rows[0]['warehouses'][0]['warehouse_name']);
    }

    /** @param array<string, mixed> $get */
    private function summaryRow(array $get): array
    {
        [$controller, $builder] = $this->filtered($get, true);
        $today = date('Y-m-d');
        $days = $this->invoke($controller, 'nearExpiryDays', []);
        $warn = date('Y-m-d', strtotime($today . ' +' . $days . ' days'));
        $cut = date('Y-m-d H:i:s', strtotime($today . ' -30 days'));
        $cond = fn (string $h): string => $this->invoke($controller, 'healthCondition', [$h, $today, $warn]);
        $count = static fn (string $c, string $alias): string => 'SUM(CASE WHEN ' . $c . ' THEN 1 ELSE 0 END) AS ' . $alias;
        $bucket = static fn (int $from, int $to): string => "b.expiry_date >= (DATE '" . date('Y-m-d', strtotime($today . ' +' . $from . ' days')) . "') AND b.expiry_date <= (DATE '" . date('Y-m-d', strtotime($today . ' +' . $to . ' days')) . "')";

        return (clone $builder)->select(implode(', ', [
            'COUNT(*) AS total',
            $count($cond('active'), 'active'),
            $count($cond('expiring'), 'expiring_soon'),
            $count($cond('expired'), 'expired'),
            $count($cond('inactive'), 'inactive'),
            'COALESCE(SUM(COALESCE(sb.on_hand, 0)), 0) AS total_on_hand',
            $count('COALESCE(sb.on_hand, 0) > 0', 'with_stock'),
            $count('COALESCE(sb.on_hand, 0) = 0', 'zero_stock'),
            $count("b.created_at IS NULL OR b.created_at < (TIMESTAMP '" . $cut . "')", 'previous_total'),
            $count('b.expiry_date IS NULL', 'no_expiry'),
            $count("b.expiry_date IS NOT NULL AND b.expiry_date < (DATE '" . $today . "')", 'bucket_expired'),
            $count($bucket(0, 30), 'bucket_within_30'),
            $count($bucket(31, 90), 'bucket_31_90'),
            $count($bucket(91, 180), 'bucket_91_180'),
            $count("b.expiry_date > (DATE '" . date('Y-m-d', strtotime($today . ' +180 days')) . "')", 'bucket_beyond_180'),
        ]), false)->get()->getRowArray() ?: [];
    }
}
