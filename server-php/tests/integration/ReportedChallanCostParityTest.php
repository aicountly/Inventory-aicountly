<?php

namespace Tests\Integration;

use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\ValuationReplayService;
use Tests\Support\IntegrationTestCase;

/**
 * The reporting engine and the posting engine must cost the same goods the same way.
 *
 * They read different tables — posting writes cost layers, the report replays movements in memory —
 * so the only thing keeping them together is the predicate each uses to decide what an inward line
 * cost. ValuationReplayService carried its own copy of that predicate and the copy had drifted: it
 * never gained INWARD_CHALLAN, although DocumentTypeRegistry::COST_BEARING_SOURCE_RATE says a GRN
 * rate IS the cost of the goods. So a challan that moved stock was reported at nothing while
 * posting costed it from the GRN rate.
 *
 * This is not a hypothetical: Migration\Validator::booksSnapshot() feeds the cutover parity gate
 * from this very engine, and it compares against Books, which costs a vch_type 24 line from its
 * cost_rate. A challan reported at zero is a value difference the gate then has to explain away.
 *
 * @group integration
 */
final class ReportedChallanCostParityTest extends IntegrationTestCase
{
    private const GRN_RATE = 250.0;

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
     * Every inward challan already in production: stock in on_hand, nothing valued. The migrator
     * derives movements from the line (unit_cost = l.valuation_rate), and Books kept no cost layer
     * for a vch_type 24 line, so a migrated challan arrives in exactly this shape too.
     */
    private function stripValuation(int $documentId): void
    {
        $this->db->table('inv_document_lines')->where('document_id', $documentId)
            ->update(['valuation_rate' => null, 'valuation_amount' => null, 'valuation_method_applied' => null]);
        $this->db->table('inv_stock_movements')->where('document_id', $documentId)->update(['unit_cost' => null, 'value' => null]);
        $this->db->table('inv_cost_layers')->where('source_document_id', $documentId)->delete();
    }

    /** @return array<string, mixed> */
    private function reported(int $itemId): array
    {
        $rows = (new ValuationReplayService())->snapshot($this->cmpId, $this->fyId, 0, '2026-04-30')['rows'];
        $this->assertCount(1, $rows);
        $this->assertSame($itemId, (int) $rows[0]['item_id']);

        return $rows[0];
    }

    private function physicalChallan(int $item, int $wh, int $pcs): array
    {
        return $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-05', 'stock_effect' => 'physical', 'party_ref' => 8800,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => self::GRN_RATE, 'amount' => self::GRN_RATE * 10]],
        ]);
    }

    public function testTheReportValuesAFreshlyPostedChallanAtWhatPostingCostedIt(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('GRN Widget', $pcs, 'FIFO');
        $challan = $this->physicalChallan($item, $wh, $pcs);

        $layer = $this->db->table('inv_cost_layers')->where('source_document_id', (int) $challan['document_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(self::GRN_RATE, (float) $layer['unit_cost'], 0.0001, 'posting opened the layer at the GRN rate');

        $row = $this->reported($item);
        $this->assertEqualsWithDelta(10.0, $row['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(self::GRN_RATE, $row['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(2500.0, $row['stock_value'], 0.0001);
    }

    /**
     * The rows the parity gate actually meets. Posting left no cost behind on these, so the report
     * has to read the GRN rate off the line — and that is only allowed because the registry declares
     * an inward challan's source rate to be a cost, the same declaration posting works from.
     */
    public function testAChallanPostedBeforeTheStockWasValuedIsStillReportedAtTheGrnRate(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Historic GRN Widget', $pcs, 'FIFO');
        $challan = $this->physicalChallan($item, $wh, $pcs);
        $this->stripValuation((int) $challan['document_id']);

        $this->assertSame(0, $this->db->table('inv_cost_layers')->where('item_id', $item)->countAllResults(), 'the shape production is in: stock, no layer');

        $row = $this->reported($item);
        $this->assertEqualsWithDelta(10.0, $row['closing_qty'], 0.0001, 'the goods are counted');
        $this->assertEqualsWithDelta(self::GRN_RATE, $row['unit_cost'], 0.0001, 'and they are worth what the challan says they cost, not nothing');
        $this->assertEqualsWithDelta(2500.0, $row['stock_value'], 0.0001);
    }

    /**
     * The other half of the same predicate: a commercial rate is still never a cost. A job-work
     * receipt in the same shape is reported at nothing rather than at the value agreed with the job
     * worker, which is the figure Table 5 of FORM GST ITC-04 declares.
     */
    public function testAJobWorkReceiptInTheSameShapeIsStillNotCostedFromItsChallanValue(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Job Work Widget', $pcs, 'FIFO');
        $receipt = $this->postDoc([
            'document_type' => 'JOB_WORK_IN', 'document_date' => '2026-04-06', 'party_ref' => 8900,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 1250, 'amount' => 12500, 'direction' => 'in']],
        ]);
        $this->stripValuation((int) $receipt['document_id']);

        $row = $this->reported($item);
        $this->assertEqualsWithDelta(10.0, $row['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $row['unit_cost'], 0.0001, 'the value agreed with the job worker is not what the stock cost');
    }
}
