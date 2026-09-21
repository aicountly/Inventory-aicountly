<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\SerialsController;
use Tests\Support\IntegrationTestCase;

/**
 * The Serials workspace's reads, against real SQL.
 *
 * The counters above the table and the rows inside it come out of one builder
 * (`SerialsController::applyFilters()`), so the thing that must never happen is
 * a card that disagrees with the list underneath it. These tests drive that
 * builder, the summary that counts over it and the lifecycle join — against
 * PostgreSQL, because what is most likely to be quietly wrong is exactly what a
 * stub cannot check: `IS NOT NULL` alongside a DATE comparison that must not
 * fire for a NULL warranty, a `COUNT(*)` over four LEFT JOINs, a grouped
 * `COALESCE(SUM(...))`, and a three-table join from a serial to the documents
 * that carried it.
 *
 * @group integration
 */
final class SerialWorkspaceTest extends IntegrationTestCase
{
    private int $unitId = 0;
    private int $groupId = 0;
    private int $brandId = 0;
    private int $itemId = 0;
    private int $otherItemId = 0;
    private int $mainWarehouse = 0;
    private int $delhiWarehouse = 0;
    private int $binId = 0;
    private int $batchId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->db->table('inv_uom')->insert(['cmp_id' => $this->cmpId, 'unit_name' => 'Pieces', 'unit_symbol' => 'pcs', 'decimal_places' => 2]);
        $this->unitId = (int) $this->db->insertID();

        $this->db->table('inv_item_groups')->insert(['cmp_id' => $this->cmpId, 'grp_name' => 'Laptops']);
        $this->groupId = (int) $this->db->insertID();

        $this->db->table('inv_brands')->insert(['cmp_id' => $this->cmpId, 'brand_name' => 'Apple']);
        $this->brandId = (int) $this->db->insertID();

        $this->db->table('inv_warehouses')->insert(['cmp_id' => $this->cmpId, 'warehouse_name' => 'Main Warehouse', 'warehouse_code' => 'MW']);
        $this->mainWarehouse = (int) $this->db->insertID();

        $this->db->table('inv_warehouses')->insert(['cmp_id' => $this->cmpId, 'warehouse_name' => 'Delhi Warehouse', 'warehouse_code' => 'DW']);
        $this->delhiWarehouse = (int) $this->db->insertID();

        $this->db->table('inv_locations')->insert(['cmp_id' => $this->cmpId, 'warehouse_id' => $this->mainWarehouse, 'location_code' => 'R-01-A1', 'location_type' => 'bin']);
        $this->binId = (int) $this->db->insertID();

        $this->itemId = $this->item('MacBook Pro 14', 'MBP14', 'BAR-MBP-1', $this->groupId, $this->brandId);
        $this->otherItemId = $this->item('Tata Salt 1kg', 'SALT1', null, null, null);

        $this->db->table('inv_batches')->insert(['cmp_id' => $this->cmpId, 'item_id' => $this->itemId, 'batch_no' => 'B-MBP-2026', 'status' => 'active']);
        $this->batchId = (int) $this->db->insertID();
    }

    private function item(string $name, string $sku, ?string $upc, ?int $groupId, ?int $brandId): int
    {
        $this->db->table('inv_items')->insert([
            'cmp_id'           => $this->cmpId,
            'item_name'        => $name,
            'item_sku'         => $sku,
            'item_upc'         => $upc,
            'item_grp_id'      => $groupId,
            'brand_id'         => $brandId,
            'unit_id'          => $this->unitId,
            'track_serial'     => 1,
            'valuation_method' => 'FIFO',
            'is_active'        => 1,
        ]);

        return (int) $this->db->insertID();
    }

    /** @param array<string, mixed> $row */
    private function serial(array $row): int
    {
        $this->db->table('inv_serials')->insert(array_merge([
            'cmp_id'     => $this->cmpId,
            'item_id'    => $this->itemId,
            'serial_no'  => 'SN-' . bin2hex(random_bytes(4)),
            'status'     => 'in_stock',
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ], $row));

        return (int) $this->db->insertID();
    }

    private function days(int $offset): string
    {
        return date('Y-m-d', strtotime(($offset >= 0 ? '+' : '') . $offset . ' days'));
    }

    // ---------------------------------------------------------------- driving

    /**
     * The controller with a request carrying the given query parameters.
     *
     * `setGlobal` rather than assigning `$_GET`: PHPUnit backs the superglobals
     * up and restores them around every test, and a filter that silently
     * arrives empty on the second test of a run is a test that passes alone and
     * lies in the suite.
     *
     * @param array<string, mixed> $get
     */
    private function controller(array $get = []): SerialsController
    {
        $request = \Config\Services::request(null, false);
        $request->setGlobal('get', $get);
        $controller = new SerialsController();

        $property = new \ReflectionProperty(\CodeIgniter\Controller::class, 'request');
        $property->setAccessible(true);
        $property->setValue($controller, $request);

        return $controller;
    }

    private function invoke(object $controller, string $name, array $args)
    {
        $method = new \ReflectionMethod(SerialsController::class, $name);
        $method->setAccessible(true);

        return $method->invokeArgs($controller, $args);
    }

    /**
     * The serial numbers the given filters select, in order.
     *
     * @param array<string, mixed> $get
     * @return list<string>
     */
    private function serialNumbers(array $get): array
    {
        $controller = $this->controller($get);
        $builder = $this->invoke($controller, 'applyFilters', [$this->invoke($controller, 'baseQuery', [$this->cmpId])]);
        $rows = $builder->select('s.serial_no', false)->orderBy('s.serial_no', 'ASC')->get()->getResultArray();

        return array_map(static fn ($r) => (string) $r['serial_no'], $rows);
    }

    /**
     * @param array<string, mixed> $get
     * @return array<string, mixed>
     */
    private function summary(array $get = [], bool $costVisible = true): array
    {
        return $this->invoke($this->controller($get), 'summaryFor', [$this->cmpId, $costVisible]);
    }

    // ----------------------------------------------------------------- tests

    public function testTheListIsScopedToTheCompany(): void
    {
        $this->serial(['serial_no' => 'SN-MINE']);
        $this->serial(['serial_no' => 'SN-OTHER', 'cmp_id' => $this->cmpId + 1]);

        $this->assertSame(['SN-MINE'], $this->serialNumbers([]));
        $this->assertSame(1, $this->summary()['total']);
    }

    public function testSearchReachesTheItemBatchWarehouseAndBinBehindTheSerial(): void
    {
        // Everything the operator might have in front of them: the serial, the
        // item's name, its SKU, its barcode, the batch, the warehouse, the bin.
        $this->serial(['serial_no' => 'SN-A', 'batch_id' => $this->batchId, 'warehouse_id' => $this->mainWarehouse, 'location_id' => $this->binId]);
        $this->serial(['serial_no' => 'SN-B', 'item_id' => $this->otherItemId]);

        foreach (['SN-A', 'macbook', 'MBP14', 'BAR-MBP', 'B-MBP-2026', 'Main Ware', 'R-01-A1'] as $needle) {
            $this->assertSame(['SN-A'], $this->serialNumbers(['q' => $needle]), 'searching for ' . $needle);
        }
    }

    public function testAStatusGroupSelectsEveryStatusInIt(): void
    {
        // The KPI cards drill in by bucket; the filter bar by exact status.
        // Both go through the same parameter, so both have to work.
        $this->serial(['serial_no' => 'SN-STOCK', 'status' => 'in_stock']);
        $this->serial(['serial_no' => 'SN-EXPECTED', 'status' => 'expected']);
        $this->serial(['serial_no' => 'SN-RESERVED', 'status' => 'reserved']);
        $this->serial(['serial_no' => 'SN-TRANSIT', 'status' => 'in_transit']);
        $this->serial(['serial_no' => 'SN-ISSUED', 'status' => 'issued']);

        $this->assertSame(['SN-EXPECTED', 'SN-RESERVED', 'SN-TRANSIT'], $this->serialNumbers(['status' => 'allocated']));
        $this->assertSame(['SN-STOCK'], $this->serialNumbers(['status' => 'in_stock']));
        $this->assertSame(['SN-ISSUED'], $this->serialNumbers(['status' => 'out']));
        $this->assertSame(['SN-ISSUED', 'SN-RESERVED'], $this->serialNumbers(['status' => 'issued,reserved']));
    }

    public function testTheThreeBucketsAddUpToTheTotal(): void
    {
        foreach (['in_stock', 'expected', 'reserved', 'in_transit', 'issued', 'returned', 'damaged', 'scrapped'] as $i => $status) {
            $this->serial(['serial_no' => 'SN-' . $i, 'status' => $status]);
        }

        $summary = $this->summary();
        $this->assertSame(8, $summary['total']);
        $this->assertSame(1, $summary['groups']['in_stock']);
        $this->assertSame(3, $summary['groups']['allocated']);
        $this->assertSame(4, $summary['groups']['out']);
        $this->assertSame(
            $summary['total'],
            array_sum($summary['groups']),
            'the three cards sit beside the total and a reader adds them up',
        );
    }

    public function testWarrantyBucketsPartitionTheSetAndLeaveNullsOutOfEveryDateComparison(): void
    {
        $this->serial(['serial_no' => 'SN-EXPIRED', 'warranty_until' => $this->days(-1)]);
        $this->serial(['serial_no' => 'SN-SOON', 'warranty_until' => $this->days(10)]);
        $this->serial(['serial_no' => 'SN-UPCOMING', 'warranty_until' => $this->days(60)]);
        $this->serial(['serial_no' => 'SN-ACTIVE', 'warranty_until' => $this->days(400)]);
        $this->serial(['serial_no' => 'SN-NONE', 'warranty_until' => null]);

        $w = $this->summary()['warranty'];
        $this->assertSame(1, $w['expired']);
        $this->assertSame(1, $w['soon']);
        $this->assertSame(1, $w['upcoming']);
        $this->assertSame(1, $w['active']);
        // A NULL warranty is not expired: `warranty_until < today` is UNKNOWN
        // for it in SQL, and a serial with no warranty on the expiry list would
        // be a false alarm somebody has to chase.
        $this->assertSame(1, $w['none']);
        $this->assertSame(5, $w['expired'] + $w['soon'] + $w['upcoming'] + $w['active'] + $w['none']);
        $this->assertSame(30, $w['soon_days']);
        $this->assertSame(90, $w['upcoming_days']);
    }

    public function testTheWarrantyFilterAgreesWithTheCardThatCountsIt(): void
    {
        $this->serial(['serial_no' => 'SN-EXPIRED', 'warranty_until' => $this->days(-5)]);
        $this->serial(['serial_no' => 'SN-SOON', 'warranty_until' => $this->days(20)]);
        $this->serial(['serial_no' => 'SN-LATER', 'warranty_until' => $this->days(200)]);
        $this->serial(['serial_no' => 'SN-NONE', 'warranty_until' => null]);

        $this->assertSame(['SN-EXPIRED'], $this->serialNumbers(['warranty_status' => 'expired']));
        $this->assertSame(['SN-SOON'], $this->serialNumbers(['warranty_status' => 'expiring']));
        $this->assertSame(['SN-NONE'], $this->serialNumbers(['warranty_status' => 'none']));
        $this->assertSame(['SN-LATER', 'SN-SOON'], $this->serialNumbers(['warranty_status' => 'active']));
        // A widened window is the server's to measure, so the card and the list
        // cannot disagree about where 90 days ends.
        $this->assertSame(['SN-LATER', 'SN-SOON'], $this->serialNumbers(['warranty_status' => 'expiring', 'warranty_days' => '365']));
    }

    public function testThePlacementBatchAndCatalogueFiltersSelectWhatTheyName(): void
    {
        $this->serial(['serial_no' => 'SN-PLACED', 'warehouse_id' => $this->mainWarehouse, 'batch_id' => $this->batchId]);
        $this->serial(['serial_no' => 'SN-LOOSE', 'warehouse_id' => null, 'batch_id' => null]);
        $this->serial(['serial_no' => 'SN-OTHERITEM', 'item_id' => $this->otherItemId, 'warehouse_id' => $this->delhiWarehouse]);

        $this->assertSame(['SN-OTHERITEM', 'SN-PLACED'], $this->serialNumbers(['placed' => '1']));
        $this->assertSame(['SN-LOOSE'], $this->serialNumbers(['placed' => '0']));
        $this->assertSame(['SN-PLACED'], $this->serialNumbers(['has_batch' => '1']));
        $this->assertSame(['SN-PLACED'], $this->serialNumbers(['warehouse_id' => (string) $this->mainWarehouse]));
        // Item group and brand live on the item, not the serial — these two
        // prove the join is being filtered rather than the serial table.
        $this->assertSame(['SN-LOOSE', 'SN-PLACED'], $this->serialNumbers(['item_grp_id' => (string) $this->groupId]));
        $this->assertSame(['SN-LOOSE', 'SN-PLACED'], $this->serialNumbers(['brand_id' => (string) $this->brandId]));
    }

    public function testTheCostRangeFilterAndTheStockValueAgree(): void
    {
        $this->serial(['serial_no' => 'SN-CHEAP', 'status' => 'in_stock', 'unit_cost' => 1000]);
        $this->serial(['serial_no' => 'SN-DEAR', 'status' => 'in_stock', 'unit_cost' => 189900]);
        $this->serial(['serial_no' => 'SN-SOLD', 'status' => 'issued', 'unit_cost' => 5000]);

        // The range is over cost alone — it does not quietly also mean "in
        // stock", which is why the issued serial is in the first result.
        $this->assertSame(['SN-DEAR', 'SN-SOLD'], $this->serialNumbers(['cost_min' => '2000']));
        $this->assertSame(['SN-CHEAP'], $this->serialNumbers(['cost_max' => '2000']));
        // Only what the company still holds, and rounded the way the API states.
        $this->assertSame(190900.0, $this->summary()['in_stock_value']);
    }

    public function testCostIsNotEvenSummedForAReaderWhoMayNotSeeIt(): void
    {
        $this->serial(['serial_no' => 'SN-1', 'status' => 'in_stock', 'unit_cost' => 1000]);

        $this->assertNull($this->summary([], false)['in_stock_value']);
        $this->assertFalse($this->summary([], false)['cost_visible']);
    }

    public function testUnplacedCountsOnlyWhatIsStillHeldOrExpected(): void
    {
        $this->serial(['serial_no' => 'SN-HELD', 'status' => 'in_stock', 'warehouse_id' => null]);
        $this->serial(['serial_no' => 'SN-COMING', 'status' => 'expected', 'warehouse_id' => null]);
        // Already issued with no warehouse is not a data-quality problem — it
        // has left the building.
        $this->serial(['serial_no' => 'SN-GONE', 'status' => 'issued', 'warehouse_id' => null]);
        $this->serial(['serial_no' => 'SN-FINE', 'status' => 'in_stock', 'warehouse_id' => $this->mainWarehouse]);

        $this->assertSame(2, $this->summary()['unplaced']);
    }

    public function testTheCountersDescribeTheFilteredSetRatherThanTheWholeCompany(): void
    {
        $this->serial(['serial_no' => 'SN-MAIN', 'status' => 'in_stock', 'warehouse_id' => $this->mainWarehouse]);
        $this->serial(['serial_no' => 'SN-DELHI-1', 'status' => 'in_stock', 'warehouse_id' => $this->delhiWarehouse]);
        $this->serial(['serial_no' => 'SN-DELHI-2', 'status' => 'issued', 'warehouse_id' => $this->delhiWarehouse]);

        $scoped = $this->summary(['warehouse_id' => (string) $this->delhiWarehouse]);
        $this->assertSame(2, $scoped['total'], 'a card that counted the company would contradict the table under it');
        $this->assertSame(1, $scoped['groups']['in_stock']);
        $this->assertSame(1, $scoped['groups']['out']);
    }

    public function testPreviousTotalCountsWhatWasOnRecordAMonthAgo(): void
    {
        $this->serial(['serial_no' => 'SN-OLD', 'created_at' => date('Y-m-d H:i:s', strtotime('-3 months'))]);
        $this->serial(['serial_no' => 'SN-NEW', 'created_at' => date('Y-m-d H:i:s')]);

        $summary = $this->summary();
        $this->assertSame(2, $summary['total']);
        $this->assertSame(1, $summary['previous_total']);
        $this->assertSame(date('Y-m-d', strtotime('-1 month')), $summary['previous_as_of']);
    }

    public function testTheCurrencyIsTheCompanysOwn(): void
    {
        $this->db->table('inv_company_settings')->where('cmp_id', $this->cmpId)->update(['base_currency_code' => 'AED']);
        $this->assertSame('AED', $this->summary()['currency']);
    }

    public function testSortKeysResolveToRealColumns(): void
    {
        // Every sortable header the table offers has to name a column the query
        // can order by; a bad one is a 500 the moment a reader clicks it.
        $this->serial(['serial_no' => 'SN-1', 'warehouse_id' => $this->mainWarehouse, 'batch_id' => $this->batchId, 'location_id' => $this->binId, 'unit_cost' => 10]);
        $sorts = (new \ReflectionClassConstant(SerialsController::class, 'SORT'))->getValue();

        $controller = $this->controller([]);
        foreach ($sorts as $key => $column) {
            $builder = $this->invoke($controller, 'baseQuery', [$this->cmpId]);
            $rows = $builder->select('s.serial_no', false)->orderBy($column, 'ASC')->get()->getResultArray();
            $this->assertCount(1, $rows, 'sorting by ' . $key);
        }
    }

    public function testTheLifecycleJoinsTheDocumentsThatCarriedTheSerial(): void
    {
        $serialId = $this->serial(['serial_no' => 'SN-LIFE', 'warehouse_id' => $this->mainWarehouse]);

        $this->db->table('inv_documents')->insert([
            'cmp_id' => $this->cmpId, 'bo_id' => $this->boId, 'fy_id' => $this->fyId,
            'document_type' => 'material_receipt', 'document_no' => 'MR-0007',
            'document_date' => '2026-04-05', 'status' => 'POSTED',
        ]);
        $documentId = (int) $this->db->insertID();

        $this->db->table('inv_document_lines')->insert([
            'document_id' => $documentId, 'cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'bo_id' => $this->boId,
            'item_id' => $this->itemId, 'warehouse_id' => $this->mainWarehouse, 'location_id' => $this->binId,
            'direction' => 'in', 'qty' => 1, 'base_qty' => 1,
        ]);
        $lineId = (int) $this->db->insertID();

        $this->db->table('inv_document_line_serials')->insert([
            'line_id' => $lineId, 'document_id' => $documentId, 'cmp_id' => $this->cmpId, 'serial_id' => $serialId,
        ]);

        $this->db->table('inv_audit_log')->insert([
            'cmp_id' => $this->cmpId, 'entity_type' => 'serial', 'entity_id' => $serialId,
            'action' => 'serial.create', 'actor_uuid' => 'user-a', 'created_at' => '2026-04-02 09:00:00',
            'after_json' => json_encode(['status' => 'expected']),
        ]);

        $events = $this->invoke($this->controller([]), 'historyEvents', [$this->cmpId, $serialId]);

        $this->assertCount(2, $events);
        // Oldest first: the registration, then the receipt that brought it in.
        $this->assertSame('audit', $events[0]['kind']);
        $this->assertSame('serial.create', $events[0]['action']);
        $this->assertSame(['status' => 'expected'], $events[0]['after']);
        $this->assertSame('document', $events[1]['kind']);
        $this->assertSame('MR-0007', $events[1]['document_no']);
        $this->assertSame('material_receipt', $events[1]['document_type']);
        $this->assertSame('in', $events[1]['direction']);
        $this->assertSame('Main Warehouse', $events[1]['warehouse_name']);
        $this->assertSame('R-01-A1', $events[1]['location_code']);
    }

    public function testALifecycleIsEmptyRatherThanBrokenForASerialNothingHasTouched(): void
    {
        $serialId = $this->serial(['serial_no' => 'SN-QUIET']);

        $this->assertSame([], $this->invoke($this->controller([]), 'historyEvents', [$this->cmpId, $serialId]));
    }

    public function testAnotherCompanysDocumentsNeverAppearInALifecycle(): void
    {
        $serialId = $this->serial(['serial_no' => 'SN-SCOPED']);
        $this->db->table('inv_audit_log')->insert([
            'cmp_id' => $this->cmpId + 1, 'entity_type' => 'serial', 'entity_id' => $serialId,
            'action' => 'serial.update', 'created_at' => '2026-05-01 09:00:00',
        ]);

        $this->assertSame([], $this->invoke($this->controller([]), 'historyEvents', [$this->cmpId, $serialId]));
    }
}
