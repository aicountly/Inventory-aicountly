<?php

namespace Tests\Integration;

use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\RecalculationService;
use Tests\Support\IntegrationTestCase;

/**
 * A replay must reach the same unit cost the posting engine reached, line for line.
 *
 * The two engines resolve an inward unit cost independently — DocumentPostingService::inwardUnitCost
 * when the document posts, RecalculationService::replayItem when it is replayed — so any difference
 * in their precedence shows up as a phantom revision: stock revalued, COGS adjusted and an
 * inventory.valuation.revised event published to Books, with nothing in the business having changed.
 *
 * @group integration
 */
final class ReplayPrecedencePostingTest extends IntegrationTestCase
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

    /**
     * A purchase billed at 100 but costed at 120 (duty, freight — an explicit valuation_rate on the
     * line). PURCHASE_RECEIPT is cost-bearing, so its source rate is a real cost too; the explicit
     * line rate still outranks it, in posting and therefore in replay.
     */
    public function testReplayKeepsAnExplicitLineValuationRateOnACostBearingType(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Imported Widget', $pcs, 'FIFO');

        $purchase = $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10', 'source_document_type' => 'books.purchase', 'source_document_id' => 801, 'source_document_no' => 'P-801',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 100, 'amount' => 1000, 'valuation_rate' => 120]],
        ]);
        $this->assertSame('POSTED', $purchase['status']);
        $purchaseLineId = (int) $purchase['lines'][0]['line_id'];
        $this->assertEqualsWithDelta(100.0, (float) $purchase['lines'][0]['source_transaction_rate'], 0.0001, 'the price agreed with the supplier stays a Books snapshot');
        $this->assertEqualsWithDelta(120.0, (float) $purchase['lines'][0]['valuation_rate'], 0.0001, 'posting takes the explicit line cost over the source rate');
        $this->assertEqualsWithDelta(1200.0, (float) $purchase['lines'][0]['valuation_amount'], 0.0001);

        $sale = $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-20', 'source_document_type' => 'books.sales', 'source_document_id' => 802, 'source_document_no' => 'S-802',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 4, 'rate' => 300, 'amount' => 1200]],
        ]);
        $saleLineId = (int) $sale['lines'][0]['line_id'];
        $this->assertEqualsWithDelta(480.0, (float) $sale['lines'][0]['valuation_amount'], 0.0001, 'FIFO consumes the 120 layer');

        $service = new RecalculationService();
        $job = $service->run($service->enqueue($this->cmpId, $this->fyId, $item, '2026-04-01', 'manual', null, 'tester'));
        $this->assertSame('COMPLETED', $job['status']);
        $this->assertSame(2, (int) $job['affected_line_count'], 'the receipt and the issue were both replayed');
        $this->assertSame(0, (int) $job['revised_line_count'], 'nothing changed in the business, so nothing may be revised');
        $this->assertEqualsWithDelta(0.0, (float) $job['cogs_delta'], 0.0001);

        $receiptLine = $this->db->table('inv_document_lines')->where('line_id', $purchaseLineId)->get()->getRowArray();
        $this->assertEqualsWithDelta(120.0, (float) $receiptLine['valuation_rate'], 0.0001, 'the replay must not drop to the supplier rate');
        $this->assertEqualsWithDelta(1200.0, (float) $receiptLine['valuation_amount'], 0.0001);
        $saleLine = $this->db->table('inv_document_lines')->where('line_id', $saleLineId)->get()->getRowArray();
        $this->assertEqualsWithDelta(120.0, (float) $saleLine['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(480.0, (float) $saleLine['valuation_amount'], 0.0001, 'COGS survives the replay');

        $layer = $this->db->table('inv_cost_layers')->where('cmp_id', $this->cmpId)->where('item_id', $item)->where('layer_kind', 'receipt')->get()->getRowArray();
        $this->assertEqualsWithDelta(120.0, (float) $layer['unit_cost'], 0.0001, 'the rebuilt FIFO layer opens at the posted cost');

        $this->assertSame(0, $this->db->table('inv_valuation_revisions')->where('cmp_id', $this->cmpId)->countAllResults());
        $this->assertSame(0, $this->db->table('inv_integration_events')->where('event_type', 'inventory.valuation.revised')->countAllResults(), 'no phantom COGS adjustment reaches Books');
    }
}
