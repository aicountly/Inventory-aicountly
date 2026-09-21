<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\StockCategoriesController;
use Tests\Support\IntegrationTestCase;

/**
 * The three things Stock categories added to the API, against real SQL.
 *
 * All three are SQL and nothing else — a grouped count, four aggregates and an
 * ORDER BY over a correlated subquery — so a stub would prove nothing. The
 * properties held here are the ones a reader of the screen would notice being
 * wrong:
 *
 *  - the usage count on a row and the count that blocks its delete are the same
 *    number, and neither includes a soft-deleted item or another company's;
 *  - "Most used" is null when nothing is categorised, rather than naming an
 *    arbitrary empty category;
 *  - "Most items" ranks the whole company, not the page that was fetched;
 *  - a bulk activate does not stamp `updated_at` on a row that was already
 *    active, and writes one audit entry per row that really moved.
 *
 * @group integration
 */
final class StockCategoryUsageTest extends IntegrationTestCase
{
    private function makeCategory(string $name, int $isActive = 1, ?string $createdAt = null, ?int $cmpId = null): int
    {
        $this->db->table('inv_stock_categories')->insert([
            'cmp_id'     => $cmpId ?? $this->cmpId,
            'cat_name'   => $name,
            'cat_alias'  => strtoupper(substr($name, 0, 3)),
            'is_active'  => $isActive,
            'created_at' => $createdAt ?? date('Y-m-d H:i:s'),
            'updated_at' => $createdAt ?? date('Y-m-d H:i:s'),
        ]);

        return (int) $this->db->insertID();
    }

    private function makeCategorisedItem(string $name, ?int $catId, ?string $deletedAt = null, ?int $cmpId = null): int
    {
        $unitId = $this->makeUnit('Pcs' . substr(md5($name), 0, 4), 'PC');
        $this->db->table('inv_items')->insert([
            'cmp_id'       => $cmpId ?? $this->cmpId,
            'item_name'    => $name,
            'unit_id'      => $unitId,
            'stock_cat_id' => $catId,
            'is_active'    => 1,
            'deleted_at'   => $deletedAt,
        ]);

        return (int) $this->db->insertID();
    }

    /** `decorateRows`, the protected hook the list calls for every page. */
    private function decorate(array $rows): array
    {
        $method = new \ReflectionMethod(StockCategoriesController::class, 'decorateRows');
        $method->setAccessible(true);

        return $method->invoke(new StockCategoriesController(), $this->cmpId, $rows);
    }

    /** The list builder with the controller's own sort applied, as `index()` builds it. */
    private function sortedIds(string $sort, string $order): array
    {
        $builder = $this->db->table('inv_stock_categories')
            ->where('cmp_id', $this->cmpId)->where('deleted_at', null);

        $method = new \ReflectionMethod(StockCategoriesController::class, 'applySort');
        $method->setAccessible(true);
        $method->invoke(new StockCategoriesController(), $builder, $sort, $order);

        return array_map(static fn ($r) => (int) $r['stock_cat_id'], $builder->get()->getResultArray());
    }

    // ---- item_count -------------------------------------------------------

    public function testItemCountCountsOnlyThisCompanysLiveItems(): void
    {
        $raw = $this->makeCategory('Raw Material');
        $this->makeCategorisedItem('Steel', $raw);
        $this->makeCategorisedItem('Copper', $raw);
        // Soft-deleted: gone from every list, so it must not inflate the count
        // that the delete guard will later refuse on.
        $this->makeCategorisedItem('Scrapped', $raw, '2026-08-01 10:00:00');
        // Another company's item, pointing at an id that exists over there.
        $this->makeCategorisedItem('Foreign', $raw, null, $this->cmpId + 1);

        $rows = $this->decorate([['stock_cat_id' => $raw]]);
        $this->assertSame(2, $rows[0]['item_count']);
    }

    public function testACategoryNothingUsesReportsZeroRatherThanNothing(): void
    {
        $unused = $this->makeCategory('Trading Goods');
        $rows = $this->decorate([['stock_cat_id' => $unused]]);
        $this->assertArrayHasKey('item_count', $rows[0]);
        $this->assertSame(0, $rows[0]['item_count']);
    }

    /**
     * A whole page decorated at once, with the counts still landing on the right
     * rows.
     *
     * The driver in use exposes no query log, so this cannot assert "one query"
     * directly. What it can assert is the thing a per-row COUNT would get wrong
     * first: the grouped result is keyed back onto the rows it belongs to, and a
     * category that the grouped query returned no row for reads 0 rather than
     * inheriting its neighbour's figure.
     */
    public function testItemCountIsKeyedBackOntoEveryRowOfThePage(): void
    {
        $ids = [];
        foreach (['Raw Material', 'Finished Goods', 'Packing Material', 'Services'] as $name) {
            $ids[] = $this->makeCategory($name);
        }
        $this->makeCategorisedItem('Steel', $ids[0]);
        $this->makeCategorisedItem('Widget', $ids[1]);
        $this->makeCategorisedItem('Gadget', $ids[1]);

        $rows = $this->decorate(array_map(static fn ($id) => ['stock_cat_id' => $id], $ids));

        $this->assertSame([1, 2, 0, 0], array_column($rows, 'item_count'));
    }

    // ---- sorting by usage -------------------------------------------------

    public function testSortByItemCountRanksTheWholeCompany(): void
    {
        $a = $this->makeCategory('Alpha');
        $b = $this->makeCategory('Beta');
        $c = $this->makeCategory('Gamma');
        $this->makeCategorisedItem('One', $b);
        $this->makeCategorisedItem('Two', $b);
        $this->makeCategorisedItem('Three', $c);

        $this->assertSame([$b, $c, $a], $this->sortedIds('item_count', 'DESC'));
        $this->assertSame([$a, $c, $b], $this->sortedIds('item_count', 'ASC'));
    }

    public function testItemCountIsTheOnlySortThisControllerAddsToTheAllowList(): void
    {
        // `index()` only ever passes a key it has already whitelisted, and the
        // list a subclass may widen is exactly this one. Anything else must fall
        // through to the base behaviour rather than reaching the ORDER BY.
        $property = new \ReflectionProperty(StockCategoriesController::class, 'extraSortColumns');
        $property->setAccessible(true);
        $this->assertSame(['item_count'], $property->getValue(new StockCategoriesController()));
    }

    public function testAnOrdinaryColumnStillSortsByItself(): void
    {
        $b = $this->makeCategory('Beta');
        $a = $this->makeCategory('Alpha');

        $this->assertSame([$a, $b], $this->sortedIds('cat_name', 'ASC'));
    }

    // ---- summary ----------------------------------------------------------

    public function testSummaryCountsTheCompanyAndNamesTheMostUsedCategory(): void
    {
        $raw = $this->makeCategory('Raw Material');
        $fg = $this->makeCategory('Finished Goods');
        $this->makeCategory('Retired', 0);
        $this->makeCategory('Other Company', 1, null, $this->cmpId + 1);

        $this->makeCategorisedItem('Steel', $raw);
        $this->makeCategorisedItem('Copper', $raw);
        $this->makeCategorisedItem('Widget', $fg);
        $this->makeCategorisedItem('Loose', null);

        $summary = StockCategoriesController::summarise($this->db, $this->cmpId);

        $this->assertSame(3, $summary['total']);
        $this->assertSame(2, $summary['active']);
        $this->assertSame(1, $summary['inactive']);
        $this->assertSame($raw, $summary['most_used']['stock_cat_id']);
        $this->assertSame('Raw Material', $summary['most_used']['cat_name']);
        $this->assertSame(2, $summary['most_used']['item_count']);
        $this->assertSame(1, $summary['uncategorised_items']);
    }

    public function testSummaryOfAnEmptyCompanyIsZerosAndNoMostUsedCategory(): void
    {
        $summary = StockCategoriesController::summarise($this->db, $this->cmpId);

        $this->assertSame(0, $summary['total']);
        $this->assertSame(0, $summary['active']);
        $this->assertSame(0, $summary['inactive']);
        $this->assertNull($summary['most_used']);
    }

    public function testMostUsedIsNullWhileNothingIsCategorised(): void
    {
        // Categories exist; no item points at any of them. Naming one anyway
        // would put a category on the card that carries nothing.
        $this->makeCategory('Raw Material');
        $this->makeCategory('Finished Goods');
        $this->makeCategorisedItem('Loose', null);

        $summary = StockCategoriesController::summarise($this->db, $this->cmpId);
        $this->assertSame(2, $summary['total']);
        $this->assertNull($summary['most_used']);
    }

    public function testSummaryIgnoresSoftDeletedCategoriesAndItems(): void
    {
        $raw = $this->makeCategory('Raw Material');
        $gone = $this->makeCategory('Deleted Category');
        $this->db->table('inv_stock_categories')->where('stock_cat_id', $gone)->update(['deleted_at' => '2026-08-01 10:00:00']);
        $this->makeCategorisedItem('Steel', $raw);
        $this->makeCategorisedItem('Scrapped', $raw, '2026-08-01 10:00:00');

        $summary = StockCategoriesController::summarise($this->db, $this->cmpId);
        $this->assertSame(1, $summary['total']);
        $this->assertSame(1, $summary['most_used']['item_count']);
    }

    public function testCreatedThisMonthCountsFromTheFirstOfTheMonth(): void
    {
        $this->makeCategory('This Month', 1, '2026-09-04 09:00:00');
        $this->makeCategory('Last Month', 1, '2026-08-28 09:00:00');

        $summary = StockCategoriesController::summarise($this->db, $this->cmpId, '2026-09-01 00:00:00');
        $this->assertSame(1, $summary['created_this_month']);
    }

    // ---- bulk status ------------------------------------------------------

    private function bulkStatus(array $ids, int $isActive): array
    {
        $existing = $this->db->table('inv_stock_categories')
            ->where('cmp_id', $this->cmpId)->where('deleted_at', null)
            ->whereIn('stock_cat_id', $ids)->get()->getResultArray();

        $method = new \ReflectionMethod(StockCategoriesController::class, 'applyBulkStatus');
        $method->setAccessible(true);

        return $method->invoke(new StockCategoriesController(), $this->db, $this->cmpId, $existing, $isActive, 'user-7');
    }

    public function testBulkDeactivateTouchesOnlyTheRowsThatMove(): void
    {
        $active = $this->makeCategory('Raw Material', 1, '2026-01-01 08:00:00');
        $alreadyOff = $this->makeCategory('Retired', 0, '2026-01-01 08:00:00');

        $changed = $this->bulkStatus([$active, $alreadyOff], 0);

        $this->assertCount(1, $changed);
        $rows = $this->db->table('inv_stock_categories')->where('cmp_id', $this->cmpId)
            ->orderBy('stock_cat_id', 'ASC')->get()->getResultArray();
        $this->assertSame(0, (int) $rows[0]['is_active']);
        $this->assertNotSame('2026-01-01 08:00:00', $rows[0]['updated_at']);
        // The row that was already inactive keeps its original stamp: it was
        // not edited, and a list that sorted by "recently updated" must not
        // claim it was.
        $this->assertStringStartsWith('2026-01-01 08:00:00', (string) $rows[1]['updated_at']);
    }

    public function testBulkStatusWritesOneAuditEntryPerCategoryThatMoved(): void
    {
        $a = $this->makeCategory('Raw Material', 1);
        $b = $this->makeCategory('Finished Goods', 1);
        $this->makeCategory('Retired', 0);

        $this->bulkStatus([$a, $b], 0);

        $log = $this->db->table('inv_audit_log')->where('cmp_id', $this->cmpId)
            ->where('entity_type', 'stock_category')->orderBy('entity_id', 'ASC')->get()->getResultArray();

        $this->assertCount(2, $log);
        $this->assertSame('stock_category.deactivate', $log[0]['action']);
        $this->assertSame([$a, $b], array_map(static fn ($r) => (int) $r['entity_id'], $log));
        $this->assertSame('user-7', $log[0]['actor_uuid']);
    }

    public function testBulkActivateChangesNothingWhenEverythingIsAlreadyActive(): void
    {
        $a = $this->makeCategory('Raw Material', 1);
        $changed = $this->bulkStatus([$a], 1);

        $this->assertSame([], $changed);
        $this->assertSame(0, $this->db->table('inv_audit_log')->where('entity_type', 'stock_category')->countAllResults());
    }
}
