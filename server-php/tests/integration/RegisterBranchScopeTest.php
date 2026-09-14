<?php

namespace Tests\Integration;

use App\Services\PendingQuantityService;
use App\Services\StockBalanceService;
use Tests\Support\IntegrationTestCase;

/**
 * Branch scope on the two registers whose exports carry a branch on the letterhead: the stock
 * balance register and the pending quantity register.
 *
 * A printed "Stock balance register — Head office" that lists every branch's stock is a wrong
 * document, so the server has to honour the branch the sheet is stamped with.
 *
 * @group integration
 */
final class RegisterBranchScopeTest extends IntegrationTestCase
{
    private function makeBranchWarehouse(string $name, int $boId): int
    {
        $this->db->table('inv_warehouses')->insert([
            'cmp_id' => $this->cmpId, 'bo_id' => $boId, 'warehouse_name' => $name,
            'warehouse_type' => 'standard', 'is_active' => 1,
        ]);

        return (int) $this->db->insertID();
    }

    private function seedBalance(int $itemId, ?int $warehouseId, float $qty): void
    {
        $this->db->table('inv_stock_balances')->insert([
            'cmp_id' => $this->cmpId, 'item_id' => $itemId, 'warehouse_id' => $warehouseId, 'on_hand_qty' => $qty,
        ]);
    }

    private function seedPending(int $itemId, int $boId, string $documentNo, float $qty): void
    {
        $this->db->table('inv_documents')->insert([
            'cmp_id' => $this->cmpId, 'bo_id' => $boId, 'fy_id' => $this->fyId, 'document_type' => 'DELIVERY_CHALLAN',
            'document_no' => $documentNo, 'document_date' => '2026-04-10', 'status' => 'POSTED',
        ]);
        $documentId = (int) $this->db->insertID();
        $this->db->table('inv_pending_quantities')->insert([
            'cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'document_id' => $documentId, 'pending_kind' => 'challan',
            'direction' => 'out', 'item_id' => $itemId, 'qty_original' => $qty, 'qty_settled' => 0, 'status' => 'open',
        ]);
    }

    public function testStockBalanceRegisterHonoursTheBranchItsExportIsStampedWith(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Bolt', $pcs);
        $whNorth = $this->makeBranchWarehouse('North store', 7);
        $whSouth = $this->makeBranchWarehouse('South store', 9);
        $whShared = $this->makeBranchWarehouse('Central store', 0);
        $this->seedBalance($item, $whNorth, 10);
        $this->seedBalance($item, $whSouth, 20);
        $this->seedBalance($item, $whShared, 5);
        $this->seedBalance($item, null, 3);

        $svc = new StockBalanceService();
        $all = $svc->listBalances($this->cmpId, 0, [], 100, 0);
        $this->assertSame(4, $all['total'], 'consolidated shows every branch');

        $north = $svc->listBalances($this->cmpId, 7, [], 100, 0);
        $this->assertSame(3, $north['total'], 'the branch, plus what belongs to no branch');
        $qtyByWarehouse = [];
        foreach ($north['rows'] as $row) {
            $qtyByWarehouse[(int) $row['warehouse_id']] = (float) $row['on_hand_qty'];
        }
        $this->assertSame(10.0, $qtyByWarehouse[$whNorth]);
        $this->assertSame(5.0, $qtyByWarehouse[$whShared], 'a warehouse in no branch is company-wide');
        $this->assertSame(3.0, $qtyByWarehouse[0], 'a balance with no warehouse is company-wide');
        $this->assertArrayNotHasKey($whSouth, $qtyByWarehouse, 'another branch must not be on this sheet');
    }

    public function testStockBalanceBranchScopeSurvivesTheOtherFilters(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Bolt', $pcs);
        $other = $this->makeItem('Nut', $pcs);
        $whNorth = $this->makeBranchWarehouse('North store', 7);
        $whSouth = $this->makeBranchWarehouse('South store', 9);
        $this->seedBalance($item, $whNorth, 10);
        $this->seedBalance($item, $whSouth, 20);
        $this->seedBalance($other, $whNorth, 0);

        $svc = new StockBalanceService();
        $result = $svc->listBalances($this->cmpId, 7, ['nonzero' => true, 'item_id' => $item], 100, 0);
        $this->assertSame(1, $result['total']);
        $this->assertSame($whNorth, (int) $result['rows'][0]['warehouse_id']);
    }

    public function testPendingQuantityRegisterHonoursTheBranchItsExportIsStampedWith(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Bolt', $pcs);
        $this->seedPending($item, 7, 'DC-N-1', 4);
        $this->seedPending($item, 9, 'DC-S-1', 6);
        $this->seedPending($item, 0, 'DC-HO-1', 1);

        $svc = new PendingQuantityService();
        $this->assertCount(3, $svc->listOpen($this->cmpId), 'consolidated shows every branch');

        $north = $svc->listOpen($this->cmpId, null, null, null, null, null, 7);
        $this->assertSame(['DC-N-1'], array_map(static fn ($r) => $r['document_no'], $north));
    }
}
