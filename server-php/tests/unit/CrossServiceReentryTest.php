<?php

use App\Services\BooksApiClient;
use App\Services\CrossServiceCallContext;
use App\Services\OutboxService;
use PHPUnit\Framework\TestCase;

/**
 * Regression tests for the Books <-> Inventory half of the PHP-FPM cross-pool starvation
 * incident.
 *
 * THE LOOP THAT WAS LIVE
 * ----------------------
 *   1. Inventory write -> BaseController::authorize() -> OutboxService::settleOnContact()
 *   2. -> POST books /api/integration/inventory/events        [Books worker blocked]
 *   3. -> InventoryEventHandler::handle() -> acknowledgeRevisions()
 *   4. -> POST inventory /api/v1/valuation/revisions/ack      [Inventory worker blocked]
 *   5. -> BaseController::authorize() -> settleOutboxOnContact()
 *   6. -> POST books /api/integration/inventory/events        [back to step 2]
 *
 * Books and Inventory run in separate PHP-FPM pools with small pm.max_children, and each
 * synchronous call parks the calling worker for the whole round trip. Nothing recurses in
 * the application sense — every process makes exactly one call and then blocks — so no
 * depth counter or re-entrancy flag inside a single process can see it. What runs out is
 * WORKERS, in both pools at once, and the queue answers 504.
 *
 * It is broken in two places, and this file pins both:
 *   - Inventory does not drain its outbox on a Books-originated request (step 5).
 *   - Books returns the acknowledgement in its response body instead of calling Inventory
 *     back for it (step 4), so the ack lands with no second connection.
 *
 * @group unit
 * @group architecture
 */
class CrossServiceReentryTest extends TestCase
{
    protected function setUp(): void
    {
        CrossServiceCallContext::reset();
    }

    protected function tearDown(): void
    {
        CrossServiceCallContext::reset();
    }

    // ==================================================================================
    // Step 5: no outbox drain on a request Books is waiting on.
    // ==================================================================================

    public function testOutboxDrainIsSkippedForABooksOriginatedRequest(): void
    {
        $body = self::methodSource(\App\Controllers\Api\BaseController::class, 'settleOutboxOnContact');

        $this->assertStringContainsString("source_app", $body);
        $this->assertStringContainsString("'books'", $body);
        $this->assertStringContainsString('isInboundFrom', $body);

        // The guard must come BEFORE the dispatch, or it guards nothing.
        $this->assertLessThan(
            strpos($body, 'settleOnContact('),
            strpos($body, 'isInboundFrom'),
            'the re-entry guard must short-circuit before the outbox is drained',
        );
    }

    /**
     * The signal consulted is resolved from the caller's X-Service-Key in auth(), not from a
     * request header, so a browser cannot switch the drain on or off.
     */
    public function testTheAuthenticatedProductIsAdoptedAsTheOrigin(): void
    {
        $body = self::methodSource(\App\Controllers\Api\BaseController::class, 'auth');

        $keyPos = strpos($body, 'ServiceKeyAuthenticator');
        $adoptPos = strpos($body, 'adoptAuthenticatedOrigin');

        $this->assertNotFalse($adoptPos, 'auth() must record the caller product it just proved');
        $this->assertNotFalse($keyPos);
        $this->assertGreaterThan($keyPos, $adoptPos, 'the origin is adopted only after the service key resolves a product');
    }

    public function testAdoptedOriginNarrowsButNeverWidens(): void
    {
        CrossServiceCallContext::adoptAuthenticatedOrigin('books');
        $this->assertTrue(CrossServiceCallContext::isInboundFrom('books'));
        $this->assertFalse(CrossServiceCallContext::mayCall('books'));
        $this->assertTrue(CrossServiceCallContext::mayCall('manage'));

        // Inventory calling itself is not a cross-pool hop, and an unknown product is ignored.
        CrossServiceCallContext::reset();
        CrossServiceCallContext::adoptAuthenticatedOrigin('inventory');
        $this->assertNull(CrossServiceCallContext::origin());

        CrossServiceCallContext::reset();
        CrossServiceCallContext::adoptAuthenticatedOrigin('not-a-saas');
        $this->assertNull(CrossServiceCallContext::origin());
    }

    public function testBooksClientRefusesToCallBooksOnABooksOriginatedRequest(): void
    {
        CrossServiceCallContext::reset('books');

        putenv('BOOKS_SERVICE_KEY=test-key-not-used');
        $result = (new BooksApiClient())->request('GET', 'integration/inventory/posting-status?cmp_id=1&fy_id=1');
        putenv('BOOKS_SERVICE_KEY');

        $this->assertFalse($result['ok']);
        $this->assertSame('books_reentrant_call_refused', $result['error']);
        $this->assertSame(0, $result['status'], 'refused before any connection was attempted');
    }

    public function testBooksClientBoundsBothConnectAndOverallTime(): void
    {
        $ref = new ReflectionClass(BooksApiClient::class);
        $connect = $ref->getConstant('CONNECT_TIMEOUT');
        $total = $ref->getConstant('TOTAL_TIMEOUT');

        $this->assertIsInt($connect);
        $this->assertIsInt($total);
        // The connect bound is what holds a Books that is up but not accepting — every
        // child blocked waiting on Inventory — which is the shape of the incident.
        $this->assertLessThanOrEqual(5, $connect, 'a Books that is not accepting must not hold an Inventory worker');
        $this->assertLessThanOrEqual(10, $total, 'this runs on ordinary user writes; 30s per attempt is not acceptable');
        $this->assertGreaterThan(0, $connect);
        $this->assertGreaterThanOrEqual($connect, $total);
    }

    public function testBooksClientNamesItselfSoBooksWillNotCallBack(): void
    {
        $body = self::methodSource(BooksApiClient::class, 'request');

        $this->assertStringContainsString('CrossServiceCallContext::HEADER', $body);
        $this->assertStringContainsString("': inventory'", $body);
    }

    // ==================================================================================
    // Step 4: the acknowledgement rides back on the response, not on a new connection.
    // ==================================================================================

    public function testPiggybackedRevisionAcksAreReadFromTheDeliveryResponse(): void
    {
        $ids = self::ackIdsFrom([
            'ok' => true,
            'status' => 200,
            'error' => null,
            'body' => ['data' => [
                ['status' => 'processed', 'ack_revision_ids' => [11, 12]],
                ['status' => 'processed', 'ack_revision_ids' => [12, 13]],
                ['status' => 'ignored'],
            ]],
        ]);

        $this->assertSame([11, 12, 13], $ids, 'ids from every event in the batch, deduplicated');
    }

    public function testPiggybackedAcksTolerateEveryResponseShape(): void
    {
        $this->assertSame([], self::ackIdsFrom(['ok' => true, 'status' => 200, 'error' => null, 'body' => null]));
        $this->assertSame([], self::ackIdsFrom(['ok' => true, 'status' => 200, 'error' => null, 'body' => []]));
        $this->assertSame([], self::ackIdsFrom(['ok' => true, 'status' => 200, 'error' => null, 'body' => ['data' => 'nope']]));
        // A single (non-list) result object, and a Books build that does not send the field.
        $this->assertSame([], self::ackIdsFrom(['ok' => true, 'status' => 200, 'error' => null, 'body' => ['data' => ['status' => 'processed']]]));
        $this->assertSame([9], self::ackIdsFrom(['ok' => true, 'status' => 200, 'error' => null, 'body' => ['data' => ['ack_revision_ids' => [9]]]]));
        // Junk must not become an UPDATE for revision 0.
        $this->assertSame([], self::ackIdsFrom(['ok' => true, 'status' => 200, 'error' => null, 'body' => ['data' => [['ack_revision_ids' => [0, -3, 'x']]]]]));
    }

    public function testPiggybackedAckApplicationIsBoundedAndNeverFailsTheDelivery(): void
    {
        $body = self::methodSource(OutboxService::class, 'applyPiggybackedRevisionAcks');

        $this->assertStringContainsString('5000', $body, 'same bound the ack endpoint enforces');
        $this->assertStringContainsString('array_chunk', $body);
        $this->assertStringContainsString('catch', $body, 'an ack failure must never fail an accepted delivery');
        $this->assertStringContainsString("'acknowledged_at', null", $body, 'only unacknowledged rows are stamped');
    }

    /**
     * The outcome of one delivery attempt is applied in recordDelivery(), which both the
     * dispatcher and the synchronous journal handoff ({@see OutboxService::deliverNow()}) go
     * through — so the piggybacked acknowledgement rides back on either path and neither can
     * apply one for a delivery Books did not acknowledge.
     */
    public function testAcksAreAppliedOnlyForAnAcknowledgedDelivery(): void
    {
        $body = self::methodSource(OutboxService::class, 'recordDelivery');

        $ackBranch = strpos($body, "\$outcome['ack']");
        $apply = strpos($body, 'applyPiggybackedRevisionAcks');

        $this->assertNotFalse($apply);
        $this->assertGreaterThan($ackBranch, $apply, 'acks are applied inside the delivered branch, not on a failure');

        // Both delivery paths must settle through it, or one of them acknowledges by its own rules.
        foreach (['dispatch', 'deliverNow'] as $method) {
            $this->assertStringContainsString('recordDelivery(', self::methodSource(OutboxService::class, $method), $method . '() must settle its attempt through the shared bookkeeping');
        }
    }

    // ==================================================================================
    // Helpers
    // ==================================================================================

    /** @param array{ok:bool,status:int,body:?array,error:?string} $result @return list<int> */
    private static function ackIdsFrom(array $result): array
    {
        $ids = [];
        $m = new ReflectionMethod(OutboxService::class, 'eventResults');
        $m->setAccessible(true);
        foreach ($m->invoke(null, $result) as $eventResult) {
            foreach ((array) ($eventResult['ack_revision_ids'] ?? []) as $id) {
                $id = (int) $id;
                if ($id > 0) {
                    $ids[] = $id;
                }
            }
        }

        return array_values(array_unique($ids));
    }

    private static function methodSource(string $class, string $method): string
    {
        $ref = new ReflectionMethod($class, $method);
        $ref->setAccessible(true);
        $lines = file($ref->getFileName());

        return implode('', array_slice(
            $lines,
            $ref->getStartLine() - 1,
            $ref->getEndLine() - $ref->getStartLine() + 1,
        ));
    }
}
