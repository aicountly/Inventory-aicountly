<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\FyCarryForwardService;
use App\Services\FyCarryForwardStatus;
use App\Services\StockBalanceService;
use App\Services\ValuationReplayService;
use Tests\Support\IntegrationTestCase;

/**
 * Year-end carry-forward of the Items module: FY1 opening + receipt + issue → FY2 opens on
 * FY1's closing quantity and value; a second run is refused unless overwrite is asked for.
 *
 * @group integration
 */
final class FyCarryForwardTest extends IntegrationTestCase
{
    private const FY2 = 6;

    private DocumentService $docs;
    private DocumentPostingService $posting;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
    }

    /** @return array<string, mixed> */
    private function request(bool $overwrite = false): array
    {
        return FyCarryForwardService::normaliseRequest([
            'source_fy_id' => $this->fyId, 'target_fy_id' => self::FY2,
            'source_fy_start' => '2026-04-01', 'source_fy_end' => '2027-03-31',
            'target_fy_start' => '2027-04-01', 'target_fy_end' => '2028-03-31',
            'bo_id' => 0, 'overwrite' => $overwrite,
        ]);
    }

    private function postDoc(array $payload): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', 'books');

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    private function purchase(int $item, int $wh, int $unit, string $date, float $qty, float $rate, int $sourceId): array
    {
        return $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => $date, 'source_document_type' => 'books.purchase', 'source_document_id' => $sourceId, 'source_document_no' => 'P-' . $sourceId,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $unit, 'qty' => $qty, 'rate' => $rate, 'amount' => $qty * $rate]],
        ]);
    }

    /** @return array{unit:int, wh:int, item:int} opening 10 @ 100, +10 @ 120, -15 → closing 5 @ 120 (FIFO) */
    private function seedYearOne(): array
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 10, 100, 0, $wh);
        $this->assertSame('POSTED', $this->purchase($item, $wh, $pcs, '2026-04-10', 10, 120, 501)['status']);
        $sale = $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-15', 'source_document_type' => 'books.sales', 'source_document_id' => 900, 'source_document_no' => 'S-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 15, 'rate' => 300, 'amount' => 4500]],
        ]);
        $this->assertSame('POSTED', $sale['status']);

        return ['unit' => $pcs, 'wh' => $wh, 'item' => $item];
    }

    public function testCarryForwardOpensYearTwoOnYearOneClosing(): void
    {
        ['unit' => $pcs, 'wh' => $wh, 'item' => $item] = $this->seedYearOne();
        $service = new FyCarryForwardService();

        // Preview: the same computation, nothing written.
        $preview = $service->preview($this->cmpId, $this->fyId, self::FY2, 0, '2027-03-31');
        $this->assertSame(1, $preview['stock_item_count']);
        $this->assertCount(1, $preview['rows']);
        $this->assertSame(['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs], array_intersect_key($preview['rows'][0], ['item_id' => 1, 'warehouse_id' => 1, 'unit_id' => 1]));
        $this->assertEqualsWithDelta(5.0, $preview['rows'][0]['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(120.0, $preview['rows'][0]['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(600.0, $preview['rows'][0]['value'], 0.0001);
        $this->assertSame('FIFO', $preview['rows'][0]['valuation_method']);
        $this->assertEqualsWithDelta(600.0, $preview['total_value'], 0.0001);
        $this->assertSame(0, $this->db->table('inv_item_openings')->where('fy_id', self::FY2)->countAllResults());
        $this->assertSame(0, $this->db->table('inv_fy_carryforward_status')->countAllResults());
        $this->assertNull($service->status($this->cmpId, $this->fyId, self::FY2, 0));
        $this->assertFalse(FyCarryForwardStatus::hasRunInto($this->cmpId, self::FY2));

        $result = $service->run($this->cmpId, $this->request(), 'closer');
        $this->assertSame(1, $result['stock_item_count']);
        $this->assertEqualsWithDelta(600.0, $result['total_value'], 0.0001);
        $this->assertSame('completed', $result['status']['status']);
        $this->assertSame(1, $result['status']['stock_item_count']);
        $this->assertSame('closer', $result['status']['carried_forward_by']);
        $this->assertNull($result['recalc_job_id'], 'no target-year movements → nothing to replay');
        $this->assertSame(0, $result['replaced_rows']);

        // FY2 openings = FY1 closing, per item / warehouse / base unit.
        $openings = $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->get()->getResultArray();
        $this->assertCount(1, $openings);
        $o = $openings[0];
        $this->assertSame($item, (int) $o['item_id']);
        $this->assertSame($wh, (int) $o['warehouse_id']);
        $this->assertSame($pcs, (int) $o['unit_id']);
        $this->assertEqualsWithDelta(5.0, (float) $o['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(120.0, (float) $o['opening_valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(600.0, (float) $o['opening_value'], 0.0001);
        $this->assertSame('carry_forward', $o['source_kind']);
        $this->assertSame('FIFO', $o['valuation_method']);
        $this->assertSame(1, $this->db->table('inv_item_openings')->where('fy_id', 0)->countAllResults(), 'the inception opening is untouched');

        // Status, FY ranges, cache flip, outbox.
        $this->assertTrue(FyCarryForwardStatus::hasRunInto($this->cmpId, self::FY2));
        $this->assertFalse(FyCarryForwardStatus::hasRunInto($this->cmpId, $this->fyId), 'the source year still opens on the inception rows');
        $range = $this->db->table('inv_fy_ranges')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->get()->getRowArray();
        $this->assertSame('2027-04-01', substr((string) $range['fy_start'], 0, 10));
        $this->assertSame('2028-03-31', substr((string) $range['fy_end'], 0, 10));
        $events = $this->db->table('inv_integration_events')->where('event_type', 'inventory.fy.carried_forward')->get()->getResultArray();
        $this->assertCount(1, $events);
        $this->assertSame('books', $events[0]['target_app']);
        $this->assertSame('fy_carryforward', $events[0]['aggregate_type']);
        $payload = json_decode((string) $events[0]['payload_json'], true);
        $this->assertSame($this->cmpId, (int) $payload['cmp_id']);
        $this->assertSame(self::FY2, (int) $payload['target_fy_id']);
        $this->assertSame(1, (int) $payload['stock_item_count']);
        $this->assertEqualsWithDelta(600.0, (float) $payload['total_value'], 0.0001);
        $this->assertSame(1, $this->db->table('inv_audit_log')->where('action', 'valuation.carried_forward')->countAllResults());

        // The new year values and counts exactly what the old year closed with.
        $snap = (new ValuationReplayService())->snapshot($this->cmpId, self::FY2, 0, '2027-04-30');
        $this->assertCount(1, $snap['rows']);
        $this->assertEqualsWithDelta(5.0, $snap['rows'][0]['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(600.0, $snap['rows'][0]['stock_value'], 0.0001);
        $closing = (new StockBalanceService())->closingQuantities($this->cmpId, self::FY2, 0, null, null);
        $this->assertEqualsWithDelta(5.0, $closing[$item . ':' . $wh]['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(5.0, (new StockBalanceService())->balance($this->cmpId, $item, $wh)['on_hand'], 0.0001);

        // Posting-time state: one opening layer for the new year, stamped at its first day.
        $layers = $this->db->table('inv_cost_layers')->where('cmp_id', $this->cmpId)->where('item_id', $item)->get()->getResultArray();
        $this->assertCount(1, $layers);
        $this->assertSame('opening', $layers[0]['layer_kind']);
        $this->assertSame(self::FY2, (int) $layers[0]['fy_id']);
        $this->assertEqualsWithDelta(5.0, (float) $layers[0]['qty_remaining'], 0.0001);
        $this->assertEqualsWithDelta(120.0, (float) $layers[0]['unit_cost'], 0.0001);
        $this->assertSame('2027-04-01', substr((string) $layers[0]['received_at'], 0, 10));
    }

    public function testSecondRunIsRefusedWithoutOverwriteAndReplacesWithIt(): void
    {
        ['unit' => $pcs, 'wh' => $wh, 'item' => $item] = $this->seedYearOne();
        $service = new FyCarryForwardService();
        $service->run($this->cmpId, $this->request(), 'closer');

        // A late FY1 receipt after the close: 5 @ 130 → closing 10, FIFO value 600 + 650.
        $this->assertSame('POSTED', $this->purchase($item, $wh, $pcs, '2026-05-01', 5, 130, 502)['status']);

        try {
            $service->run($this->cmpId, $this->request(), 'closer');
            $this->fail('expected the second run to be refused');
        } catch (InventoryException $e) {
            $this->assertSame('conflict', $e->errorCode());
            $this->assertSame(409, $e->httpStatus());
            $this->assertSame(1, $e->details()['existing_rows']);
        }
        $unchanged = $this->db->table('inv_item_openings')->where('fy_id', self::FY2)->get()->getResultArray();
        $this->assertCount(1, $unchanged);
        $this->assertEqualsWithDelta(5.0, (float) $unchanged[0]['opening_qty'], 0.0001, 'a refused run writes nothing');
        $this->assertSame(1, $this->db->table('inv_integration_events')->where('event_type', 'inventory.fy.carried_forward')->countAllResults());

        $result = $service->run($this->cmpId, $this->request(true), 'closer');
        $this->assertSame(1, $result['replaced_rows']);
        $this->assertEqualsWithDelta(10.0, $result['rows'][0]['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(125.0, $result['rows'][0]['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(1250.0, $result['total_value'], 0.0001);

        $replaced = $this->db->table('inv_item_openings')->where('fy_id', self::FY2)->get()->getResultArray();
        $this->assertCount(1, $replaced, 'delete-then-write: still one row');
        $this->assertNotSame((int) $unchanged[0]['opening_id'], (int) $replaced[0]['opening_id']);
        $this->assertEqualsWithDelta(10.0, (float) $replaced[0]['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(125.0, (float) $replaced[0]['opening_valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(1250.0, (float) $replaced[0]['opening_value'], 0.0001);
        $this->assertSame(1, $this->db->table('inv_fy_carryforward_status')->countAllResults(), 'status row is replaced, not duplicated');
        $this->assertSame(2, $this->db->table('inv_integration_events')->where('event_type', 'inventory.fy.carried_forward')->countAllResults());
        $snap = (new ValuationReplayService())->snapshot($this->cmpId, self::FY2, 0, '2027-04-30');
        $this->assertEqualsWithDelta(10.0, $snap['rows'][0]['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(1250.0, $snap['rows'][0]['stock_value'], 0.0001);
        $this->assertEqualsWithDelta(10.0, (new StockBalanceService())->balance($this->cmpId, $item, $wh)['on_hand'], 0.0001);
    }

    public function testMovementsAlreadyPostedInTargetYearQueueAReplayInsteadOfReseeding(): void
    {
        ['unit' => $pcs, 'wh' => $wh, 'item' => $item] = $this->seedYearOne();
        // FY2 opened before the close ran (the usual case in practice).
        $this->db->table('inv_fy_ranges')->insert(['cmp_id' => $this->cmpId, 'fy_id' => self::FY2, 'fy_start' => '2027-04-01', 'fy_end' => '2028-03-31']);
        $doc = $this->docs->create(['cmp_id' => $this->cmpId, 'fy_id' => self::FY2, 'bo_id' => 0], [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2027-04-05', 'source_document_type' => 'books.purchase', 'source_document_id' => 601,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 3, 'rate' => 140, 'amount' => 420]],
        ], 'tester', 'books');
        $this->assertSame('POSTED', $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']])['status']);
        $layersBefore = $this->db->table('inv_cost_layers')->where('item_id', $item)->countAllResults();

        $result = (new FyCarryForwardService())->run($this->cmpId, $this->request(), 'closer');
        $this->assertEqualsWithDelta(5.0, $result['rows'][0]['closing_qty'], 0.0001, 'FY2 movements do not count towards FY1 closing');
        $this->assertNotNull($result['recalc_job_id']);
        $job = $this->db->table('inv_valuation_recalc_jobs')->where('job_id', $result['recalc_job_id'])->get()->getRowArray();
        $this->assertSame('carry_forward', $job['trigger_kind']);
        $this->assertSame('QUEUED', $job['status']);
        $this->assertSame(self::FY2, (int) $job['fy_id']);
        $this->assertSame('2027-04-01', substr((string) $job['from_date'], 0, 10));
        $this->assertSame($layersBefore, $this->db->table('inv_cost_layers')->where('item_id', $item)->countAllResults(), 'layers of a moved item are left for the replay');
        // Quantity is right straight away: carried 5 + 3 received in FY2.
        $this->assertEqualsWithDelta(8.0, (new StockBalanceService())->balance($this->cmpId, $item, $wh)['on_hand'], 0.0001);
        $snap = (new ValuationReplayService())->snapshot($this->cmpId, self::FY2, 0, '2027-04-30');
        $this->assertEqualsWithDelta(8.0, $snap['rows'][0]['closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(600.0 + 420.0, $snap['rows'][0]['stock_value'], 0.0001);
    }
}
