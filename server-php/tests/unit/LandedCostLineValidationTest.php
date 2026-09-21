<?php

namespace Tests\Unit;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use Config\DocumentTypeRegistry;
use PHPUnit\Framework\TestCase;

/**
 * A landed cost on a document line is never silently dropped.
 *
 * Books captures the charges (a freight bill is a payable), allocates them across the receipt lines
 * and sends Inventory a per-line rupee amount. Inventory consumes it as part of the cost of the
 * goods. Everything about the amount that cannot be consumed has to be a refusal with a reason:
 * an amount on a document type that carries no valuation, or on an outward line, has nowhere to go,
 * and accepting it quietly leaves a closing stock that is short by exactly that amount with nobody
 * told. That is the failure this whole split of ownership exists to prevent.
 *
 * @group unit
 */
final class LandedCostLineValidationTest extends TestCase
{
    /** @param array<string, mixed> $line */
    private function read(array $line): array
    {
        return DocumentService::landedCostFromLine($line, 3);
    }

    /** @return array<string, mixed> */
    private function refusal(callable $fn): InventoryException
    {
        try {
            $fn();
        } catch (InventoryException $e) {
            return $e;
        }
        $this->fail('expected a validation refusal');
    }

    // ------------------------------------------------------------------ reading the field

    public function testALineWithNoLandedCostCarriesNone(): void
    {
        $this->assertSame(['amount' => 0.0, 'breakdown' => []], $this->read(['item_id' => 7, 'qty' => 2]));
        $this->assertSame(['amount' => 0.0, 'breakdown' => []], $this->read(['landed_cost_amount' => null]));
        $this->assertSame(['amount' => 0.0, 'breakdown' => []], $this->read(['landed_cost_amount' => '']));
    }

    public function testTheAmountIsReadAndRoundedToFourPlaces(): void
    {
        $this->assertSame(1234.56, $this->read(['landed_cost_amount' => 1234.56])['amount']);
        $this->assertSame(1234.5679, $this->read(['landed_cost_amount' => '1234.56789'])['amount']);
        $this->assertSame(0.0, $this->read(['landed_cost_amount' => 0])['amount']);
    }

    /** A negative landing cost is a credit note, not a cost, and it has no allocator here. */
    public function testANegativeAmountIsRefused(): void
    {
        $e = $this->refusal(fn () => $this->read(['landed_cost_amount' => -1]));
        $this->assertStringContainsString('Line 3', $e->getMessage());
        $this->assertStringContainsString('cannot be negative', $e->getMessage());
    }

    public function testANonNumericAmountIsRefused(): void
    {
        $this->assertStringContainsString('must be a number', $this->refusal(fn () => $this->read(['landed_cost_amount' => 'free'])) ->getMessage());
    }

    // ------------------------------------------------------------------ the breakdown

    public function testTheBreakdownIsKeptWithItsCostTypesAndBases(): void
    {
        $read = $this->read([
            'landed_cost_amount' => 1234.56,
            'landed_cost_breakdown' => [
                ['cost_type' => 'freight', 'amount' => 800, 'allocation_basis' => 'value'],
                ['cost_type' => 'duty', 'amount' => 200, 'allocation_basis' => 'qty'],
                ['cost_type' => 'insurance', 'amount' => 100, 'allocation_basis' => 'value'],
                ['cost_type' => 'non_creditable_tax', 'amount' => 134.56, 'allocation_basis' => 'direct'],
            ],
        ]);

        $this->assertSame(1234.56, $read['amount']);
        $this->assertCount(4, $read['breakdown']);
        $this->assertSame(['cost_type' => 'freight', 'amount' => 800.0, 'allocation_basis' => 'value'], $read['breakdown'][0]);
        $this->assertSame('non_creditable_tax', $read['breakdown'][3]['cost_type']);
        $this->assertSame('direct', $read['breakdown'][3]['allocation_basis']);
    }

    /** A stored line comes back with the breakdown in its metadata, and update() re-reads it. */
    public function testTheBreakdownIsAlsoReadBackOutOfTheLinesMetadata(): void
    {
        $read = $this->read([
            'landed_cost_amount' => 500.0,
            'metadata' => ['landed_cost_breakdown' => [['cost_type' => 'handling', 'amount' => 500, 'allocation_basis' => 'qty']]],
        ]);

        $this->assertSame([['cost_type' => 'handling', 'amount' => 500.0, 'allocation_basis' => 'qty']], $read['breakdown']);
    }

    public function testEveryCostTypeInTheContractIsAccepted(): void
    {
        foreach (DocumentService::LANDED_COST_TYPES as $costType) {
            $read = $this->read(['landed_cost_amount' => 10, 'landed_cost_breakdown' => [['cost_type' => $costType, 'amount' => 10, 'allocation_basis' => 'value']]]);
            $this->assertSame($costType, $read['breakdown'][0]['cost_type']);
        }
        $this->assertSame(['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'], DocumentService::LANDED_COST_TYPES);
    }

    public function testEveryAllocationBasisInTheContractIsAccepted(): void
    {
        foreach (DocumentService::LANDED_COST_BASES as $basis) {
            $read = $this->read(['landed_cost_amount' => 10, 'landed_cost_breakdown' => [['cost_type' => 'other', 'amount' => 10, 'allocation_basis' => $basis]]]);
            $this->assertSame($basis, $read['breakdown'][0]['allocation_basis']);
        }
        $this->assertSame(['value', 'qty', 'equal', 'manual', 'direct'], DocumentService::LANDED_COST_BASES);
    }

    /** Value is the default basis, so a breakdown entry that omits it is not a hole. */
    public function testAMissingBasisMeansProRataByValue(): void
    {
        $read = $this->read(['landed_cost_amount' => 10, 'landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 10]]]);
        $this->assertSame('value', $read['breakdown'][0]['allocation_basis']);
    }

    public function testAnUnknownCostTypeIsRefusedWithTheAllowedList(): void
    {
        $e = $this->refusal(fn () => $this->read(['landed_cost_amount' => 10, 'landed_cost_breakdown' => [['cost_type' => 'demurrage', 'amount' => 10]]]));
        $this->assertStringContainsString('demurrage', $e->getMessage());
        $this->assertStringContainsString('non_creditable_tax', $e->getMessage());
    }

    /**
     * Weight is the one a user will reach for and it is deliberately not offered: there is no item
     * weight master to allocate by, so the control would silently fall back to something else.
     */
    public function testWeightIsNotAnAllocationBasis(): void
    {
        $e = $this->refusal(fn () => $this->read(['landed_cost_amount' => 10, 'landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 10, 'allocation_basis' => 'weight']]]));
        $this->assertStringContainsString('weight is not offered', $e->getMessage());
        $this->assertNotContains('weight', DocumentService::LANDED_COST_BASES);
    }

    public function testABreakdownThatDoesNotSumToTheAmountIsRefusedQuotingBoth(): void
    {
        $e = $this->refusal(fn () => $this->read([
            'landed_cost_amount' => 1000,
            'landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 800], ['cost_type' => 'duty', 'amount' => 150]],
        ]));
        $this->assertStringContainsString('950.0000', $e->getMessage());
        $this->assertStringContainsString('1000.0000', $e->getMessage());
    }

    /** One paisa either side is rounding; anything wider is a charge that was only partly sent. */
    public function testTheToleranceIsOnePaisaEitherWay(): void
    {
        $this->assertSame(1000.0, $this->read(['landed_cost_amount' => 1000, 'landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 1000.01]]])['amount']);
        $this->assertSame(1000.0, $this->read(['landed_cost_amount' => 1000, 'landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 999.99]]])['amount']);
        $this->refusal(fn () => $this->read(['landed_cost_amount' => 1000, 'landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 1000.02]]]));
        $this->refusal(fn () => $this->read(['landed_cost_amount' => 1000, 'landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 999.98]]]));
    }

    /** A breakdown with no amount alongside it is the same mismatch, and says so the same way. */
    public function testABreakdownWithNoAmountBesideItIsRefused(): void
    {
        $e = $this->refusal(fn () => $this->read(['landed_cost_breakdown' => [['cost_type' => 'freight', 'amount' => 800]]]));
        $this->assertStringContainsString('800.0000', $e->getMessage());
        $this->assertStringContainsString('0.0000', $e->getMessage());
    }

    // ------------------------------------------------------------------ where it may be carried

    /** @param array<string, mixed>|null $spec */
    private function allow(string $type, string $direction, float $amount = 500.0, string $stockEffect = ''): void
    {
        DocumentService::assertLandedCostAllowed($type, DocumentTypeRegistry::get($type), $stockEffect, $direction, $amount, 2);
    }

    public function testAnInwardLineOfAValuedTypeCarriesIt(): void
    {
        $this->allow('PURCHASE_RECEIPT', 'in');
        $this->allow('OPENING_STOCK', 'in');
        $this->allow('MATERIAL_RECEIPT', 'in');
        $this->addToAssertionCount(3);
    }

    public function testAnOutwardLineIsRefusedNamingTheLine(): void
    {
        $e = $this->refusal(fn () => $this->allow('SALES_ISSUE', 'out'));
        $this->assertStringContainsString('Line 2', $e->getMessage());
        $this->assertStringContainsString('cannot be carried on an outward line', $e->getMessage());
    }

    /**
     * A transfer turns ONE entered line into an out row and an in row. Validating the payload line
     * would see whatever direction the payload named; validating the emitted rows catches the out
     * leg, which is the one that would have dropped the cost.
     */
    public function testTheOutLegATransferGeneratesIsRefused(): void
    {
        $this->assertStringContainsString('outward line', $this->refusal(fn () => $this->allow('STOCK_TRANSFER', 'out'))->getMessage());
    }

    /**
     * An inward challan values only the stock it actually moves (VALUES_MOVED_STOCK), so the type
     * itself carries no valuation and a charge on one has nothing to join. It is refused with the
     * route that does work — a LANDED_COST document against the receipt that valued the goods.
     */
    public function testATypeThatCarriesNoValuationIsRefusedWithTheRouteThatWorks(): void
    {
        $e = $this->refusal(fn () => $this->allow('INWARD_CHALLAN', 'in'));
        $this->assertStringContainsString('Inward Challan', $e->getMessage());
        $this->assertStringContainsString('does not carry valuation', $e->getMessage());
        $this->assertStringContainsString('LANDED_COST', $e->getMessage());
    }

    public function testADirectionlessStatusLineIsRefused(): void
    {
        $this->assertStringContainsString('outward line', $this->refusal(fn () => $this->allow('REVALUATION', 'none'))->getMessage());
    }

    /** Nothing is refused when there is nothing to carry. */
    public function testZeroIsNotACostAndIsAllowedAnywhere(): void
    {
        $this->allow('SALES_ISSUE', 'out', 0.0);
        $this->allow('INWARD_CHALLAN', 'in', 0.0);
        $this->allow('BATCH_ADJUSTMENT', 'none', 0.0);
        $this->addToAssertionCount(3);
    }

    /**
     * A type that values its lines but DEFERS the movement accepts nothing either, because posting
     * skips its whole valuation block and the amount vanishes without a trace.
     *
     * This is the case the registry flag alone cannot see. A defer_inward purchase declares
     * valuation => true and emits an inward row, so the first two questions pass; then posting
     * moves no stock, values no line, writes no allocation row, and the goods enter later on the
     * settling inward challan, which costs them from the purchase's RATE
     * (deferredPurchaseUnitCost selects qty, base_qty, conversion_factor, valuation_rate and the
     * two source_transaction_* columns — no landed cost among them). The layer opens at the bare
     * purchase rate and closing stock is short by exactly the charge, which is the one outcome
     * this class exists to make impossible.
     */
    public function testATypeThatDefersItsMovementIsRefusedRatherThanDroppingTheCost(): void
    {
        $e = $this->refusal(fn () => $this->allow('PURCHASE_RECEIPT', 'in', 500.0, 'defer_inward'));
        $this->assertStringContainsString('Line 2', $e->getMessage());
        $this->assertStringContainsString('defer_inward', $e->getMessage());
        $this->assertStringContainsString('moves no stock when it posts', $e->getMessage());
        $this->assertStringContainsString('LANDED_COST', $e->getMessage());

        // The same purchase on its ordinary stock effects values the line at once and takes it.
        $this->allow('PURCHASE_RECEIPT', 'in', 500.0, 'on_invoice');
        $this->allow('PURCHASE_RECEIPT', 'in', 500.0, 'from_challan');
        $this->addToAssertionCount(2);
    }

    /** The same shape from the other side: goods that arrived on a physical challan, not here. */
    public function testAReturnSettledFromAPhysicalChallanIsRefusedToo(): void
    {
        $e = $this->refusal(fn () => $this->allow('SALES_RETURN', 'in', 500.0, 'from_physical_challan'));
        $this->assertStringContainsString('from_physical_challan', $e->getMessage());
        $this->assertStringContainsString('moves no stock when it posts', $e->getMessage());
        $this->allow('SALES_RETURN', 'in', 500.0, 'on_invoice');
        $this->addToAssertionCount(1);
    }

    /**
     * The load-bearing one. Every refusal above exists so that no path accepts the amount and then
     * throws it away: for each place a landed cost may not be carried, entry raises rather than
     * returning a zero that posting would never notice.
     *
     * The right-hand side is NOT the entry guard's own predicate restated — that would pass however
     * wrong both were. It is rebuilt from the three separate posting-side decisions that stand
     * between a stored amount and a cost layer, in the order applyPosting() asks them: does this
     * document move its stock now (the block runs at all), does it value the lines it moves, and
     * does landedCostOnLine() let the stored amount through. If any of the three drifts away from
     * what entry accepts, this fails.
     */
    public function testALandedCostIsNeverSilentlyDropped(): void
    {
        $effects = ['', 'on_invoice', 'from_challan', 'defer_inward', 'challan_only', 'settle_deferred', 'physical', 'from_packing', 'from_physical_challan'];
        $dropped = [];
        foreach (DocumentTypeRegistry::TYPES as $type => $spec) {
            foreach ($effects as $effect) {
                foreach (['in', 'out', 'none'] as $direction) {
                    $accepted = true;
                    try {
                        DocumentService::assertLandedCostAllowed($type, $spec, $effect, $direction, 750.0, 1);
                    } catch (InventoryException) {
                        $accepted = false;
                    }
                    $capitalised = $direction === 'in'
                        && DocumentPostingService::movesStockNow($type, $spec, $effect)
                        && DocumentPostingService::valuesLines($type, $spec, $effect)
                        && DocumentPostingService::landedCostOnLine(['landed_cost_amount' => 750.0], $spec, $direction) > 0;
                    if ($accepted !== $capitalised) {
                        $dropped[] = $type . '/' . ($effect ?: '-') . '/' . $direction . ($accepted ? ' accepted' : ' refused');
                    }
                }
            }
        }

        $this->assertSame([], $dropped, 'these accept a landed cost that posting would not capitalise, or refuse one it would');
    }

    /**
     * And the second line of defence, asked of the rows AS STORED: a landed cost that reached a
     * line by some path that is not create() — a migration, a repair by hand — stops the posting
     * rather than being thrown away by it.
     */
    public function testPostingRefusesAStoredLandedCostItCannotCapitalise(): void
    {
        $spec = DocumentTypeRegistry::get('PURCHASE_RECEIPT');
        $lines = [['line_id' => 44, 'direction' => 'in', 'landed_cost_amount' => 250.0]];

        DocumentPostingService::assertStoredLandedCostsCanBeCapitalised('PURCHASE_RECEIPT', $spec, 'on_invoice', $lines);
        $this->addToAssertionCount(1);

        $e = $this->refusal(fn () => DocumentPostingService::assertStoredLandedCostsCanBeCapitalised('PURCHASE_RECEIPT', $spec, 'defer_inward', $lines));
        $this->assertStringContainsString('Line #44', $e->getMessage());
        $this->assertStringContainsString('250.0000', $e->getMessage());
        $this->assertStringContainsString('cannot capitalise', $e->getMessage());

        // Nothing to carry, nothing to refuse.
        DocumentPostingService::assertStoredLandedCostsCanBeCapitalised('PURCHASE_RECEIPT', $spec, 'defer_inward', [['line_id' => 44, 'direction' => 'in', 'landed_cost_amount' => 0]]);
        $this->addToAssertionCount(1);
    }
}
