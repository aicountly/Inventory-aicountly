<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\ItemsController;
use Tests\Support\IntegrationTestCase;

/**
 * The figures above the Items table, against real PostgreSQL.
 *
 * `ItemsController::summary()` and `index()` both read `filtered()`, so the
 * cards can never disagree with the rows the list beneath them shows. Driven
 * directly against the query builder, the same shape AuditSummaryTest uses,
 * because `COUNT(DISTINCT …)` and the NULL-vs-empty-string SKU check are
 * exactly the things a stub would get wrong.
 *
 * @group integration
 */
final class ItemsSummaryTest extends IntegrationTestCase
{
    private int $pcs;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pcs = $this->makeUnit();
    }

    private function category(string $name): int
    {
        $this->db->table('inv_stock_categories')->insert(['cmp_id' => $this->cmpId, 'cat_name' => $name, 'is_active' => 1]);

        return (int) $this->db->insertID();
    }

    /** The controller's private query builder, driven by a request carrying the given query parameters. */
    private function filtered(array $get)
    {
        $request = \Config\Services::request(null, false);
        $request->setGlobal('get', $get);
        $controller = new ItemsController();

        $property = new \ReflectionProperty(\CodeIgniter\Controller::class, 'request');
        $property->setAccessible(true);
        $property->setValue($controller, $request);

        $method = new \ReflectionMethod(ItemsController::class, 'filtered');
        $method->setAccessible(true);

        return $method->invoke($controller, $this->cmpId);
    }

    /** The exact aggregate `summary()` runs, over `filtered()`'s builder. */
    private function aggregate(array $get): array
    {
        return (clone $this->filtered($get))
            ->select(
                'COUNT(*) AS total'
                . ', SUM(CASE WHEN i.is_active = 1 THEN 1 ELSE 0 END) AS active'
                . ', COUNT(DISTINCT i.stock_cat_id) AS categories'
                . ", SUM(CASE WHEN i.item_sku IS NULL OR i.item_sku = '' THEN 1 ELSE 0 END) AS missing_sku",
                false,
            )
            ->get()
            ->getRowArray() ?: [];
    }

    public function testTheSummaryCountsTheSameRowsTheListWouldReturn(): void
    {
        $stationery = $this->category('Stationery');
        $packaging = $this->category('Packaging');

        $pen = $this->makeItem('Pen', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $pen)->update(['item_sku' => 'PEN-1', 'stock_cat_id' => $stationery]);

        $box = $this->makeItem('Box', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $box)->update(['stock_cat_id' => $packaging, 'is_active' => 0]);

        $marker = $this->makeItem('Marker', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $marker)->update(['item_sku' => '', 'stock_cat_id' => $stationery]);

        $agg = $this->aggregate([]);

        $this->assertSame(3, (int) $agg['total']);
        $this->assertSame(2, (int) $agg['active']);
        $this->assertSame(2, (int) $agg['categories']);
        // Marker's SKU is '' and the untouched item has none at all — both count as missing.
        $this->assertSame(2, (int) $agg['missing_sku']);
    }

    public function testAFilterNarrowsTheFiguresExactlyAsItNarrowsTheRows(): void
    {
        $stationery = $this->category('Stationery');
        $packaging = $this->category('Packaging');
        $pen = $this->makeItem('Pen', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $pen)->update(['stock_cat_id' => $stationery]);
        $box = $this->makeItem('Box', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $box)->update(['stock_cat_id' => $packaging]);

        $agg = $this->aggregate(['stock_cat_id' => (string) $stationery]);

        $this->assertSame(1, (int) $agg['total']);
        $this->assertSame(1, (int) $agg['categories']);

        $active = $this->aggregate(['status' => 'inactive']);
        $this->assertSame(0, (int) $active['total']);
    }

    public function testMissingSkuFilterNarrowsBothTheListAndTheSummaryTogether(): void
    {
        $withSku = $this->makeItem('Pen', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $withSku)->update(['item_sku' => 'PEN-1']);
        $this->makeItem('Box', $this->pcs); // no SKU
        $blankSku = $this->makeItem('Marker', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $blankSku)->update(['item_sku' => '']);

        $agg = $this->aggregate(['missing_sku' => '1']);

        $this->assertSame(2, (int) $agg['total']);
        $this->assertSame(2, (int) $agg['missing_sku']);
    }

    public function testAnEmptyStringSkuCountsAsMissingLikeNoSkuAtAll(): void
    {
        $blank = $this->makeItem('Pen', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $blank)->update(['item_sku' => '']);
        $this->makeItem('Box', $this->pcs); // item_sku left NULL by makeItem()

        $agg = $this->aggregate([]);

        $this->assertSame(2, (int) $agg['missing_sku']);
    }

    public function testAnotherCompanysItemsAreNeverCounted(): void
    {
        $this->makeItem('Pen', $this->pcs);
        $this->db->table('inv_items')->insert([
            'cmp_id' => $this->cmpId + 1, 'item_name' => 'Other Co Item', 'unit_id' => $this->pcs,
            'valuation_method' => 'FIFO', 'is_active' => 1,
        ]);

        $agg = $this->aggregate([]);

        $this->assertSame(1, (int) $agg['total']);
    }
}
