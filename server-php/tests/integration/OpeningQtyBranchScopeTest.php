<?php

namespace Tests\Integration;

use App\Services\StockBalanceService;
use App\Services\ValuationReplayService;
use Tests\Support\IntegrationTestCase;

/**
 * Branch scope has to apply to the SAME set of facts on both sides of a closing balance.
 *
 * StockBalanceService::closingQuantities() takes a bo_id and filters movements by it, but seeds
 * the opening quantity from OpeningStockResolver::openingQtyMap(), which took no bo_id at all.
 * A branch therefore opened with every branch's stock and then moved only its own -- so the
 * closing quantity, and every value built on it, carried the other branches' opening.
 *
 * That reaches further than one register: the same snapshot is what Books asks for when it prints
 * the Indian Classic Trading Account's opening and closing stock and the Balance Sheet's stock in
 * hand, so a branch statement overstated both.
 *
 * Quantity is a branch fact and must be scoped. The unit COST stays company-wide on purpose --
 * see OpeningValueBranchScopeTest: a WAC/FIFO queue under company-scope valuation is one queue
 * shared across branches, and narrowing it would silently change costs everywhere.
 *
 * @group integration
 */
final class OpeningQtyBranchScopeTest extends IntegrationTestCase
{
    private function warehouseFor(int $boId, string $name): int
    {
        $this->db->table('inv_warehouses')->insert([
            'cmp_id' => $this->cmpId, 'bo_id' => $boId, 'warehouse_name' => $name, 'warehouse_type' => 'standard', 'is_active' => 1,
        ]);

        return (int) $this->db->insertID();
    }

    /** @return array{0:int,1:int,2:int,3:int} [pcs, item, whA, whB] */
    private function twoBranchCompany(): array
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $whA = $this->warehouseFor(1, 'Branch A store');
        $whB = $this->warehouseFor(2, 'Branch B store');
        $this->setOpening($item, $pcs, 10, 100, 0, $whA); // branch 1: 10 @ 100
        $this->setOpening($item, $pcs, 4, 100, 0, $whB);  // branch 2:  4 @ 100

        return [$pcs, $item, $whA, $whB];
    }

    private function closingQty(int $boId): float
    {
        $rows = (new StockBalanceService())->closingQuantities($this->cmpId, $this->fyId, $boId, null, '2026-03-31');
        $qty = 0.0;
        foreach ($rows as $r) {
            $qty += (float) $r['closing_qty'];
        }

        return round($qty, 4);
    }

    public function testCompanyScopePoolsEveryBranchOpening(): void
    {
        $this->twoBranchCompany();

        self::assertEqualsWithDelta(14.0, $this->closingQty(0), 0.0001);
    }

    public function testOneBranchOpensWithItsOwnStockOnly(): void
    {
        $this->twoBranchCompany();

        self::assertEqualsWithDelta(10.0, $this->closingQty(1), 0.0001);
        self::assertEqualsWithDelta(4.0, $this->closingQty(2), 0.0001);
    }

    /**
     * An opening row with no warehouse belongs to no branch in particular, so it stays in view
     * under every scope -- the same rule openingLines() and listBalances() already apply.
     */
    public function testAnOpeningWithNoWarehouseStaysInEveryBranch(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $whA = $this->warehouseFor(1, 'Branch A store');
        $this->setOpening($item, $pcs, 10, 100, 0, $whA);
        $this->setOpening($item, $pcs, 2, 100, 0, null);

        self::assertEqualsWithDelta(12.0, $this->closingQty(1), 0.0001);
        self::assertEqualsWithDelta(2.0, $this->closingQty(2), 0.0001);
    }

    /**
     * The value a branch Trading Account prints: its own opening quantity at the company-wide
     * opening cost. Branch 1 holds 10 of the 14 units, all costed at 100.
     */
    public function testBranchValuationSnapshotValuesOnlyThatBranchesOpening(): void
    {
        $this->twoBranchCompany();

        $snap = (new ValuationReplayService())->snapshot($this->cmpId, $this->fyId, 1, '2026-03-31', 'AS_PER_MASTER');

        self::assertEqualsWithDelta(10.0, (float) $snap['total_qty'], 0.0001);
        self::assertEqualsWithDelta(1000.0, (float) $snap['total_value'], 0.0001);
    }
}
