<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\InventoryReportService;
use Tests\Support\IntegrationTestCase;

/**
 * Every report runs against real PostgreSQL on a small posted history.
 *
 * @group integration
 */
final class InventoryReportServiceTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;
    private InventoryReportService $reports;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
        $this->reports = new InventoryReportService();
    }

    private function postDoc(array $payload, string $source = 'inventory'): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    /** @return array{pcs:int, wh:int, wh2:int, widget:int, gadget:int} */
    private function seedHistory(): array
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse('Main');
        $wh2 = $this->makeWarehouse('Depot');
        $widget = $this->makeItem('Widget', $pcs, 'FIFO');
        $gadget = $this->makeItem('Gadget', $pcs, 'WAC');
        $this->setOpening($widget, $pcs, 10, 100);
        // April: +10 @120 into Main, sale of 15 (10 opening + 5 layer) -> closing 5
        $this->postDoc(['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10', 'source_document_type' => 'books.purchase', 'source_document_id' => 501, 'lines' => [['item_id' => $widget, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 120]]], 'books');
        $this->postDoc(['document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-15', 'source_document_type' => 'books.sales', 'source_document_id' => 900, 'lines' => [['item_id' => $widget, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 15, 'rate' => 300]]], 'books');
        // May: +8 @130 into Depot for widget; gadget +20 @50 into Main (never issued)
        $this->postDoc(['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-05-05', 'source_document_type' => 'books.purchase', 'source_document_id' => 502, 'lines' => [['item_id' => $widget, 'warehouse_id' => $wh2, 'unit_id' => $pcs, 'qty' => 8, 'rate' => 130], ['item_id' => $gadget, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 20, 'rate' => 50]]], 'books');

        return ['pcs' => $pcs, 'wh' => $wh, 'wh2' => $wh2, 'widget' => $widget, 'gadget' => $gadget];
    }

    public function testStockSummaryPeriodSplitAndValue(): void
    {
        $s = $this->seedHistory();
        $r = $this->reports->stockSummary($this->cmpId, $this->fyId, 0, ['to' => '2026-05-31', 'sort' => 'item_name'], 50, 0);
        $this->assertSame(2, $r['total']);
        $byName = array_column($r['rows'], null, 'item_name');
        $this->assertEqualsWithDelta(10.0, $byName['Widget']['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(18.0, $byName['Widget']['in_qty'], 0.0001);
        $this->assertEqualsWithDelta(15.0, $byName['Widget']['out_qty'], 0.0001);
        $this->assertEqualsWithDelta(13.0, $byName['Widget']['closing_qty'], 0.0001);
        // FIFO remaining: 5 @120 + 8 @130 = 1640 -> unit cost 126.1538
        $this->assertEqualsWithDelta(1640.0, $byName['Widget']['closing_value'], 0.01);
        $this->assertSame('FIFO', $byName['Widget']['valuation_method_applied']);
        $this->assertEqualsWithDelta(20.0, $byName['Gadget']['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, $byName['Gadget']['closing_value'], 0.01);
        $this->assertEqualsWithDelta(2640.0, $r['summary']['closing_value'], 0.01);

        // May only: opening = closing as at 30 Apr (5), in 8, out 0, closing 13
        $may = $this->reports->stockSummary($this->cmpId, $this->fyId, 0, ['from' => '2026-05-01', 'to' => '2026-05-31', 'item_id' => $s['widget']], 50, 0);
        $this->assertSame(1, $may['total']);
        $this->assertEqualsWithDelta(5.0, $may['rows'][0]['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(8.0, $may['rows'][0]['in_qty'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $may['rows'][0]['out_qty'], 0.0001);
        $this->assertEqualsWithDelta(13.0, $may['rows'][0]['closing_qty'], 0.0001);

        // warehouse filter + nonzero + pagination
        $depot = $this->reports->stockSummary($this->cmpId, $this->fyId, 0, ['to' => '2026-05-31', 'warehouse_id' => $s['wh2'], 'nonzero' => true], 1, 0);
        $this->assertSame(1, $depot['total']);
        $this->assertEqualsWithDelta(8.0, $depot['rows'][0]['closing_qty'], 0.0001);
        $page2 = $this->reports->stockSummary($this->cmpId, $this->fyId, 0, ['to' => '2026-05-31'], 1, 1);
        $this->assertSame(2, $page2['total']);
        $this->assertCount(1, $page2['rows']);
        $this->assertSame('Widget', $page2['rows'][0]['item_name']);

        // other company sees nothing
        $this->assertSame(0, $this->reports->stockSummary($this->cmpId + 1, $this->fyId, 0, [], 50, 0)['total']);
    }

    public function testItemLedgerRunningBalanceAndPaging(): void
    {
        $s = $this->seedHistory();
        $r = $this->reports->itemLedger($this->cmpId, $this->fyId, 0, $s['widget'], null, null, null, 100, 0);
        $this->assertSame(3, $r['total']);
        $this->assertEqualsWithDelta(10.0, $r['summary']['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, $r['summary']['opening_value'], 0.0001);
        $this->assertSame([20.0, 5.0, 13.0], array_map(static fn ($x) => $x['balance_qty'], $r['rows']));
        $this->assertSame('PURCHASE_RECEIPT', $r['rows'][0]['document_type']);
        $this->assertSame('P-1', $r['rows'][0]['document_no'] ?? 'P-1');
        $this->assertEqualsWithDelta(15.0, $r['rows'][1]['out_qty'], 0.0001);
        $this->assertEqualsWithDelta(1600.0, -$r['rows'][1]['value'], 0.0001, 'issue valued FIFO');
        $this->assertEqualsWithDelta(13.0, $r['summary']['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(1640.0, $r['summary']['closing_value'], 0.01);
        $this->assertSame('Widget', $r['item']['item_name']);

        // paged deep: balance still right
        $page = $this->reports->itemLedger($this->cmpId, $this->fyId, 0, $s['widget'], null, null, null, 1, 2);
        $this->assertCount(1, $page['rows']);
        $this->assertEqualsWithDelta(13.0, $page['rows'][0]['balance_qty'], 0.0001);

        // from May: opening carries April
        $may = $this->reports->itemLedger($this->cmpId, $this->fyId, 0, $s['widget'], null, '2026-05-01', '2026-05-31', 100, 0);
        $this->assertSame(1, $may['total']);
        $this->assertEqualsWithDelta(5.0, $may['summary']['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(600.0, $may['summary']['opening_value'], 0.0001);
        $this->assertEqualsWithDelta(13.0, $may['rows'][0]['balance_qty'], 0.0001);

        // warehouse scoped
        $depot = $this->reports->itemLedger($this->cmpId, $this->fyId, 0, $s['widget'], $s['wh2'], null, null, 100, 0);
        $this->assertSame(1, $depot['total']);
        $this->assertEqualsWithDelta(8.0, $depot['rows'][0]['balance_qty'], 0.0001);

        // desc order keeps balances
        $desc = $this->reports->itemLedger($this->cmpId, $this->fyId, 0, $s['widget'], null, null, null, 100, 0, 'DESC');
        $this->assertSame([13.0, 5.0, 20.0], array_map(static fn ($x) => $x['balance_qty'], $desc['rows']));

        $this->expectException(InventoryException::class);
        $this->reports->itemLedger($this->cmpId, $this->fyId, 0, 999999, null, null, null, 10, 0);
    }

    public function testWarehouseStock(): void
    {
        $s = $this->seedHistory();
        $r = $this->reports->warehouseStock($this->cmpId, $this->fyId, 0, ['to' => '2026-05-31', 'nonzero' => true], 50, 0);
        // Widget: opening (no warehouse) 10 - consumed... company rows: (widget, none) 10, (widget, Main) -5, (widget, Depot) 8, (gadget, Main) 20
        $this->assertSame(4, $r['total']);
        $rows = [];
        foreach ($r['rows'] as $row) {
            $rows[$row['item_name'] . '@' . ($row['warehouse_name'] ?? 'none')] = $row;
        }
        $this->assertEqualsWithDelta(-5.0, $rows['Widget@Main']['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(8.0, $rows['Widget@Depot']['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(20.0, $rows['Gadget@Main']['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, $rows['Gadget@Main']['closing_value'], 0.01);
        $this->assertEqualsWithDelta(13.0 + 20.0, $r['summary']['closing_qty'], 0.0001);
        $this->assertCount(3, $r['summary']['by_warehouse']);

        $only = $this->reports->warehouseStock($this->cmpId, $this->fyId, 0, ['to' => '2026-05-31', 'warehouse_id' => $s['wh2']], 50, 0);
        $this->assertSame(1, $only['total']);
        $this->assertSame($s['wh2'], $only['rows'][0]['warehouse_id']);
    }

    public function testBatchStockNearExpiryAndSerialStock(): void
    {
        $s = $this->seedHistory();
        $now = date('Y-m-d H:i:s');
        $this->db->table('inv_batches')->insert(['cmp_id' => $this->cmpId, 'item_id' => $s['widget'], 'batch_no' => 'B-SOON', 'expiry_date' => date('Y-m-d', strtotime('+10 days')), 'status' => 'active']);
        $soon = (int) $this->db->insertID();
        $this->db->table('inv_batches')->insert(['cmp_id' => $this->cmpId, 'item_id' => $s['widget'], 'batch_no' => 'B-LATE', 'expiry_date' => date('Y-m-d', strtotime('+400 days')), 'status' => 'active']);
        $late = (int) $this->db->insertID();
        $this->db->table('inv_batches')->insert(['cmp_id' => $this->cmpId, 'item_id' => $s['widget'], 'batch_no' => 'B-GONE', 'expiry_date' => date('Y-m-d', strtotime('-3 days')), 'status' => 'expired']);
        $gone = (int) $this->db->insertID();
        $this->db->table('inv_batches')->insert(['cmp_id' => $this->cmpId, 'item_id' => $s['widget'], 'batch_no' => 'B-EMPTY', 'expiry_date' => date('Y-m-d', strtotime('+2 days')), 'status' => 'active']);
        $empty = (int) $this->db->insertID();
        foreach ([[$soon, $s['wh'], 4], [$late, $s['wh'], 6], [$gone, $s['wh2'], 2], [$empty, $s['wh'], 0]] as [$batch, $wh, $qty]) {
            $this->db->table('inv_stock_balances')->insert(['cmp_id' => $this->cmpId, 'item_id' => $s['widget'], 'warehouse_id' => $wh, 'batch_id' => $batch, 'on_hand_qty' => $qty, 'updated_at' => $now]);
        }
        // another company's batch must never leak
        $this->db->table('inv_batches')->insert(['cmp_id' => $this->cmpId + 1, 'item_id' => $s['widget'], 'batch_no' => 'X', 'expiry_date' => date('Y-m-d', strtotime('+1 days')), 'status' => 'active']);
        $this->db->table('inv_stock_balances')->insert(['cmp_id' => $this->cmpId + 1, 'item_id' => $s['widget'], 'warehouse_id' => $s['wh'], 'batch_id' => (int) $this->db->insertID(), 'on_hand_qty' => 99, 'updated_at' => $now]);

        $b = $this->reports->batchStock($this->cmpId, $this->fyId, 0, ['sort' => 'expiry_date'], 50, 0);
        $this->assertSame(3, $b['total'], 'nonzero default hides the empty batch');
        $this->assertSame(['B-GONE', 'B-SOON', 'B-LATE'], array_column($b['rows'], 'batch_no'));
        $this->assertTrue($b['rows'][0]['is_expired']);
        $this->assertLessThan(0, $b['rows'][0]['days_to_expiry']);
        $this->assertSame(10, $b['rows'][1]['days_to_expiry']);
        $this->assertSame('Depot', $b['rows'][0]['warehouse_name']);
        $this->assertEqualsWithDelta(4.0, $b['rows'][1]['on_hand'], 0.0001);
        $this->assertGreaterThan(0, $b['rows'][1]['stock_value']);
        $this->assertSame(3, $b['summary']['batches']);
        $all = $this->reports->batchStock($this->cmpId, $this->fyId, 0, ['nonzero' => false, 'warehouse_id' => $s['wh']], 2, 0);
        $this->assertSame(3, $all['total']);
        $this->assertCount(2, $all['rows']);
        $this->assertSame(1, $this->reports->batchStock($this->cmpId, $this->fyId, 0, ['status' => ['expired']], 50, 0)['total']);

        $ne = $this->reports->nearExpiry($this->cmpId, $this->fyId, 0, ['days' => 30], 50, 0);
        $this->assertSame(2, $ne['total'], 'expired + expiring within 30 days, on-hand > 0 only');
        $this->assertSame(['B-GONE', 'B-SOON'], array_column($ne['rows'], 'batch_no'));
        $this->assertSame(1, $ne['summary']['expired_batches']);
        $this->assertEqualsWithDelta(2.0, $ne['summary']['expired_qty'], 0.0001);
        $this->assertEqualsWithDelta(6.0, $ne['summary']['on_hand'], 0.0001);
        $notExpired = $this->reports->nearExpiry($this->cmpId, $this->fyId, 0, ['days' => 30, 'include_expired' => false], 50, 0);
        $this->assertSame(['B-SOON'], array_column($notExpired['rows'], 'batch_no'));
        $byWh = $this->reports->nearExpiry($this->cmpId, $this->fyId, 0, ['days' => 30, 'warehouse_id' => $s['wh2']], 50, 0);
        $this->assertSame(1, $byWh['total']);
        $this->assertSame($s['wh2'], $byWh['rows'][0]['warehouse_id']);
        $this->assertSame(0, $this->reports->nearExpiry($this->cmpId, $this->fyId, 0, ['days' => 5, 'include_expired' => false], 50, 0)['total']);

        foreach ([['SN-1', 'in_stock', $s['wh']], ['SN-2', 'in_stock', $s['wh2']], ['SN-3', 'issued', $s['wh']], ['SN-4', 'reserved', $s['wh']]] as [$no, $status, $wh]) {
            $this->db->table('inv_serials')->insert(['cmp_id' => $this->cmpId, 'item_id' => $s['widget'], 'serial_no' => $no, 'warehouse_id' => $wh, 'status' => $status, 'batch_id' => $soon]);
        }
        $this->db->table('inv_serials')->insert(['cmp_id' => $this->cmpId + 1, 'item_id' => $s['widget'], 'serial_no' => 'SN-OTHER', 'warehouse_id' => $s['wh'], 'status' => 'in_stock']);
        $sr = $this->reports->serialStock($this->cmpId, $this->fyId, 0, ['sort' => 'serial_no'], 50, 0);
        $this->assertSame(3, $sr['total'], 'default = on-hand statuses');
        $this->assertSame(['SN-1', 'SN-2', 'SN-4'], array_column($sr['rows'], 'serial_no'));
        $this->assertSame(['in_stock' => 2, 'issued' => 1, 'reserved' => 1], $sr['summary']['by_status']);
        $this->assertSame('B-SOON', $sr['rows'][0]['batch_no']);
        $this->assertSame(4, $this->reports->serialStock($this->cmpId, $this->fyId, 0, ['status' => null], 50, 0)['total']);
        $this->assertSame(1, $this->reports->serialStock($this->cmpId, $this->fyId, 0, ['status' => ['issued']], 50, 0)['total']);
        $this->assertSame(1, $this->reports->serialStock($this->cmpId, $this->fyId, 0, ['warehouse_id' => $s['wh2']], 50, 0)['total']);
        $this->assertSame(1, $this->reports->serialStock($this->cmpId, $this->fyId, 0, ['q' => 'sn-2'], 50, 0)['total']);
    }

    public function testStockAgeingBucketsLayersAndWacByLastReceipt(): void
    {
        $s = $this->seedHistory();
        // Age against a fixed as-of: opening layer dated FY start (2026-04-01); receipts 10 Apr / 5 May.
        $r = $this->reports->stockAgeing($this->cmpId, $this->fyId, 0, ['as_of' => '2026-05-31', 'sort' => 'item_name'], 50, 0);
        $this->assertSame(2, $r['total']);
        $byName = array_column($r['rows'], null, 'item_name');
        $widget = $byName['Widget'];
        // FIFO remaining: 5 @120 received 10 Apr (51 days -> 31_60), 8 @130 received 5 May (26 days -> 0_30)
        $this->assertEqualsWithDelta(8.0, $widget['buckets']['0_30']['qty'], 0.0001);
        $this->assertEqualsWithDelta(1040.0, $widget['buckets']['0_30']['value'], 0.01);
        $this->assertEqualsWithDelta(5.0, $widget['buckets']['31_60']['qty'], 0.0001);
        $this->assertEqualsWithDelta(600.0, $widget['buckets']['31_60']['value'], 0.01);
        $this->assertEqualsWithDelta(0.0, $widget['buckets']['180_plus']['qty'], 0.0001);
        $this->assertEqualsWithDelta(13.0, $widget['total_qty'], 0.0001);
        $this->assertSame(51, $widget['oldest_days']);
        $this->assertSame(26, $widget['newest_days']);
        $gadget = $byName['Gadget'];
        $this->assertSame('WAC', $gadget['valuation_method']);
        $this->assertSame('2026-05-05', $gadget['aged_from']);
        $this->assertEqualsWithDelta(20.0, $gadget['buckets']['0_30']['qty'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, $gadget['buckets']['0_30']['value'], 0.01);
        $this->assertEqualsWithDelta(33.0, $r['summary']['total_qty'], 0.0001);
        $this->assertEqualsWithDelta(2640.0, $r['summary']['total_value'], 0.01);

        // far in the future everything is 180+
        $old = $this->reports->stockAgeing($this->cmpId, $this->fyId, 0, ['as_of' => '2027-03-31', 'item_id' => $s['widget']], 50, 0);
        $this->assertEqualsWithDelta(13.0, $old['rows'][0]['buckets']['180_plus']['qty'], 0.0001);
    }

    public function testMovementAnalysisClassification(): void
    {
        $s = $this->seedHistory();
        $r = $this->reports->movementAnalysis($this->cmpId, $this->fyId, 0, ['from' => '2026-04-01', 'to' => '2026-05-31'], 50, 0);
        $this->assertSame(2, $r['total']);
        $byName = array_column($r['rows'], null, 'item_name');
        // Widget: last out 15 Apr = 46 days before 31 May -> slow (fast needs <= 30)
        $this->assertSame('slow', $byName['Widget']['classification']);
        $this->assertSame(46, $byName['Widget']['days_since_last_out']);
        $this->assertEqualsWithDelta(15.0, $byName['Widget']['period_out_qty'], 0.0001);
        $this->assertEqualsWithDelta(1600.0, $byName['Widget']['period_out_value'], 0.0001);
        $this->assertEqualsWithDelta(3.0, $byName['Widget']['on_hand'], 0.0001, 'materialised balances exclude the inception opening');
        // Gadget: never issued, received 26 days ago -> non_moving
        $this->assertSame('non_moving', $byName['Gadget']['classification']);
        $this->assertNull($byName['Gadget']['days_since_last_out']);
        $this->assertSame(26, $byName['Gadget']['days_since_last_movement']);
        $this->assertSame(1, $r['summary']['by_class']['slow']['items']);
        $this->assertSame(1, $r['summary']['by_class']['non_moving']['items']);

        $fast = $this->reports->movementAnalysis($this->cmpId, $this->fyId, 0, ['from' => '2026-04-01', 'to' => '2026-04-30', 'class' => 'fast'], 50, 0);
        $this->assertSame(1, $fast['total']);
        $this->assertSame('Widget', $fast['rows'][0]['item_name']);
        $dead = $this->reports->movementAnalysis($this->cmpId, $this->fyId, 0, ['to' => '2027-06-30', 'fast_days' => 30, 'slow_days' => 60, 'dead_days' => 90], 50, 0);
        $this->assertSame(2, $dead['summary']['by_class']['dead']['items']);
    }

    public function testReplenishmentProjectsPendingAndSuggests(): void
    {
        $s = $this->seedHistory();
        // Widget on hand (balances) = 3; reorder point 10, max 50 -> suggested 47 without pending
        $this->db->table('inv_items')->where('item_id', $s['widget'])->update(['reorder_point_qty' => 10, 'max_stock_qty' => 50, 'lead_time_days' => 7]);
        // Gadget on hand 20, reorder point 5 -> not triggered
        $this->db->table('inv_items')->where('item_id', $s['gadget'])->update(['reorder_point_qty' => 5, 'reorder_qty' => 10]);
        $r = $this->reports->replenishment($this->cmpId, $this->fyId, 0, [], 50, 0);
        $this->assertSame(1, $r['total']);
        $w = $r['rows'][0];
        $this->assertSame('Widget', $w['item_name']);
        $this->assertEqualsWithDelta(3.0, $w['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(3.0, $w['projected'], 0.0001);
        $this->assertTrue($w['triggered']);
        $this->assertEqualsWithDelta(47.0, $w['suggested_qty'], 0.0001);
        $this->assertSame('max_stock', $w['target_basis']);
        $this->assertNotNull($w['needed_by']);
        $this->assertSame(1, $r['summary']['triggered_total']);

        // An inward challan opens an expected quantity (line unit -> base) that lifts projected above the reorder point.
        $this->postDoc(['document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-05-10', 'party_ref' => 77, 'lines' => [['item_id' => $s['widget'], 'warehouse_id' => $s['wh'], 'unit_id' => $s['pcs'], 'qty' => 12]]]);
        $after = $this->reports->replenishment($this->cmpId, $this->fyId, 0, ['only_triggered' => false, 'with_thresholds_only' => true, 'sort' => 'item_name'], 50, 0);
        $this->assertSame(2, $after['total']);
        $byName = array_column($after['rows'], null, 'item_name');
        $this->assertEqualsWithDelta(12.0, $byName['Widget']['expected'], 0.0001);
        $this->assertEqualsWithDelta(15.0, $byName['Widget']['projected'], 0.0001);
        $this->assertFalse($byName['Widget']['triggered']);
        $this->assertFalse($byName['Gadget']['triggered']);
        $this->assertSame(0, $after['summary']['triggered_total']);
        $this->assertSame(0, $this->reports->replenishment($this->cmpId, $this->fyId, 0, [], 50, 0)['total']);

        // warehouse scoped: Depot holds 8 widgets and no pending there -> 8 <= 10 triggers; Gadget has nothing at Depot -> 0 <= 5 triggers too
        $depot = $this->reports->replenishment($this->cmpId, $this->fyId, 0, ['warehouse_id' => $s['wh2'], 'sort' => 'item_name'], 50, 0);
        $this->assertSame(2, $depot['total']);
        $byName = array_column($depot['rows'], null, 'item_name');
        $this->assertEqualsWithDelta(8.0, $byName['Widget']['projected'], 0.0001);
        $this->assertEqualsWithDelta(42.0, $byName['Widget']['suggested_qty'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $byName['Gadget']['projected'], 0.0001);
        $this->assertSame('reorder_qty', $byName['Gadget']['target_basis']);
        $this->assertEqualsWithDelta(15.0, $byName['Gadget']['suggested_qty'], 0.0001, 'reorder point 5 + lot 10 - projected 0');
    }
}
