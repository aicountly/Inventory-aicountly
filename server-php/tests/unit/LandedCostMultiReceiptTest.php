<?php

namespace Tests\Unit;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use PHPUnit\Framework\TestCase;

/**
 * One bill, more than one receipt.
 *
 * A consignment that arrived over two GRNs is still one freight invoice, and splitting it into two
 * documents by hand means inventing a division of the bill before the allocator gets to make one.
 * These cover the metadata contract that lets a document name several receipts, and the fact that
 * the single-receipt shape every stored draft and every integration caller already uses keeps
 * working unchanged.
 *
 * @group unit
 */
final class LandedCostMultiReceiptTest extends TestCase
{
    // ------------------------------------------------------------------ the metadata contract

    public function testTheSingleReceiptShapeStillReadsAsOneTarget(): void
    {
        $this->assertSame([41], DocumentService::landedCostTargets(['target_document_id' => 41]));
        $this->assertSame(41, DocumentService::landedCostTarget(['target_document_id' => 41]));
    }

    public function testAListOfReceiptsIsReadInTheOrderGiven(): void
    {
        $this->assertSame([41, 42, 43], DocumentService::landedCostTargets(['target_document_ids' => [41, 42, 43]]));
    }

    /**
     * A receipt named twice is ONE receipt. Left as two it would weigh double in every pro-rata
     * split — its lines counted twice in the denominator and twice in the numerator — and take
     * twice the share of the bill it is entitled to.
     */
    public function testAReceiptNamedTwiceIsOneReceipt(): void
    {
        $this->assertSame([41, 42], DocumentService::landedCostTargets(['target_document_ids' => [41, 42, 41]]));
    }

    public function testTheSingularKeyIsFoldedInWithTheList(): void
    {
        $this->assertSame([42, 41], DocumentService::landedCostTargets(['target_document_ids' => [42], 'target_document_id' => 41]));
        // …and is not added twice when it is already in the list.
        $this->assertSame([41, 42], DocumentService::landedCostTargets(['target_document_ids' => [41, 42], 'target_document_id' => 41]));
    }

    public function testRowsOfObjectsAreAcceptedAsWellAsBareIds(): void
    {
        $this->assertSame([41, 42], DocumentService::landedCostTargets(['target_document_ids' => [['document_id' => 41], ['document_id' => 42]]]));
    }

    public function testNothingToLoadOntoIsRefused(): void
    {
        foreach ([[], ['target_document_ids' => []], ['target_document_id' => 0], ['target_document_ids' => [0, -3]]] as $meta) {
            try {
                DocumentService::landedCostTargets($meta);
                $this->fail('expected a refusal for ' . json_encode($meta));
            } catch (InventoryException $e) {
                $this->assertStringContainsString('must name the receipt', $e->getMessage());
            }
        }
    }

    // ------------------------------------------------------------------ allocating across receipts

    /**
     * The allocator does not know or care which receipt a line came from: it is handed the union of
     * the valued inward lines of every selected receipt and spreads over all of them at once. That
     * is the whole point — a bill split per receipt first would round twice and tie to neither.
     */
    public function testOneChargeSpreadsOverTheLinesOfEveryReceiptAtOnce(): void
    {
        // Receipt A lines worth 3000 + 1000, receipt B line worth 4000. Freight 800 over 8000.
        $shares = DocumentPostingService::allocateCharge(800.0, [11 => 3000.0, 12 => 1000.0, 21 => 4000.0]);

        $this->assertSame([11 => 300.0, 12 => 100.0, 21 => 400.0], $shares);
        $this->assertSame(800.0, array_sum($shares));
    }

    public function testTheResidualIsSettledOnceOverTheWholeConsignment(): void
    {
        // Three lines of equal value and 100: 33.3333 each leaves a paisa, placed once.
        $shares = DocumentPostingService::allocateCharge(100.0, [11 => 1.0, 21 => 1.0, 31 => 1.0]);

        $this->assertSame(100.0, round(array_sum($shares), 4));
        $this->assertCount(3, $shares);
    }

    // ------------------------------------------------------------------ the equal basis

    /**
     * 'equal' is implemented as a weight of 1 per line rather than a division, so the one allocator,
     * the one rounding rule and the one residual placement serve it too.
     */
    public function testEqualGivesEveryLineTheSameShare(): void
    {
        $this->assertSame([11 => 25.0, 12 => 25.0, 13 => 25.0, 14 => 25.0], DocumentPostingService::allocateCharge(100.0, [11 => 1.0, 12 => 1.0, 13 => 1.0, 14 => 1.0]));
    }

    public function testEqualIsAnAllocationBasisTheContractAccepts(): void
    {
        $this->assertContains('equal', DocumentService::LANDED_COST_BASES);
    }

    /** Weight is still not one, and the refusal still says why. */
    public function testWeightIsStillNotAnAllocationBasis(): void
    {
        $this->assertNotContains('weight', DocumentService::LANDED_COST_BASES);
    }
}
