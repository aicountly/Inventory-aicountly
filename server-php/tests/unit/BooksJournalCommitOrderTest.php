<?php

namespace Tests\Unit;

use App\Services\DocumentPostingService;
use App\Services\OutboxService;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * The commit ordering of a stock posting, pinned in place.
 *
 * INVENTORY COMMITS FIRST, BOOKS LAST. There is always a last commit and it can always fail;
 * the question is only which failure is cheaper to repair.
 *
 *   Books last and it fails      Inventory holds the document, Books has no journal. The repair
 *                                is re-sending the event — idempotent on its event_uuid — or
 *                                reversing the document, which is a routine act in Inventory.
 *   Inventory last and it fails  Books holds a journal for stock that never moved. The repair is
 *                                reversing a general-ledger entry: two permanent entries in the
 *                                statutory books.
 *
 * The side whose failure repairs cleanly is the side allowed to fail. Reordering these two
 * statements is a one-line change that nothing else in the suite would notice, and it would move
 * every future failure into the statutory books — which is why it is asserted here directly.
 *
 * post() needs the whole valuation engine and a PostgreSQL schema to run, so the ordering is
 * read off the method itself. BooksJournalHandoffTest covers the behaviour either side of it.
 *
 * @group unit
 * @group architecture
 */
final class BooksJournalCommitOrderTest extends CIUnitTestCase
{
    public function testTheDocumentIsCommittedBeforeBooksIsAskedForTheJournal(): void
    {
        $src = self::methodSource(DocumentPostingService::class, 'post');

        $commit = strpos($src, '$db->transComplete()');
        $deliver = strpos($src, '$this->booksHandoff->deliver(');

        $this->assertNotFalse($commit, 'post() must still commit its own transaction');
        $this->assertNotFalse($deliver, 'post() must offer the journal to Books before reporting success');
        $this->assertGreaterThan(
            $commit,
            $deliver,
            'Books is asked LAST. Asking it before Inventory commits lets Books accept a journal for a document Inventory then rolls back — a ledger entry for stock that never moved, whose only repair is two more permanent entries in the statutory books.',
        );
    }

    /**
     * (e) The durable row is written BEFORE the risky step.
     *
     * The orphan bug earlier in this project was a tracker row written on the connection whose
     * rollback it was meant to outlive. This one has the opposite job — it must survive a worker
     * killed between the commit and Books' answer — so it is claimed inside the document's
     * transaction and committed with it. Claimed after the call, it would be missing in exactly
     * the case it exists for.
     */
    public function testTheOutboxRowAndTheHandoffClaimAreOnDiskBeforeAnythingIsSent(): void
    {
        $src = self::methodSource(DocumentPostingService::class, 'post');

        $enqueue = strpos($src, "\$this->outbox->enqueue(\$cmpId, 'inventory.document.posted'");
        $claim = strpos($src, '->tracker()->claim(');
        $commit = strpos($src, '$db->transComplete()');
        $deliver = strpos($src, '$this->booksHandoff->deliver(');

        $this->assertNotFalse($enqueue, 'the outbox stays: it is the fallback that catches the residue');
        $this->assertNotFalse($claim, 'the handoff must be claimed, not assumed');
        $this->assertLessThan($commit, $enqueue, 'the event is written in the document transaction');
        $this->assertLessThan($commit, $claim, 'and so is the claim, or it dies with a rollback it was meant to outlive');
        $this->assertLessThan($deliver, $claim, 'the row names the risky step BEFORE it is taken, never after');
    }

    /**
     * revise() wraps reverse() + create() + post() in ONE transaction. A synchronous Books call
     * from inside it could have Books accept a journal for a document Inventory then rolls back,
     * so the decision to wait is taken from the transaction depth BEFORE the transaction opens.
     */
    public function testWhetherToWaitForBooksIsDecidedBeforeTheTransactionOpens(): void
    {
        $src = self::methodSource(DocumentPostingService::class, 'post');

        $depth = strpos($src, 'transDepth');
        $decide = strpos($src, '$waitForBooks = ');
        $start = strpos($src, '$db->transStart()');

        $this->assertNotFalse($depth, 'a nested post must be able to tell that it is nested');
        $this->assertNotFalse($decide);
        $this->assertLessThan($start, $depth, 'transDepth read after transStart() is always at least 1 and tells you nothing');
        $this->assertLessThan($start, $decide);
    }

    /** (e) again, for the repair: the reversal is claimed before it is attempted. */
    public function testTheReversalIsClaimedBeforeItIsAttempted(): void
    {
        $src = self::methodSource(DocumentPostingService::class, 'undoPostBooksWouldNotTake');

        $claim = strpos($src, 'claimReversal(');
        $reverse = strpos($src, '$this->reverse(');

        $this->assertNotFalse($claim);
        $this->assertNotFalse($reverse);
        $this->assertLessThan($reverse, $claim, 'the document is already committed; the row is the only thing that knows stock moved with no journal behind it');
    }

    /** (a) One channel. The synchronous send reuses the outbox row, it does not invent a second. */
    public function testTheSynchronousSendGoesThroughTheSameRowAndTheSameEnvelope(): void
    {
        $deliverNow = self::methodSource(OutboxService::class, 'deliverNow');
        $dispatch = self::methodSource(OutboxService::class, 'dispatch');

        $this->assertStringContainsString('inv_integration_events', $deliverNow, 'the synchronous send delivers the queued row itself');
        $this->assertStringContainsString('self::envelopeFor($row)', $deliverNow);
        $this->assertStringContainsString('self::envelopeFor($row)', $dispatch, 'both paths build the envelope in one place, so the event_uuid cannot drift');
        $this->assertStringContainsString('postEvent(', $deliverNow, 'and both use the endpoint that is already idempotent by event_id');
    }

    /** (f) outbox-dispatch runs every minute and must keep working unchanged. */
    public function testTheCronContractIsUnchanged(): void
    {
        $dispatch = new \ReflectionMethod(OutboxService::class, 'dispatch');
        $params = array_map(static fn ($p) => $p->getName(), $dispatch->getParameters());

        $this->assertSame(['limit', 'books', 'cmpId', 'stopOnFailure'], $params, 'inventory:outbox-dispatch calls dispatch($limit)');
        foreach (['limit', 'books', 'cmpId', 'stopOnFailure'] as $i => $name) {
            $this->assertTrue($dispatch->getParameters()[$i]->isOptional(), $name . ' must stay optional');
        }
        $src = self::methodSource(OutboxService::class, 'dispatch');
        foreach (["'sent'", "'failed'", "'dead'", "'skipped'"] as $key) {
            $this->assertStringContainsString($key, $src, 'the command reports ' . $key . ' to the cron monitor');
        }
    }

    private static function methodSource(string $class, string $method): string
    {
        $ref = new \ReflectionMethod($class, $method);
        $ref->setAccessible(true);
        $lines = file($ref->getFileName());

        return implode('', array_slice($lines, $ref->getStartLine() - 1, $ref->getEndLine() - $ref->getStartLine() + 1));
    }
}
