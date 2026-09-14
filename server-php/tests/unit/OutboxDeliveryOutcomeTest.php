<?php

namespace Tests\Unit;

use App\Services\OutboxService;
use PHPUnit\Framework\TestCase;

/**
 * The ACK decision of the outbox dispatcher (no database).
 *
 * An outbox row is only closed — status ACKED, acked_at set, last_error null, never picked up
 * again — when Books actually applied the event. Judging that on the HTTP status alone dropped
 * every event Books failed to apply: Books answered 200 with status='failed' per event, the row
 * was ACKED, and the COGS revision never reached the ledger while the outbox reported 100%
 * delivery.
 *
 * @group unit
 */
final class OutboxDeliveryOutcomeTest extends TestCase
{
    /** @return array{ok:bool, status:int, body:?array, error:?string} */
    private static function booksAnswer(int $status, ?array $body): array
    {
        // Mirrors BooksApiClient::request(): ok and error come from the HTTP status alone.
        return [
            'ok'     => $status >= 200 && $status < 300,
            'status' => $status,
            'body'   => $body,
            'error'  => $status >= 300 ? ('Books HTTP ' . $status . ': ' . json_encode($body)) : null,
        ];
    }

    public function testAppliedEventIsAcknowledged(): void
    {
        $outcome = OutboxService::deliveryOutcome(self::booksAnswer(200, [
            'data' => [['event_id' => 'e1', 'event_type' => 'inventory.valuation.revised', 'status' => 'processed']], 'received' => 1,
        ]));

        $this->assertTrue($outcome['ack']);
        $this->assertSame('', $outcome['error']);
    }

    public function testIgnoredEventIsAcknowledged(): void
    {
        $outcome = OutboxService::deliveryOutcome(self::booksAnswer(200, [
            'data' => [['event_id' => 'e2', 'event_type' => 'inventory.item.upserted', 'status' => 'ignored', 'reason' => 'mirror archived']], 'received' => 1,
        ]));

        $this->assertTrue($outcome['ack'], 'an event Books deliberately ignored is delivered, not failed');
    }

    /** Books now answers 500 for this; the row must go back to FAILED with the reason. */
    public function testEventBooksCouldNotApplyIsNotAcknowledged(): void
    {
        $outcome = OutboxService::deliveryOutcome(self::booksAnswer(500, [
            'data'  => [['event_id' => 'e3', 'event_type' => 'inventory.valuation.revised', 'status' => 'failed', 'error' => 'Could not apply COGS revision to voucher #42']],
            'error' => ['code' => 'event_apply_failed', 'message' => '1 of 1 event(s) could not be applied'],
        ]));

        $this->assertFalse($outcome['ack']);
        $this->assertStringContainsString('Could not apply COGS revision to voucher #42', $outcome['error']);
    }

    /**
     * A Books build that still answers 200 for a failed event — an older deployment, or Inventory
     * rolled out ahead of Books — must not get an ACK either.
     */
    public function testFailedEventInsideA200IsNotAcknowledged(): void
    {
        $outcome = OutboxService::deliveryOutcome(self::booksAnswer(200, [
            'data' => [['event_id' => 'e4', 'event_type' => 'inventory.valuation.revised', 'status' => 'failed', 'error' => 'Could not apply COGS revision to voucher #7']], 'received' => 1,
        ]));

        $this->assertFalse($outcome['ack'], 'HTTP 200 with status=failed is a dropped event, not a delivery');
        $this->assertStringContainsString('Could not apply COGS revision to voucher #7', $outcome['error']);
    }

    public function testOneFailureInABatchBlocksTheAck(): void
    {
        $outcome = OutboxService::deliveryOutcome(self::booksAnswer(200, [
            'data' => [
                ['event_id' => 'e5', 'event_type' => 'inventory.document.posted', 'status' => 'processed'],
                ['event_id' => 'e6', 'event_type' => 'inventory.valuation.revised', 'status' => 'failed', 'error' => 'voucher locked'],
            ],
            'received' => 2,
        ]));

        $this->assertFalse($outcome['ack']);
        $this->assertStringContainsString('voucher locked', $outcome['error']);
    }

    public function testUnreachableBooksKeepsItsOwnTransportError(): void
    {
        $outcome = OutboxService::deliveryOutcome(['ok' => false, 'status' => 0, 'body' => null, 'error' => 'Books unreachable']);

        $this->assertFalse($outcome['ack']);
        $this->assertSame('Books unreachable', $outcome['error']);
    }

    /** A 2xx whose body Books did not shape as expected is still a delivery. */
    public function testUnparseableBodyOnA2xxIsAcknowledged(): void
    {
        $this->assertTrue(OutboxService::deliveryOutcome(self::booksAnswer(200, null))['ack']);
        $this->assertTrue(OutboxService::deliveryOutcome(self::booksAnswer(202, ['received' => 1]))['ack']);
    }
}
