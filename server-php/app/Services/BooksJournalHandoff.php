<?php

namespace App\Services;

/**
 * The synchronous half of Inventory -> Books posting: the journal is accepted by Books BEFORE
 * the user is told the stock document posted.
 *
 * WHY, AND WHY IN THIS ORDER
 * --------------------------
 * Posting used to write the document, commit, and enqueue an outbox event that Books turned
 * into a journal up to a minute later. In that window stock had moved and no accounting entry
 * existed. The event is now offered to Books inside the user's own request.
 *
 * INVENTORY COMMITS FIRST, BOOKS LAST. There is always a last commit and it can always fail;
 * the question is which failure is cheaper to repair:
 *
 *   Books last and it fails      Inventory holds the document, Books has no journal. The repair
 *                                is re-sending it — idempotent on the event_uuid, no scar.
 *   Inventory last and it fails  Books holds a journal for stock that never moved. The repair
 *                                is reversing a general-ledger entry: two permanent entries in
 *                                the statutory books.
 *
 * The side whose failure repairs cleanly is the side allowed to fail, so Books goes last.
 *
 * ONE CHANNEL, NOT TWO
 * --------------------
 * The event delivered here is the same inv_integration_events row the dispatcher would have
 * delivered, sent to the same endpoint through {@see OutboxService::deliverNow()}. Books is
 * idempotent on the event_uuid, so the synchronous send and any later redelivery are one
 * journal. The outbox is not replaced; it is demoted from primary delivery to the fallback
 * that catches the residue.
 *
 * WHEN IT DOES NOT RUN
 * --------------------
 * {@see enabledFor()} — a post Books itself issued (calling Books back would park a second
 * Books worker on a request Books is already blocked on: the cross-pool starvation
 * {@see CrossServiceCallContext} exists to stop), a deployment where the Books integration is
 * not configured, a build that is ahead of migration 010, a document type Inventory cannot
 * reverse, or an operator who has turned it off. In every one of those the old behaviour is
 * unchanged: the event is queued and the dispatcher delivers it.
 */
class BooksJournalHandoff
{
    /**
     * Document types {@see DocumentPostingService::reverse()} refuses.
     *
     * The whole argument for letting Books fail last is that the repair is clean, and here the
     * repair is Inventory reversing its own document. A type that cannot be reversed has no
     * clean repair, so it keeps the queued delivery it has always had rather than risking a
     * refusal it could not undo. BooksJournalHandoffTest pins this against reverse() itself.
     */
    public const UNREVERSIBLE_TYPES = ['LANDED_COST'];

    public function __construct(
        protected ?OutboxService $outbox = null,
        protected ?BooksJournalHandoffTracker $tracker = null,
        protected ?BooksApiClient $books = null,
    ) {
        $this->outbox ??= new OutboxService();
        $this->tracker ??= new BooksJournalHandoffTracker();
    }

    public function tracker(): BooksJournalHandoffTracker
    {
        return $this->tracker;
    }

    /**
     * May this post wait for Books?
     *
     * @param bool $ownsTransaction false when the post is nested inside a wider transaction
     *                              (revise()): a Books acceptance followed by an Inventory
     *                              rollback is exactly the ordering this design forbids, so the
     *                              nested post keeps the queued delivery.
     */
    public function enabledFor(string $documentType, bool $ownsTransaction): bool
    {
        if (!$ownsTransaction) {
            return false;
        }
        if (in_array(strtoupper($documentType), self::UNREVERSIBLE_TYPES, true)) {
            return false;
        }
        if (!self::switchedOn()) {
            return false;
        }
        // Books is blocked on this very request; calling it back parks a second Books worker on
        // it. Books raises its own journal in-process on that path anyway.
        if (CrossServiceCallContext::isInboundFrom('books')) {
            return false;
        }
        if (!self::booksConfigured()) {
            return false;
        }

        return BooksJournalHandoffTracker::tableExists();
    }

    /**
     * INVENTORY_SYNC_BOOKS_POSTING=0|false|off turns the synchronous wait off without a deploy.
     *
     * "Books is down, so stock cannot be posted" is the accepted cost of this design, but an
     * operator in the middle of an incident must be able to trade it back for availability
     * without waiting for a release.
     */
    public static function switchedOn(): bool
    {
        $v = getenv('INVENTORY_SYNC_BOOKS_POSTING');
        if ($v === false) {
            return true;
        }

        return !in_array(strtolower(trim((string) $v)), ['0', 'false', 'off', 'no'], true);
    }

    /**
     * Same test BooksApiClient::request() makes before it dials. Asked here so a deployment with
     * no Books behind it (standalone Inventory, a developer machine) posts exactly as it always
     * did instead of reversing every document against a service that was never configured.
     */
    public static function booksConfigured(): bool
    {
        $key = (string) (getenv('BOOKS_SERVICE_KEY') ?: '');

        return $key !== '' && !str_starts_with($key, 'CHANGE_ME');
    }

    /**
     * Offer the committed document's event to Books and record what Books made of it.
     *
     * Called AFTER the document's own commit. The tracker row was claimed inside that
     * transaction, so whatever happens from here — including this worker being killed mid-call
     * — leaves a row on disk saying the outcome is unknown, and the dispatcher finishes it.
     *
     * @return array{accepted:bool, status:int, error:string, books_holds_no_journal:bool}
     */
    public function deliver(int $cmpId, int $eventId, int $handoffId): array
    {
        try {
            $delivery = $this->outbox->deliverNow($cmpId, $eventId, $this->books);
        } catch (\Throwable $e) {
            // deliverNow() only throws when Inventory's own database would not answer. Nothing
            // was sent, so Books holds no journal and the document must come back off the books.
            log_message('error', 'Books journal handoff for event {ev} could not be attempted: {msg}', ['ev' => $eventId, 'msg' => $e->getMessage()]);

            return $this->record($handoffId, ['accepted' => false, 'status' => 0, 'error' => $e->getMessage(), 'books_holds_no_journal' => true]);
        }

        return $this->record($handoffId, [
            'accepted'               => (bool) $delivery['accepted'],
            'status'                 => (int) $delivery['status'],
            'error'                  => (string) $delivery['error'],
            'books_holds_no_journal' => self::booksHoldsNoJournal($delivery),
        ]);
    }

    /**
     * Claim the reversal BEFORE reversing.
     *
     * The document is committed by now, so this row is the only thing on disk that knows stock
     * has moved with no journal behind it. Written after the attempt it would be missing in
     * exactly the case it exists for — the worker dying part-way through the repair.
     */
    public function claimReversal(int $handoffId, string $reason, int $booksStatus): void
    {
        $this->tracker->transition($handoffId, BooksJournalHandoffTracker::REVERSAL_PENDING, [
            'books_status' => $booksStatus ?: null,
            'last_error'   => mb_substr('Books did not take the journal (' . $reason . '); the inventory document must be reversed.', 0, 4000),
            // Due immediately: the decision is already made, so an interrupted repair is
            // finished by the next sweep rather than waiting out a grace period.
            'next_retry_at' => null,
        ]);
    }

    public function recordReversed(int $handoffId, string $reason): void
    {
        $this->tracker->transition($handoffId, BooksJournalHandoffTracker::REVERSED, [
            'last_error' => mb_substr('Document reversed because Books did not take the journal: ' . $reason, 0, 4000),
        ]);
    }

    public function recordReversalFailed(int $handoffId, string $error): void
    {
        $this->tracker->recordFailure($handoffId, BooksJournalHandoffTracker::REVERSAL_PENDING, 'Reversal after a refused journal did not complete: ' . $error);
    }

    /**
     * Does Books' answer PROVE it did not apply the event?
     *
     * Only then may the queued event be retired: if Books answered 4xx, or answered with its own
     * per-event 'failed' verdict, no journal exists there and redelivering the posting of a
     * document that has since been reversed is noise. Silence, a timeout or a bare gateway 5xx
     * proves nothing — the request may have reached Books — so the event stays queued and the
     * reversal follows it through the same channel, in event order.
     *
     * @param array{accepted:bool, status:int, error:string, body:?array} $delivery
     */
    public static function booksHoldsNoJournal(array $delivery): bool
    {
        if (!empty($delivery['accepted'])) {
            return false;
        }
        $status = (int) ($delivery['status'] ?? 0);
        if ($status >= 400 && $status < 500) {
            return true;
        }
        $body = $delivery['body'] ?? null;
        if (!is_array($body)) {
            return false;
        }
        if ((string) ($body['error']['code'] ?? '') === 'event_apply_failed') {
            return true;
        }
        foreach ((array) ($body['data'] ?? []) as $event) {
            if (is_array($event) && ($event['status'] ?? '') === 'failed') {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array{accepted:bool, status:int, error:string, books_holds_no_journal:bool} $outcome
     * @return array{accepted:bool, status:int, error:string, books_holds_no_journal:bool}
     */
    private function record(int $handoffId, array $outcome): array
    {
        if ($outcome['accepted']) {
            $this->tracker->transition($handoffId, BooksJournalHandoffTracker::ACCEPTED, [
                'books_status' => $outcome['status'] ?: null, 'last_error' => null,
            ]);
        }

        return $outcome;
    }
}
