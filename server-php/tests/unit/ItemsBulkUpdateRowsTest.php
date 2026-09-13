<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\ItemsController;
use App\Exceptions\InventoryException;
use PHPUnit\Framework\TestCase;

/**
 * The request normalisation behind POST /v1/items/bulk-update — in particular the whitelist,
 * which is what keeps a bulk edit away from units and the valuation method. No database.
 *
 * @group unit
 */
final class ItemsBulkUpdateRowsTest extends TestCase
{
    /**
     * @param array<string, mixed> $body
     * @return array<int, array<string, mixed>>
     */
    private function normalize(array $body): array
    {
        $m = new \ReflectionMethod(ItemsController::class, 'normalizeBulkRows');
        $m->setAccessible(true);

        return $m->invoke(null, $body);
    }

    public function testOneValueIsSpreadAcrossEverySelectedItem(): void
    {
        $out = $this->normalize(['item_ids' => [3, 1, 3], 'fields' => ['books_tax_cat_id' => 7]]);

        $this->assertSame([3, 1], array_keys($out));
        $this->assertSame(['books_tax_cat_id' => 7], $out[1]);
    }

    public function testAValuePerItemIsKeptPerItem(): void
    {
        $out = $this->normalize(['rows' => [
            ['item_id' => 1, 'mrp' => 100],
            ['item_id' => 2, 'mrp' => 120],
        ]]);

        $this->assertSame(100, $out[1]['mrp']);
        $this->assertSame(120, $out[2]['mrp']);
    }

    public function testARepeatedItemMergesRatherThanTheLastRowWinningSilently(): void
    {
        $out = $this->normalize(['rows' => [
            ['item_id' => 1, 'mrp' => 100],
            ['item_id' => 1, 'hsn_sac' => '8471'],
        ]]);

        $this->assertSame(['mrp' => 100, 'hsn_sac' => '8471'], $out[1]);
    }

    public function testRowsWinOverTheWholeSelectionShapeWhenBothAreSent(): void
    {
        $out = $this->normalize([
            'rows'     => [['item_id' => 1, 'mrp' => 100]],
            'item_ids' => [9],
            'fields'   => ['mrp' => 999],
        ]);

        $this->assertSame([1], array_keys($out));
    }

    public function testAFieldOutsideTheWhitelistIsRefusedRatherThanDropped(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessageMatches('/valuation_method/');

        $this->normalize(['item_ids' => [1], 'fields' => ['valuation_method' => 'LIFO']]);
    }

    public function testChangingTheUnitInBulkIsRefused(): void
    {
        $this->expectException(InventoryException::class);

        $this->normalize(['rows' => [['item_id' => 1, 'unit_id' => 4]]]);
    }

    public function testAnEmptySelectionOrAnEmptyChangeYieldsNothingToDo(): void
    {
        $this->assertSame([], $this->normalize(['item_ids' => [1, 2], 'fields' => []]));
        $this->assertSame([], $this->normalize(['item_ids' => [], 'fields' => ['mrp' => 1]]));
        $this->assertSame([], $this->normalize(['rows' => [['item_id' => 0, 'mrp' => 1]]]));
        $this->assertSame([], $this->normalize([]));
    }
}
