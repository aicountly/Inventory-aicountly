<?php

namespace Tests\Unit;

use App\Services\DocumentPostingService;
use Config\DocumentTypeRegistry;
use PHPUnit\Framework\TestCase;

/**
 * Loading a landed cost onto the cost of the goods.
 *
 *     valuation_amount = (base cost of the goods) + landed_cost_amount
 *     valuation_rate   = valuation_amount / base_qty
 *
 * The rate is what posting hands ValuationEngine::recordReceipt(), which opens the FIFO/LIFO layer
 * at it AND feeds the same figure to the weighted average — so loading the rate once is what makes
 * both methods carry the landed cost rather than whichever one happens to be read.
 *
 * Landed cost is a COST. Nothing here touches source_transaction_rate / source_transaction_amount:
 * those are the commercial pair Books owns, the one that drives GST, receivables and turnover, and
 * a freight bill may never change an invoice value.
 *
 * @group unit
 */
final class LandedCostUnitCostTest extends TestCase
{
    public function testTheChargeIsSpreadOverTheBaseQuantity(): void
    {
        // 10 units at 100 = 1000 of goods, + 250 freight = 1250 over 10 units.
        $this->assertSame(125.0, DocumentPostingService::loadedInwardUnitCost(100.0, 10.0, 250.0));
    }

    public function testNoChargeLeavesTheCostOfTheGoodsExactlyWhereItWas(): void
    {
        $this->assertSame(100.0, DocumentPostingService::loadedInwardUnitCost(100.0, 10.0, 0.0));
        $this->assertSame(87.6543, DocumentPostingService::loadedInwardUnitCost(87.6543, 3.0, 0.0));
    }

    /** Freight on goods that cost nothing is still what the stock cost. */
    public function testGoodsThatCostNothingStillCarryTheirFreight(): void
    {
        $this->assertSame(25.0, DocumentPostingService::loadedInwardUnitCost(0.0, 4.0, 100.0));
    }

    /**
     * A status line carries no quantity, so there is nothing to divide by. The cost of the goods is
     * returned untouched rather than dividing by zero — and posting never reaches here for such a
     * line anyway, because it skips base_qty <= 0 before it values anything.
     */
    public function testAZeroBaseQuantityReturnsTheCostOfTheGoodsUnchanged(): void
    {
        $this->assertSame(100.0, DocumentPostingService::loadedInwardUnitCost(100.0, 0.0, 250.0));
        $this->assertSame(0.0, DocumentPostingService::loadedInwardUnitCost(0.0, 0.0, 250.0));
    }

    /**
     * The rate is NUMERIC(18,4), so a charge that does not divide evenly rounds there. The bound is
     * 0.00005 x base_qty on the amount, and deriving the line, the movement, the layer and the
     * weighted average from ONE rounded rate is what makes them all tie.
     */
    public function testAChargeThatDoesNotDivideEvenlyRoundsToFourPlaces(): void
    {
        $rate = DocumentPostingService::loadedInwardUnitCost(100.0, 3.0, 100.0);
        $this->assertSame(133.3333, $rate);
        $this->assertEqualsWithDelta(400.0, $rate * 3, 0.01, 'the amount still ties within a paisa');
    }

    // ------------------------------------------------------------------ what a stored line contributes

    /** @param array<string, mixed> $spec */
    private function onLine(float $amount, string $type, string $direction): float
    {
        return DocumentPostingService::landedCostOnLine(['landed_cost_amount' => $amount], DocumentTypeRegistry::get($type), $direction);
    }

    public function testAnInwardLineOfAValuedTypeContributesItsLandedCost(): void
    {
        $this->assertSame(250.0, $this->onLine(250.0, 'PURCHASE_RECEIPT', 'in'));
        $this->assertSame(0.0, $this->onLine(0.0, 'PURCHASE_RECEIPT', 'in'));
    }

    /**
     * Defence in depth behind the 422 at entry: a row written before that guard existed, or by a
     * migration, is not capitalised onto a document that cannot carry it.
     */
    public function testARowInAPlaceItMayNotBeContributesNothing(): void
    {
        $this->assertSame(0.0, $this->onLine(250.0, 'PURCHASE_RECEIPT', 'out'));
        $this->assertSame(0.0, $this->onLine(250.0, 'INWARD_CHALLAN', 'in'), 'the type carries no valuation');
        $this->assertSame(0.0, $this->onLine(250.0, 'BATCH_ADJUSTMENT', 'in'));
    }

    public function testANegativeStoredAmountNeverReducesTheCostOfTheGoods(): void
    {
        $this->assertSame(0.0, $this->onLine(-500.0, 'PURCHASE_RECEIPT', 'in'));
    }

    /**
     * The zero-cost warning is asked of the LOADED cost, not the bare cost of the goods. A receipt
     * whose goods cost nothing but which carries real freight does not enter at zero, and telling
     * the operator it did would point them at something already right. This pins the ORDER in
     * applyPosting(), which is the only thing that makes it true.
     */
    public function testTheZeroCostWarningIsAskedOfTheLoadedCost(): void
    {
        $method = new \ReflectionMethod(DocumentPostingService::class, 'applyPosting');
        $source = (array) file((string) $method->getFileName());
        $body = implode('', array_slice($source, $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1));

        $loaded = strpos($body, 'loadedInwardUnitCost(');
        $warned = strpos($body, 'zeroInwardCostWarning(');
        $recorded = strpos($body, '$this->valuation->recordReceipt(');
        $this->assertIsInt($loaded, 'the landed cost is loaded onto the unit cost where the base cost is computed');
        $this->assertIsInt($warned);
        $this->assertIsInt($recorded);
        $this->assertLessThan($warned, $loaded, 'the warning asks about the loaded cost, not the bare cost of the goods');
        $this->assertLessThan($recorded, $loaded, 'the layer and the weighted average are both opened at the loaded cost');

        // A freight-only receipt: goods at zero, 100 of freight over 4 units.
        $this->assertNull(DocumentPostingService::zeroInwardCostWarning('PURCHASE_RECEIPT', 7, 1, DocumentPostingService::loadedInwardUnitCost(0.0, 4.0, 100.0)));
        // And with no freight it still says so.
        $this->assertNotNull(DocumentPostingService::zeroInwardCostWarning('PURCHASE_RECEIPT', 7, 1, DocumentPostingService::loadedInwardUnitCost(0.0, 4.0, 0.0)));
    }

    /**
     * The commercial pair is Books': it drives GST, receivables and turnover. Posting writes the
     * landed cost beside the valuation and never near source_transaction_*.
     */
    public function testPostingNeverWritesTheCommercialPairWhileLoadingACost(): void
    {
        $source = (string) file_get_contents((string) (new \ReflectionClass(DocumentPostingService::class))->getFileName());

        $this->assertStringNotContainsString("'source_transaction_rate' =>", $source, 'Books owns the commercial rate; Inventory only ever reads it');
        $this->assertStringNotContainsString("'source_transaction_amount' =>", $source);
        $this->assertStringContainsString("'landed_cost_amount'       => round(\$landed, 4),", $source, 'the line records how much of its valuation is landed cost');
    }
}
