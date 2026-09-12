<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\BomService;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\StockBalanceService;
use Tests\Support\IntegrationTestCase;

/**
 * BomService::explode against PostgreSQL, and the contract that its lines are accepted and
 * posted by DocumentService / DocumentPostingService as a PRODUCTION document.
 *
 * @group integration
 */
final class BomServiceTest extends IntegrationTestCase
{
    private function makeBom(int $finished, int $yieldUnit, float $yieldQty, array $lines, int $active = 1): int
    {
        $this->db->table('inv_bom_headers')->insert(['cmp_id' => $this->cmpId, 'bom_name' => 'BOM ' . $finished, 'finished_item_id' => $finished, 'yield_qty' => $yieldQty, 'yield_unit_id' => $yieldUnit, 'is_active' => $active, 'created_at' => date('Y-m-d H:i:s')]);
        $bomId = (int) $this->db->insertID();
        $sort = 0;
        foreach ($lines as $l) {
            $this->db->table('inv_bom_lines')->insert($l + ['bom_id' => $bomId, 'cmp_id' => $this->cmpId, 'line_kind' => 'component', 'scrap_percent' => 0, 'sort_order' => $sort++]);
        }

        return $bomId;
    }

    public function testExplodeAndPostProduction(): void
    {
        $pcs = $this->makeUnit('Pcs', 'Pcs');
        $box = $this->makeUnit('Box', 'Box');
        $wh = $this->makeWarehouse();
        $flour = $this->makeItem('Flour', $pcs, 'FIFO');
        $sugar = $this->makeItem('Sugar', $pcs, 'WAC');
        $cake = $this->makeItem('Cake', $pcs, 'FIFO', [$box => 12]);
        $this->setOpening($flour, $pcs, 100, 2, 0, $wh);
        $this->setOpening($sugar, $pcs, 100, 4, 0, $wh);
        // 1 box (12 cakes) needs 4 flour + 1 sugar
        $bomId = $this->makeBom($cake, $box, 1, [['item_id' => $flour, 'qty' => 4, 'unit_id' => $pcs], ['item_id' => $sugar, 'qty' => 1, 'unit_id' => $pcs]]);

        $svc = new BomService();
        $lines = $svc->explode($this->cmpId, $bomId, 5, $wh, 120);
        $this->assertCount(3, $lines);
        $this->assertSame([20.0, 5.0, 5.0], array_map(static fn ($l) => $l['qty'], $lines));
        $this->assertSame(['out', 'out', 'in'], array_column($lines, 'direction'));
        $this->assertSame($box, $lines[2]['unit_id']);
        $this->assertEqualsWithDelta(10.0, $lines[2]['valuation_rate'], 0.0001, '120 per box / 12 pcs per box');

        $docs = new DocumentService();
        $doc = $docs->create($this->ctx(), $svc->productionPayload($this->cmpId, $bomId, 5, $wh, 120, ['document_date' => '2026-04-10']), 'tester');
        $this->assertSame('PRODUCTION', $doc['document_type']);
        $this->assertSame($bomId, (int) $doc['metadata']['bom_id']);
        $this->assertCount(3, $doc['lines']);
        $this->assertSame(['out', 'out', 'in'], array_column($doc['lines'], 'direction'));
        $this->assertEqualsWithDelta(60.0, $doc['lines'][2]['base_qty'], 0.0001, '5 boxes = 60 pcs');

        $posted = (new DocumentPostingService($docs))->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
        $this->assertSame('POSTED', $posted['status']);
        $this->assertEqualsWithDelta(10.0, $posted['lines'][2]['valuation_rate'], 0.0001, 'finished goods received at the given finished rate (base unit)');
        $this->assertEqualsWithDelta(600.0, $posted['lines'][2]['valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(40.0, $posted['lines'][0]['valuation_amount'], 0.0001, '20 flour @ 2');
        $bal = new StockBalanceService();
        // inv_stock_balances only carries posted movements (openings live in inv_item_openings, see PostingEngineTest)
        $this->assertEqualsWithDelta(-20.0, $bal->balance($this->cmpId, $flour, $wh)['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(-5.0, $bal->balance($this->cmpId, $sugar, $wh)['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(60.0, $bal->balance($this->cmpId, $cake, $wh)['on_hand'], 0.0001);
        $this->assertSame(1, $this->db->table('inv_stock_movements')->where('document_id', (int) $doc['document_id'])->where('item_id', $cake)->where('direction', 'in')->countAllResults());

        // the delete guard used by BomController sees this document
        $used = $this->db->table('inv_documents')->where('cmp_id', $this->cmpId)->where('document_type', 'PRODUCTION')->where("(metadata_json->>'bom_id') = '" . $bomId . "'", null, false)->countAllResults();
        $this->assertSame(1, $used);
    }

    public function testExplodeRejectsInactiveMissingAndTenantForeignBoms(): void
    {
        $pcs = $this->makeUnit();
        $a = $this->makeItem('A', $pcs);
        $b = $this->makeItem('B', $pcs);
        $inactive = $this->makeBom($a, $pcs, 1, [['item_id' => $b, 'qty' => 1, 'unit_id' => $pcs]], 0);
        $svc = new BomService();
        try {
            $svc->explode($this->cmpId, $inactive, 1, null, 0);
            $this->fail('inactive BOM must not explode');
        } catch (InventoryException $e) {
            $this->assertSame('validation_failed', $e->errorCode());
        }
        try {
            $svc->explode($this->cmpId + 1, $inactive, 1, null, 0);
            $this->fail('other company must not see the BOM');
        } catch (InventoryException $e) {
            $this->assertSame('not_found', $e->errorCode());
        }
        try {
            $svc->explode($this->cmpId, 999999, 1, null, 0);
            $this->fail('missing BOM');
        } catch (InventoryException $e) {
            $this->assertSame('not_found', $e->errorCode());
        }
        $empty = $this->makeBom($a, $pcs, 1, []);
        try {
            $svc->explode($this->cmpId, $empty, 1, null, 0);
            $this->fail('BOM without component lines');
        } catch (InventoryException $e) {
            $this->assertSame('validation_failed', $e->errorCode());
        }
        $this->expectException(InventoryException::class);
        $svc->explode($this->cmpId, $empty, 0, null, 0);
    }
}
