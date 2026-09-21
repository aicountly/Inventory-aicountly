<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\WarehousesController;
use Tests\Support\IntegrationTestCase;

/**
 * The figures above the Warehouses table, against real SQL.
 *
 * The KPI strip states company totals while the table under it shows one page
 * of a filtered list, so these aggregates are the only thing standing between a
 * user and a "total capacity" that changes when they turn the page. They are
 * driven here against real PostgreSQL because `COUNT(*) FILTER`, `SUM` over a
 * column where every row is NULL, and grouping on `address_json->>'city'` are
 * precisely what a stubbed database would get wrong.
 *
 * The rule under test throughout: a capacity nobody configured is null, never
 * 0 — a 0 would make every screen downstream read an unconfigured warehouse as
 * a full one.
 *
 * @group integration
 */
final class WarehouseSummaryTest extends IntegrationTestCase
{
    private function seed(array $row): int
    {
        $this->db->table('inv_warehouses')->insert(array_merge([
            'cmp_id'         => $this->cmpId,
            'bo_id'          => 0,
            'warehouse_name' => 'W' . random_int(1000, 999999),
            'warehouse_type' => 'standard',
            'is_default'     => 0,
            'is_active'      => 1,
            'created_at'     => '2026-09-01 10:00:00',
            'updated_at'     => '2026-09-01 10:00:00',
        ], $row));

        return (int) $this->db->insertID();
    }

    /** @return array<string, mixed> */
    private function summary(int $bo = 0): array
    {
        $method = new \ReflectionMethod(WarehousesController::class, 'summaryFor');
        $method->setAccessible(true);

        return $method->invoke(new WarehousesController(), $this->cmpId, $bo);
    }

    public function testCountsActiveAndInactiveSeparately(): void
    {
        $this->seed(['warehouse_name' => 'Main', 'is_active' => 1, 'is_default' => 1]);
        $this->seed(['warehouse_name' => 'Transit', 'is_active' => 1]);
        $this->seed(['warehouse_name' => 'Old', 'is_active' => 0]);

        $summary = $this->summary();

        $this->assertSame(3, $summary['total']);
        $this->assertSame(2, $summary['active']);
        $this->assertSame(1, $summary['inactive']);
        $this->assertSame(1, $summary['defaults']);
    }

    public function testExcludesSoftDeletedWarehouses(): void
    {
        $this->seed(['warehouse_name' => 'Live']);
        $this->seed(['warehouse_name' => 'Gone', 'deleted_at' => '2026-09-02 09:00:00']);

        $this->assertSame(1, $this->summary()['total']);
    }

    public function testNeverLeaksAnotherCompanysWarehouses(): void
    {
        $this->seed(['warehouse_name' => 'Ours']);
        $this->seed(['warehouse_name' => 'Theirs', 'cmp_id' => $this->cmpId + 7]);

        $this->assertSame(1, $this->summary()['total']);
    }

    public function testCapacityIsNullWhenNoWarehouseHasOne(): void
    {
        $this->seed(['warehouse_name' => 'A']);
        $this->seed(['warehouse_name' => 'B']);

        $summary = $this->summary();

        // Null, not 0: the company has no ceiling to report, and every screen
        // downstream must say "Not configured" instead of dividing by it.
        $this->assertNull($summary['capacity']['units']);
        $this->assertNull($summary['capacity']['area']);
        $this->assertSame(0, $summary['capacity']['configured']);
    }

    public function testCapacitySumsOnlyTheWarehousesThatHaveOne(): void
    {
        $this->seed(['warehouse_name' => 'A', 'capacity_units' => 50000]);
        $this->seed(['warehouse_name' => 'B', 'capacity_units' => 20000]);
        $this->seed(['warehouse_name' => 'C']);

        $summary = $this->summary();

        $this->assertSame(70000.0, (float) $summary['capacity']['units']);
        $this->assertSame(2, $summary['capacity']['configured']);
        $this->assertSame(3, $summary['total']);
    }

    public function testAreaIsSummedPerUnitNeverAcrossThem(): void
    {
        $this->seed(['warehouse_name' => 'A', 'area' => 2500, 'area_unit' => 'sq_ft']);
        $this->seed(['warehouse_name' => 'B', 'area' => 1500, 'area_unit' => 'sq_ft']);
        $this->seed(['warehouse_name' => 'C', 'area' => 2, 'area_unit' => 'acre']);

        $byUnit = $this->summary()['capacity']['area_by_unit'];
        $keyed = array_column($byUnit, null, 'unit');

        $this->assertSame(4000.0, $keyed['sq_ft']['area']);
        $this->assertSame(2, $keyed['sq_ft']['count']);
        $this->assertSame(2.0, $keyed['acre']['area']);
    }

    public function testCountsOnlyWarehousesWithBothHalvesOfAPoint(): void
    {
        $this->seed(['warehouse_name' => 'Placed', 'latitude' => 18.5204303, 'longitude' => 73.8567437]);
        $this->seed(['warehouse_name' => 'Half', 'latitude' => 28.6]);
        $this->seed(['warehouse_name' => 'None']);

        $this->assertSame(1, $this->summary()['geo']['with_coordinates']);
    }

    public function testGroupsByCountryStateAndCityFromTheStoredAddress(): void
    {
        $this->seed(['warehouse_name' => 'A', 'address_json' => json_encode(['city' => 'Pune', 'state' => 'MH', 'country' => 'India'])]);
        $this->seed(['warehouse_name' => 'B', 'address_json' => json_encode(['city' => 'Pune', 'state' => 'MH', 'country' => 'India'])]);
        $this->seed(['warehouse_name' => 'C', 'address_json' => json_encode(['city' => 'Delhi', 'state' => 'DL', 'country' => 'India']), 'is_active' => 0]);

        $byLocation = $this->summary()['by_location'];

        $this->assertSame('Pune', $byLocation[0]['city']);
        $this->assertSame(2, $byLocation[0]['count']);
        $this->assertSame(2, $byLocation[0]['active']);
        $this->assertSame('Delhi', $byLocation[1]['city']);
        $this->assertSame(0, $byLocation[1]['active']);
    }

    public function testCollectsAddresslessWarehousesRatherThanDroppingThem(): void
    {
        $this->seed(['warehouse_name' => 'Placed', 'address_json' => json_encode(['city' => 'Pune'])]);
        $this->seed(['warehouse_name' => 'Unplaced']);
        $this->seed(['warehouse_name' => 'Blank', 'address_json' => json_encode(['city' => '   '])]);

        $byLocation = $this->summary()['by_location'];
        $empty = array_values(array_filter($byLocation, static fn (array $l): bool => $l['city'] === '' && $l['state'] === '' && $l['country'] === ''));

        // A whitespace-only city is the same as no city — one group, not two.
        $this->assertCount(1, $empty);
        $this->assertSame(2, $empty[0]['count']);
        $this->assertSame(3, array_sum(array_column($byLocation, 'count')));
    }

    public function testBranchScopeKeepsSharedWarehousesVisible(): void
    {
        $this->seed(['warehouse_name' => 'Shared', 'bo_id' => 0]);
        $this->seed(['warehouse_name' => 'Branch two', 'bo_id' => 2]);
        $this->seed(['warehouse_name' => 'Branch three', 'bo_id' => 3]);

        // Branch 2 sees its own and the all-branches one, exactly as the list does.
        $this->assertSame(2, $this->summary(2)['total']);
        $this->assertSame(3, $this->summary(0)['total']);
    }

    public function testCountsByType(): void
    {
        $this->seed(['warehouse_name' => 'A', 'warehouse_type' => 'standard']);
        $this->seed(['warehouse_name' => 'B', 'warehouse_type' => 'standard', 'is_active' => 0]);
        $this->seed(['warehouse_name' => 'C', 'warehouse_type' => 'transit']);

        $byType = array_column($this->summary()['by_type'], null, 'warehouse_type');

        $this->assertSame(2, $byType['standard']['count']);
        $this->assertSame(1, $byType['standard']['active']);
        $this->assertSame(1, $byType['transit']['count']);
    }
}
