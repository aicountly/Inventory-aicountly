<?php

namespace Tests\Unit;

use App\Services\Migration\Precheck;
use App\Services\RecalculationService;
use PHPUnit\Framework\TestCase;

/**
 * A recalculation replays an item from its opening, and the cost of every receipt it meets is an
 * input it carries, not a figure it works out again — that is what lets the system say a backdated
 * document re-costs later issues without re-pricing historical closing stock.
 *
 * The claim held only where the line carried a positive valuation. A job-work receipt that Books
 * had no cost_rate for migrates with its valuation column empty or zero, and JOB_WORK_IN is not
 * cost-bearing (its source rate is the value agreed with the job worker, the figure Table 5 of FORM
 * GST ITC-04 declares), so the replay reached for the item's current cost instead — and wrote that
 * invention back to the line, the movement and the stored accounting effects and published it to
 * Books as a valuation revision, moving COGS in a period that may already be filed.
 *
 * @group unit
 */
final class RecalculationUnpricedReceiptTest extends TestCase
{
    /** The value agreed with the job worker on the challan the goods come back on. */
    private const CHALLAN_RATE = 1250.0;

    /**
     * A replay movement row as replayItem() selects it: the movement joined to its document line.
     *
     * @return array<string, mixed>
     */
    private function inward(string $type, float|string|null $valuationRate, float $sourceRate = self::CHALLAN_RATE, int $movementId = 1): array
    {
        return [
            'movement_id' => $movementId, 'line_id' => 500 + $movementId, 'document_id' => 90, 'qty' => 10.0,
            'document_type' => $type, 'conversion_factor' => 1.0, 'line_qty' => 10.0,
            'source_transaction_rate' => $sourceRate, 'source_transaction_amount' => $sourceRate * 10,
            'line_valuation_rate' => $valuationRate, 'metadata_json' => null,
        ];
    }

    public function testAJobWorkReceiptMigratedWithNoCostLeavesTheReplayWithNothingToCarry(): void
    {
        $cost = RecalculationService::decidedInwardUnitCost($this->inward('JOB_WORK_IN', null));

        $this->assertNull($cost, 'nothing decided this line a cost, and a replay may not invent one');
    }

    /** Posting writes the column for every line it values, so a stored zero is a decision. */
    public function testACostDecidedAsZeroIsCarriedRatherThanWorkedOutAgain(): void
    {
        $this->assertSame(0.0, RecalculationService::decidedInwardUnitCost($this->inward('JOB_WORK_IN', '0.0000')));
    }

    public function testTheChallanValueIsNeverTheReplayedCost(): void
    {
        foreach ([null, '0.0000'] as $stored) {
            $cost = RecalculationService::decidedInwardUnitCost($this->inward('JOB_WORK_IN', $stored));
            $this->assertNotEqualsWithDelta(self::CHALLAN_RATE, (float) $cost, 0.0001);
        }
    }

    public function testAPurchaseRateIsStillReadAsTheCostWhenTheLineCarriesNone(): void
    {
        $this->assertEqualsWithDelta(100.0, (float) RecalculationService::decidedInwardUnitCost($this->inward('PURCHASE_RECEIPT', null, 100.0)), 0.0001);
    }

    public function testAnExplicitLineCostStillOutranksACostBearingSourceRate(): void
    {
        $this->assertEqualsWithDelta(120.0, (float) RecalculationService::decidedInwardUnitCost($this->inward('PURCHASE_RECEIPT', 120.0, 100.0)), 0.0001);
    }

    /** A purchase that reached Inventory with neither figure is as unpriced as a job-work receipt. */
    public function testACostBearingLineWithNoRateEitherIsUnpricedToo(): void
    {
        $row = $this->inward('PURCHASE_RECEIPT', null, 0.0);
        $row['source_transaction_amount'] = 0.0;

        $this->assertNull(RecalculationService::decidedInwardUnitCost($row));
    }

    public function testOnlyTheInwardsThatNothingPricesAreListed(): void
    {
        $transferIn = $this->inward('STOCK_TRANSFER', null, 0.0, 2);
        $transferIn['source_transaction_amount'] = 0.0;
        $transferIn['metadata_json'] = json_encode(['side' => 'in', 'transfer_pair' => 'a']);
        $issue = $this->inward('SALES_ISSUE', null, 0.0, 3);
        $issue['qty'] = -4.0;
        $reversedReceipt = $this->inward('JOB_WORK_IN', null, self::CHALLAN_RATE, 4);
        $unvalued = $this->inward('BATCH_ADJUSTMENT', null, 0.0, 5);

        $unpriced = RecalculationService::unpricedInwardMovements(
            [$this->inward('JOB_WORK_IN', null), $this->inward('PURCHASE_RECEIPT', 120.0, 100.0, 6), $transferIn, $issue, $reversedReceipt, $unvalued],
            [4 => true],
        );

        $this->assertSame([501], array_map(static fn ($m) => (int) $m['line_id'], $unpriced));
    }

    /**
     * The refusal has to happen before transStart(): PostgreSQL aborts the whole transaction on a
     * failed statement, and clearValuationState() has already deleted the item's layers by then.
     */
    public function testTheItemIsRefusedBeforeATransactionIsOpen(): void
    {
        $source = (string) file_get_contents((string) (new \ReflectionClass(RecalculationService::class))->getFileName());
        $replay = substr($source, (int) strpos($source, 'public function replayItem('));

        $this->assertIsInt($guard = strpos($replay, 'unpricedInwardMovements('), 'the replay must ask whether anything is unpriced');
        $this->assertIsInt($open = strpos($replay, 'transStart()'));
        $this->assertLessThan($open, $guard, 'the replay must refuse before it opens a transaction and clears the item');
    }

    /**
     * Revisions reach Books only once every item has been replayed, so an item refused halfway
     * through would leave the lines already rewritten with Books never told.
     */
    public function testTheJobIsRefusedBeforeTheFirstItemIsReplayed(): void
    {
        $source = (string) file_get_contents((string) (new \ReflectionClass(RecalculationService::class))->getFileName());
        $run = substr($source, (int) strpos($source, 'public function run('));

        $this->assertIsInt($guard = strpos($run, '$this->unpricedInwardLines('), 'the job must ask before it replays');
        $this->assertIsInt($replay = strpos($run, '$this->replayItem('));
        $this->assertLessThan($replay, $guard, 'the whole job is refused before any item is touched');
    }

    /** The population that reaches Inventory unpriced has to be countable before cutover. */
    public function testTheCutoverCensusCountsACostOfZeroAsNoCost(): void
    {
        $source = (string) file_get_contents((string) (new \ReflectionClass(Precheck::class))->getFileName());
        $census = substr($source, (int) strpos($source, "'posted_lines_without_cost'"));
        $census = substr($census, 0, (int) strpos($census, "\n"));

        $this->assertStringContainsString('l.cost_rate = 0', $census);
        $this->assertStringContainsString('l.cost_rate IS NULL', $census);
    }
}
