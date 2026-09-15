<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\ItemsController;
use App\Exceptions\InventoryException;
use PHPUnit\Framework\TestCase;

/**
 * The item-level ITC attribute: `inherit | claim | block`.
 *
 * Inventory STORES an attribute of the goods — this thing is a motor vehicle, this thing is a food
 * and beverage. It makes no tax determination, computes no tax consequence and holds no precedence
 * rule; Books reads the attribute, resolves it against the tax category, the purchase ledger and
 * the voucher line, and books the result. So the only behaviour there is to test here is the
 * vocabulary, the default, and the refusal.
 *
 * The refusal is the part that matters. Everything else out of range on the item row is quietly
 * corrected — an unknown negative_stock_policy becomes "company default", an unknown item_type
 * becomes "stock" — because the wrong answer there is a label. Here an unknown word would become
 * "inherit", a real third state, and a caller who typed "blocked" would be told nothing while Books
 * went on claiming a credit the item was meant to block. A tax claim is the one thing that must not
 * be decided by a silent coercion.
 *
 * @group unit
 */
final class ItemItcEligibilityTest extends TestCase
{
    private function normalize(mixed $value): string
    {
        return ItemsController::normalizeItcEligibility($value);
    }

    private function refusal(callable $fn): InventoryException
    {
        try {
            $fn();
        } catch (InventoryException $e) {
            return $e;
        }
        $this->fail('expected a validation refusal');
    }

    public function testTheVocabularyIsExactlyTheThreeStates(): void
    {
        $this->assertSame(['inherit', 'claim', 'block'], ItemsController::ITC_ELIGIBILITY);
    }

    /** Nothing said = inherit. Every item that existed before the attribute did is on this. */
    public function testAnAbsentValueIsInherit(): void
    {
        $this->assertSame('inherit', $this->normalize(null));
        $this->assertSame('inherit', $this->normalize(''));
        $this->assertSame('inherit', $this->normalize('   '));
        $this->assertSame('inherit', $this->normalize(false));
    }

    public function testEachStateIsKept(): void
    {
        $this->assertSame('inherit', $this->normalize('inherit'));
        $this->assertSame('claim', $this->normalize('claim'));
        $this->assertSame('block', $this->normalize('block'));
    }

    public function testCaseAndSurroundingSpaceDoNotMatter(): void
    {
        $this->assertSame('block', $this->normalize(' BLOCK '));
        $this->assertSame('claim', $this->normalize('Claim'));
    }

    /**
     * The defect this guards: a near-miss silently becoming 'inherit'. "blocked" is the word a
     * person actually types, and under a coercion it would read back as "the item says nothing".
     */
    public function testANearMissIsRefusedRatherThanSilentlyBecomingInherit(): void
    {
        $e = $this->refusal(fn () => $this->normalize('blocked'));

        $this->assertSame('validation_failed', $e->errorCode());
        $this->assertSame(422, $e->httpStatus());
        $this->assertStringContainsString('itc_eligibility', $e->getMessage());
        $this->assertSame(['inherit', 'claim', 'block'], $e->details()['allowed'] ?? null);
        $this->assertSame('blocked', $e->details()['received'] ?? null);
    }

    public function testAnotherProductsVocabularyIsRefusedToo(): void
    {
        $this->assertStringContainsString('inherit, claim, block', $this->refusal(fn () => $this->normalize('ineligible'))->getMessage());
        $this->assertStringContainsString('inherit, claim, block', $this->refusal(fn () => $this->normalize('yes'))->getMessage());
    }

    /**
     * A structured value is nonsense for a three-word enum: it must not fatal on a cast, and it
     * must not be quietly read as silence either.
     *
     * `{"itc_eligibility": ["block"]}` is the shape a JSON mapping bug produces, and coercing it
     * to 'inherit' was the one door left open in the rule this guard states for itself four lines
     * above: the scalar near-miss 'blocked' was refused with a 422 while this was accepted, stored
     * as 'inherit' and shown on the item screen as "Inherit — let Books decide". The operator
     * believes the item blocks the credit; Books resolves inherit and goes on claiming it.
     */
    public function testANonScalarValueIsRefusedRatherThanReadAsSilence(): void
    {
        foreach ([['claim'], ['block'], ['value' => 'block'], (object) ['value' => 'block'], []] as $value) {
            $e = $this->refusal(fn () => $this->normalize($value));
            $this->assertStringContainsString('inherit, claim, block', $e->getMessage());
        }
    }

}
