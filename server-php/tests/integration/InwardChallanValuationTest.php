<?php

namespace Tests\Integration;

use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\StockBalanceService;
use Tests\Support\IntegrationTestCase;

/**
 * An inward challan that moves stock is a receipt and must open a cost layer for it.
 *
 * The type is declared valuation => false because most challans (challan_only) move nothing at
 * all, but on settle_deferred and physical the goods enter on_hand — and goods in on_hand with no
 * layer behind them leave the pool short for ever: every later issue falls through to the fallback
 * cost. The deferred purchase is the worst of it, because the purchase moved no stock and the
 * challan carries no rate, so neither document would ever price the goods.
 *
 * @group integration
 */
final class InwardChallanValuationTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
    }

    private function postDoc(array $payload, string $source = 'inventory'): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    /** @return array<string, mixed>|null */
    private function receiptLayer(int $documentId): ?array
    {
        return $this->db->table('inv_cost_layers')->where('source_document_id', $documentId)->where('layer_kind', 'receipt')->get()->getRowArray();
    }

    /**
     * The reversal of a challan posted BEFORE this type became valued.
     *
     * Such a document carries a null valuation_rate: it contributed to no cost layer and to no
     * WAC state, because posting skipped valuation entirely for its type. Deciding what to unwind
     * from the type's CURRENT rule would unwind something that was never wound — and for a WAC
     * item that is not a no-op, it subtracts the quantity from qty_on_hand and re-averages, taking
     * out units that were never put in and inflating the cost of everything left.
     *
     * FIFO survives it by accident, because reverseLineValuation() looks the layer up by
     * source_line_id and finds none. WAC keeps running state, so it does not — and WAC is exactly
     * where the damage is invisible, there being no layer to inspect afterwards.
     */
    public function testReversingAChallanPostedBeforeThisTypeWasValuedLeavesWacUntouched(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('WAC Widget', $pcs, 'WAC');
        $this->setOpening($item, $pcs, 100, 50);

        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-05', 'stock_effect' => 'physical', 'party_ref' => 8400,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 150, 'amount' => 1500]],
        ]);
        $documentId = (int) $challan['document_id'];
        $lineId = (int) $challan['lines'][0]['line_id'];

        // Strip the document back to the exact shape a pre-change production row has: the line
        // valued at nothing, the movement uncosted, no layer, and the WAC state as it stood before.
        $this->db->table('inv_document_lines')->where('line_id', $lineId)
            ->update(['valuation_rate' => null, 'valuation_amount' => null, 'valuation_method_applied' => null]);
        $this->db->table('inv_stock_movements')->where('line_id', $lineId)->update(['unit_cost' => null, 'value' => null]);
        $this->db->table('inv_cost_layers')->where('source_document_id', $documentId)->delete();
        $this->db->table('inv_wac_state')->where('cmp_id', $this->cmpId)->where('item_id', $item)
            ->update(['qty_on_hand' => 100, 'average_cost' => 50]);

        $before = $this->db->table('inv_wac_state')->where('cmp_id', $this->cmpId)->where('item_id', $item)->get()->getRowArray();

        $this->posting->reverse($this->cmpId, $documentId, 'reversing a historical challan', 'tester');

        $after = $this->db->table('inv_wac_state')->where('cmp_id', $this->cmpId)->where('item_id', $item)->get()->getRowArray();

        $this->assertEqualsWithDelta(
            (float) $before['qty_on_hand'],
            (float) $after['qty_on_hand'],
            0.0001,
            'the challan never added to the WAC pool, so reversing it must not take anything out',
        );
        $this->assertEqualsWithDelta(
            (float) $before['average_cost'],
            (float) $after['average_cost'],
            0.0001,
            're-averaging over a receipt that never happened inflates the cost of every unit left',
        );
    }

    /**
     * Goods received on a challan before the purchase is raised: the challan's own rate is the cost
     * of the goods (DocumentTypeRegistry::COST_BEARING_SOURCE_RATE says so), so the layer opens at
     * it and a later issue is costed from it instead of from the newest surviving layer.
     */
    public function testPhysicalInwardChallanOpensACostLayerAtItsOwnRate(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('GRN Widget', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 5, 100);

        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-05', 'stock_effect' => 'physical', 'party_ref' => 8100,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 150, 'amount' => 1500]],
        ]);
        $this->assertSame('POSTED', $challan['status']);
        $this->assertEqualsWithDelta(150.0, (float) $challan['lines'][0]['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(1500.0, (float) $challan['lines'][0]['valuation_amount'], 0.0001);

        $layer = $this->receiptLayer((int) $challan['document_id']);
        $this->assertNotNull($layer, 'stock in on_hand must have a cost layer behind it');
        $this->assertEqualsWithDelta(150.0, (float) $layer['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(10.0, (float) $layer['qty_remaining'], 0.0001);

        $movement = $this->db->table('inv_stock_movements')->where('document_id', (int) $challan['document_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(150.0, (float) $movement['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(1500.0, (float) $movement['value'], 0.0001);

        // 12 out of 15 on hand. FIFO: 5 @ 100 (opening) + 7 @ 150. Without the challan's layer the
        // pool holds only the opening, and the 7 short are priced at the last known cost, 100.
        $issue = $this->postDoc([
            'document_type' => 'MATERIAL_ISSUE', 'document_date' => '2026-04-12',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 12]],
        ]);
        $this->assertEqualsWithDelta(1550.0, (float) $issue['lines'][0]['valuation_amount'], 0.0001);
        // 3 left, all of them the challan's, and the pool matches the stock rather than going short.
        $this->assertEqualsWithDelta(3.0, (float) $this->receiptLayer((int) $challan['document_id'])['qty_remaining'], 0.0001);
        $pool = $this->db->table('inv_cost_layers')->selectSum('qty_remaining', 'q')->where('item_id', $item)->get()->getRowArray();
        $this->assertEqualsWithDelta(3.0, (float) $pool['q'], 0.0001);
    }

    /**
     * The case that proves the intent. A purchase posted with defer_inward moves no stock; the
     * inward challan that settles it does. The price agreed with the supplier lives on the
     * purchase, so the challan's layer must be costed from the purchase's line for the same item —
     * otherwise the goods exist, permanently, at no cost.
     */
    public function testDeferredPurchaseSettledByChallanIsCostedFromThePurchase(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Deferred Widget', $pcs, 'FIFO');

        $purchase = $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-02', 'stock_effect' => 'defer_inward', 'party_ref' => 8200,
            'source_document_type' => 'books.purchase', 'source_document_id' => 8801, 'source_document_no' => 'PB-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 220, 'amount' => 2200]],
        ], 'books');
        $this->assertSame('POSTED', $purchase['status']);
        $this->assertSame(0, $this->db->table('inv_stock_movements')->where('document_id', (int) $purchase['document_id'])->countAllResults(), 'a deferred purchase moves no stock');
        $this->assertNull($this->receiptLayer((int) $purchase['document_id']), 'a deferred purchase opens no layer either');

        // The challan carries the goods and no rate of its own.
        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-06', 'stock_effect' => 'settle_deferred', 'party_ref' => 8200,
            'metadata' => ['linked_source_document_id' => (int) $purchase['document_id']],
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10]],
        ]);
        $this->assertSame('POSTED', $challan['status']);
        $this->assertEqualsWithDelta(220.0, (float) $challan['lines'][0]['valuation_rate'], 0.0001, 'the cost belongs to the purchase, not to the challan');
        $this->assertEqualsWithDelta(2200.0, (float) $challan['lines'][0]['valuation_amount'], 0.0001);

        $layer = $this->receiptLayer((int) $challan['document_id']);
        $this->assertNotNull($layer, 'the goods the challan brought in must have a cost layer');
        $this->assertEqualsWithDelta(220.0, (float) $layer['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(10.0, (float) $layer['qty_remaining'], 0.0001);

        $issue = $this->postDoc([
            'document_type' => 'MATERIAL_ISSUE', 'document_date' => '2026-04-20',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10]],
        ]);
        $this->assertEqualsWithDelta(2200.0, (float) $issue['lines'][0]['valuation_amount'], 0.0001, 'the issue is costed, not guessed');
    }

    /** A challan_only challan moves no stock, so it values nothing and touches no layer. */
    public function testChallanOnlyInwardChallanIsStillNotValued(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Pending Widget', $pcs, 'FIFO');

        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-07', 'party_ref' => 8300,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 4, 'rate' => 99, 'amount' => 396]],
        ]);
        $this->assertSame('challan_only', $challan['stock_effect']);
        $this->assertNull($challan['lines'][0]['valuation_rate']);
        $this->assertSame(0, $this->db->table('inv_stock_movements')->where('document_id', (int) $challan['document_id'])->countAllResults());
        $this->assertSame(0, $this->db->table('inv_cost_layers')->where('item_id', $item)->countAllResults());
        $this->assertGreaterThan(0, $this->db->table('inv_pending_quantities')->where('document_id', (int) $challan['document_id'])->countAllResults());

        $this->posting->reverse($this->cmpId, (int) $challan['document_id'], 'tester', 'wrong supplier');
        $this->assertSame(0, $this->db->table('inv_cost_layers')->where('item_id', $item)->countAllResults(), 'reversing a challan that valued nothing must not touch valuation');
        $this->assertSame(0, $this->db->table('inv_wac_state')->where('item_id', $item)->countAllResults());
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults(), 'nothing to replay: no cost ever moved');
    }

    /** Reversing a challan that opened a layer withdraws it and replays what came after. */
    public function testReversingAValuedInwardChallanWithdrawsItsLayer(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Reversible Widget', $pcs, 'FIFO');

        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-05', 'stock_effect' => 'physical', 'party_ref' => 8400,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 6, 'rate' => 80, 'amount' => 480]],
        ]);
        $this->assertEqualsWithDelta(6.0, (float) $this->receiptLayer((int) $challan['document_id'])['qty_remaining'], 0.0001);

        $this->posting->reverse($this->cmpId, (int) $challan['document_id'], 'tester', 'goods sent back');
        $this->assertEqualsWithDelta(0.0, (float) $this->receiptLayer((int) $challan['document_id'])['qty_remaining'], 0.0001, 'the layer is withdrawn with the stock');
        $this->assertEqualsWithDelta(0.0, (new StockBalanceService())->balance($this->cmpId, $item, $wh)['on_hand'], 0.0001);
        $this->assertGreaterThan(0, $this->db->table('inv_valuation_recalc_jobs')->where('trigger_kind', 'reversal')->countAllResults(), 'later issues may have consumed this layer');
    }
}
