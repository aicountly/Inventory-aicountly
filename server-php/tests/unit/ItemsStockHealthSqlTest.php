<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\ItemsController;
use PHPUnit\Framework\TestCase;

/**
 * The predicates behind `?stock_status=` on GET /v1/items and the counters on
 * /v1/items/summary. No database — this holds the SHAPE of the SQL, which is where the
 * decisions live.
 *
 * Why it is worth a test at all: this SQL is the server half of a rule the browser states
 * again in `web/src/pages/items/itemsModel.ts`. The two have to agree, or a filter returns a
 * row whose badge says something else, and the reader believes the badge. The frontend half
 * has its own tests; this is the other end of the same contract.
 *
 * @group unit
 */
final class ItemsStockHealthSqlTest extends TestCase
{
    /** @return array<string, string> */
    private function sql(): array
    {
        $m = new \ReflectionMethod(ItemsController::class, 'stockHealthSql');
        $m->setAccessible(true);

        return $m->invoke(null);
    }

    public function testEveryStatusTheApiDocumentsIsOffered(): void
    {
        $this->assertSame(
            ['negative', 'out', 'low', 'in_stock', 'attention'],
            array_keys($this->sql()),
        );
    }

    public function testEveryPredicateIsRestrictedToItemsThatActuallyHoldStock(): void
    {
        // A service holds no quantity. Without this every service item in the catalogue
        // would be counted "out of stock" — an alarm about nothing, on the card a user is
        // meant to trust.
        foreach ($this->sql() as $status => $predicate) {
            $this->assertStringContainsString("i.item_type = 'stock'", $predicate, $status);
        }
    }

    public function testNegativeAndOutAreSeparateStates(): void
    {
        $sql = $this->sql();
        $this->assertStringContainsString('< 0', $sql['negative']);
        $this->assertStringContainsString('= 0', $sql['out']);
        $this->assertStringNotContainsString('<= 0', $sql['negative']);
    }

    public function testLowIsMeasuredAgainstTheReorderPointFallingBackToMinimumStock(): void
    {
        $low = $this->sql()['low'];
        $this->assertStringContainsString('i.reorder_point_qty', $low);
        $this->assertStringContainsString('i.min_stock_qty', $low);
        // NULLIF is what stops a zero being read as a threshold: otherwise every item in the
        // catalogue turns amber the moment it empties, which is what `out` already says.
        $this->assertStringContainsString('NULLIF(i.reorder_point_qty, 0)', $low);
        $this->assertStringContainsString('IS NOT NULL', $low);
    }

    public function testLowRequiresStockOnHandSoItCannotOverlapOutOrNegative(): void
    {
        $this->assertStringContainsString('> 0', $this->sql()['low']);
    }

    public function testInStockIsTheComplementOfLowRatherThanASecondDefinitionOfIt(): void
    {
        // Spelled as NOT(low) on purpose: two hand-written inequalities would drift the first
        // time the threshold rule changed, and an item would be both "In stock" and "Low".
        $sql = $this->sql();
        $this->assertStringContainsString('NOT', $sql['in_stock']);
        $this->assertStringContainsString('> 0', $sql['in_stock']);
    }

    public function testAttentionCoversNegativeOutAndLowTogether(): void
    {
        $attention = $this->sql()['attention'];
        $this->assertStringContainsString('<= 0', $attention);
        $this->assertStringContainsString('i.reorder_point_qty', $attention);
    }

    public function testEveryPredicateReadsTheSameOnHandAggregateTheRowDisplays(): void
    {
        // `sb.on_hand` is the join attachStock() mirrors. A second aggregation here would let
        // `stock_status=negative` return a row whose On hand column reads 4.
        foreach ($this->sql() as $status => $predicate) {
            $this->assertStringContainsString('COALESCE(sb.on_hand, 0)', $predicate, $status);
        }
    }
}
