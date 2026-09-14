<?php

namespace Tests\Unit;

use App\Services\DocumentPostingService;
use PHPUnit\Framework\TestCase;

/**
 * Stock may not enter at zero cost without anyone being told.
 *
 * A job-work receipt is the ordinary way to reach it: the challan rate beside the cost column is
 * commercial and refused as a cost, JOB_WORK_OUT books no consumption to inherit a cost from, and
 * for a finished good that only ever arrives from a job worker the first receipt has no cost
 * layer, no weighted average and no earlier inward line either. Every one of those is correct on
 * its own; together they used to post a receipt valued at nothing, which understates closing stock
 * now and COGS when that layer is issued, and said nothing at all about it.
 *
 * @group unit
 */
final class ZeroCostInwardWarningTest extends TestCase
{
    private const ITEM = 90;

    private const LINE = 4410;

    /** @return array<string, mixed>|null */
    private function warning(float $unitCost, string $type = 'JOB_WORK_IN'): ?array
    {
        return DocumentPostingService::zeroInwardCostWarning($type, self::ITEM, self::LINE, $unitCost);
    }

    public function testAReceiptWithNoKnownCostIsReported(): void
    {
        $warning = $this->warning(0.0);

        $this->assertNotNull($warning, 'a receipt valued at nothing is not a silent event');
        $this->assertSame('zero_valuation_inward', $warning['code']);
        $this->assertStringContainsString('#' . self::ITEM, (string) $warning['message']);
        $this->assertSame(['item_id' => self::ITEM, 'line_id' => self::LINE, 'document_type' => 'JOB_WORK_IN'], $warning['details']);
    }

    public function testACostedReceiptWarnsAboutNothing(): void
    {
        $this->assertNull($this->warning(610.0));
        $this->assertNull($this->warning(0.0001));
    }

    /** Not a job-work problem: any inward line of a valuation-bearing type entering at zero counts. */
    public function testAnyInwardLineEnteringAtZeroIsReported(): void
    {
        $this->assertNotNull($this->warning(0.0, 'PRODUCTION'));
        $this->assertSame('MATERIAL_RECEIPT', $this->warning(0.0, 'MATERIAL_RECEIPT')['details']['document_type']);
    }

    /**
     * A warning nothing raises is exactly what this finding was, so pin the wiring: posting asks
     * for it where it resolves the inward cost, and puts the answer in the document's warnings.
     */
    public function testPostingRaisesItWhereItResolvesTheInwardCost(): void
    {
        $method = new \ReflectionMethod(DocumentPostingService::class, 'applyPosting');
        $source = (array) file((string) $method->getFileName());
        $body = implode('', array_slice($source, $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1));

        $this->assertStringContainsString('$this->inwardUnitCost(', $body);
        $this->assertStringContainsString('zeroInwardCostWarning(', $body);
        $this->assertMatchesRegularExpression('/zeroInwardCostWarning\(.*\n(.*\n)?\s*\$warnings\[\] =/', $body, 'the warning must reach the posted document, not a local variable');
    }
}
