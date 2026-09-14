<?php

namespace Tests\Integration;

use App\Services\RecalculationService;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use Tests\Support\IntegrationTestCase;

/**
 * A replay re-costs issues that were already valued, already stored and already published to Books
 * as COGS. Two ways it could answer with a figure nothing recorded, and must not.
 *
 * The first is a cost of zero it never decided: replayItem() cast a possibly-null unit cost to
 * (float), which is 0.0, and receiving goods at zero is not a refusal — it is a wrong answer written
 * to the line, the movement, the stored accounting effects and the outbox.
 *
 * The second is a cost from the future: the last-resort cost ends at the item's newest inward line,
 * and during a replay "newest" was unbounded, so an issue could be re-priced from a receipt dated
 * after it and the difference handed to Books as a revision for a period that may already be filed.
 *
 * @group integration
 */
final class ReplayInventedCostTest extends IntegrationTestCase
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

    /**
     * A transfer pair the replay can never complete: the issuing side is void, the receiving side
     * is not, and the receiving line carries no cost of its own — the shape a migration leaves when
     * Books had no cost_rate for the transfer and only one side of the pair came across intact.
     */
    private function breakTransferPair(array $transfer): void
    {
        $out = $this->db->table('inv_stock_movements')->where('line_id', (int) $transfer['lines'][0]['line_id'])->where('movement_kind', 'physical')->get()->getRowArray();
        $this->db->table('inv_stock_movements')->insert([
            'cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'bo_id' => 0, 'document_id' => (int) $out['document_id'], 'line_id' => (int) $out['line_id'],
            'document_type' => 'STOCK_TRANSFER', 'movement_date' => $out['movement_date'], 'sequence_no' => 9, 'item_id' => (int) $out['item_id'],
            'warehouse_id' => $out['warehouse_id'], 'direction' => 'in', 'qty' => -(float) $out['qty'], 'unit_cost' => $out['unit_cost'],
            'value' => $out['value'] !== null ? -(float) $out['value'] : null, 'movement_kind' => 'reversal',
            'reversal_of_movement_id' => (int) $out['movement_id'], 'created_at' => date('Y-m-d H:i:s'), 'created_by' => 'tester',
        ]);
        $this->db->table('inv_document_lines')->where('line_id', (int) $transfer['lines'][1]['line_id'])
            ->update(['valuation_rate' => null, 'valuation_amount' => null, 'valuation_method_applied' => null]);
    }

    public function testATransferInSideWithNoIssuingSideIsRefusedRatherThanReceivedAtZero(): void
    {
        $pcs = $this->makeUnit();
        $a = $this->makeWarehouse('A');
        $b = $this->makeWarehouse('B');
        $item = $this->makeItem('Mover', $pcs, 'FIFO');
        $this->postDoc(['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-01', 'source_document_type' => 'books.purchase', 'source_document_id' => 71, 'lines' => [['item_id' => $item, 'warehouse_id' => $a, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 40, 'amount' => 400]]], 'books');
        $transfer = $this->postDoc(['document_type' => 'STOCK_TRANSFER', 'document_date' => '2026-04-02', 'from_warehouse_id' => $a, 'to_warehouse_id' => $b, 'lines' => [['item_id' => $item, 'qty' => 4]]]);
        $this->assertSame('in', $transfer['lines'][1]['direction']);
        $this->breakTransferPair($transfer);

        $layersBefore = $this->db->table('inv_cost_layers')->select('layer_id, unit_cost, qty_remaining')->where('item_id', $item)->orderBy('layer_id', 'ASC')->get()->getResultArray();
        $this->assertNotSame([], $layersBefore);

        $service = new RecalculationService();
        $jobId = $service->enqueue($this->cmpId, $this->fyId, $item, '2026-04-01', 'manual', null, 'tester');
        // Caught rather than asserted in place: PHPUnit's own failure is a RuntimeException too, so
        // a catch around $this->fail() would swallow it and report the wrong thing.
        $refusal = null;
        try {
            $service->run($jobId);
        } catch (\RuntimeException $e) {
            $refusal = $e;
        }
        $this->assertNotNull($refusal, 'the replay received the goods instead of refusing them');
        $this->assertSame(409, $refusal->getCode());
        $this->assertStringContainsString('receiving side of a transfer', $refusal->getMessage());
        $this->assertStringContainsString('line_id ' . (int) $transfer['lines'][1]['line_id'], $refusal->getMessage());

        $job = $this->db->table('inv_valuation_recalc_jobs')->where('job_id', $jobId)->get()->getRowArray();
        $this->assertSame('FAILED', $job['status'], 'the refusal is recorded, which needs the connection left usable');
        $this->assertStringContainsString('receiving side of a transfer', (string) $job['failure_reason']);

        // The refusal rolled back the clear-and-reseed, so the item still values exactly as before.
        $this->assertSame($layersBefore, $this->db->table('inv_cost_layers')->select('layer_id, unit_cost, qty_remaining')->where('item_id', $item)->orderBy('layer_id', 'ASC')->get()->getResultArray());
        $this->assertSame(0, $this->db->table('inv_cost_layers')->where('item_id', $item)->where('unit_cost', 0)->countAllResults(), 'nothing was received at zero');
        $this->assertSame(0, $this->db->table('inv_valuation_revisions')->countAllResults());
        $this->assertSame(0, $this->db->table('inv_integration_events')->where('event_type', 'inventory.valuation.revised')->countAllResults());
    }

    /**
     * An issue costed at zero because nothing was known yet stays costed at zero. Replaying it
     * against a purchase raised two months later would restate a filed period's COGS by the whole
     * value of the sale, and Books would be told to book the difference.
     */
    public function testAnIssueIsNotRePricedFromAReceiptDatedAfterIt(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Sold Before Bought', $pcs, 'FIFO');

        $sale = $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-10', 'source_document_type' => 'books.sales', 'source_document_id' => 4100, 'source_document_no' => 'S-41',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 5, 'rate' => 1200, 'amount' => 6000]],
        ], 'books');
        $saleLineId = (int) $sale['lines'][0]['line_id'];
        $this->assertEqualsWithDelta(0.0, (float) $sale['lines'][0]['valuation_amount'], 0.0001, 'nothing was known about this item on 10-Apr');

        // The item is first bought two months later, at a real price.
        $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-06-01', 'source_document_type' => 'books.purchase', 'source_document_id' => 4200,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 900, 'amount' => 9000]],
        ], 'books');

        $service = new RecalculationService();
        $job = $service->run($service->enqueue($this->cmpId, $this->fyId, $item, '2026-04-10', 'manual', null, 'tester'));

        $this->assertSame('COMPLETED', $job['status']);
        $this->assertSame(2, (int) $job['affected_line_count'], 'the sale and the purchase were both replayed');

        $line = $this->db->table('inv_document_lines')->where('line_id', $saleLineId)->get()->getRowArray();
        $this->assertEqualsWithDelta(0.0, (float) $line['valuation_amount'], 0.0001, 'a June purchase may not price an April sale');
        $this->assertSame(0, (int) $job['revised_line_count'], 'the replay reproduced what posting decided');
        $this->assertEqualsWithDelta(0.0, (float) $job['cogs_delta'], 0.0001);
        $this->assertSame(0, $this->db->table('inv_valuation_revisions')->countAllResults());
        $this->assertSame(0, $this->db->table('inv_integration_events')->where('event_type', 'inventory.valuation.revised')->countAllResults(), 'Books is told nothing, because nothing changed');
    }

    /** Posting keeps the opposite rule: a backdated document is priced from everything known today. */
    public function testPostingABackdatedIssueStillUsesTodaysKnownCost(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Backdated', $pcs, 'FIFO');
        $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-06-01', 'source_document_type' => 'books.purchase', 'source_document_id' => 4300,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 900, 'amount' => 9000]],
        ], 'books');

        // Dated before that purchase and issued from a different warehouse, so no layer covers it.
        $other = $this->makeWarehouse('Other');
        $this->db->table('inv_company_settings')->where('cmp_id', $this->cmpId)->update(['valuation_scope' => 'warehouse']);
        \App\Services\InventorySettingsService::flush();
        $sale = $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-10', 'source_document_type' => 'books.sales', 'source_document_id' => 4400,
            'lines' => [['item_id' => $item, 'warehouse_id' => $other, 'unit_id' => $pcs, 'qty' => 2, 'rate' => 1200, 'amount' => 2400]],
        ], 'books');

        $this->assertEqualsWithDelta(900.0, (float) $sale['lines'][0]['valuation_rate'], 0.0001, 'posting reaches for every cost known today, backdated or not');
    }
}
