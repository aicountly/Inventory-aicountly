<?php

namespace Tests\Unit;

use App\Exceptions\InventoryException;
use App\Services\DocumentService;
use App\Services\InventorySettingsService;
use PHPUnit\Framework\TestCase;

/**
 * The company-level landed-cost capitalisation policy: which charges this company puts into the
 * cost of stock.
 *
 * Deciding whether freight, insurance or customs is part of what inventory cost is an accounting
 * policy of the company that holds the stock. It is not a per-voucher decision, and it is not the
 * billing product's to make — Books captures a charge and allocates it; Inventory decides whether
 * that kind of charge belongs in stock value at all.
 *
 * Two rules are load-bearing and both are asserted here rather than only described:
 *
 *   1. non_creditable_tax is not a switch. Under AS-2 the cost of purchase includes taxes that are
 *      not recoverable from the authority, so a company cannot elect to keep them out of stock. A
 *      switch would create a third state where those rupees are neither a recoverable credit nor a
 *      cost and simply vanish. The choice is made upstream in Books, by declaring the ITC claimable
 *      or not.
 *   2. An excluded type is REFUSED, never accepted-and-dropped. A cost quietly left out of stock
 *      value is a closing stock short by exactly that amount with nobody told.
 *
 * No database: this is the vocabulary and the refusal, both pure.
 *
 * @group unit
 */
final class LandedCostPolicyTest extends TestCase
{
    private function refusal(callable $fn): InventoryException
    {
        try {
            $fn();
        } catch (InventoryException $e) {
            return $e;
        }
        $this->fail('expected a validation refusal');
    }

    // ------------------------------------------------------------------ the vocabulary

    public function testTheSwitchableTypesAreEveryTypeExceptTheTaxOne(): void
    {
        $this->assertSame(
            DocumentService::LANDED_COST_TYPES,
            InventorySettingsService::landedCostTypes(),
            'the policy knows exactly the cost types a document may carry — no more, no fewer',
        );
        $this->assertSame(['non_creditable_tax'], InventorySettingsService::LANDED_COST_ALWAYS_CAPITALISED);
        $this->assertSame(
            ['freight', 'duty', 'insurance', 'handling', 'other'],
            InventorySettingsService::LANDED_COST_SWITCHABLE_TYPES,
        );
        $this->assertNotContains('non_creditable_tax', InventorySettingsService::LANDED_COST_SWITCHABLE_TYPES);
    }

    // ------------------------------------------------------------------ reading the stored set

    /** NULL, '' and a column that does not exist yet all mean "nothing excluded" — the default. */
    public function testAnEmptyPolicyExcludesNothing(): void
    {
        $this->assertSame([], InventorySettingsService::parseExcludedTypes(null));
        $this->assertSame([], InventorySettingsService::parseExcludedTypes(''));
        $this->assertSame([], InventorySettingsService::parseExcludedTypes([]));
    }

    public function testTheStoredSetIsReadFromAListOrACommaSeparatedString(): void
    {
        $this->assertSame(['freight', 'insurance'], InventorySettingsService::parseExcludedTypes('freight,insurance'));
        $this->assertSame(['freight', 'insurance'], InventorySettingsService::parseExcludedTypes(['freight', 'insurance']));
        $this->assertSame(['freight'], InventorySettingsService::parseExcludedTypes(' FREIGHT '));
    }

    /**
     * Ordered by the vocabulary and de-duplicated, so two equal policies compare equal and the
     * stored string does not depend on the order a screen happened to send the checkboxes in.
     */
    public function testTheStoredSetIsOrderedAndDeduplicated(): void
    {
        $this->assertSame(
            ['freight', 'duty', 'other'],
            InventorySettingsService::parseExcludedTypes(['other', 'freight', 'duty', 'freight']),
        );
    }

    /**
     * Reading is forgiving on purpose: a column holding a word a later release dropped from the
     * vocabulary must not make the settings unreadable. Writing is not — see the next test.
     */
    public function testReadingDropsAWordOutsideTheVocabulary(): void
    {
        $this->assertSame(['duty'], InventorySettingsService::parseExcludedTypes('duty,weight,non_creditable_tax'));
    }

    // ------------------------------------------------------------------ writing the policy

    public function testEverySwitchableTypeMayBeExcluded(): void
    {
        InventorySettingsService::assertExcludableTypes(InventorySettingsService::LANDED_COST_SWITCHABLE_TYPES);
        InventorySettingsService::assertExcludableTypes(null);
        InventorySettingsService::assertExcludableTypes('');
        $this->addToAssertionCount(1);
    }

    /** The rule the whole design turns on, and the reason has to be in the message. */
    public function testNonCreditableTaxCannotBeSwitchedOff(): void
    {
        $e = $this->refusal(static fn () => InventorySettingsService::assertExcludableTypes(['freight', 'non_creditable_tax']));

        $this->assertSame('validation_failed', $e->errorCode());
        $this->assertStringContainsString('non_creditable_tax', $e->getMessage());
        $this->assertStringContainsString('AS-2', $e->getMessage());
        $this->assertStringContainsString('Books', $e->getMessage(), 'the message says where the real choice is made');
        $this->assertSame('non_creditable_tax', $e->details()['cost_type'] ?? null);
    }

    public function testAWordOutsideTheVocabularyIsRefusedOnWrite(): void
    {
        $e = $this->refusal(static fn () => InventorySettingsService::assertExcludableTypes('freight,weight'));

        $this->assertStringContainsString('weight', $e->getMessage());
        $this->assertStringContainsString('is not a landed cost type', $e->getMessage());
    }

    // ------------------------------------------------------------------ the refusal at intake

    public function testACapitalisableTypePassesThrough(): void
    {
        DocumentService::assertCostTypeCapitalisable('freight', ['freight', 'duty', 'non_creditable_tax'], 'Line 1');
        $this->addToAssertionCount(1);
    }

    public function testAnExcludedTypeIsRefusedWithItsNameAndThePolicy(): void
    {
        $e = $this->refusal(static fn () => DocumentService::assertCostTypeCapitalisable('freight', ['duty', 'non_creditable_tax'], 'Line 4'));

        $this->assertSame('validation_failed', $e->errorCode());
        $this->assertSame(422, $e->httpStatus());
        $this->assertStringContainsString('Line 4', $e->getMessage());
        $this->assertStringContainsString('freight', $e->getMessage());
        $this->assertSame('freight', $e->details()['cost_type'] ?? null);
        $this->assertSame(['duty', 'non_creditable_tax'], $e->details()['capitalisable_cost_types'] ?? null);
        $this->assertSame('landed_cost_excluded_types', $e->details()['setting'] ?? null);
    }

    // ------------------------------------------------------------------ the policy over a whole line

    public function testALineWithNoLandedCostIsNotAskedAnything(): void
    {
        // Not even 'other' has to be switched on for a line that carries nothing.
        DocumentService::assertLandedCostPolicy(0.0, [], [], 'Line 1');
        $this->addToAssertionCount(1);
    }

    public function testEveryBreakdownEntryIsChecked(): void
    {
        $breakdown = [
            ['cost_type' => 'freight', 'amount' => 100.0, 'allocation_basis' => 'value'],
            ['cost_type' => 'insurance', 'amount' => 50.0, 'allocation_basis' => 'value'],
        ];

        DocumentService::assertLandedCostPolicy(150.0, $breakdown, ['freight', 'insurance', 'non_creditable_tax'], 'Line 2');

        $e = $this->refusal(static fn () => DocumentService::assertLandedCostPolicy(150.0, $breakdown, ['freight', 'non_creditable_tax'], 'Line 2'));
        $this->assertStringContainsString('insurance', $e->getMessage(), 'the second entry is checked too, not only the first');
    }

    /**
     * An amount with no breakdown is capitalised as an 'other' charge
     * (DocumentPostingService::receiptBorneShares), so that is the type the policy is asked about.
     * A company that switched 'other' off has said it does not capitalise charges it cannot name.
     */
    public function testAnAmountWithNoBreakdownIsCheckedAsOther(): void
    {
        DocumentService::assertLandedCostPolicy(250.0, [], ['other', 'non_creditable_tax'], 'Line 5');

        $e = $this->refusal(static fn () => DocumentService::assertLandedCostPolicy(250.0, [], ['freight', 'non_creditable_tax'], 'Line 5'));
        $this->assertStringContainsString('no breakdown', $e->getMessage());
        $this->assertStringContainsString('other', $e->getMessage());
        $this->assertSame(250.0, $e->details()['landed_cost_amount'] ?? null);
    }

    /**
     * The one type that is always on: a company may exclude everything else and a non-creditable
     * tax still reaches stock.
     */
    public function testNonCreditableTaxIsCapitalisedEvenWhenEverythingElseIsOff(): void
    {
        DocumentService::assertLandedCostPolicy(
            134.56,
            [['cost_type' => 'non_creditable_tax', 'amount' => 134.56, 'allocation_basis' => 'direct']],
            ['non_creditable_tax'],
            'Line 1',
        );
        $this->addToAssertionCount(1);
    }
}
