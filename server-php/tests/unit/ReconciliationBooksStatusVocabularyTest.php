<?php

namespace Tests\Unit;

use App\Services\ReconciliationService;
use PHPUnit\Framework\TestCase;

/**
 * The words Books answers the posting-status call with, and what this side makes of them.
 *
 * Books does not answer POSTED / CANCELLED / PENDING. It answers a composite of what happened on
 * both sides — CANCELLED_BOTH, CANCELLED_IN_BOOKS, INVENTORY_PENDING, REVERSAL_PENDING, MIGRATED,
 * INVENTORY_NATIVE — and not one of them was in the normaliser. Every one of them normalised to
 * UNKNOWN, and UNKNOWN was then reported as agreement: a voucher cancelled in Books read as a
 * document Inventory had reversed on its own, and a handover Books had not finished read IN_SYNC.
 *
 * The literals below are the ones InventoryIntegrationController::postingStatus() emits in the
 * Books tree (its side of the contract is pinned there by
 * tests/unit/Inventory/PostingStatusCoversMigratedNativeTypesTest.php). They are spelled out
 * rather than derived, because the point of the test is to catch the two vocabularies parting.
 *
 * @group unit
 */
final class ReconciliationBooksStatusVocabularyTest extends TestCase
{
    /** @return array<string, array{0:string, 1:string}> */
    public static function booksVocabulary(): array
    {
        return [
            'posted before cutover'          => ['MIGRATED', 'POSTED'],
            'type Inventory owns now'        => ['INVENTORY_NATIVE', 'POSTED'],
            'posted and acknowledged'        => ['COMPLETED', 'POSTED'],
            'cancelled on both sides'        => ['CANCELLED_BOTH', 'CANCELLED'],
            'cancelled in Books only'        => ['CANCELLED_IN_BOOKS', 'CANCELLED'],
            'reversed'                       => ['REVERSED', 'CANCELLED'],
            'handed over, not posted yet'    => ['INVENTORY_PENDING', 'PENDING'],
            'reversal handed over'           => ['REVERSAL_PENDING', 'PENDING'],
            'handover failed'                => ['FAILED', 'FAILED'],
        ];
    }

    /**
     * @dataProvider booksVocabulary
     */
    public function testEveryStatusBooksEmitsIsRecognised(string $booksStatus, string $expected): void
    {
        $this->assertSame($expected, ReconciliationService::normalizeBooksStatus($booksStatus), $booksStatus . ' is a status Books answers with');
    }

    /**
     * Both sides cancelled is a closed case; REVERSED_INVENTORY says Inventory reversed a document
     * Books still stands behind, which is an operator's problem to chase.
     */
    public function testACancellationBooksReportsIsNotReadAsAnInventoryOnlyReversal(): void
    {
        $this->assertSame('CANCELLED_BOTH', ReconciliationService::compositeStatus('CANCELLED', 'CANCELLED_BOTH', true));
        $this->assertSame('CANCELLED_BOTH', ReconciliationService::compositeStatus('REVERSED', 'CANCELLED_IN_BOOKS', true));
        $this->assertSame('REVERSED_INVENTORY', ReconciliationService::compositeStatus('REVERSED', 'COMPLETED', true), 'Books still holds the voucher');
    }

    /** The Books voucher is cancelled and the inventory document is still posted: the stock is wrong. */
    public function testAVoucherCancelledInBooksAloneIsFlagged(): void
    {
        $this->assertSame('CANCELLED_IN_BOOKS', ReconciliationService::compositeStatus('POSTED', 'CANCELLED_IN_BOOKS', true));
    }

    /** A handover Books has not settled is work outstanding, not agreement. */
    public function testAHandoverBooksHasNotFinishedIsNotInSync(): void
    {
        $this->assertSame('PENDING_IN_BOOKS', ReconciliationService::compositeStatus('POSTED', 'INVENTORY_PENDING', true));
        $this->assertSame('PENDING_IN_BOOKS', ReconciliationService::compositeStatus('POSTED', 'REVERSAL_PENDING', true));
    }

    /** History: the voucher is posted in Books, the migration made its document. Nothing to do. */
    public function testMigratedAndInventoryNativeHistoryIsInSync(): void
    {
        $this->assertSame('IN_SYNC', ReconciliationService::compositeStatus('POSTED', 'MIGRATED', true));
        $this->assertSame('IN_SYNC', ReconciliationService::compositeStatus('POSTED', 'INVENTORY_NATIVE', true));
    }

    /** A word this side does not know is the one thing that must not pass as agreement. */
    public function testAnUnrecognisedBooksStatusIsReportedRatherThanCalledInSync(): void
    {
        $this->assertSame('BOOKS_STATUS_UNKNOWN', ReconciliationService::compositeStatus('POSTED', 'SOMETHING_BOOKS_ADDED', true));
        $this->assertSame('UNKNOWN', ReconciliationService::normalizeBooksStatus('SOMETHING_BOOKS_ADDED'));
    }

    /** MISSING_IN_BOOKS still has to mean what it says: Books reported nothing at all for it. */
    public function testASourceBooksDoesNotReportAtAllIsStillMissing(): void
    {
        $this->assertSame('MISSING_IN_BOOKS', ReconciliationService::compositeStatus('POSTED', null, true));
        $this->assertSame('BOOKS_UNAVAILABLE', ReconciliationService::compositeStatus('POSTED', null, false));
    }
}
