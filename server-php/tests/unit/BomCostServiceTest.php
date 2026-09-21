<?php

namespace Tests\Unit;

use App\Services\BomCostService;
use PHPUnit\Framework\TestCase;

/**
 * The costing arithmetic of BomCostService, without a database.
 *
 * `costLines` is driven with company 0: UnitConversionService::factorFor
 * short-circuits to 1.0 for a non-positive company id and never opens a
 * connection, so every line here is costed in its own unit. Unit conversion
 * itself is covered by the conversion service's own tests; what these pin down
 * is the part a production manager reads — wastage, the split between material
 * and wastage cost, and what happens to a component nobody can price.
 *
 * @group unit
 */
final class BomCostServiceTest extends TestCase
{
    private function service(): BomCostService
    {
        return new BomCostService();
    }

    public function testGrossQtyUpliftsByWastage(): void
    {
        $this->assertSame(10.0, BomCostService::grossQty(10, 0));
        $this->assertSame(11.0, BomCostService::grossQty(10, 10));
        $this->assertSame(10.25, BomCostService::grossQty(10, 2.5));
        // A negative wastage is not a discount on consumption.
        $this->assertSame(10.0, BomCostService::grossQty(10, -5));
    }

    public function testCostsComponentsAndSplitsWastageOut(): void
    {
        $costed = $this->service()->costLines(0, [
            ['item_id' => 10, 'qty' => 4, 'unit_id' => null, 'line_kind' => 'component', 'scrap_percent' => 0],
            ['item_id' => 11, 'qty' => 10, 'unit_id' => null, 'line_kind' => 'component', 'scrap_percent' => 10],
        ], [
            10 => ['cost' => 25.0, 'source' => BomCostService::SOURCE_AVERAGE],
            11 => ['cost' => 2.0, 'source' => BomCostService::SOURCE_STANDARD],
        ]);

        // 4 x 25 = 100, and 10 x 2 = 20 net / 11 x 2 = 22 gross.
        $this->assertSame(120.0, $costed['component_cost']);
        $this->assertSame(2.0, $costed['wastage_cost']);
        $this->assertSame(122.0, $costed['total_cost']);
        $this->assertSame(2, $costed['priced_components']);
        $this->assertSame(0, $costed['unpriced_components']);
        $this->assertTrue($costed['complete']);

        $this->assertSame(11.0, $costed['lines'][1]['gross_qty']);
        $this->assertSame(22.0, $costed['lines'][1]['estimated_cost']);
        $this->assertSame(BomCostService::SOURCE_STANDARD, $costed['lines'][1]['cost_source']);
    }

    public function testUnpricedComponentStaysNullRatherThanZero(): void
    {
        $costed = $this->service()->costLines(0, [
            ['item_id' => 10, 'qty' => 2, 'unit_id' => null, 'line_kind' => 'component', 'scrap_percent' => 0],
            ['item_id' => 99, 'qty' => 3, 'unit_id' => null, 'line_kind' => 'component', 'scrap_percent' => 0],
        ], [
            10 => ['cost' => 5.0, 'source' => BomCostService::SOURCE_AVERAGE],
        ]);

        $this->assertSame(10.0, $costed['total_cost']);
        $this->assertSame(1, $costed['unpriced_components']);
        $this->assertFalse($costed['complete']);
        $this->assertNull($costed['lines'][1]['estimated_cost']);
        $this->assertNull($costed['lines'][1]['cost_per_unit']);
        // The quantity is still known even when the rate is not.
        $this->assertSame(3.0, $costed['lines'][1]['gross_qty']);
    }

    public function testByProductsAndScrapAreNotMaterialCost(): void
    {
        $costed = $this->service()->costLines(0, [
            ['item_id' => 10, 'qty' => 1, 'unit_id' => null, 'line_kind' => 'component', 'scrap_percent' => 0],
            ['item_id' => 20, 'qty' => 1, 'unit_id' => null, 'line_kind' => 'by_product', 'scrap_percent' => 0],
            ['item_id' => 30, 'qty' => 1, 'unit_id' => null, 'line_kind' => 'scrap', 'scrap_percent' => 0],
        ], [
            10 => ['cost' => 7.0, 'source' => BomCostService::SOURCE_AVERAGE],
            20 => ['cost' => 3.0, 'source' => BomCostService::SOURCE_AVERAGE],
            30 => ['cost' => 1.0, 'source' => BomCostService::SOURCE_AVERAGE],
        ]);

        $this->assertSame(7.0, $costed['total_cost']);
        $this->assertSame(1, $costed['priced_components']);
        $this->assertNull($costed['lines'][1]['estimated_cost']);
        $this->assertNull($costed['lines'][2]['estimated_cost']);
    }

    public function testNoComponentsIsNotAFreeBom(): void
    {
        $costed = $this->service()->costLines(0, [], []);

        $this->assertSame(0.0, $costed['total_cost']);
        $this->assertFalse($costed['complete']);
    }
}
