<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\SerialsController;
use PHPUnit\Framework\TestCase;

/**
 * The serial workspace's four counters, and the routes that serve them.
 *
 * The cards read "Total / In stock / Allocated / Out of stock" one beside the
 * other. Three of them are buckets of `status`, and a reader adds them up
 * without being asked to: if the buckets overlapped, or left a status out, the
 * strip would quietly disagree with its own total and nothing on the screen
 * would say which figure was wrong. So the grouping is asserted to be a
 * partition of the status vocabulary — every status in exactly one bucket.
 *
 * @group unit
 */
final class SerialStatusGroupsTest extends TestCase
{
    public function testEveryStatusBelongsToExactlyOneGroup(): void
    {
        $seen = [];
        foreach (SerialsController::STATUS_GROUPS as $group => $statuses) {
            foreach ($statuses as $status) {
                $this->assertContains($status, SerialsController::STATUSES, $status . ' is not a serial status');
                $this->assertArrayNotHasKey($status, $seen, $status . ' is counted by both ' . ($seen[$status] ?? '') . ' and ' . $group);
                $seen[$status] = $group;
            }
        }

        foreach (SerialsController::STATUSES as $status) {
            $this->assertArrayHasKey($status, $seen, $status . ' is in no counter bucket, so the cards cannot add up to the total');
        }
    }

    public function testTheGroupNamesAreTheOnesTheScreenDrillsInOn(): void
    {
        // The KPI cards link to ?status=<group>; the list endpoint expands a
        // group name back into its statuses. Rename one without the other and
        // the card opens an empty list.
        $this->assertSame(['in_stock', 'allocated', 'out'], array_keys(SerialsController::STATUS_GROUPS));
    }

    public function testStockBearingStatusesAreAllAccountedForAsHeldOrInProcess(): void
    {
        // A serial the company physically holds may not sit in the "out of
        // stock" column — that column is what the business no longer has.
        $out = SerialsController::STATUS_GROUPS['out'];
        foreach (['in_stock', 'reserved', 'in_transit'] as $held) {
            $this->assertNotContains($held, $out, $held . ' is stock-bearing and cannot be counted as out of stock');
        }
    }

    public function testTheSerialRoutesTheWorkspaceCallsAreRegistered(): void
    {
        $routes = (string) file_get_contents(__DIR__ . '/../../app/Config/Routes.php');
        foreach ([
            "\$routes->get('serials/summary', 'SerialsController::summary');",
            "\$routes->get('serials/(:num)/history', 'SerialsController::history/\$1');",
            "\$routes->post('serials/bulk', 'SerialsController::bulkCreate');",
            "\$routes->post('serials/bulk-update', 'SerialsController::bulkUpdate');",
        ] as $line) {
            $this->assertStringContainsString($line, $routes, 'missing route: ' . $line);
        }
    }

    public function testEveryRegisteredSerialRouteHasAMethodBehindIt(): void
    {
        foreach (['index', 'summary', 'show', 'history', 'create', 'update', 'delete', 'bulkCreate', 'bulkUpdate'] as $method) {
            $this->assertTrue(method_exists(SerialsController::class, $method), 'SerialsController::' . $method . '() is routed but missing');
        }
    }
}
