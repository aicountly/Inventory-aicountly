<?php

namespace Tests\Unit;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use PHPUnit\Framework\TestCase;

/**
 * The allocator: one charge spread over the lines of the receipt it loads.
 *
 * The rule that matters is that the shares sum EXACTLY to the charge. Rounding four decimal places
 * of every share and dropping what is left over loses rupees out of closing stock, and a closing
 * stock that does not tie is the one failure nobody can reconcile afterwards — the charge was
 * booked in Books in full and capitalised in Inventory short. The residual goes onto the largest
 * line, which is where it is smallest in proportion.
 *
 * @group unit
 */
final class LandedCostAllocationTest extends TestCase
{
    private function sum(array $shares): float
    {
        $total = 0.0;
        foreach ($shares as $s) {
            $total = round($total + $s, 4);
        }

        return $total;
    }

    // ------------------------------------------------------------------ pro-rata

    public function testAChargeIsSpreadInProportionToTheWeights(): void
    {
        // by value: lines worth 3000 and 1000, freight 400 -> 300 / 100
        $shares = DocumentPostingService::allocateCharge(400.0, [11 => 3000.0, 12 => 1000.0]);

        $this->assertSame([11 => 300.0, 12 => 100.0], $shares);
        $this->assertSame(400.0, $this->sum($shares));
    }

    public function testQuantityIsJustAnotherWeight(): void
    {
        // by qty: 30 units and 10 units, duty 200 -> 150 / 50
        $this->assertSame([11 => 150.0, 12 => 50.0], DocumentPostingService::allocateCharge(200.0, [11 => 30.0, 12 => 10.0]));
    }

    public function testAChargeOnOneLineIsThatWholeCharge(): void
    {
        $this->assertSame([11 => 1234.56], DocumentPostingService::allocateCharge(1234.56, [11 => 900.0]));
    }

    /**
     * Three equal lines and 100: 33.3333 each is 99.9999, and the missing paisa is put back on the
     * first of the largest rather than lost.
     */
    public function testTheResidualIsNeverLost(): void
    {
        $shares = DocumentPostingService::allocateCharge(100.0, [11 => 1.0, 12 => 1.0, 13 => 1.0]);

        $this->assertSame(100.0, $this->sum($shares), 'the shares add up to the charge exactly');
        $this->assertSame([11 => 33.3334, 12 => 33.3333, 13 => 33.3333], $shares);
    }

    public function testTheResidualGoesOnTheLargestLine(): void
    {
        // 1000 over 1 : 1 : 7 -> 111.1111 / 111.1111 / 777.7778 = 1000.0000 exactly
        $shares = DocumentPostingService::allocateCharge(1000.0, [11 => 1.0, 12 => 1.0, 13 => 7.0]);

        $this->assertSame(1000.0, $this->sum($shares));
        $this->assertSame(777.7778, $shares[13], 'the biggest line absorbs the rounding');
        $this->assertSame(111.1111, $shares[11]);
    }

    /** The awkward one: many lines, an amount that divides into none of them. */
    public function testManyLinesStillTieToTheRupee(): void
    {
        $weights = [];
        for ($i = 1; $i <= 17; $i++) {
            $weights[$i] = (float) $i;
        }
        $shares = DocumentPostingService::allocateCharge(1000.01, $weights);

        $this->assertSame(1000.01, $this->sum($shares));
        $this->assertCount(17, $shares);
    }

    public function testALineThatWeighsNothingTakesNothing(): void
    {
        $shares = DocumentPostingService::allocateCharge(500.0, [11 => 1000.0, 12 => 0.0]);

        $this->assertSame(0.0, $shares[12]);
        $this->assertSame(500.0, $shares[11]);
    }

    /**
     * Every line weighing nothing is refused rather than spread evenly: a charge nobody can
     * attribute is a decision for the person entering it, and an arbitrary spread would look like
     * an answer.
     */
    public function testAChargeNoLineCanCarryIsRefusedRatherThanSpreadArbitrarily(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('every line it would be spread over weighs nothing');
        DocumentPostingService::allocateCharge(500.0, [11 => 0.0, 12 => 0.0]);
    }

    public function testTheRefusalNamesTheCharge(): void
    {
        try {
            DocumentPostingService::allocateCharge(500.0, [11 => 0.0], 'freight charge');
            $this->fail('expected a refusal');
        } catch (InventoryException $e) {
            $this->assertStringContainsString('freight charge', $e->getMessage());
        }
    }

    public function testNoLineAtAllIsRefusedTheSameWay(): void
    {
        $this->expectException(InventoryException::class);
        DocumentPostingService::allocateCharge(500.0, []);
    }

    // ------------------------------------------------------------------ manual and direct

    /**
     * Manual and direct shares are the amounts the user typed. They are kept, and only the paisa of
     * slack the entry tolerance allows is settled, so the stored detail ties to the charge exactly
     * without the typed numbers being quietly rescaled.
     */
    public function testTypedSharesAreKeptAndOnlyTheSlackIsSettled(): void
    {
        $shares = DocumentPostingService::settleResidual([11 => 600.0, 12 => 399.99], 1000.0);

        $this->assertSame(1000.0, $this->sum($shares));
        $this->assertSame(600.01, $shares[11], 'the largest typed share takes the paisa');
        $this->assertSame(399.99, $shares[12]);
    }

    public function testTypedSharesThatAlreadyTieAreLeftAlone(): void
    {
        $this->assertSame([11 => 600.0, 12 => 400.0], DocumentPostingService::settleResidual([11 => 600.0, 12 => 400.0], 1000.0));
    }

    public function testADirectChargeSitsWhollyOnItsOneLine(): void
    {
        $this->assertSame([12 => 134.56], DocumentPostingService::settleResidual([12 => 134.56], 134.56));
    }

    public function testSettlingNothingOverNoLinesIsNotAnError(): void
    {
        $this->assertSame([], DocumentPostingService::settleResidual([], 500.0));
    }
}
