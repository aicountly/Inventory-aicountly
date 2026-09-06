<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\StockBalanceService;
use App\Services\ValuationReplayService;
use Tests\Support\IntegrationTestCase;

/**
 * @group integration
 */
final class PostingEngineTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
    }

    private function postDoc(array $payload, string $source = 'inventory', array $opts = []): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', $opts + ['session' => ['kind' => 'service']]);
    }

    public function testFifoOpeningReceiptIssueAndReversal(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 10, 100);

        $purchase = $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10', 'source_document_type' => 'books.purchase', 'source_document_id' => 501, 'source_document_no' => 'P-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 120, 'amount' => 1200]],
        ], 'books');
        $this->assertSame('POSTED', $purchase['status']);
        $this->assertEqualsWithDelta(120.0, $purchase['lines'][0]['valuation_rate'], 0.0001);

        $sale = $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-15', 'source_document_type' => 'books.sales', 'source_document_id' => 900, 'source_document_no' => 'S-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 15, 'rate' => 300, 'amount' => 4500]],
        ], 'books');
        $this->assertSame('POSTED', $sale['status']);
        // FIFO: 10 @ 100 (opening) + 5 @ 120 = 1600
        $this->assertEqualsWithDelta(1600.0, $sale['lines'][0]['valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(300.0, $sale['lines'][0]['source_transaction_rate'], 0.0001, 'commercial rate stays a snapshot');
        $effects = $sale['accounting_effects'];
        $this->assertSame('COGS_ISSUE', $effects[0]['effect']);
        $this->assertEqualsWithDelta(1600.0, $effects[0]['amount'], 0.0001);

        $bal = (new StockBalanceService())->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(-5.0, $bal['on_hand'], 0.0001, 'warehouse balance excludes the inception opening (no warehouse)');
        $companyBal = (new StockBalanceService())->balance($this->cmpId, $item);
        $this->assertEqualsWithDelta(-5.0, $companyBal['on_hand'], 0.0001);

        $snap = (new ValuationReplayService())->snapshot($this->cmpId, $this->fyId, 0, '2026-04-30');
        $this->assertCount(1, $snap['rows']);
        $this->assertEqualsWithDelta(5.0, $snap['rows'][0]['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(600.0, $snap['rows'][0]['stock_value'], 0.0001);

        // Outbox event written in the same transaction
        $events = $this->db->table('inv_integration_events')->where('event_type', 'inventory.document.posted')->countAllResults();
        $this->assertSame(2, $events);

        // Reverse the sale: layers restored, on-hand back
        $reversed = $this->posting->reverse($this->cmpId, (int) $sale['document_id'], 'tester', 'keyed wrong invoice');
        $this->assertSame('REVERSED', $reversed['status']);
        $snap2 = (new ValuationReplayService())->snapshot($this->cmpId, $this->fyId, 0, '2026-04-30');
        $this->assertEqualsWithDelta(20.0, $snap2['rows'][0]['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(2200.0, $snap2['rows'][0]['stock_value'], 0.0001);
        $layers = $this->db->table('inv_cost_layers')->where('item_id', $item)->where('qty_remaining >', 0)->selectSum('qty_remaining', 'q')->get()->getRowArray();
        $this->assertEqualsWithDelta(20.0, (float) $layers['q'], 0.0001);
        $movements = $this->db->table('inv_stock_movements')->where('document_id', (int) $sale['document_id'])->countAllResults();
        $this->assertSame(2, $movements, 'reversal appends, never deletes');
        $this->assertGreaterThan(0, $this->db->table('inv_valuation_recalc_jobs')->where('trigger_kind', 'reversal')->countAllResults());
    }

    public function testDuplicateSourcePostingIsRejectedByConstraint(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Gadget', $pcs);
        $payload = ['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-05-01', 'source_document_type' => 'books.purchase', 'source_document_id' => 77, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 1, 'rate' => 10]]];
        $this->postDoc($payload, 'books');
        $this->assertNotNull($this->docs->findBySource($this->cmpId, 'books', 'books.purchase', 77));
        $this->expectException(\Throwable::class);
        $this->docs->create($this->ctx(), $payload, 'tester', 'books');
    }

    public function testWeightedAverageAndUnitConversion(): void
    {
        $pcs = $this->makeUnit('Pcs', 'Pcs');
        $box = $this->makeUnit('Box', 'Box');
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Bottle', $pcs, 'WAC', [$box => 12]);
        $this->setOpening($item, $pcs, 12, 10);
        // 2 Box @ 1200 = 24 pcs @ 100
        $this->postDoc(['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-02', 'source_document_type' => 'books.purchase', 'source_document_id' => 1, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $box, 'qty' => 2, 'rate' => 1200]]], 'books');
        // WAC = (12*10 + 24*100) / 36 = 70
        $sale = $this->postDoc(['document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-03', 'source_document_type' => 'books.sales', 'source_document_id' => 2, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 6, 'rate' => 150]]], 'books');
        $this->assertEqualsWithDelta(70.0, $sale['lines'][0]['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(420.0, $sale['lines'][0]['valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(24.0, $this->db->table('inv_document_lines')->where('document_id', $sale['document_id'] - 1)->get()->getRowArray()['base_qty'], 0.0001);
    }

    public function testNegativeStockPolicyBlockAndAllow(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Scarce', $pcs);
        $this->db->table('inv_company_settings')->where('cmp_id', $this->cmpId)->update(['negative_stock_policy' => 'block']);
        \App\Services\InventorySettingsService::flush();
        try {
            $this->postDoc(['document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-05', 'source_document_type' => 'books.sales', 'source_document_id' => 5, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 3, 'rate' => 50]]], 'books');
            $this->fail('expected negative stock block');
        } catch (InventoryException $e) {
            $this->assertSame('negative_stock_blocked', $e->errorCode());
        }
        $failed = $this->db->table('inv_documents')->where('status', 'FAILED')->countAllResults();
        $this->assertSame(1, $failed, 'failed posting is visible, not silent');
        $this->assertSame(0, $this->db->table('inv_stock_movements')->countAllResults());

        $this->db->table('inv_company_settings')->where('cmp_id', $this->cmpId)->update(['negative_stock_policy' => 'allow']);
        \App\Services\InventorySettingsService::flush();
        $sale = $this->postDoc(['document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-05', 'source_document_type' => 'books.sales', 'source_document_id' => 6, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 3, 'rate' => 50]]], 'books');
        $this->assertSame('POSTED', $sale['status']);
        $this->assertEqualsWithDelta(0.0, $sale['lines'][0]['valuation_amount'], 0.0001, 'no cost history anywhere -> zero cost, as Books');
        $this->assertSame(1, $this->db->table('inv_cost_layers')->where('layer_kind', 'backorder')->countAllResults());
    }

    public function testStockTransferValuesInSideAtOutSideCost(): void
    {
        $pcs = $this->makeUnit();
        $a = $this->makeWarehouse('A');
        $b = $this->makeWarehouse('B');
        $item = $this->makeItem('Mover', $pcs);
        $this->postDoc(['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-01', 'source_document_type' => 'books.purchase', 'source_document_id' => 11, 'lines' => [['item_id' => $item, 'warehouse_id' => $a, 'qty' => 10, 'rate' => 40]]], 'books');
        $t = $this->postDoc(['document_type' => 'STOCK_TRANSFER', 'document_date' => '2026-04-02', 'from_warehouse_id' => $a, 'to_warehouse_id' => $b, 'lines' => [['item_id' => $item, 'qty' => 4]]]);
        $this->assertCount(2, $t['lines']);
        $this->assertSame('out', $t['lines'][0]['direction']);
        $this->assertSame('in', $t['lines'][1]['direction']);
        $this->assertEqualsWithDelta(40.0, $t['lines'][1]['valuation_rate'], 0.0001);
        $bal = new StockBalanceService();
        $this->assertEqualsWithDelta(6.0, $bal->balance($this->cmpId, $item, $a)['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(4.0, $bal->balance($this->cmpId, $item, $b)['on_hand'], 0.0001);
        $this->assertSame([], $t['accounting_effects'], 'a transfer has no accounting effect');
    }

    public function testPhysicalAdjustmentFromCountAndPendingChallanFlow(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Counted', $pcs);
        $this->postDoc(['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-01', 'source_document_type' => 'books.purchase', 'source_document_id' => 21, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 10, 'rate' => 25]]], 'books');
        $adj = $this->postDoc(['document_type' => 'PHYSICAL_ADJUSTMENT', 'document_date' => '2026-04-03', 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'book_qty' => 10, 'physical_qty' => 8]]]);
        $this->assertSame('out', $adj['lines'][0]['direction']);
        $this->assertEqualsWithDelta(2.0, $adj['lines'][0]['qty'], 0.0001);
        $this->assertEqualsWithDelta(50.0, $adj['lines'][0]['valuation_amount'], 0.0001);
        $this->assertSame('STOCK_ADJUSTMENT', $adj['accounting_effects'][0]['effect']);
        $this->assertEqualsWithDelta(-50.0, $adj['accounting_effects'][0]['amount'], 0.0001);

        $challan = $this->postDoc(['document_type' => 'DELIVERY_CHALLAN', 'document_date' => '2026-04-04', 'party_ref' => 9001, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 3]]]);
        $this->assertSame('POSTED', $challan['status']);
        $this->assertSame(0, $this->db->table('inv_stock_movements')->where('document_id', $challan['document_id'])->countAllResults(), 'challan_only does not move stock');
        $pending = (new \App\Services\PendingQuantityService())->listOpen($this->cmpId, 'challan', 'out', 9001);
        $this->assertCount(1, $pending);
        $sale = $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-06', 'party_ref' => 9001, 'stock_effect' => 'from_challan', 'source_document_type' => 'books.sales', 'source_document_id' => 22,
            'metadata' => ['challan_settlements' => [['source_document_id' => $challan['document_id'], 'item_id' => $item, 'qty' => 3, 'warehouse_id' => $wh]]],
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 3, 'rate' => 60]],
        ], 'books');
        $this->assertSame('POSTED', $sale['status']);
        $this->assertCount(0, (new \App\Services\PendingQuantityService())->listOpen($this->cmpId, 'challan', 'out', 9001));
        $this->assertEqualsWithDelta(5.0, (new StockBalanceService())->balance($this->cmpId, $item, $wh)['on_hand'], 0.0001);
    }
}
