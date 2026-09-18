<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\BrandsController;
use Tests\Support\IntegrationTestCase;

/**
 * What the Brands screen asks the database for, against real PostgreSQL.
 *
 * Every assertion here is about a figure or a filter the screen shows a reader,
 * and each is exactly the kind of SQL a stubbed database would get wrong: a
 * `COUNT(*) FILTER (WHERE …)`, a correlated `NOT EXISTS`, a subquery in the
 * ORDER BY, a partial unique index on `LOWER(brand_code)`.
 *
 * It also pins the thing the module must never start doing: the metrics answer
 * carries no commercial figure. Revenue belongs to Books and is read live; the
 * day somebody adds a `sales` key here is the day Inventory starts keeping a
 * second copy of another product's ledger, and this test fails first.
 *
 * @group integration
 */
final class BrandsWorkspaceApiTest extends IntegrationTestCase
{
    private function controller(array $get = []): BrandsController
    {
        $request = \Config\Services::request(null, false);
        // Through setGlobal rather than $_GET: PHPUnit restores the superglobals
        // around every test, so a filter that silently arrives empty on the
        // second test of a run is a test that passes alone and lies in a suite.
        $request->setGlobal('get', $get);
        $controller = new BrandsController();

        $property = new \ReflectionProperty(\CodeIgniter\Controller::class, 'request');
        $property->setAccessible(true);
        $property->setValue($controller, $request);

        return $controller;
    }

    /** @param array<string, mixed> $row */
    private function seedBrand(array $row): int
    {
        $this->db->table('inv_brands')->insert(array_merge([
            'cmp_id'      => $this->cmpId,
            'brand_name'  => 'Brand',
            'brand_alias' => null,
            'brand_code'  => null,
            'description' => null,
            'is_active'   => 1,
            'created_at'  => date('Y-m-d H:i:s'),
            'updated_at'  => date('Y-m-d H:i:s'),
        ], $row));

        return (int) $this->db->insertID();
    }

    private function seedItem(string $name, ?int $brandId, bool $deleted = false): void
    {
        $this->db->table('inv_items')->insert([
            'cmp_id'     => $this->cmpId,
            'bo_id'      => 0,
            'item_name'  => $name,
            'brand_id'   => $brandId,
            'is_active'  => 1,
            'deleted_at' => $deleted ? date('Y-m-d H:i:s') : null,
            'created_at' => date('Y-m-d H:i:s'),
        ]);
    }

    /** The list builder `index()` assembles, with the controller's own filters and sort applied. */
    private function listRows(array $get): array
    {
        $controller = $this->controller($get);
        $builder = $this->db->table('inv_brands')->where('cmp_id', $this->cmpId)->where('deleted_at', null);

        $applyFilters = new \ReflectionMethod(BrandsController::class, 'applyIndexFilters');
        $applyFilters->setAccessible(true);
        $applyFilters->invoke($controller, $builder);

        $applySort = new \ReflectionMethod(BrandsController::class, 'applySort');
        $applySort->setAccessible(true);
        $applySort->invoke($controller, $builder, (string) ($get['sort'] ?? 'brand_name'), strtoupper((string) ($get['order'] ?? 'ASC')));

        $rows = $builder->get()->getResultArray();

        $decorate = new \ReflectionMethod(BrandsController::class, 'decorateRows');
        $decorate->setAccessible(true);

        return $decorate->invoke($controller, $this->cmpId, $rows);
    }

    private function metrics(): array
    {
        $method = new \ReflectionMethod(BrandsController::class, 'computeMetrics');
        $method->setAccessible(true);

        return $method->invoke($this->controller(), $this->cmpId);
    }

    /** @param list<array<string, mixed>> $rows */
    private function names(array $rows): array
    {
        return array_map(static fn (array $r) => $r['brand_name'], $rows);
    }

    // -----------------------------------------------------------------------
    // Item counts
    // -----------------------------------------------------------------------

    public function testItemCountCountsLiveItemsOnlyAndIsZeroRatherThanAbsent(): void
    {
        $apple = $this->seedBrand(['brand_name' => 'Apple']);
        $this->seedBrand(['brand_name' => 'Zebra']);
        $this->seedItem('iPhone', $apple);
        $this->seedItem('iPad', $apple);
        $this->seedItem('Retired', $apple, true);

        $rows = $this->listRows([]);
        $byName = array_column($rows, null, 'brand_name');

        self::assertSame(2, (int) $byName['Apple']['item_count'], 'a soft-deleted item must not be counted');
        // Absent would render as an em dash; the truth is zero and the screen
        // says zero, which is what makes "brands with no items" clickable.
        self::assertSame(0, (int) $byName['Zebra']['item_count']);
    }

    public function testItemCountIgnoresAnotherCompanysItems(): void
    {
        $apple = $this->seedBrand(['brand_name' => 'Apple']);
        $this->db->table('inv_items')->insert([
            'cmp_id' => $this->cmpId + 1,
            'bo_id' => 0,
            'item_name' => 'Someone else\'s',
            'brand_id' => $apple,
            'is_active' => 1,
            'created_at' => date('Y-m-d H:i:s'),
        ]);

        $rows = $this->listRows([]);
        self::assertSame(0, (int) $rows[0]['item_count']);
    }

    // -----------------------------------------------------------------------
    // Filters
    // -----------------------------------------------------------------------

    public function testHasItemsSplitsTheMasterInTwoWithoutOverlapOrLoss(): void
    {
        $apple = $this->seedBrand(['brand_name' => 'Apple']);
        $this->seedBrand(['brand_name' => 'Canon']);
        $this->seedBrand(['brand_name' => 'Dell']);
        $this->seedItem('iPhone', $apple);

        self::assertSame(['Apple'], $this->names($this->listRows(['has_items' => '1'])));
        self::assertSame(['Canon', 'Dell'], $this->names($this->listRows(['has_items' => '0'])));
        self::assertCount(3, $this->listRows([]), 'no linkage filter means every brand');
    }

    public function testHasItemsIgnoresAValueTheApiDoesNotDefine(): void
    {
        $this->seedBrand(['brand_name' => 'Apple']);
        // Neither '1' nor '0' must silently become one of them.
        self::assertCount(1, $this->listRows(['has_items' => 'yes']));
    }

    public function testCreatedRangeIsInclusiveAtBothEnds(): void
    {
        $this->seedBrand(['brand_name' => 'Before', 'created_at' => '2026-08-31 23:59:00']);
        $this->seedBrand(['brand_name' => 'FirstDay', 'created_at' => '2026-09-01 00:00:01']);
        $this->seedBrand(['brand_name' => 'LastDay', 'created_at' => '2026-09-30 23:30:00']);
        $this->seedBrand(['brand_name' => 'After', 'created_at' => '2026-10-01 00:30:00']);

        $rows = $this->listRows(['created_from' => '2026-09-01', 'created_to' => '2026-09-30']);
        // A brand created at half past eleven at night on the last day of the
        // window is inside the window a reader asked for.
        self::assertSame(['FirstDay', 'LastDay'], $this->names($rows));
    }

    public function testCreatedRangeIgnoresAMalformedDate(): void
    {
        $this->seedBrand(['brand_name' => 'Apple', 'created_at' => '2026-09-18 10:00:00']);
        self::assertCount(1, $this->listRows(['created_from' => 'last-tuesday']));
    }

    // -----------------------------------------------------------------------
    // Sorting
    // -----------------------------------------------------------------------

    public function testSortByItemCountOrdersByTheDerivedFigureAndBreaksTiesByName(): void
    {
        $apple = $this->seedBrand(['brand_name' => 'Apple']);
        $canon = $this->seedBrand(['brand_name' => 'Canon']);
        $this->seedBrand(['brand_name' => 'Zebra']);
        $this->seedBrand(['brand_name' => 'Acme']);
        foreach (['a', 'b', 'c'] as $n) {
            $this->seedItem("apple-{$n}", $apple);
        }
        $this->seedItem('canon-a', $canon);

        self::assertSame(
            ['Apple', 'Canon', 'Acme', 'Zebra'],
            $this->names($this->listRows(['sort' => 'item_count', 'order' => 'DESC'])),
            'the two brands with no items must come back in a stable, alphabetical order',
        );
    }

    // -----------------------------------------------------------------------
    // Metrics
    // -----------------------------------------------------------------------

    public function testMetricsCountTheWholeCompanyBySplitAndLinkage(): void
    {
        $apple = $this->seedBrand(['brand_name' => 'Apple']);
        $this->seedBrand(['brand_name' => 'Canon']);
        $this->seedBrand(['brand_name' => 'LG', 'is_active' => 0]);
        $this->seedBrand(['brand_name' => 'Gone', 'deleted_at' => date('Y-m-d H:i:s')]);
        $this->seedItem('iPhone', $apple);

        $m = $this->metrics();

        self::assertSame(3, $m['total'], 'a soft-deleted brand is not in the master');
        self::assertSame(2, $m['active']);
        self::assertSame(1, $m['inactive']);
        self::assertSame(2, $m['without_items']);
        self::assertSame(1, $m['with_items']);
        self::assertSame($m['total'], $m['with_items'] + $m['without_items']);
    }

    public function testMetricsCountThisMonthAndLastMonthSeparately(): void
    {
        $now = new \DateTimeImmutable('now');
        $thisMonth = $now->modify('first day of this month')->setTime(9, 0);
        $lastMonth = $thisMonth->modify('-1 month');
        $older = $thisMonth->modify('-4 months');

        $this->seedBrand(['brand_name' => 'New A', 'created_at' => $thisMonth->format('Y-m-d H:i:s')]);
        $this->seedBrand(['brand_name' => 'New B', 'created_at' => $thisMonth->format('Y-m-d H:i:s')]);
        $this->seedBrand(['brand_name' => 'Old', 'created_at' => $lastMonth->format('Y-m-d H:i:s')]);
        $this->seedBrand(['brand_name' => 'Ancient', 'created_at' => $older->format('Y-m-d H:i:s')]);

        $m = $this->metrics();
        self::assertSame(2, $m['new_this_month']);
        self::assertSame(1, $m['new_prev_month'], 'the month before must not swallow everything older');
    }

    public function testTopByItemsIsTheItemLeaderAndIsNullWhenNothingIsFiled(): void
    {
        self::assertNull($this->metrics()['top_by_items'], 'an empty master has no leader to name');

        $apple = $this->seedBrand(['brand_name' => 'Apple']);
        $canon = $this->seedBrand(['brand_name' => 'Canon']);
        $this->seedItem('iPhone', $apple);
        $this->seedItem('iPad', $apple);
        $this->seedItem('EOS', $canon);

        $top = $this->metrics()['top_by_items'];
        self::assertSame('Apple', $top['brand_name']);
        self::assertSame(2, $top['item_count']);
        self::assertSame($apple, $top['brand_id']);
    }

    public function testMetricsCarryNoCommercialFigure(): void
    {
        $this->seedBrand(['brand_name' => 'Apple']);
        $keys = array_keys($this->metrics());

        foreach ($keys as $key) {
            self::assertDoesNotMatchRegularExpression(
                '/sales|revenue|turnover|amount|value/i',
                $key,
                'Brand turnover belongs to Books and is read live — Inventory must not report one here',
            );
        }
    }

    // -----------------------------------------------------------------------
    // Brand code
    // -----------------------------------------------------------------------

    public function testTheCodeIndexIsCaseInsensitiveAndPartial(): void
    {
        // The backstop the controller's check races against. Asserted on the
        // definition rather than by provoking a failed write: the point is the
        // two properties that make the index right, and a deliberate constraint
        // violation would put a driver warning in every suite run for ever.
        $index = $this->db->query(
            "SELECT indexdef FROM pg_indexes WHERE tablename = 'inv_brands' AND indexname = 'uq_inv_brands_cmp_code'",
        )->getRowArray();

        self::assertNotNull($index, 'migration 010 must create uq_inv_brands_cmp_code');
        self::assertStringContainsString('UNIQUE', $index['indexdef']);
        self::assertStringContainsString('lower((brand_code)', $index['indexdef'], 'APL and apl are one handle');
        self::assertStringContainsString('deleted_at IS NULL', $index['indexdef'], 'a removed brand releases its code');
    }

    public function testTheControllerReportsADuplicateCodeAsAConflictNamingTheField(): void
    {
        $this->seedBrand(['brand_name' => 'Apple', 'brand_code' => 'APL']);

        $validate = new \ReflectionMethod(BrandsController::class, 'validateRow');
        $validate->setAccessible(true);

        try {
            $validate->invoke($this->controller(), $this->cmpId, ['brand_name' => 'Apricot', 'brand_code' => 'apl'], null);
            self::fail('a duplicate brand code must not validate');
        } catch (\App\Exceptions\InventoryException $e) {
            self::assertSame(409, $e->httpStatus());
            self::assertSame('brand_code', $e->details()['field'] ?? null);
            self::assertStringContainsString('apl', $e->getMessage());
        }
    }

    public function testTheControllerRejectsAnOverLongAliasWithAFieldRatherThanADriverError(): void
    {
        $validate = new \ReflectionMethod(BrandsController::class, 'validateRow');
        $validate->setAccessible(true);

        try {
            $validate->invoke(
                $this->controller(),
                $this->cmpId,
                ['brand_name' => 'Apple', 'brand_alias' => str_repeat('x', 65)],
                null,
            );
            self::fail('an alias longer than the column must not validate');
        } catch (\App\Exceptions\InventoryException $e) {
            self::assertSame(422, $e->httpStatus());
            self::assertSame('brand_alias', $e->details()['field'] ?? null);
        }
    }

    public function testSeveralBrandsMayLeaveTheCodeUnset(): void
    {
        $this->seedBrand(['brand_name' => 'Apple']);
        $this->seedBrand(['brand_name' => 'Canon']);
        self::assertCount(2, $this->listRows([]));
    }

    public function testADeletedBrandReleasesItsCode(): void
    {
        // The unique index is partial on `deleted_at IS NULL`: a brand that was
        // removed must not hold its handle hostage for ever.
        $this->seedBrand(['brand_name' => 'Apple', 'brand_code' => 'APL', 'deleted_at' => date('Y-m-d H:i:s')]);
        $reused = $this->seedBrand(['brand_name' => 'Apricot', 'brand_code' => 'APL']);
        self::assertGreaterThan(0, $reused);
    }
}
