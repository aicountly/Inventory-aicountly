<?php

namespace Tests\Integration;

use App\Services\InventoryReportService;
use App\Services\ReconciliationService;
use Tests\Support\IntegrationTestCase;

/**
 * The opening stock register answers "what did this year open with" — and it is the one report
 * that has to agree with the reconciliation tab to the paisa, because its total IS the
 * `inventory_opening_value` that tab holds against Books' Stock-in-Hand opening. A register that
 * footed to its own arithmetic would turn a clean reconciliation into a phantom variance every
 * time a reader compared the two screens.
 *
 * It also has to be honest about WHICH rows it is showing: before a year-end close a company
 * opens on its inception rows (fy_id = 0), after one on that year's own rows, and the same FY
 * legitimately means different stock either side of that run.
 *
 * @group integration
 */
final class OpeningStockReportTest extends IntegrationTestCase
{
    private function reports(): InventoryReportService
    {
        return new InventoryReportService();
    }

    private function opening(array $filters = []): array
    {
        return $this->reports()->openingStock($this->cmpId, $this->fyId, $this->boId, $filters + ['nonzero' => true], 100, 0);
    }

    public function testTotalsToTheSameFigureReconciliationHoldsAgainstBooks(): void
    {
        $pcs = $this->makeUnit();
        $a = $this->makeItem('Widget', $pcs);
        $b = $this->makeItem('Gadget', $pcs);
        $this->setOpening($a, $pcs, 10, 100);   // 1,000
        $this->setOpening($b, $pcs, 3.5, 12.34); // 43.19

        $result = $this->opening();
        $expected = (new ReconciliationService())->inventoryOpeningValue($this->cmpId, $this->fyId, $this->boId);

        $this->assertSame(2, $result['summary']['items']);
        $this->assertSame(
            round($expected, 4),
            round((float) $result['summary']['opening_value'], 4),
            'the register total and the reconciliation figure must be the same number, not two roundings of it',
        );
    }

    /** Several opening lines for one item collapse into the single layer valuation starts from. */
    public function testOneRowPerItemCarryingTheCollapsedLayerValuationUses(): void
    {
        $pcs = $this->makeUnit();
        $main = $this->makeWarehouse('Main');
        $overflow = $this->makeWarehouse('Overflow');
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100, 0, $main);  // 1,000
        $this->setOpening($item, $pcs, 30, 200, 0, $overflow); // 6,000

        $rows = $this->opening()['rows'];

        $this->assertCount(1, $rows, 'one item is one row however many warehouses it opened in');
        $this->assertEqualsWithDelta(40.0, (float) $rows[0]['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(175.0, (float) $rows[0]['unit_cost'], 0.0001, '(1,000 + 6,000) / 40');
        $this->assertEqualsWithDelta(7000.0, (float) $rows[0]['opening_value'], 0.0001);
        $this->assertSame(2, (int) $rows[0]['lines']);
        $this->assertSame(['Main', 'Overflow'], $rows[0]['warehouse_names']);
    }

    /**
     * Opening quantity entered with no rate is stock the company holds and Inventory values at
     * nil. It is the single largest reason an Inventory opening sits below the Books one, so the
     * register names the quantity rather than leaving a reader to infer it from a zero value.
     */
    public function testNamesTheQuantityThatCarriesNoValuationRate(): void
    {
        $pcs = $this->makeUnit();
        $valued = $this->makeItem('Widget', $pcs);
        $unvalued = $this->makeItem('Gadget', $pcs);
        $this->setOpening($valued, $pcs, 10, 100);
        $this->setOpening($unvalued, $pcs, 25, 0);

        $result = $this->opening();
        $byName = [];
        foreach ($result['rows'] as $row) {
            $byName[$row['item_name']] = $row;
        }

        $this->assertEqualsWithDelta(0.0, (float) $byName['Gadget']['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(25.0, (float) $byName['Gadget']['unvalued_qty'], 0.0001);
        $this->assertEqualsWithDelta(0.0, (float) $byName['Widget']['unvalued_qty'], 0.0001);
        $this->assertSame(1, (int) $result['summary']['unvalued_items']);
        $this->assertEqualsWithDelta(25.0, (float) $result['summary']['unvalued_qty'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, (float) $result['summary']['opening_value'], 0.0001);

        $only = $this->opening(['unvalued' => true]);
        $this->assertCount(1, $only['rows']);
        $this->assertSame('Gadget', $only['rows'][0]['item_name']);
    }

    /** An alternate unit is converted the way valuation converts it, not shown as entered. */
    public function testConvertsAnAlternateUnitOpeningToBaseUnits(): void
    {
        $pcs = $this->makeUnit('Pcs', 'Pcs');
        $box = $this->makeUnit('Box', 'Box');
        $item = $this->makeItem('Widget', $pcs, 'FIFO', [$box => 12]);
        $this->setOpening($item, $box, 5, 1200); // 5 boxes of 12 = 60 pcs, 6,000

        $rows = $this->opening()['rows'];

        $this->assertEqualsWithDelta(60.0, (float) $rows[0]['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(100.0, (float) $rows[0]['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(6000.0, (float) $rows[0]['opening_value'], 0.0001);
    }

    /**
     * The basis is the report's own disclosure of which rows it read. Without the close having
     * run into the FY, that is the company's inception opening — the FY's own rows are not yet
     * authoritative, and a register that showed them would be reporting a year that has not
     * started.
     */
    public function testStatesWhichSetOfOpeningRowsItRead(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100);             // inception
        $result = $this->opening();

        $this->assertSame('master_inception', $result['summary']['basis']);
        $this->assertSame(0, (int) $result['summary']['source_fy_id']);
        $this->assertEqualsWithDelta(1000.0, (float) $result['summary']['opening_value'], 0.0001);

        // The close runs into the FY and writes a carried-forward opening of its own.
        $this->setOpening($item, $pcs, 4, 250, $this->fyId);  // 1,000 again, different stock
        \App\Services\FyCarryForwardStatus::flush();
        $after = $this->opening();

        $this->assertSame('carry_forward', $after['summary']['basis']);
        $this->assertSame($this->fyId, (int) $after['summary']['source_fy_id']);
        $this->assertEqualsWithDelta(4.0, (float) $after['rows'][0]['opening_qty'], 0.0001, 'the carried rows replace the inception ones, never add to them');
    }

    public function testNarrowsToOneWarehouseWithoutAttributingCompanyWideStockToIt(): void
    {
        $pcs = $this->makeUnit();
        $main = $this->makeWarehouse('Main');
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100, 0, $main); // 1,000 in Main
        $this->setOpening($item, $pcs, 7, 100);            // 700 company-wide

        $all = $this->opening();
        $this->assertEqualsWithDelta(1700.0, (float) $all['summary']['opening_value'], 0.0001);

        $inMain = $this->opening(['warehouse_id' => $main]);
        $this->assertEqualsWithDelta(10.0, (float) $inMain['rows'][0]['opening_qty'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, (float) $inMain['summary']['opening_value'], 0.0001);
    }

    /** A zero or negative opening line carries no layer; it is counted, never silently dropped. */
    public function testCountsAnOpeningLineThatCarriesNoLayerRatherThanHidingIt(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100);
        $this->setOpening($item, $pcs, -4, 100, 0, $this->makeWarehouse('Main'));

        $rows = $this->opening()['rows'];

        $this->assertEqualsWithDelta(10.0, (float) $rows[0]['opening_qty'], 0.0001);
        $this->assertSame(2, (int) $rows[0]['lines']);
        $this->assertSame(1, (int) $rows[0]['non_positive_lines']);
    }

    public function testReturnsNothingForACompanyWithNoOpeningAtAll(): void
    {
        $pcs = $this->makeUnit();
        $this->makeItem('Widget', $pcs);

        $result = $this->opening();

        $this->assertSame([], $result['rows']);
        $this->assertSame(0, $result['total']);
        $this->assertEqualsWithDelta(0.0, (float) $result['summary']['opening_value'], 0.0001);
    }
}
