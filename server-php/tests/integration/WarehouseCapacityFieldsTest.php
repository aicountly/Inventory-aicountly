<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\WarehousesController;
use App\Exceptions\InventoryException;
use Tests\Support\IntegrationTestCase;

/**
 * What the warehouse form is allowed to save into the new capacity and
 * coordinate columns.
 *
 * The validation matters more than it looks. Every one of these fields is
 * optional, and "not set" is a real answer the screens render as "Not
 * configured" — so a blank must reach the database as NULL. A blank coerced to
 * 0 would give a warehouse a zero-unit ceiling, and every utilisation bar,
 * every KPI card and every insight downstream would then read it as
 * permanently full.
 *
 * @group integration
 */
final class WarehouseCapacityFieldsTest extends IntegrationTestCase
{
    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    private function build(array $body, ?array $existing = null): array
    {
        $method = new \ReflectionMethod(WarehousesController::class, 'buildRow');
        $method->setAccessible(true);

        return $method->invoke(new WarehousesController(), $this->cmpId, $body + ['warehouse_name' => 'Test'], $existing);
    }

    public function testBlankCapacityAndAreaAreStoredAsNullNotZero(): void
    {
        $row = $this->build(['capacity_units' => '', 'area' => '']);

        $this->assertNull($row['capacity_units']);
        $this->assertNull($row['area']);
    }

    public function testCapacityAndAreaAreStoredAsNumbers(): void
    {
        $row = $this->build(['capacity_units' => '50000', 'area' => '2500.5', 'area_unit' => 'sq_ft']);

        $this->assertSame(50000.0, $row['capacity_units']);
        $this->assertSame(2500.5, $row['area']);
        $this->assertSame('sq_ft', $row['area_unit']);
    }

    public function testRejectsANegativeCapacity(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('Capacity cannot be negative');
        $this->build(['capacity_units' => -1]);
    }

    public function testRejectsANegativeArea(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('Area cannot be negative');
        $this->build(['area' => -0.5]);
    }

    public function testRejectsANonNumericCapacity(): void
    {
        $this->expectException(InventoryException::class);
        $this->build(['capacity_units' => 'lots']);
    }

    public function testRejectsAnUnknownAreaUnit(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('Unknown area unit');
        $this->build(['area' => 10, 'area_unit' => 'furlongs']);
    }

    public function testDefaultsTheAreaUnitRatherThanRefusingTheSave(): void
    {
        // The user typed a figure; sq ft is what an Indian warehouse is quoted in.
        $this->assertSame('sq_ft', $this->build(['area' => 2500])['area_unit']);
    }

    public function testAcceptsACompleteCoordinatePair(): void
    {
        $row = $this->build(['latitude' => '18.5204303', 'longitude' => '73.8567437']);

        $this->assertSame(18.5204303, $row['latitude']);
        $this->assertSame(73.8567437, $row['longitude']);
    }

    public function testRejectsHalfAPoint(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('Latitude and longitude must be set together');
        $this->build(['latitude' => 18.52, 'longitude' => '']);
    }

    public function testAcceptsNeitherCoordinate(): void
    {
        $row = $this->build(['latitude' => '', 'longitude' => '']);

        $this->assertNull($row['latitude']);
        $this->assertNull($row['longitude']);
    }

    public function testRejectsAnOutOfRangeLatitude(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('Latitude must be between');
        $this->build(['latitude' => 91, 'longitude' => 10]);
    }

    public function testRejectsAnOutOfRangeLongitude(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('Longitude must be between');
        $this->build(['latitude' => 10, 'longitude' => 181]);
    }

    public function testAnEditThatTouchesNeitherCoordinateKeepsTheStoredPoint(): void
    {
        // MasterController::update merges the existing row into the body, so an
        // edit of an unrelated field must not be read as clearing the point.
        $existing = ['warehouse_id' => 1, 'latitude' => '18.5204303', 'longitude' => '73.8567437', 'area_unit' => 'sq_ft'];
        $row = $this->build(['latitude' => '18.5204303', 'longitude' => '73.8567437', 'warehouse_name' => 'Renamed'], $existing);

        $this->assertSame(18.5204303, $row['latitude']);
        $this->assertSame(73.8567437, $row['longitude']);
    }

    public function testTheAddressStillRoundTripsThroughAddressJson(): void
    {
        $row = $this->build(['address' => ['city' => 'Pune', 'state' => 'MH', 'country' => 'India']]);

        $this->assertSame(['city' => 'Pune', 'state' => 'MH', 'country' => 'India'], json_decode($row['address_json'], true));
    }

    public function testAnUnknownTypeStillFallsBackToStandard(): void
    {
        $this->assertSame('standard', $this->build(['warehouse_type' => 'spaceport'])['warehouse_type']);
    }
}
