<?php

namespace Tests\Integration;

use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\RecalculationService;
use App\Services\StockBalanceService;
use Tests\Support\IntegrationTestCase;

/**
 * Backdated valuation recalculation: a receipt posted later but dated earlier must re-price
 * every later FIFO issue, rewrite the sale line, record the revision and publish it to Books.
 *
 * @group integration
 */
final class RecalculationTest extends IntegrationTestCase
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

    private function purchase(int $item, int $wh, int $unit, string $date, float $qty, float $rate, int $sourceId): array
    {
        return $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => $date, 'source_document_type' => 'books.purchase', 'source_document_id' => $sourceId, 'source_document_no' => 'P-' . $sourceId,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $unit, 'qty' => $qty, 'rate' => $rate, 'amount' => $qty * $rate]],
        ]);
    }

    public function testBackdatedPurchaseRepricesLaterFifoSaleAndPublishesRevision(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO');

        // 1. Purchase 10 @ 100 on 10-Apr, then sell 5 on 20-Apr -> COGS 500.
        $first = $this->purchase($item, $wh, $pcs, '2026-04-10', 10, 100, 501);
        $this->assertSame('POSTED', $first['status']);
        $sale = $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-20', 'source_document_type' => 'books.sales', 'source_document_id' => 901, 'source_document_no' => 'S-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 5, 'rate' => 300, 'amount' => 1500]],
        ]);
        $this->assertSame('POSTED', $sale['status']);
        $saleLineId = (int) $sale['lines'][0]['line_id'];
        $this->assertEqualsWithDelta(500.0, (float) $sale['lines'][0]['valuation_amount'], 0.0001, 'FIFO before the backdated receipt: 5 @ 100');
        $this->assertEqualsWithDelta(100.0, (float) $sale['lines'][0]['valuation_rate'], 0.0001);

        // 2. A BACKDATED purchase 10 @ 50 dated 05-Apr arrives after the sale was already costed.
        $backdated = $this->purchase($item, $wh, $pcs, '2026-04-05', 10, 50, 502);
        $this->assertSame('POSTED', $backdated['status']);
        $this->assertEqualsWithDelta(500.0, (float) $this->db->table('inv_document_lines')->where('line_id', $saleLineId)->get()->getRowArray()['valuation_amount'], 0.0001, 'posting a backdated receipt does not silently rewrite history — the recalc job does');

        // 3. Enqueue + run the recalculation from the backdated date.
        $service = new RecalculationService();
        $this->assertTrue($service->needsRecalc($this->cmpId, $item, '2026-04-05'));
        $jobId = $service->enqueue($this->cmpId, $this->fyId, $item, '2026-04-05', 'manual', (int) $backdated['document_id'], 'tester');
        $this->assertGreaterThan(0, $jobId);
        $this->assertSame('QUEUED', $this->db->table('inv_valuation_recalc_jobs')->where('job_id', $jobId)->get()->getRowArray()['status']);
        $job = $service->run($jobId);
        $this->assertSame('COMPLETED', $job['status']);
        $this->assertSame(3, (int) $job['affected_line_count'], 'two receipts + one issue replayed');
        $this->assertSame(1, (int) $job['revised_line_count']);
        $this->assertEqualsWithDelta(-250.0, (float) $job['cogs_delta'], 0.0001);
        $this->assertSame([(int) $sale['document_id']], array_map('intval', json_decode((string) $job['affected_documents_json'], true)));

        // 4. FIFO now consumes the older (backdated) 50-layer first: 5 @ 50 = 250.
        $line = $this->db->table('inv_document_lines')->where('line_id', $saleLineId)->get()->getRowArray();
        $this->assertEqualsWithDelta(250.0, (float) $line['valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(50.0, (float) $line['valuation_rate'], 0.0001);
        $this->assertSame('FIFO', $line['valuation_method_applied']);
        $movement = $this->db->table('inv_stock_movements')->where('line_id', $saleLineId)->where('movement_kind', 'physical')->get()->getRowArray();
        $this->assertEqualsWithDelta(-250.0, (float) $movement['value'], 0.0001, 'the ledger row carries the revised cost');
        $this->assertEqualsWithDelta(50.0, (float) $movement['unit_cost'], 0.0001);

        // Receipt lines were re-costed identically, so they carry no revision.
        $revisions = $this->db->table('inv_valuation_revisions')->where('cmp_id', $this->cmpId)->get()->getResultArray();
        $this->assertCount(1, $revisions);
        $rev = $revisions[0];
        $this->assertSame($jobId, (int) $rev['job_id']);
        $this->assertSame($saleLineId, (int) $rev['line_id']);
        $this->assertSame((int) $sale['document_id'], (int) $rev['document_id']);
        $this->assertEqualsWithDelta(500.0, (float) $rev['old_valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(250.0, (float) $rev['new_valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(-250.0, (float) $rev['delta_amount'], 0.0001);
        $this->assertSame('books', $rev['source_app']);
        $this->assertSame('books.sales', $rev['source_document_type']);
        $this->assertSame(901, (int) $rev['source_document_id']);
        $this->assertNotNull($rev['published_at'], 'a Books-sourced line is published through the outbox');
        $this->assertNull($rev['acknowledged_at']);

        // 5. Outbox: inventory.valuation.revised for the sale line, addressed to Books.
        $events = $this->db->table('inv_integration_events')->where('event_type', 'inventory.valuation.revised')->get()->getResultArray();
        $this->assertCount(1, $events);
        $this->assertSame('books', $events[0]['target_app']);
        $this->assertSame('PENDING', $events[0]['status']);
        $this->assertSame('document_line', $events[0]['aggregate_type']);
        $this->assertSame($saleLineId, (int) $events[0]['aggregate_id']);
        $payload = json_decode((string) $events[0]['payload_json'], true);
        $this->assertEqualsWithDelta(-250.0, (float) $payload['delta_amount'], 0.0001);
        $this->assertSame($jobId, (int) $payload['job_id']);
        $this->assertSame(901, (int) $payload['source_document_id']);

        // 6. Layers after replay: 5 left of the 50-layer, 10 untouched of the 100-layer; on-hand 15.
        $open = $this->db->table('inv_cost_layers')->select('unit_cost, qty_remaining')->where('cmp_id', $this->cmpId)->where('item_id', $item)->where('qty_remaining >', 0)->orderBy('received_at', 'ASC')->get()->getResultArray();
        $this->assertCount(2, $open);
        $this->assertEqualsWithDelta(50.0, (float) $open[0]['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(5.0, (float) $open[0]['qty_remaining'], 0.0001);
        $this->assertEqualsWithDelta(100.0, (float) $open[1]['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(10.0, (float) $open[1]['qty_remaining'], 0.0001);
        $this->assertEqualsWithDelta(15.0, (new StockBalanceService())->balance($this->cmpId, $item, $wh)['on_hand'], 0.0001, 'balances rebuilt after the replay');

        // Running a completed job again is a no-op.
        $again = $service->run($jobId);
        $this->assertSame('COMPLETED', $again['status']);
        $this->assertSame(1, $this->db->table('inv_valuation_revisions')->countAllResults());
    }

    public function testDryRunReportsRevisionsWithoutWriting(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Probe', $pcs, 'FIFO');
        $this->purchase($item, $wh, $pcs, '2026-04-10', 10, 100, 601);
        $sale = $this->postDoc(['document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-20', 'source_document_type' => 'books.sales', 'source_document_id' => 902, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 5, 'rate' => 300]]]);
        $this->purchase($item, $wh, $pcs, '2026-04-05', 10, 50, 602);

        $service = new RecalculationService();
        $jobId = $service->enqueue($this->cmpId, $this->fyId, $item, '2026-04-05', 'manual', null, 'tester', true);
        $job = $service->run($jobId);
        $this->assertSame('COMPLETED', $job['status']);
        $this->assertSame(1, (int) $job['revised_line_count']);
        $this->assertEqualsWithDelta(-250.0, (float) $job['cogs_delta'], 0.0001);
        $this->assertEqualsWithDelta(500.0, (float) $this->db->table('inv_document_lines')->where('line_id', (int) $sale['lines'][0]['line_id'])->get()->getRowArray()['valuation_amount'], 0.0001, 'dry run leaves the line untouched');
        $this->assertSame(0, $this->db->table('inv_valuation_revisions')->countAllResults());
        $this->assertSame(0, $this->db->table('inv_integration_events')->where('event_type', 'inventory.valuation.revised')->countAllResults());
    }
}
