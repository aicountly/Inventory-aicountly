<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\ValuationController;
use PHPUnit\Framework\TestCase;

/**
 * The method-comparison screen offers to compare "positive stock only" and
 * "negative stock only", and the figure it prints under that heading is the
 * `summary` this endpoint computes. So the narrowing and the totalling have to
 * happen together: rows filtered without their totals re-derived is the one
 * outcome that puts a company-wide value on screen beside a scope label that
 * excludes most of it.
 *
 * @group unit
 */
final class ValuationScopeFilterTest extends TestCase
{
    private const SNAP = [
        'rows' => [
            ['item_id' => 1, 'item_name' => 'Anodised sheet', 'closing_qty' => 40.0, 'unit_cost' => 12.5, 'stock_value' => 500.0],
            ['item_id' => 2, 'item_name' => 'Brass fitting', 'closing_qty' => -12.0, 'unit_cost' => 7.25, 'stock_value' => -87.0],
            ['item_id' => 3, 'item_name' => 'Copper rod', 'closing_qty' => 5.0, 'unit_cost' => 90.0, 'stock_value' => 450.0],
        ],
        'total_qty'   => 33.0,
        'total_value' => 863.0,
        'method'      => 'FIFO',
    ];

    /** @param array<string, mixed> $snap */
    private function ids(array $snap): array
    {
        return array_map(static fn ($r) => $r['item_id'], $snap['rows']);
    }

    public function testNoScopeLeavesTheSnapshotExactlyAsItCame(): void
    {
        $this->assertSame(self::SNAP, ValuationController::filterSnapshotByQtySign(self::SNAP, null));
    }

    public function testPositiveScopeKeepsOnlyStockOnHandAndRetotalsIt(): void
    {
        $out = ValuationController::filterSnapshotByQtySign(self::SNAP, 'positive');

        $this->assertSame([1, 3], $this->ids($out));
        $this->assertSame(45.0, $out['total_qty']);
        $this->assertSame(950.0, $out['total_value'], 'the negative row must leave the total with the rows');
        $this->assertSame('FIFO', $out['method'], 'the scope narrows the stock, never the method asked for');
    }

    public function testNegativeScopeKeepsOnlyTheShortagesAndRetotalsThem(): void
    {
        $out = ValuationController::filterSnapshotByQtySign(self::SNAP, 'negative');

        $this->assertSame([2], $this->ids($out));
        $this->assertSame(-12.0, $out['total_qty']);
        $this->assertSame(-87.0, $out['total_value']);
    }

    public function testRowsAreReindexedSoTheyEncodeAsAJsonArray(): void
    {
        // array_filter preserves keys; a gap in them makes json_encode emit an
        // object, and the client's `data.map` then reads undefined.
        $out = ValuationController::filterSnapshotByQtySign(self::SNAP, 'negative');

        $this->assertSame([0], array_keys($out['rows']));
    }

    public function testZeroQuantityBelongsToNeitherSide(): void
    {
        $snap = ['rows' => [['item_id' => 9, 'closing_qty' => 0.0, 'stock_value' => 0.0]], 'total_qty' => 0.0, 'total_value' => 0.0, 'method' => 'WAC'];

        $this->assertSame([], ValuationController::filterSnapshotByQtySign($snap, 'positive')['rows']);
        $this->assertSame([], ValuationController::filterSnapshotByQtySign($snap, 'negative')['rows']);
    }
}
