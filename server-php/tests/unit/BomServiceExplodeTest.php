<?php

namespace Tests\Unit;

use App\Services\BomService;
use PHPUnit\Framework\TestCase;

/**
 * Pure scaling arithmetic of BomService (no database). Mirrors Books ProductionService::preparePayload.
 *
 * @group unit
 */
final class BomServiceExplodeTest extends TestCase
{
    /** @return array<string, mixed> */
    private function bom(): array
    {
        return [
            'bom_id'           => 5,
            'finished_item_id' => 100,
            'yield_qty'        => 2,
            'yield_unit_id'    => 7,
            'lines'            => [
                ['bom_line_id' => 1, 'item_id' => 10, 'qty' => 4, 'unit_id' => 1, 'line_kind' => 'component', 'scrap_percent' => 0],
                ['bom_line_id' => 2, 'item_id' => 11, 'qty' => 1, 'unit_id' => 2, 'line_kind' => 'component', 'scrap_percent' => 0],
            ],
        ];
    }

    public function testScaleFactorMatchesBooks(): void
    {
        $this->assertSame(5.0, BomService::scaleFactor(10, 2));
        $this->assertSame(1.0, BomService::scaleFactor(3, 3));
        // yield_qty guarded to 0.0001 like Books (max(0.0001, yield))
        $this->assertEqualsWithDelta(10 / 0.0001, BomService::scaleFactor(10, 0), 0.0001);
        $this->assertEqualsWithDelta(10 / 0.0001, BomService::scaleFactor(10, -4), 0.0001);
    }

    public function testExplodesBomIntoOutComponentsAndInFinishedLine(): void
    {
        $lines = BomService::scaleLines($this->bom(), 10, 3, 50);

        $this->assertCount(3, $lines);
        $out = array_values(array_filter($lines, static fn ($l) => $l['direction'] === 'out'));
        $in = array_values(array_filter($lines, static fn ($l) => $l['direction'] === 'in'));
        $this->assertCount(2, $out);
        $this->assertCount(1, $in);

        // component qty = bom qty * (10 / 2)
        $this->assertSame(10, $out[0]['item_id']);
        $this->assertSame(20.0, $out[0]['qty']);
        $this->assertSame(1, $out[0]['unit_id']);
        $this->assertSame(0, $out[0]['rate']);
        $this->assertSame(0, $out[0]['amount']);
        $this->assertSame(3, $out[0]['warehouse_id']);
        $this->assertSame(11, $out[1]['item_id']);
        $this->assertSame(5.0, $out[1]['qty']);
        $this->assertSame(1, $out[0]['metadata']['bom_line_id']);
        $this->assertSame('component', $out[0]['metadata']['line_kind']);

        // finished line is last, receives production_qty at finished_rate
        $finished = $lines[2];
        $this->assertSame('in', $finished['direction']);
        $this->assertSame(100, $finished['item_id']);
        $this->assertSame(7, $finished['unit_id']);
        $this->assertSame(10.0, $finished['qty']);
        $this->assertSame(50.0, $finished['rate']);
        $this->assertSame(500.0, $finished['amount']);
        $this->assertSame(50.0, $finished['valuation_rate']);
        $this->assertSame(3, $finished['warehouse_id']);
        $this->assertSame(5, $finished['metadata']['bom_id']);
    }

    public function testFractionalScaleRoundsToFourDecimals(): void
    {
        $bom = $this->bom();
        $bom['yield_qty'] = 3;
        $bom['lines'] = [['item_id' => 10, 'qty' => 1, 'line_kind' => 'component']];
        $lines = BomService::scaleLines($bom, 1, null, 12.345678);
        // 1 * (1/3) = 0.3333...
        $this->assertSame(0.3333, $lines[0]['qty']);
        $this->assertNull($lines[0]['warehouse_id']);
        $this->assertSame(12.3457, $lines[1]['rate']);
        $this->assertSame(12.3457, $lines[1]['amount']);
        $this->assertNull($lines[0]['unit_id'], 'no unit on the BOM line -> null, DocumentService resolves the item default');
    }

    public function testZeroAndInvalidComponentLinesAreSkipped(): void
    {
        $bom = $this->bom();
        $bom['lines'] = [
            ['item_id' => 10, 'qty' => 0],
            ['item_id' => 0, 'qty' => 5],
            ['item_id' => 12, 'qty' => 0.00001],   // rounds to 0.0000 -> skipped
            ['item_id' => 13, 'qty' => 2],
        ];
        $lines = BomService::scaleLines($bom, 2, null, 0);
        $this->assertCount(2, $lines);
        $this->assertSame(13, $lines[0]['item_id']);
        $this->assertSame(2.0, $lines[0]['qty']);
        $this->assertSame(100, $lines[1]['item_id']);
        $this->assertNull($lines[1]['valuation_rate'], 'zero finished rate leaves valuation to the posting engine');
        $this->assertSame(0.0, $lines[1]['amount']);
    }

    public function testScrapPercentUpliftsComponentConsumptionOnly(): void
    {
        $bom = $this->bom();
        $bom['yield_qty'] = 1;
        $bom['lines'] = [
            ['item_id' => 10, 'qty' => 10, 'line_kind' => 'component', 'scrap_percent' => 5],
            ['item_id' => 20, 'qty' => 1, 'line_kind' => 'by_product', 'scrap_percent' => 50],
            ['item_id' => 30, 'qty' => 1, 'line_kind' => 'scrap'],
        ];
        $lines = BomService::scaleLines($bom, 4, 9, 10);
        $this->assertCount(3, $lines, 'scrap lines produce no movement');
        $this->assertSame(42.0, $lines[0]['qty'], '10 * 4 * 1.05');
        $this->assertSame('out', $lines[0]['direction']);
        $this->assertSame(20, $lines[1]['item_id']);
        $this->assertSame('in', $lines[1]['direction']);
        $this->assertSame(4.0, $lines[1]['qty'], 'scrap_percent ignored on by-products');
        $this->assertSame(100, $lines[2]['item_id']);
        $this->assertSame(4.0, $lines[2]['qty']);
    }

    public function testComponentQtyArithmetic(): void
    {
        $this->assertSame(20.0, BomService::componentQty(4, 5));
        $this->assertSame(21.0, BomService::componentQty(4, 5, 5));
        $this->assertSame(0.6667, BomService::componentQty(2, 1 / 3));
        $this->assertSame(20.0, BomService::componentQty(4, 5, -10), 'negative scrap is ignored');
    }

    public function testFinishedValuationRateIsPerBaseUnit(): void
    {
        // finished_rate 120 per box, 12 pcs per box -> 10 per pc in the layer
        $lines = BomService::scaleLines($this->bom(), 2, null, 120, 12);
        $finished = end($lines);
        $this->assertSame(120.0, $finished['rate']);
        $this->assertSame(240.0, $finished['amount']);
        $this->assertSame(10.0, $finished['valuation_rate']);
        $this->assertSame(10.0, BomService::baseUnitRate(120, 12));
        $this->assertSame(120.0, BomService::baseUnitRate(120, 0), 'zero factor treated as 1');
    }
}
