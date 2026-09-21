<?php

namespace Tests\Unit;

use App\Services\InventoryReportService;
use PHPUnit\Framework\TestCase;

/**
 * The stock-health verdict behind the warehouse-stock register's status badge (no database).
 *
 * @group unit
 */
final class WarehouseStockHealthTest extends TestCase
{
    /** @return array{min_stock_qty:?float, max_stock_qty:?float, reorder_point_qty:?float, safety_stock_qty:?float} */
    private function levels(array $set = []): array
    {
        return $set + [
            'min_stock_qty'     => null,
            'max_stock_qty'     => null,
            'reorder_point_qty' => null,
            'safety_stock_qty'  => null,
        ];
    }

    public function testNegativeAndOutAreFactsAboutTheRowAlone(): void
    {
        // Even with a healthy company-wide position, one warehouse below zero is negative:
        // it is a posting error on that shelf and nothing in another building fixes it.
        $this->assertSame('negative', InventoryReportService::stockHealth(-15.0, 900.0, $this->levels(['reorder_point_qty' => 10.0])));
        $this->assertSame('out', InventoryReportService::stockHealth(0.0, 900.0, $this->levels()));
        // Rounding noise from the movement walk is zero, not a negative balance.
        $this->assertSame('out', InventoryReportService::stockHealth(-0.00001, 900.0, $this->levels()));
    }

    public function testThresholdsAreComparedAgainstTheItemNotTheShelf(): void
    {
        $levels = $this->levels(['reorder_point_qty' => 100.0]);
        // 40 on this shelf, 400 across the company: nothing to reorder.
        $this->assertSame('healthy', InventoryReportService::stockHealth(40.0, 400.0, $levels));
        // 40 on this shelf and 90 in total: the item itself is under its reorder point.
        $this->assertSame('reorder', InventoryReportService::stockHealth(40.0, 90.0, $levels));
        // The reorder point is inclusive — sitting exactly on it is the trigger.
        $this->assertSame('reorder', InventoryReportService::stockHealth(40.0, 100.0, $levels));
    }

    public function testReorderOutranksLowBecauseItIsTheActionableOne(): void
    {
        $levels = $this->levels(['reorder_point_qty' => 100.0, 'safety_stock_qty' => 50.0]);
        $this->assertSame('reorder', InventoryReportService::stockHealth(30.0, 30.0, $levels));
    }

    public function testLowComesFromSafetyStockOrMinimum(): void
    {
        $this->assertSame('low', InventoryReportService::stockHealth(30.0, 30.0, $this->levels(['safety_stock_qty' => 50.0])));
        $this->assertSame('low', InventoryReportService::stockHealth(30.0, 30.0, $this->levels(['min_stock_qty' => 50.0])));
        // Strictly below, unlike the reorder point: standing exactly on the minimum is fine.
        $this->assertSame('healthy', InventoryReportService::stockHealth(50.0, 50.0, $this->levels(['min_stock_qty' => 50.0])));
    }

    public function testOverstockedNeedsAMaximum(): void
    {
        $this->assertSame('overstocked', InventoryReportService::stockHealth(900.0, 900.0, $this->levels(['max_stock_qty' => 500.0])));
        // No maximum on the item, so there is no quantity this register calls too much.
        $this->assertSame('healthy', InventoryReportService::stockHealth(900.0, 900.0, $this->levels()));
    }

    public function testNoThresholdsMeansNoInventedVerdict(): void
    {
        // An item nobody has set levels for can only read negative, out or healthy — the
        // register never guesses a reorder point from the quantity in front of it.
        foreach ([1.0, 50.0, 100000.0] as $qty) {
            $this->assertSame('healthy', InventoryReportService::stockHealth($qty, $qty, $this->levels()));
            $this->assertSame('healthy', InventoryReportService::stockHealth($qty, $qty, null));
        }
    }

    public function testVocabularyIsWorstFirst(): void
    {
        $this->assertSame(
            ['negative', 'out', 'reorder', 'low', 'overstocked', 'healthy'],
            InventoryReportService::STOCK_HEALTH,
        );
    }

    public function testHealthFilterResolvesOneStateOrANamedSet(): void
    {
        $this->assertNull(InventoryReportService::stockHealthFilterSet(''), 'no filter means no filter');
        $this->assertNull(InventoryReportService::stockHealthFilterSet('   '));
        $this->assertSame(['low'], InventoryReportService::stockHealthFilterSet('LOW'));
        $this->assertSame(
            ['negative', 'out', 'reorder', 'low'],
            InventoryReportService::stockHealthFilterSet('attention'),
            'the KPI card asks one question, not four',
        );
    }

    public function testUnknownHealthIsRejectedRatherThanIgnored(): void
    {
        // Silently dropping it would answer a different question under the same heading.
        $this->expectException(\App\Exceptions\InventoryException::class);
        InventoryReportService::stockHealthFilterSet('sparkling');
    }
}
