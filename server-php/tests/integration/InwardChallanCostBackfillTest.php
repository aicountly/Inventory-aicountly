<?php

namespace Tests\Integration;

use App\Commands\InventoryBackfillChallanCost;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\RecalculationService;
use CodeIgniter\CLI\CLI;
use Tests\Support\IntegrationTestCase;

require_once __DIR__ . '/../../app/Commands/InventoryBackfillChallanCost.php';

/**
 * The repair for inward challans posted before posting valued them.
 *
 * Those rows are still in production: stock in on_hand, no valuation on the line, no unit_cost on
 * the movement, no cost layer. The fixture reproduces that shape exactly — post a challan through
 * the current engine, then strip the valuation off it the way the old gate left it.
 *
 * @group integration
 */
final class InwardChallanCostBackfillTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;

    /** @var array<string, mixed>|null */
    private $savedOptions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
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

    private function postDoc(array $payload, string $source = 'inventory'): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    /** Leave the document exactly as the old gate left it: stock moved, nothing valued. */
    private function stripValuation(int $documentId): void
    {
        $this->db->table('inv_document_lines')->where('document_id', $documentId)
            ->update(['valuation_rate' => null, 'valuation_amount' => null, 'valuation_method_applied' => null]);
        $this->db->table('inv_stock_movements')->where('document_id', $documentId)
            ->update(['unit_cost' => null, 'value' => null]);
        $this->db->table('inv_cost_layers')->where('source_document_id', $documentId)->delete();
    }

    private function runCommand(array $options): void
    {
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $options);
        (new \ReflectionClass(InventoryBackfillChallanCost::class))->newInstanceWithoutConstructor()->run([]);
    }

    public function testTheRecordedCostIsRestoredAndTheReplayRebuildsTheLayer(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Historic Widget', $pcs, 'FIFO');

        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-05', 'stock_effect' => 'physical', 'party_ref' => 9500,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 150, 'amount' => 1500]],
        ]);
        $this->stripValuation((int) $challan['document_id']);
        $lineId = (int) $challan['lines'][0]['line_id'];

        // Dry run writes nothing.
        $this->runCommand(['company' => $this->cmpId]);
        $this->assertNull($this->db->table('inv_document_lines')->where('line_id', $lineId)->get()->getRowArray()['valuation_rate']);
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());

        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);
        $line = $this->db->table('inv_document_lines')->where('line_id', $lineId)->get()->getRowArray();
        $this->assertEqualsWithDelta(150.0, (float) $line['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(1500.0, (float) $line['valuation_amount'], 0.0001);
        $movement = $this->db->table('inv_stock_movements')->where('line_id', $lineId)->get()->getRowArray();
        $this->assertEqualsWithDelta(150.0, (float) $movement['unit_cost'], 0.0001);

        // The command does not insert layers; the queued replay does, in date order.
        $job = $this->db->table('inv_valuation_recalc_jobs')->where('trigger_kind', 'challan_cost_backfill')->get()->getRowArray();
        $this->assertNotNull($job);
        $this->assertSame($item, (int) $job['item_id'], 'one job per repaired item, so an unrelated broken item cannot block it');
        $this->assertSame(0, $this->db->table('inv_cost_layers')->where('item_id', $item)->countAllResults());

        (new RecalculationService())->run((int) $job['job_id']);
        $layer = $this->db->table('inv_cost_layers')->where('item_id', $item)->where('layer_kind', 'receipt')->get()->getRowArray();
        $this->assertEqualsWithDelta(150.0, (float) $layer['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(10.0, (float) $layer['qty_remaining'], 0.0001);

        // Idempotent: a second apply finds nothing and queues nothing.
        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);
        $this->assertSame(1, $this->db->table('inv_valuation_recalc_jobs')->where('trigger_kind', 'challan_cost_backfill')->countAllResults());
    }

    /** A settled deferred purchase is repaired from the purchase's rate, as posting would have. */
    public function testASettledDeferredPurchaseIsRepairedFromThePurchase(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Historic Deferred', $pcs, 'FIFO');

        $purchase = $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-02', 'stock_effect' => 'defer_inward', 'party_ref' => 9600,
            'source_document_type' => 'books.purchase', 'source_document_id' => 9601,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 8, 'rate' => 310, 'amount' => 2480]],
        ], 'books');
        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-09', 'stock_effect' => 'settle_deferred', 'party_ref' => 9600,
            'metadata' => ['linked_source_document_id' => (int) $purchase['document_id']],
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 8]],
        ]);
        $this->stripValuation((int) $challan['document_id']);

        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);
        $line = $this->db->table('inv_document_lines')->where('line_id', (int) $challan['lines'][0]['line_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(310.0, (float) $line['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(2480.0, (float) $line['valuation_amount'], 0.0001);
    }

    /** A line no document ever priced is reported and left alone, never priced by invention. */
    public function testALineWithNoRecordedCostIsLeftAlone(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Unpriced Widget', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 5, 777);

        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-05', 'stock_effect' => 'physical', 'party_ref' => 9700,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 3]],
        ]);
        $this->stripValuation((int) $challan['document_id']);

        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);
        $line = $this->db->table('inv_document_lines')->where('line_id', (int) $challan['lines'][0]['line_id'])->get()->getRowArray();
        $this->assertNull($line['valuation_rate'], 'the item costs 777 today, but nothing recorded that as this receipt\'s cost');
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());
    }
}
