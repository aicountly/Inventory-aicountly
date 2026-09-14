<?php

namespace Tests\Unit;

use App\Services\DocumentPostingService;
use App\Services\PackingService;
use PHPUnit\Framework\TestCase;

/**
 * One packed consignment may be invoiced once.
 *
 * The packed bucket is not a ledger: it holds goods set aside for a named customer. Nothing used
 * to close a packing list when a sale issued it — markConsumed() had no callers at all — so a
 * second sales invoice could name the same list and issue the same consignment again, taking the
 * goods out of whatever other packed stock happened to exist while both lists stayed open.
 *
 * @group unit
 */
final class PackingListConsumptionGuardTest extends TestCase
{
    private const CONSUMER = 4242;

    /** @param array<string, mixed> $meta */
    private function refusal(array $meta, int $consumingDocumentId = self::CONSUMER): ?string
    {
        return PackingService::consumptionRefusal($meta, $consumingDocumentId);
    }

    public function testAnOpenOrLockedListMayBeConsumed(): void
    {
        $this->assertNull($this->refusal(['packing_status' => 'open', 'locked_by_document_id' => null]));
        $this->assertNull($this->refusal(['packing_status' => 'locked', 'locked_by_document_id' => null]));
    }

    public function testASecondInvoiceCannotConsumeTheSameList(): void
    {
        $refusal = $this->refusal(['packing_status' => 'consumed', 'locked_by_document_id' => 900]);

        $this->assertNotNull($refusal, 'the second invoice would issue a consignment that has already left');
        $this->assertStringContainsString('#900', (string) $refusal, 'the refusal names the invoice that took it');
    }

    public function testRepostingTheSameInvoiceIsIdempotent(): void
    {
        $this->assertNull($this->refusal(['packing_status' => 'consumed', 'locked_by_document_id' => self::CONSUMER]));
    }

    public function testAnUnpackedListHasNothingLeftToIssue(): void
    {
        $this->assertNotNull($this->refusal(['packing_status' => 'unpacked', 'locked_by_document_id' => null]));
    }

    public function testOnlyASalesIssueConsumesTheListItLinks(): void
    {
        $linked = ['linked_source_document_id' => 77];

        $this->assertSame(77, PackingService::consumedListId('SALES_ISSUE', $linked));
        // A credit note links the invoice it reverses through the same key, and an inward challan
        // links the deferred purchase it settles; neither ever took goods out of a packed bucket.
        $this->assertSame(0, PackingService::consumedListId('SALES_RETURN', $linked));
        $this->assertSame(0, PackingService::consumedListId('INWARD_CHALLAN', $linked));
        $this->assertSame(0, PackingService::consumedListId('SALES_ISSUE', null));
        $this->assertSame(0, PackingService::consumedListId('SALES_ISSUE', []));
    }

    /**
     * The decision above is only worth anything if posting asks for it, so pin the wiring: a
     * guard nothing calls is exactly what this finding was.
     */
    public function testPostingConsumesTheLinkedListAndReversalGivesItBack(): void
    {
        $packing = null;
        foreach ((new \ReflectionMethod(DocumentPostingService::class, '__construct'))->getParameters() as $p) {
            if ((string) $p->getType() === '?' . PackingService::class) {
                $packing = $p->getName();
            }
        }
        $this->assertSame('packing', $packing, 'posting must hold the packing list service');

        $source = (string) file_get_contents((string) (new \ReflectionClass(DocumentPostingService::class))->getFileName());
        $this->assertStringContainsString('$this->packing->consumeForSale(', $source);
        $this->assertStringContainsString('$this->packing->releaseConsumedBy(', $source);
    }
}
