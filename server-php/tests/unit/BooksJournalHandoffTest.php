<?php

namespace Tests\Unit;

use App\Exceptions\InventoryException;
use App\Services\BooksApiClient;
use App\Services\BooksJournalHandoff;
use App\Services\BooksJournalHandoffTracker;
use App\Services\CrossServiceCallContext;
use App\Services\DocumentPostingService;
use App\Services\OutboxService;
use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * The synchronous Inventory -> Books journal handoff.
 *
 * Posting a stock document used to write the document, commit, and leave an outbox row that
 * Books turned into a journal up to a minute later. In that window stock had moved and no
 * accounting entry existed. The journal is now accepted by Books BEFORE the user is told the
 * post worked.
 *
 * These run against a real in-memory SQLite connection with DBDebug off — as deployed — so the
 * rows, the statuses and the ordering are the real ones, not a mock's opinion of them.
 *
 * @group unit
 */
final class BooksJournalHandoffTest extends CIUnitTestCase
{
    private BaseConnection $conn;

    /** @var array<string, mixed> */
    private array $savedConnections = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (!extension_loaded('sqlite3')) {
            $this->markTestSkipped('sqlite3 required');
        }
        CrossServiceCallContext::reset();
        putenv('BOOKS_SERVICE_KEY=test-service-key');
        putenv('INVENTORY_SYNC_BOOKS_POSTING');
        $this->conn = $this->connection();
        $cache = self::connectionCache();
        $this->savedConnections = $cache->getValue();
        $cache->setValue(null, array_merge($this->savedConnections, ['tests' => $this->conn, 'default' => $this->conn]));
        $this->createSchema();
        BooksJournalHandoffTracker::forgetTableProbe();
    }

    protected function tearDown(): void
    {
        self::connectionCache()->setValue(null, $this->savedConnections);
        BooksJournalHandoffTracker::forgetTableProbe();
        CrossServiceCallContext::reset();
        putenv('BOOKS_SERVICE_KEY');
        putenv('INVENTORY_SYNC_BOOKS_POSTING');
        parent::tearDown();
    }

    // =================================================================================
    // (g) Idempotence: the synchronous send and a later cron redelivery are ONE journal
    // =================================================================================

    /**
     * THE RESIDUAL WINDOW, end to end.
     *
     * Inventory committed, Books accepted, and the worker died before the outcome could be
     * recorded — so the outbox row is still PENDING and the dispatcher delivers it a minute
     * later. Both deliveries are run here against the same Books. Books is idempotent on the
     * event_uuid, and the two paths send the SAME row through the same envelope, so the second
     * delivery is recognised as a duplicate and the journal is raised exactly once.
     */
    public function testASynchronousSendAndALaterCronRedeliveryRaiseOneJournal(): void
    {
        $books = new FakeBooks();
        $eventId = $this->enqueuePosted(101, 77);
        (new BooksJournalHandoffTracker())->claim(101, 77, 'doc-uuid-77', $eventId, 'u-1');

        // The synchronous send, on a worker that dies before it can record the outcome.
        $dying = new class () extends OutboxService {
            protected function recordDelivery(array $row, array $result): array
            {
                throw new \RuntimeException('worker killed after Books answered');
            }
        };
        try {
            $dying->deliverNow(101, $eventId, $books);
            $this->fail('the simulated worker death did not happen');
        } catch (\RuntimeException $e) {
            $this->assertSame('worker killed after Books answered', $e->getMessage());
        }

        $this->assertSame(1, $books->journals, 'Books raised the journal on the synchronous send');
        $this->assertSame('PENDING', $this->eventRow($eventId)['status'], 'nothing recorded the acceptance, so the row is still queued');
        $this->assertSame(BooksJournalHandoffTracker::AWAITING_BOOKS, $this->handoffRow($eventId)['state']);

        // A minute later: the outbox cron.
        $sent = (new OutboxService())->dispatch(100, $books);

        $this->assertSame(1, $sent['sent']);
        $this->assertSame(2, $books->deliveries, 'the event really was delivered twice');
        $this->assertSame(1, $books->journals, 'but only one journal exists — Books deduplicated on the event_uuid');
        $this->assertSame('ACKED', $this->eventRow($eventId)['status']);
        $this->assertSame(BooksJournalHandoffTracker::ACCEPTED, $this->handoffRow($eventId)['state'], 'the residual row is closed by the delivery that finished it');
    }

    /** Both paths must build the envelope the same way, or "idempotent on the event_uuid" is a wish. */
    public function testBothDeliveryPathsSendTheSameEnvelopeForTheSameRow(): void
    {
        $eventId = $this->enqueuePosted(101, 77);

        $sync = new FakeBooks();
        (new OutboxService())->deliverNow(101, $eventId, $sync);

        // Re-open the row exactly as it was and let the dispatcher take it.
        $this->conn->table('inv_integration_events')->where('event_id', $eventId)
            ->update(['status' => 'PENDING', 'attempts' => 0, 'acked_at' => null, 'sent_at' => null]);
        $cron = new FakeBooks();
        (new OutboxService())->dispatch(100, $cron);

        $this->assertNotSame([], $sync->envelopes);
        $this->assertSame($sync->envelopes[0], $cron->envelopes[0], 'the synchronous send and the dispatcher must send byte-identical envelopes');
    }

    // =================================================================================
    // (c) Books refuses, and Books unreachable
    // =================================================================================

    /**
     * Books answers 4xx. It holds no journal, so the stock must come back off the books, the
     * caller must be told why, and nothing may be left queued.
     */
    public function testARefusedJournalReversesTheDocumentAndLeavesNothingQueued(): void
    {
        $eventId = $this->enqueuePosted(101, 77);
        $handoffId = (new BooksJournalHandoffTracker())->claim(101, 77, 'doc-uuid-77', $eventId, 'u-1');
        $posting = $this->postingService(new FakeBooks(['refuse' => 422]));

        try {
            $posting->settleHandoff(101, 77, 'u-1', $eventId, $handoffId);
            $this->fail('a refused journal must not be reported as a successful post');
        } catch (InventoryException $e) {
            $this->assertSame('books_refused', $e->errorCode());
            $this->assertSame(409, $e->httpStatus());
            $this->assertTrue($e->details()['reversed'], 'the document was taken back off the books');
            $this->assertStringContainsString('no stock has changed', $e->getMessage());
            $this->assertStringContainsString('refused', strtolower($e->getMessage()));
            $this->assertStringContainsString('marked Reversed and cannot be posted again', $e->getMessage());
        }

        $this->assertSame([[101, 77, 'u-1']], $posting->reversals, 'exactly one reversal, of the document that was just posted');
        $this->assertSame(BooksJournalHandoffTracker::REVERSED, $this->handoffRow($eventId)['state']);
        $this->assertSame('DEAD', $this->eventRow($eventId)['status'], 'Books proved it applied nothing, so the posting event is not deliverable');
        $this->assertStringContainsString('refused', strtolower((string) $this->eventRow($eventId)['last_error']));
    }

    /**
     * Books cannot be reached. The document is reversed just the same — but silence is not proof
     * that Books applied nothing, so the event stays queued and the reversal follows it through
     * the same channel, in event order.
     */
    public function testAnUnreachableBooksReversesTheDocumentAndKeepsTheEventQueued(): void
    {
        $eventId = $this->enqueuePosted(101, 77);
        $handoffId = (new BooksJournalHandoffTracker())->claim(101, 77, 'doc-uuid-77', $eventId, 'u-1');
        $posting = $this->postingService(new FakeBooks(['unreachable' => true]));

        try {
            $posting->settleHandoff(101, 77, 'u-1', $eventId, $handoffId);
            $this->fail('an unreachable Books must not be reported as a successful post');
        } catch (InventoryException $e) {
            $this->assertSame('books_unavailable', $e->errorCode());
            $this->assertSame(503, $e->httpStatus());
            $this->assertTrue($e->details()['reversed']);
            // (d) the availability cost, stated rather than implied.
            $this->assertStringContainsString('could not be reached', $e->getMessage());
            $this->assertStringContainsString('cannot post while the books are unavailable', $e->getMessage());
            // The document is REVERSED, so "try again" on its own would point the user at a Post
            // button that refuses them.
            $this->assertStringContainsString('marked Reversed and cannot be posted again', $e->getMessage());
        }

        $this->assertSame([[101, 77, 'u-1']], $posting->reversals);
        $this->assertSame(BooksJournalHandoffTracker::REVERSED, $this->handoffRow($eventId)['state']);
        $this->assertContains($this->eventRow($eventId)['status'], ['PENDING', 'FAILED'], 'Books may have taken it, so the row stays deliverable');
    }

    /**
     * The worst case: the journal was not accepted AND the stock movement could not be undone.
     * Stock has moved with no entry behind it, so the row must say so, the caller must be told
     * not to re-enter the document, and the repair must be queued rather than lost.
     */
    public function testAReversalThatFailsIsRecordedForRepairAndSaysSo(): void
    {
        $eventId = $this->enqueuePosted(101, 77);
        $handoffId = (new BooksJournalHandoffTracker())->claim(101, 77, 'doc-uuid-77', $eventId, 'u-1');
        $posting = $this->postingService(new FakeBooks(['refuse' => 422]));
        $posting->reverseThrows = new \RuntimeException('period is locked');

        try {
            $posting->settleHandoff(101, 77, 'u-1', $eventId, $handoffId);
            $this->fail('an unrepaired posting must not be reported as successful');
        } catch (InventoryException $e) {
            $this->assertSame('books_handoff_unresolved', $e->errorCode());
            $this->assertSame(500, $e->httpStatus());
            $this->assertFalse($e->details()['reversed']);
            $this->assertStringContainsString('period is locked', $e->getMessage());
            $this->assertStringContainsString('do not re-enter', strtolower($e->getMessage()));
        }

        $row = $this->handoffRow($eventId);
        $this->assertSame(BooksJournalHandoffTracker::REVERSAL_PENDING, $row['state'], 'the repair is queued, not lost');
        $this->assertSame(1, (int) $row['attempts']);
        $this->assertStringContainsString('period is locked', (string) $row['last_error']);
        $this->assertNotSame('DEAD', $this->eventRow($eventId)['status'], 'the document is still posted, so its event is not retired');
    }

    /**
     * (e) The reversal is claimed BEFORE it is attempted.
     *
     * The document is committed by the time this runs, so the row is the only thing on disk that
     * knows stock moved with no journal behind it. Proved by killing the worker inside reverse():
     * the row still has to be there afterwards.
     */
    public function testTheReversalIsClaimedBeforeItIsAttempted(): void
    {
        $eventId = $this->enqueuePosted(101, 77);
        $handoffId = (new BooksJournalHandoffTracker())->claim(101, 77, 'doc-uuid-77', $eventId, 'u-1');
        $posting = $this->postingService(new FakeBooks(['refuse' => 422]));
        $seen = null;
        $posting->onReverse = function () use (&$seen, $eventId): void {
            // What is on disk at the moment the risky step begins.
            $seen = $this->handoffRow($eventId);
            throw new \Error('worker killed mid-reversal');
        };

        try {
            $posting->settleHandoff(101, 77, 'u-1', $eventId, $handoffId);
        } catch (\Throwable) {
        }

        $this->assertNotNull($seen, 'reverse() was never reached');
        $this->assertSame(BooksJournalHandoffTracker::REVERSAL_PENDING, $seen['state'], 'the claim must be on disk before the reversal is attempted, not after it');
        $this->assertSame(BooksJournalHandoffTracker::REVERSAL_PENDING, $this->handoffRow($eventId)['state'], 'and it must survive the death');
    }

    // =================================================================================
    // (f) The outbox stays — and now also finishes an interrupted reversal
    // =================================================================================

    /**
     * The sweep never DECIDES to reverse anything. It finishes a reversal this code already
     * chose, on a request a user was present for, and that did not complete.
     */
    public function testTheUnattendedSweepFinishesAnInterruptedReversal(): void
    {
        $eventId = $this->enqueuePosted(101, 77);
        $handoffId = (new BooksJournalHandoffTracker())->claim(101, 77, 'doc-uuid-77', $eventId, 'u-1');
        (new BooksJournalHandoffTracker())->transition($handoffId, BooksJournalHandoffTracker::REVERSAL_PENDING, ['last_error' => 'Books refused']);
        $reversed = [];
        $outbox = new class ($reversed) extends OutboxService {
            public function __construct(public array &$seen)
            {
            }

            protected function postingService(): DocumentPostingService
            {
                return new class ($this->seen) extends DocumentPostingService {
                    public function __construct(public array &$seen)
                    {
                    }

                    public function reverse(int $cmpId, int $documentId, ?string $actor, string $reason, array $options = []): array
                    {
                        $this->seen[] = [$cmpId, $documentId];

                        return ['document_id' => $documentId, 'status' => 'REVERSED'];
                    }
                };
            }
        };

        $out = $outbox->settleBooksHandoffs();

        $this->assertSame(['reversed' => 1, 'failed' => 0], $out);
        $this->assertSame([[101, 77]], $reversed);
        $this->assertSame(BooksJournalHandoffTracker::REVERSED, $this->handoffRow($eventId)['state']);
    }

    /**
     * A drain riding somebody's unrelated write must never reverse a document: it is scoped to
     * one company precisely because a user is waiting on it.
     */
    public function testAnOnContactDrainNeverRepairs(): void
    {
        $outbox = new class () extends OutboxService {
            public int $repairs = 0;

            public function settleBooksHandoffs(int $limit = 20): array
            {
                $this->repairs++;

                return ['reversed' => 0, 'failed' => 0];
            }
        };

        $outbox->settleOnContact(101, 3, new FakeBooks());
        $this->assertSame(0, $outbox->repairs, 'a user waiting on their own write does not pay for a document reversal');

        $outbox->dispatch(10, new FakeBooks());
        $this->assertSame(1, $outbox->repairs, 'the unattended sweep does');
    }

    /** A repair that keeps failing stops being retried rather than looping for ever. */
    public function testRepairsAreBoundedAndBackOff(): void
    {
        $eventId = $this->enqueuePosted(101, 77);
        $handoffId = (new BooksJournalHandoffTracker())->claim(101, 77, 'doc-uuid-77', $eventId, 'u-1');
        $tracker = new BooksJournalHandoffTracker();
        $tracker->transition($handoffId, BooksJournalHandoffTracker::REVERSAL_PENDING);
        $this->conn->table('inv_books_journal_handoffs')->where('handoff_id', $handoffId)
            ->update(['attempts' => BooksJournalHandoffTracker::MAX_REPAIR_ATTEMPTS]);

        $this->assertSame([], $tracker->dueRepairs(), 'an exhausted repair waits for a human, not for the next minute');
        $this->assertGreaterThan(BooksJournalHandoffTracker::backoffSeconds(1), BooksJournalHandoffTracker::backoffSeconds(4));
        $this->assertLessThanOrEqual(1800, BooksJournalHandoffTracker::backoffSeconds(99));
    }

    /**
     * DBDebug is FALSE in every deployed environment, so a failed read answers false rather than
     * throwing. Answering "nothing due" there is byte-identical to a healthy quiet sweep, and the
     * rows it would be hiding are documents posted with no journal behind them.
     */
    public function testAnUnreadableRepairQueueIsAFaultNotAnEmptyQueue(): void
    {
        $this->conn->query('DROP TABLE inv_books_journal_handoffs');
        // The table probe is cached per process, exactly as a live worker would have cached it.
        BooksJournalHandoffTracker::forgetTableProbe(true);

        try {
            (new BooksJournalHandoffTracker())->dueRepairs();
            $this->fail('an unreadable repair queue must not read as an empty one');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('could not be read', $e->getMessage());
        }

        // The sweep itself must survive it: the outbox delivery it rides on is not the caller's
        // problem to fail. It logs and reports nothing repaired, which is the truth.
        $this->assertSame(['reversed' => 0, 'failed' => 0], (new OutboxService())->settleBooksHandoffs());
    }

    /**
     * Nothing was sent because Inventory's own database would not answer. Books therefore holds
     * no journal, and the document must come off the books rather than be reported as posted.
     */
    public function testAnUnsendableEventIsTreatedAsBooksHoldingNoJournal(): void
    {
        $eventId = $this->enqueuePosted(101, 77);
        $handoffId = (new BooksJournalHandoffTracker())->claim(101, 77, 'doc-uuid-77', $eventId, 'u-1');
        $this->conn->query('DROP TABLE inv_integration_events');

        // DBDebug is off, so the read answers false and ->getRowArray() on false would be a fatal
        // with no usable message. Guarded, it is an exception that names what could not be read.
        try {
            (new OutboxService())->deliverNow(101, $eventId, new FakeBooks());
            $this->fail('an unreadable outbox must not be delivered');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('inv_integration_events', $e->getMessage());
            $this->assertStringContainsString('nothing was sent to Books', $e->getMessage());
        }

        $delivery = (new BooksJournalHandoff(new OutboxService(), new BooksJournalHandoffTracker(), new FakeBooks()))->deliver(101, $eventId, $handoffId);

        $this->assertFalse($delivery['accepted']);
        $this->assertTrue($delivery['books_holds_no_journal'], 'nothing left this process, so there is nothing in Books to undo');
        $this->assertSame(BooksJournalHandoffTracker::AWAITING_BOOKS, $this->handoffRow($eventId)['state'], 'and it is certainly not recorded as accepted');
    }

    /** Retiring this posting's events must not touch an older episode on the same document. */
    public function testAbandoningIsBoundedToThisEpisode(): void
    {
        $old = $this->enqueuePosted(101, 77);
        $new = $this->enqueuePosted(101, 77);
        $other = $this->enqueuePosted(101, 78);

        $retired = (new OutboxService())->abandonForDocument(101, 77, $new, 'Books refused');

        $this->assertSame(1, $retired);
        $this->assertSame('PENDING', $this->eventRow($old)['status'], 'an earlier posting of the same document is not ours to close');
        $this->assertSame('DEAD', $this->eventRow($new)['status']);
        $this->assertSame('PENDING', $this->eventRow($other)['status']);
    }

    // =================================================================================
    // Classification and gating
    // =================================================================================

    /** Only an answer that PROVES Books applied nothing may retire the queued event. */
    public function testOnlyAProvenRefusalCountsAsBooksHoldingNoJournal(): void
    {
        $no = static fn (array $d) => BooksJournalHandoff::booksHoldsNoJournal($d);

        $this->assertFalse($no(['accepted' => true, 'status' => 200, 'body' => null]));
        $this->assertTrue($no(['accepted' => false, 'status' => 401, 'body' => null]), '4xx: Books refused the request outright');
        $this->assertTrue($no(['accepted' => false, 'status' => 422, 'body' => null]));
        $this->assertTrue(
            $no(['accepted' => false, 'status' => 500, 'body' => ['error' => ['code' => 'event_apply_failed']]]),
            "Books' own verdict that it applied nothing",
        );
        $this->assertTrue($no(['accepted' => false, 'status' => 500, 'body' => ['data' => [['status' => 'failed']]]]));
        // Silence and bare gateway errors prove nothing: the request may well have reached Books.
        $this->assertFalse($no(['accepted' => false, 'status' => 0, 'body' => null]), 'a timeout is not proof');
        $this->assertFalse($no(['accepted' => false, 'status' => 502, 'body' => null]), 'a proxy 502 is not proof');
        $this->assertFalse($no(['accepted' => false, 'status' => 504, 'body' => null]));
    }

    /** @dataProvider gatingCases */
    public function testTheSynchronousWaitIsSkippedWhereItWouldDoHarm(string $type, bool $ownsTransaction, ?string $origin, ?string $key, ?string $switch, bool $expected, string $why): void
    {
        CrossServiceCallContext::reset($origin);
        putenv($key === null ? 'BOOKS_SERVICE_KEY' : 'BOOKS_SERVICE_KEY=' . $key);
        putenv($switch === null ? 'INVENTORY_SYNC_BOOKS_POSTING' : 'INVENTORY_SYNC_BOOKS_POSTING=' . $switch);

        $this->assertSame($expected, (new BooksJournalHandoff())->enabledFor($type, $ownsTransaction), $why);
    }

    /** @return array<string, array{0:string,1:bool,2:?string,3:?string,4:?string,5:bool,6:string}> */
    public static function gatingCases(): array
    {
        return [
            'ordinary post'       => ['MATERIAL_ISSUE', true, null, 'k', null, true, 'the whole point'],
            'nested in revise'    => ['MATERIAL_ISSUE', false, null, 'k', null, false, 'a Books acceptance inside a transaction Inventory may still roll back is the ordering this design forbids'],
            'books is waiting'    => ['MATERIAL_ISSUE', true, 'books', 'k', null, false, 'calling Books back parks a second Books worker on a request Books is already blocked on'],
            'unreversible type'   => ['LANDED_COST', true, null, 'k', null, false, 'a refusal it could not undo is worse than the window'],
            'no books configured' => ['MATERIAL_ISSUE', true, null, null, null, false, 'a deployment with no Books must post exactly as it always did'],
            'placeholder key'     => ['MATERIAL_ISSUE', true, null, 'CHANGE_ME_please', null, false, 'an unset key is not a configured Books'],
            'switched off'        => ['MATERIAL_ISSUE', true, null, 'k', '0', false, 'an operator can trade consistency back for availability without a deploy'],
            'switched off word'   => ['MATERIAL_ISSUE', true, null, 'k', 'off', false, 'the switch is readable'],
        ];
    }

    /**
     * The skip list is only correct while reverse() really does refuse exactly those types. If
     * reverse() grows another refusal, this fails and the list has to grow with it.
     */
    public function testTheUnreversibleSkipListMatchesWhatReverseActuallyRefuses(): void
    {
        $src = self::methodSource(DocumentPostingService::class, 'reverse');
        foreach (BooksJournalHandoff::UNREVERSIBLE_TYPES as $type) {
            $this->assertStringContainsString("'" . $type . "'", $src, $type . ' is skipped because reverse() refuses it');
        }
        // Every document TYPE reverse() refuses outright must be on the list.
        preg_match_all("/\\\$doc\\['document_type'\\] === '([A-Z_]+)'/", $src, $m);
        $this->assertNotEmpty($m[1] ?? [], 'the refusal could not be located in reverse(); without a match this check passes over nothing');
        foreach ($m[1] as $refused) {
            $this->assertContains($refused, BooksJournalHandoff::UNREVERSIBLE_TYPES, 'reverse() refuses ' . $refused . ', so it has no clean repair and must not wait for Books');
        }
    }

    /** No table (a build ahead of migration 010) means the old behaviour, not a failed post. */
    public function testABuildAheadOfTheMigrationPostsExactlyAsBefore(): void
    {
        $this->conn->query('DROP TABLE inv_books_journal_handoffs');
        BooksJournalHandoffTracker::forgetTableProbe();

        $this->assertFalse((new BooksJournalHandoff())->enabledFor('MATERIAL_ISSUE', true));
        $this->assertSame(0, (new BooksJournalHandoffTracker())->claim(101, 77, 'u', 5, 'u-1'));
    }

    // =================================================================================
    // Helpers
    // =================================================================================

    private function enqueuePosted(int $cmpId, int $documentId): int
    {
        return (new OutboxService())->enqueue($cmpId, 'inventory.document.posted', 'document', $documentId, 'doc-uuid-' . $documentId, ['document_id' => $documentId]);
    }

    /** @return array<string, mixed> */
    private function eventRow(int $eventId): array
    {
        return $this->conn->table('inv_integration_events')->where('event_id', $eventId)->get()->getRowArray() ?? [];
    }

    /** @return array<string, mixed> */
    private function handoffRow(int $eventId): array
    {
        return $this->conn->table('inv_books_journal_handoffs')->where('event_id', $eventId)->get()->getRowArray() ?? [];
    }

    private function postingService(BooksApiClient $books): SpyPostingService
    {
        return new SpyPostingService(new OutboxService(), new BooksJournalHandoff(new OutboxService(), new BooksJournalHandoffTracker(), $books));
    }

    private static function methodSource(string $class, string $method): string
    {
        $ref = new \ReflectionMethod($class, $method);
        $lines = file($ref->getFileName());

        return implode('', array_slice($lines, $ref->getStartLine() - 1, $ref->getEndLine() - $ref->getStartLine() + 1));
    }

    private function connection(): BaseConnection
    {
        return \CodeIgniter\Database\Config::connect([
            'DSN' => '', 'hostname' => '', 'username' => '', 'password' => '', 'database' => ':memory:',
            'DBDriver' => 'SQLite3', 'DBPrefix' => '', 'pConnect' => false,
            // As deployed: a failed read answers false rather than throwing.
            'DBDebug' => false,
            'charset' => 'utf8', 'DBCollat' => '', 'swapPre' => '', 'encrypt' => false, 'compress' => false,
            'strictOn' => false, 'failover' => [], 'port' => 3306, 'foreignKeys' => false, 'busyTimeout' => 1000,
        ], false);
    }

    private function createSchema(): void
    {
        $this->conn->query('CREATE TABLE inv_integration_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT, event_uuid TEXT NULL, cmp_id INTEGER NOT NULL,
            target_app TEXT NOT NULL DEFAULT "books", event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL,
            aggregate_id INTEGER NOT NULL, aggregate_uuid TEXT NULL, payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT "PENDING", attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NULL,
            last_error TEXT NULL, sent_at TEXT NULL, acked_at TEXT NULL, created_at TEXT NOT NULL)');
        // Stands in for the column default gen_random_uuid(): enqueue() never writes event_uuid.
        $this->conn->query('CREATE TRIGGER inv_events_uuid AFTER INSERT ON inv_integration_events WHEN NEW.event_uuid IS NULL
            BEGIN UPDATE inv_integration_events SET event_uuid = "evt-" || NEW.event_id WHERE event_id = NEW.event_id; END');
        $this->conn->query('CREATE TABLE inv_books_journal_handoffs (
            handoff_id INTEGER PRIMARY KEY AUTOINCREMENT, cmp_id INTEGER NOT NULL, document_id INTEGER NOT NULL,
            document_uuid TEXT NULL, event_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT "AWAITING_BOOKS",
            attempts INTEGER NOT NULL DEFAULT 0, books_status INTEGER NULL, last_error TEXT NULL, next_retry_at TEXT NULL,
            created_by TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT NULL)');
    }

    private static function connectionCache(): \ReflectionProperty
    {
        $p = new \ReflectionProperty(\CodeIgniter\Database\Config::class, 'instances');
        $p->setAccessible(true);

        return $p;
    }
}

/**
 * A Books that behaves like the real integration endpoint: idempotent by event_uuid, so a second
 * delivery of the same event is a duplicate and raises no second journal.
 */
final class FakeBooks extends BooksApiClient
{
    public int $deliveries = 0;

    public int $journals = 0;

    /** @var list<array<string, mixed>> */
    public array $envelopes = [];

    /** @var array<string, true> */
    private array $seen = [];

    /** @param array{refuse?:int, unreachable?:bool} $mode */
    public function __construct(private array $mode = [])
    {
    }

    public function postEvent(array $envelope): array
    {
        $this->deliveries++;
        $this->envelopes[] = $envelope;
        if (!empty($this->mode['unreachable'])) {
            return ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'Connection timed out after 8000 ms'];
        }
        if (!empty($this->mode['refuse'])) {
            $status = (int) $this->mode['refuse'];

            return ['ok' => false, 'status' => $status, 'body' => ['error' => ['code' => 'event_apply_failed', 'message' => 'no stock-in-hand ledger is mapped']], 'error' => 'Books HTTP ' . $status . ': no stock-in-hand ledger is mapped'];
        }
        $uuid = (string) ($envelope['event_uuid'] ?? '');
        $duplicate = isset($this->seen[$uuid]);
        if (!$duplicate) {
            $this->seen[$uuid] = true;
            $this->journals++;
        }

        return ['ok' => true, 'status' => 200, 'body' => ['data' => [['event_id' => $uuid, 'status' => 'processed', 'duplicate' => $duplicate]], 'received' => 1], 'error' => null];
    }
}

/**
 * DocumentPostingService with its constructor bypassed (nothing here needs the posting engine)
 * and reverse() observable. settleHandoff() is the private post-commit step under test.
 */
final class SpyPostingService extends DocumentPostingService
{
    /** @var list<array{0:int,1:int,2:?string}> */
    public array $reversals = [];

    public ?\Throwable $reverseThrows = null;

    /** @var callable|null */
    public $onReverse = null;

    public function __construct(OutboxService $outbox, BooksJournalHandoff $handoff)
    {
        $this->outbox = $outbox;
        $this->booksHandoff = $handoff;
    }

    public function reverse(int $cmpId, int $documentId, ?string $actor, string $reason, array $options = []): array
    {
        if ($this->onReverse !== null) {
            ($this->onReverse)();
        }
        if ($this->reverseThrows !== null) {
            throw $this->reverseThrows;
        }
        $this->reversals[] = [$cmpId, $documentId, $actor];

        return ['document_id' => $documentId, 'status' => 'REVERSED'];
    }

    /** @param array<string,mixed> $unused */
    public function settleHandoff(int $cmpId, int $documentId, ?string $actor, int $eventId, int $handoffId): void
    {
        $delivery = $this->booksHandoff->deliver($cmpId, $eventId, $handoffId);
        if ($delivery['accepted']) {
            return;
        }
        $m = new \ReflectionMethod(DocumentPostingService::class, 'undoPostBooksWouldNotTake');
        $m->setAccessible(true);
        $m->invoke($this, $cmpId, $documentId, $actor, $eventId, $handoffId, $delivery);
    }
}
