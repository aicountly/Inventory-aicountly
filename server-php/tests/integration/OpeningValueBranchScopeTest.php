<?php

namespace Tests\Integration;

use App\Services\OpeningStockResolver;
use App\Services\ReconciliationService;
use Tests\Support\IntegrationTestCase;

/**
 * inv_item_openings has no bo_id of its own -- branch scope travels through warehouse_id, same as
 * inv_stock_balances (see StockBalanceService::listBalances()'s own comment on this). Every caller
 * of OpeningStockResolver except ReconciliationService::inventoryOpeningValue() legitimately wants
 * every branch's openings pooled together -- a WAC/FIFO cost RATE under company-scope valuation is
 * one queue shared across branches, so narrowing the default there would silently change costs
 * everywhere. Only inventoryOpeningValue() needs a single branch's VALUE, to diff against that one
 * branch's Books opening balance; without scoping, every OTHER branch's opening leaked in as a
 * phantom amount on a multi-branch company (confirmed against production data for a real company
 * whose per-branch opening_difference didn't match any sensible single-branch figure).
 *
 * @group integration
 */
final class OpeningValueBranchScopeTest extends IntegrationTestCase
{
    private function makeWarehouseForBranch(int $boId, string $name): int
    {
        $this->db->table('inv_warehouses')->insert([
            'cmp_id' => $this->cmpId, 'bo_id' => $boId, 'warehouse_name' => $name, 'warehouse_type' => 'standard', 'is_active' => 1,
        ]);

        return (int) $this->db->insertID();
    }

    public function testInventoryOpeningValueWithNoBranchSumsEveryBranch(): void
    {
        $pcs = $this->makeUnit();
        $whA = $this->makeWarehouseForBranch(1, 'Branch A');
        $whB = $this->makeWarehouseForBranch(2, 'Branch B');
        $itemA = $this->makeItem('Widget A', $pcs);
        $itemB = $this->makeItem('Widget B', $pcs);
        $this->setOpening($itemA, $pcs, 10, 100, 0, $whA); // 1,000
        $this->setOpening($itemB, $pcs, 5, 200, 0, $whB);  // 1,000

        $svc = new ReconciliationService();

        self::assertEqualsWithDelta(2000.0, $svc->inventoryOpeningValue($this->cmpId, $this->fyId, 0), 0.0001);
    }

    public function testInventoryOpeningValueScopedToOneBranchExcludesTheOthers(): void
    {
        $pcs = $this->makeUnit();
        $whA = $this->makeWarehouseForBranch(1, 'Branch A');
        $whB = $this->makeWarehouseForBranch(2, 'Branch B');
        $itemA = $this->makeItem('Widget A', $pcs);
        $itemB = $this->makeItem('Widget B', $pcs);
        $this->setOpening($itemA, $pcs, 10, 100, 0, $whA); // 1,000 -- branch 1 only
        $this->setOpening($itemB, $pcs, 5, 200, 0, $whB);  // 1,000 -- branch 2 only

        $svc = new ReconciliationService();

        self::assertEqualsWithDelta(1000.0, $svc->inventoryOpeningValue($this->cmpId, $this->fyId, 1), 0.0001, 'branch 1 must see only its own opening, not branch 2\'s');
        self::assertEqualsWithDelta(1000.0, $svc->inventoryOpeningValue($this->cmpId, $this->fyId, 2), 0.0001, 'branch 2 must see only its own opening, not branch 1\'s');
    }

    public function testACompanyWideOpeningWithNoWarehouseStaysInScopeForEveryBranch(): void
    {
        $pcs = $this->makeUnit();
        $this->makeWarehouseForBranch(1, 'Branch A');
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100, 0, null); // no warehouse -- company-wide

        $svc = new ReconciliationService();

        self::assertEqualsWithDelta(1000.0, $svc->inventoryOpeningValue($this->cmpId, $this->fyId, 1), 0.0001);
        self::assertEqualsWithDelta(1000.0, $svc->inventoryOpeningValue($this->cmpId, $this->fyId, 999), 0.0001, 'a company-wide opening is not tied to any one branch id');
    }

    /**
     * The regression guard: every caller other than ReconciliationService calls
     * openingLayersByItem()/openingLines() without a $boId at all, and must keep pooling every
     * branch's opening together -- a WAC/FIFO rate under company-scope valuation would otherwise
     * silently change for every existing caller (ValuationEngine, ValuationReplayService, the
     * report services).
     */
    public function testOpeningLayersByItemWithoutABranchStillPoolsEveryBranch(): void
    {
        $pcs = $this->makeUnit();
        $whA = $this->makeWarehouseForBranch(1, 'Branch A');
        $whB = $this->makeWarehouseForBranch(2, 'Branch B');
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100, 0, $whA);
        $this->setOpening($item, $pcs, 5, 200, 0, $whB);

        $resolver = new OpeningStockResolver();
        $layers = $resolver->openingLayersByItem($this->cmpId, $this->fyId, [$item]);

        self::assertCount(1, $layers[$item], 'the two branches\' layers collapse into one blended layer, same as before this change');
        self::assertEqualsWithDelta(15.0, $layers[$item][0]['qty_remaining'], 0.0001);
        self::assertEqualsWithDelta(2000.0 / 15.0, $layers[$item][0]['unit_cost'], 0.0001);
    }
}
