<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use Tests\Support\IntegrationTestCase;

/**
 * A landed cost that arrives WITH the receipt.
 *
 * Books captures the charges (a freight bill is a payable it books on its own side), allocates them
 * across the receipt lines and sends a per-line rupee amount. Inventory consumes that amount as
 * part of the cost of the goods:
 *
 *     valuation_amount = (base cost of the goods) + landed_cost_amount
 *     valuation_rate   = valuation_amount / base_qty
 *
 * Both valuation methods have to carry it. Posting loads the rate once, before anything is
 * recorded, so ValuationEngine::recordReceipt() opens the FIFO layer at the loaded cost AND feeds
 * the same figure to the weighted average — not one or the other depending on which is read.
 *
 * And the commercial pair is untouched throughout: source_transaction_rate /
 * source_transaction_amount are what was agreed with the supplier, the numbers that drive GST,
 * receivables and turnover, and a freight bill may never change an invoice value.
 *
 * @group integration
 */
final class LandedCostReceiptTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
    }

    private function postDoc(array $payload, string $source = 'books'): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    /** 10 units at 100 plus 250 of freight = 1250 over 10 units. */
    private function receiptPayload(int $item, int $wh, int $pcs, int $sourceId, string $method): array
    {
        return [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10',
            'source_document_type' => 'books.purchase', 'source_document_id' => $sourceId, 'source_document_no' => 'P-' . $sourceId,
            'lines' => [[
                'item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 100, 'amount' => 1000,
                'landed_cost_amount' => 250.0,
                'landed_cost_breakdown' => [
                    ['cost_type' => 'freight', 'amount' => 150.0, 'allocation_basis' => 'value'],
                    ['cost_type' => 'duty', 'amount' => 60.0, 'allocation_basis' => 'qty'],
                    ['cost_type' => 'non_creditable_tax', 'amount' => 40.0, 'allocation_basis' => 'direct'],
                ],
            ]],
        ];
    }

    public function testUnderFifoTheCostLayerCarriesTheLandedCost(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Imported widget', $pcs, 'FIFO');

        $receipt = $this->postDoc($this->receiptPayload($item, $wh, $pcs, 801, 'FIFO'));
        $line = $receipt['lines'][0];

        $this->assertSame('POSTED', $receipt['status']);
        $this->assertEqualsWithDelta(125.0, $line['valuation_rate'], 0.0001, 'the goods cost 100 and the landing cost 25 a unit');
        $this->assertEqualsWithDelta(1250.0, $line['valuation_amount'], 0.01, 'base cost + landed cost');
        $this->assertEqualsWithDelta(250.0, $line['landed_cost_amount'], 0.0001, 'the line says how much of its valuation is landed cost');

        // Books owns these two and neither moved.
        $this->assertEqualsWithDelta(100.0, $line['source_transaction_rate'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, $line['source_transaction_amount'], 0.0001);

        $layer = $this->db->table('inv_cost_layers')->where('source_line_id', (int) $line['line_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(125.0, (float) $layer['unit_cost'], 0.0001, 'the FIFO layer opens at the loaded cost');
        $this->assertEqualsWithDelta(10.0, (float) $layer['qty_remaining'], 0.0001);

        $movement = $this->db->table('inv_stock_movements')->where('line_id', (int) $line['line_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(125.0, (float) $movement['unit_cost'], 0.0001, 'the movement, the line and the layer agree');
        $this->assertEqualsWithDelta(1250.0, (float) $movement['value'], 0.01);
    }

    public function testUnderWeightedAverageTheAverageCarriesTheSameLandedCost(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Averaged widget', $pcs, 'WAC');

        $receipt = $this->postDoc($this->receiptPayload($item, $wh, $pcs, 802, 'WAC'));
        $line = $receipt['lines'][0];

        $this->assertEqualsWithDelta(125.0, $line['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(1250.0, $line['valuation_amount'], 0.01);

        $state = $this->db->table('inv_wac_state')->where('item_id', $item)->get()->getRowArray();
        $this->assertNotNull($state, 'the weighted average was opened');
        $this->assertEqualsWithDelta(10.0, (float) $state['qty_on_hand'], 0.0001);
        $this->assertEqualsWithDelta(125.0, (float) $state['average_cost'], 0.0001, 'the average carries the landed cost too, not only FIFO');
    }

    /** A second receipt of the same item averages the two LOADED costs, not the two invoice rates. */
    public function testASecondReceiptAveragesLoadedCosts(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Averaged widget', $pcs, 'WAC');

        $this->postDoc($this->receiptPayload($item, $wh, $pcs, 803, 'WAC'));
        $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-20',
            'source_document_type' => 'books.purchase', 'source_document_id' => 804,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 200, 'amount' => 2000, 'landed_cost_amount' => 750.0]],
        ]);

        // (10 x 125 + 10 x 275) / 20 = 200
        $state = $this->db->table('inv_wac_state')->where('item_id', $item)->get()->getRowArray();
        $this->assertEqualsWithDelta(20.0, (float) $state['qty_on_hand'], 0.0001);
        $this->assertEqualsWithDelta(200.0, (float) $state['average_cost'], 0.0001);
    }

    public function testTheAllocationDetailIsWrittenPerCostType(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Imported widget', $pcs, 'FIFO');

        $receipt = $this->postDoc($this->receiptPayload($item, $wh, $pcs, 805, 'FIFO'));
        $documentId = (int) $receipt['document_id'];
        $lineId = (int) $receipt['lines'][0]['line_id'];

        $costs = $this->db->table('inv_landed_costs')->where('document_id', $documentId)->orderBy('cost_type', 'ASC')->get()->getResultArray();
        $this->assertCount(3, $costs, 'one row per cost type');
        $byType = [];
        foreach ($costs as $row) {
            $byType[$row['cost_type']] = $row;
            // A cost that arrived with the receipt names the receipt as both document and target.
            $this->assertSame($documentId, (int) $row['target_document_id']);
            $this->assertSame($documentId, (int) $row['document_id']);
        }
        $this->assertEqualsWithDelta(150.0, (float) $byType['freight']['amount'], 0.0001);
        $this->assertSame('value', $byType['freight']['allocation_basis']);
        $this->assertEqualsWithDelta(60.0, (float) $byType['duty']['amount'], 0.0001);
        $this->assertSame('qty', $byType['duty']['allocation_basis']);
        $this->assertEqualsWithDelta(40.0, (float) $byType['non_creditable_tax']['amount'], 0.0001);
        $this->assertSame('direct', $byType['non_creditable_tax']['allocation_basis']);

        $lines = $this->db->table('inv_landed_cost_lines')->where('cmp_id', $this->cmpId)->get()->getResultArray();
        $this->assertCount(3, $lines);
        $total = 0.0;
        foreach ($lines as $row) {
            $this->assertSame($lineId, (int) $row['target_line_id']);
            $total = round($total + (float) $row['allocated_amount'], 4);
            $this->assertEqualsWithDelta((float) $row['allocated_amount'] / 10, (float) $row['per_unit_amount'], 0.0001);
        }
        $this->assertEqualsWithDelta(250.0, $total, 0.0001, 'the detail adds up to what the line carries');
    }

    /**
     * The detail is derived allocation, not audit: applying it again REPLACES what is there rather
     * than appending a second copy that describes an allocation that no longer happened. Nothing
     * append-only is touched and no retention rule is involved.
     *
     * Driven straight at the writer, because a full document cannot be posted twice — the unique
     * index uq_inv_stock_movements_line refuses the second set of movements, and a posting that
     * fails rolls its landed-cost rows back with everything else. The delete-and-rewrite is the
     * guarantee that holds when that changes: a document edited and posted again, or a future
     * un-post, leaves exactly one description of its allocation behind.
     */
    public function testTheAllocationDetailIsRewrittenNotAppended(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Imported widget', $pcs, 'FIFO');

        $receipt = $this->postDoc($this->receiptPayload($item, $wh, $pcs, 806, 'FIFO'));
        $documentId = (int) $receipt['document_id'];
        $lineId = (int) $receipt['lines'][0]['line_id'];
        $this->assertSame(3, $this->db->table('inv_landed_costs')->where('document_id', $documentId)->countAllResults());

        // The same document allocated again, this time as one charge instead of three.
        $write = new \ReflectionMethod(DocumentPostingService::class, 'writeLandedCostAllocation');
        $write->invoke($this->posting, $this->db, $this->cmpId, $documentId, $documentId, [
            ['cost_type' => 'freight', 'allocation_basis' => 'value', 'line_id' => $lineId, 'base_qty' => 10.0, 'amount' => 250.0],
        ]);

        $costs = $this->db->table('inv_landed_costs')->where('document_id', $documentId)->get()->getResultArray();
        $this->assertCount(1, $costs, 'rewritten, not appended');
        $this->assertEqualsWithDelta(250.0, (float) $costs[0]['amount'], 0.0001);
        $this->assertSame(1, $this->db->table('inv_landed_cost_lines')->where('cmp_id', $this->cmpId)->countAllResults(), 'and no orphaned children left behind');

        // Allocating nothing clears it, so a draft edited to drop its freight leaves no detail.
        $write->invoke($this->posting, $this->db, $this->cmpId, $documentId, $documentId, []);
        $this->assertSame(0, $this->db->table('inv_landed_costs')->where('document_id', $documentId)->countAllResults());
        $this->assertSame(0, $this->db->table('inv_landed_cost_lines')->where('cmp_id', $this->cmpId)->countAllResults());
    }

    /** A receipt that carries no charge writes no detail and no landed cost. */
    public function testAnOrdinaryReceiptIsUnchanged(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Plain widget', $pcs, 'FIFO');

        $receipt = $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10',
            'source_document_type' => 'books.purchase', 'source_document_id' => 807,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 100, 'amount' => 1000]],
        ]);

        $this->assertEqualsWithDelta(100.0, $receipt['lines'][0]['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $receipt['lines'][0]['landed_cost_amount'], 0.0001);
        $this->assertSame(0, $this->db->table('inv_landed_costs')->countAllResults());
    }

    /**
     * Reversal unwinds the STORED valuation, which already includes the landed cost, so nothing
     * about the landed cost is re-derived on the way back. Layers, weighted average and balances
     * return to exactly the pre-receipt position.
     */
    public function testReversingALoadedReceiptReturnsEverythingToWhereItWas(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $fifo = $this->makeItem('Imported widget', $pcs, 'FIFO');
        $wac = $this->makeItem('Averaged widget', $pcs, 'WAC');

        foreach ([[$fifo, 808], [$wac, 809]] as [$item, $sourceId]) {
            $receipt = $this->postDoc($this->receiptPayload($item, $wh, $pcs, $sourceId, 'x'));
            $this->posting->reverse($this->cmpId, (int) $receipt['document_id'], 'tester', 'supplier cancelled the shipment');
        }

        $open = $this->db->table('inv_cost_layers')->where('qty_remaining >', 0)->countAllResults();
        $this->assertSame(0, $open, 'no layer is left holding stock at the loaded cost');
        $state = $this->db->table('inv_wac_state')->where('item_id', $wac)->get()->getRowArray();
        $this->assertEqualsWithDelta(0.0, (float) $state['qty_on_hand'], 0.0001);
        foreach ([$fifo, $wac] as $item) {
            $balance = $this->db->table('inv_stock_balances')->where('item_id', $item)->selectSum('on_hand_qty', 'q')->get()->getRowArray();
            $this->assertEqualsWithDelta(0.0, (float) ($balance['q'] ?? 0), 0.0001);
        }
        // And the allocation detail goes with the valuation it described. These rows are DERIVED
        // detail, not audit: left behind they say 250 of freight is capitalised onto a receipt
        // whose valuation has just been taken back off, and any report answering "what landed cost
        // sits on this company's receipts" counts an amount that is no longer there.
        $this->assertSame(0, $this->db->table('inv_landed_costs')->countAllResults(), 'a reversed receipt describes no allocation');
        $this->assertSame(0, $this->db->table('inv_landed_cost_lines')->countAllResults());
    }

    /**
     * A deferred purchase moves no stock when it posts, so it never values its lines and a landed
     * cost on one has nowhere to go. It is refused at entry rather than accepted and dropped.
     *
     * The drop was invisible end to end: the purchase posted POSTED with the amount on its line and
     * no warning, wrote no allocation row and no cost layer, and the settling inward challan then
     * costed the goods from the purchase's RATE — deferredPurchaseUnitCost() reads valuation_rate
     * and the two source_transaction_* columns and no landed cost — so the layer opened at 100 a
     * unit instead of 125 and closing stock was short by exactly the freight with nobody told.
     */
    public function testADeferredPurchaseRefusesALandedCostRatherThanDroppingIt(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Imported widget', $pcs, 'FIFO');

        $payload = $this->receiptPayload($item, $wh, $pcs, 813, 'FIFO');
        $payload['stock_effect'] = 'defer_inward';

        try {
            $this->docs->create($this->ctx(), $payload, 'tester', 'books');
            $this->fail('a deferred purchase must refuse a landed cost, not drop it');
        } catch (InventoryException $e) {
            $this->assertStringContainsString('defer_inward', $e->getMessage());
            $this->assertStringContainsString('moves no stock when it posts', $e->getMessage());
            $this->assertStringContainsString('LANDED_COST', $e->getMessage());
        }
        $this->assertSame(0, $this->db->table('inv_documents')->countAllResults(), 'and nothing is left half-saved');

        // The same purchase without the charge is accepted, and the route that does work is the
        // LANDED_COST document against the challan that actually receives the goods.
        unset($payload['lines'][0]['landed_cost_amount'], $payload['lines'][0]['landed_cost_breakdown']);
        $purchase = $this->postDoc($payload);
        $this->assertSame('POSTED', $purchase['status']);
    }

    // ------------------------------------------------------------------ refusals at entry

    public function testALandedCostOnAnOutwardLineIsRefused(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO');

        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('cannot be carried on an outward line');
        $this->docs->create($this->ctx(), [
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-12', 'source_document_type' => 'books.sales', 'source_document_id' => 810,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 2, 'rate' => 300, 'landed_cost_amount' => 50.0]],
        ], 'tester', 'books');
    }

    /**
     * An inward challan values only the stock it actually moves, so the TYPE carries no valuation
     * and a charge on one would be dropped. It is a 422 with the route that works, never a silent
     * zero — a dropped cost is a closing stock nobody is told is short.
     */
    public function testALandedCostOnATypeThatCarriesNoValuationIsRefused(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO');

        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('does not carry valuation');
        $this->docs->create($this->ctx(), [
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-12', 'stock_effect' => 'physical',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 2, 'landed_cost_amount' => 50.0]],
        ], 'tester', 'inventory');
    }

    /** The out leg a transfer generates from one entered line is caught, not only what was typed. */
    public function testALandedCostOnATransferIsRefusedOnTheLegItWouldBeDroppedFrom(): void
    {
        $pcs = $this->makeUnit();
        $from = $this->makeWarehouse('From');
        $to = $this->makeWarehouse('To');
        $item = $this->makeItem('Widget', $pcs, 'FIFO');

        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('outward line');
        $this->docs->create($this->ctx(), [
            'document_type' => 'STOCK_TRANSFER', 'document_date' => '2026-04-12', 'from_warehouse_id' => $from, 'to_warehouse_id' => $to,
            'lines' => [['item_id' => $item, 'warehouse_id' => $to, 'unit_id' => $pcs, 'qty' => 2, 'landed_cost_amount' => 50.0]],
        ], 'tester', 'inventory');
    }

    public function testABreakdownThatDoesNotTieToTheAmountIsRefused(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO');

        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('landed_cost_breakdown sums to');
        $this->docs->create($this->ctx(), [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-12', 'source_document_type' => 'books.purchase', 'source_document_id' => 811,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 2, 'rate' => 100, 'landed_cost_amount' => 100.0,
                'landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 60.0]]]],
        ], 'tester', 'books');
    }

    /** The breakdown survives create -> read -> post, because posting reads its lines back out. */
    public function testTheBreakdownSurvivesTheRoundTripThroughTheDatabase(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Imported widget', $pcs, 'FIFO');

        $draft = $this->docs->create($this->ctx(), $this->receiptPayload($item, $wh, $pcs, 812, 'FIFO'), 'tester', 'books');
        $reread = $this->docs->get($this->cmpId, (int) $draft['document_id']);

        $this->assertCount(3, $reread['lines'][0]['metadata']['landed_cost_breakdown']);
        $this->assertSame('freight', $reread['lines'][0]['metadata']['landed_cost_breakdown'][0]['cost_type']);
        $this->assertEqualsWithDelta(250.0, $reread['lines'][0]['landed_cost_amount'], 0.0001);
    }
}
