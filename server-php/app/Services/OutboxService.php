<?php

namespace App\Services;

/**
 * Outbox pattern: integration events are written in the same transaction as the domain
 * change, then delivered with retries.
 *
 * THIS IS NO LONGER THE PRIMARY DELIVERY PATH FOR A POSTED DOCUMENT.
 * A stock document's journal is now offered to Books inside the user's own request, before
 * they are told the post worked ({@see deliverNow()}, driven by
 * {@see BooksJournalHandoff}). The outbox is demoted to the fallback that catches what that
 * leaves behind: the window where Inventory committed, Books accepted, and the worker died
 * before the outcome could be recorded. Books is idempotent on the event_uuid, so a
 * redelivery of a row that was already sent synchronously is the same journal, not a second
 * one — which is exactly why both paths send the same row, through {@see envelopeFor()}.
 *
 * It remains the ONLY delivery path for everything else: master mirrors, valuation
 * revisions, reversals, and any post that cannot wait for Books (a post Books itself issued,
 * a nested post inside revise(), an unconfigured deployment).
 *
 * Three callers, over the same rows: inventory:outbox-dispatch every minute, a drain of the
 * acting company's due rows on every authenticated write ({@see settleOnContact()}, from
 * App\Controllers\Api\BaseController::authorize()), and the operator's Dispatch button.
 */
class OutboxService
{
    protected ?BooksJournalHandoffTracker $handoffs = null;

    /** @param array<string, mixed> $payload */
    public function enqueue(int $cmpId, string $eventType, string $aggregateType, int $aggregateId, ?string $aggregateUuid, array $payload, string $targetApp = 'books'): int
    {
        $db = \Config\Database::connect();
        $db->table('inv_integration_events')->insert([
            'cmp_id'          => $cmpId,
            'target_app'      => $targetApp,
            'event_type'      => $eventType,
            'aggregate_type'  => $aggregateType,
            'aggregate_id'    => $aggregateId,
            'aggregate_uuid'  => $aggregateUuid,
            'payload_json'    => json_encode($payload, JSON_UNESCAPED_UNICODE),
            'status'          => 'PENDING',
            'attempts'        => 0,
            'next_attempt_at' => date('Y-m-d H:i:s'),
            'created_at'      => date('Y-m-d H:i:s'),
        ]);

        return (int) $db->insertID();
    }

    /**
     * Deliver this company's due events on a request somebody is already waiting on.
     *
     * There is no cron in this deployment, so an enqueue nothing drains is a promise never kept:
     * the row is durable and stays PENDING for ever. The moment left is the next action on the
     * same company, which is how Books settles its own deferred work
     * (InventoryRetryService::settleOnContact). Built to be invisible there: a handful of rows on
     * the indexed due predicate (almost always none), the same back-off as the dispatcher so a row
     * Books keeps refusing is not re-fired on every click, and it stops at the first undelivered
     * row so a Books outage costs the user one timeout rather than $limit of them.
     *
     * Its own failure is never the caller's problem — they asked to post a document, not to
     * deliver an older event; the row simply stays queued for the next contact.
     *
     * @return array{sent:int, failed:int, dead:int, skipped:int}
     */
    public function settleOnContact(int $cmpId, int $limit = 3, ?BooksApiClient $books = null): array
    {
        if ($cmpId <= 0) {
            return ['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0];
        }
        try {
            return $this->dispatch($limit, $books, $cmpId, true);
        } catch (\Throwable $e) {
            log_message('warning', 'On-contact outbox dispatch for company {cmp} stopped early: {msg}', ['cmp' => $cmpId, 'msg' => $e->getMessage()]);

            return ['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0];
        }
    }

    /**
     * Deliver due events. Returns counts.
     *
     * $cmpId narrows the sweep to one company (the on-contact drain: only the company whose
     * request is in flight); $stopOnFailure leaves the rest of the batch for later as soon as one
     * row is not acknowledged, which is what keeps that drain off a user's clock during an outage.
     *
     * The unattended sweep ($cmpId null: the every-minute cron and the operator's Dispatch
     * button) additionally finishes any interrupted journal-handoff reversal and reports it under
     * 'repaired'. The existing keys are untouched, so inventory:outbox-dispatch reads exactly
     * what it always did.
     *
     * @return array{sent:int, failed:int, dead:int, skipped:int, repaired?:array{reversed:int, failed:int}}
     */
    public function dispatch(int $limit = 100, ?BooksApiClient $books = null, ?int $cmpId = null, bool $stopOnFailure = false): array
    {
        $db = \Config\Database::connect();
        $books ??= new BooksApiClient();
        $b = $db->table('inv_integration_events')
            ->whereIn('status', ['PENDING', 'FAILED'])
            ->where('next_attempt_at <=', date('Y-m-d H:i:s'));
        if ($cmpId !== null) {
            $b->where('cmp_id', $cmpId);
        }
        $q = $b->orderBy('event_id', 'ASC')->limit($limit)->get();
        $out = ['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0];
        // DBDebug is off in every deployed environment, so a failed read answers false rather than
        // throwing. Reading it bare would be a fatal on somebody's document posting — but
        // returning all-zeros is worse in the other direction: it is byte-identical to "nothing
        // was due", so a database that is unreachable at 02:00 was reported to the cron monitor as
        // a healthy quiet run and the console row stayed green while not one accounting event was
        // being delivered. It is raised as a controlled exception instead: settleOnContact()
        // catches it and logs (the user's write is never affected), the API endpoint answers an
        // error, and the CLI sweep reports the run as FAILED to Console — which is the truth.
        if ($q === false) {
            throw new \RuntimeException(
                'Could not read inv_integration_events: the outbox query failed, so nothing was '
                . 'dispatched. This is a database fault, not an empty queue.'
            );
        }
        foreach ($q->getResultArray() as $row) {
            if (($row['target_app'] ?? 'books') !== 'books') {
                $out['skipped']++;
                continue;
            }
            $result = $books->postEvent(self::envelopeFor($row));
            $settled = $this->recordDelivery($row, $result);
            if ($settled['ack']) {
                $out['sent']++;
                continue;
            }
            $settled['dead'] ? $out['dead']++ : $out['failed']++;
            if ($stopOnFailure) {
                break;
            }
        }
        // The synchronous handoff's residue: a reversal this code already decided on, in a
        // request the user was present for, that did not finish. Only on the unattended sweep —
        // the every-minute outbox cron and the operator's Dispatch button — never on a drain
        // riding somebody's unrelated write, where a document reversal has no business.
        if ($cmpId === null) {
            $out['repaired'] = $this->settleBooksHandoffs();
        }

        return $out;
    }

    /**
     * The envelope one outbox row is delivered as.
     *
     * Shared by the dispatcher and the synchronous handoff ({@see deliverNow()}) so both carry
     * the SAME event_uuid. Books is idempotent on it, so a document sent synchronously and
     * redelivered later by the cron is one journal, not two. Building the envelope twice, in
     * two places, is how that stops being true.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function envelopeFor(array $row): array
    {
        return [
            'event_uuid'     => $row['event_uuid'],
            'event_type'     => $row['event_type'],
            'cmp_id'         => (int) $row['cmp_id'],
            'aggregate_type' => $row['aggregate_type'],
            'aggregate_id'   => (int) $row['aggregate_id'],
            'aggregate_uuid' => $row['aggregate_uuid'],
            'occurred_at'    => $row['created_at'],
            'payload'        => json_decode((string) $row['payload_json'], true) ?: [],
        ];
    }

    /**
     * Deliver ONE row now, on the request that created it, and settle it exactly as the
     * dispatcher would.
     *
     * This is the synchronous Inventory -> Books posting path: the caller has committed the
     * stock document and has not yet told the user it posted. It deliberately reuses the outbox
     * row rather than opening a second channel — same endpoint, same envelope, same event_uuid,
     * same ACK rules — so the two paths cannot disagree about what "Books took it" means.
     *
     * @return array{accepted:bool, status:int, error:string, event_uuid:?string, body:?array}
     */
    public function deliverNow(int $cmpId, int $eventId, ?BooksApiClient $books = null): array
    {
        $db = \Config\Database::connect();
        $q = $db->table('inv_integration_events')->where('event_id', $eventId)->where('cmp_id', $cmpId)->get();
        // DBDebug is off in every deployed environment: ->get() answers false on a query error
        // and ->getResultArray() on false is a fatal with no usable message. The caller turns
        // this into "Books holds no journal", which is true: nothing was sent.
        if ($q === false) {
            throw new \RuntimeException('Could not read inv_integration_events for event ' . $eventId . ': the outbox row could not be read, so nothing was sent to Books.');
        }
        $row = $q->getRowArray();
        if (!$row) {
            throw new \RuntimeException('Outbox event ' . $eventId . ' was not found for company ' . $cmpId . ', so nothing was sent to Books.');
        }
        if (($row['status'] ?? '') === 'ACKED') {
            // Already delivered — a replayed request, or a dispatcher that got there first.
            return ['accepted' => true, 'status' => 200, 'error' => '', 'event_uuid' => $row['event_uuid'] ?? null, 'body' => null];
        }
        $books ??= new BooksApiClient();
        $result = $books->postEvent(self::envelopeFor($row));
        $settled = $this->recordDelivery($row, $result);

        return [
            'accepted'   => $settled['ack'],
            'status'     => (int) ($result['status'] ?? 0),
            'error'      => $settled['error'],
            'event_uuid' => $row['event_uuid'] ?? null,
            'body'       => is_array($result['body'] ?? null) ? $result['body'] : null,
        ];
    }

    /**
     * Apply one delivery attempt's outcome to its row: ACKED, or FAILED/DEAD with the back-off.
     *
     * @param array<string, mixed> $row
     * @param array{ok:bool, status:int, body:?array, error:?string} $result
     * @return array{ack:bool, dead:bool, error:string}
     */
    protected function recordDelivery(array $row, array $result): array
    {
        $db = \Config\Database::connect();
        $eventId = (int) $row['event_id'];
        $attempts = (int) $row['attempts'] + 1;
        $outcome = self::deliveryOutcome($result);
        if ($outcome['ack']) {
            $db->table('inv_integration_events')->where('event_id', $eventId)->update([
                'status' => 'ACKED', 'attempts' => $attempts, 'sent_at' => date('Y-m-d H:i:s'), 'acked_at' => date('Y-m-d H:i:s'), 'last_error' => null,
            ]);
            $this->applyPiggybackedRevisionAcks((int) $row['cmp_id'], $result);
            // Whatever the synchronous handoff could not finish recording, this closes: the
            // event is delivered, so the document's journal exists.
            $this->handoffTracker()->completeForEvent($eventId);

            return ['ack' => true, 'dead' => false, 'error' => ''];
        }
        $dead = $attempts >= 20;
        $delay = min(3600, 30 * (2 ** min(10, $attempts)));
        $db->table('inv_integration_events')->where('event_id', $eventId)->update([
            'status'          => $dead ? 'DEAD' : 'FAILED',
            'attempts'        => $attempts,
            'last_error'      => substr($outcome['error'], 0, 2000),
            'next_attempt_at' => date('Y-m-d H:i:s', time() + $delay),
        ]);

        return ['ack' => false, 'dead' => $dead, 'error' => $outcome['error']];
    }

    /**
     * Retire the events of a document whose journal Books definitively refused and which has
     * therefore been reversed.
     *
     * Only called when Books ANSWERED that it applied nothing, so there is no journal to undo
     * and no reason to spend twenty more round trips being refused the same way. DEAD is the
     * existing terminal status — the dispatcher already skips it, the dashboard already counts
     * it and the operator screens already list it — so the row stays visible with the reason on
     * it rather than disappearing.
     *
     * Bounded to this episode by event_id: an older event for the same document, from a posting
     * that was reversed weeks ago, is not this posting's to close.
     */
    public function abandonForDocument(int $cmpId, int $documentId, int $fromEventId, string $reason): int
    {
        $db = \Config\Database::connect();
        $db->table('inv_integration_events')
            ->where('cmp_id', $cmpId)
            ->where('aggregate_type', 'document')
            ->where('aggregate_id', $documentId)
            ->where('event_id >=', $fromEventId)
            ->whereIn('event_type', ['inventory.document.posted', 'inventory.document.reversed'])
            ->whereIn('status', ['PENDING', 'FAILED'])
            ->update([
                'status'          => 'DEAD',
                'last_error'      => substr('Not deliverable: ' . $reason, 0, 2000),
                'next_attempt_at' => null,
            ]);

        return $db->affectedRows();
    }

    /**
     * Finish the reversals the synchronous handoff decided on but could not complete.
     *
     * This never decides anything. A row is only REVERSAL_PENDING because, on a request a user
     * was waiting on, Books refused or could not be reached and this code already chose to take
     * the document back off the books; the worker then died, or the reversal itself failed. The
     * sweep re-runs exactly that reversal.
     *
     * @return array{reversed:int, failed:int}
     */
    public function settleBooksHandoffs(int $limit = 20): array
    {
        $out = ['reversed' => 0, 'failed' => 0];
        $tracker = $this->handoffTracker();
        try {
            $due = $tracker->dueRepairs($limit);
        } catch (\Throwable $e) {
            log_message('error', 'Books journal handoff repairs could not be read: {msg}', ['msg' => $e->getMessage()]);

            return $out;
        }
        foreach ($due as $row) {
            $handoffId = (int) $row['handoff_id'];
            $reason = (string) ($row['last_error'] ?? 'Books did not take the journal');
            try {
                $posting = $this->postingService();
                $posting->reverse((int) $row['cmp_id'], (int) $row['document_id'], (string) ($row['created_by'] ?? '') ?: null, 'Reversed: ' . mb_substr($reason, 0, 400));
                $tracker->transition($handoffId, BooksJournalHandoffTracker::REVERSED, [
                    'last_error' => mb_substr('Document reversed by the outbox sweep after a refused journal: ' . $reason, 0, 4000),
                ]);
                $out['reversed']++;
            } catch (\Throwable $e) {
                $tracker->recordFailure($handoffId, BooksJournalHandoffTracker::REVERSAL_PENDING, $e->getMessage());
                log_message('error', 'Could not reverse document {doc} whose journal Books refused: {msg}', ['doc' => (int) $row['document_id'], 'msg' => $e->getMessage()]);
                $out['failed']++;
            }
        }

        return $out;
    }

    protected function handoffTracker(): BooksJournalHandoffTracker
    {
        return $this->handoffs ??= new BooksJournalHandoffTracker();
    }

    /** Built on demand: DocumentPostingService constructs an OutboxService of its own. */
    protected function postingService(): DocumentPostingService
    {
        return new DocumentPostingService();
    }

    /**
     * Mark the valuation revisions Books reported taking into its ledger, from the response
     * body of the delivery we just made.
     *
     * WHY THE ACK ARRIVES THIS WAY — PHP-FPM CROSS-POOL STARVATION
     * ------------------------------------------------------------
     * Books used to acknowledge by calling Inventory back on POST
     * /api/v1/valuation/revisions/ack while serving this very request. That parked a second
     * Inventory worker on a request Inventory was already waiting on, and that worker's
     * authorize() drained the outbox straight back into Books:
     *
     *   Inventory outbox -> books /integration/inventory/events
     *     -> books acknowledgeRevisions() -> inventory /v1/valuation/revisions/ack
     *       -> inventory authorize() -> outbox -> books /integration/inventory/events -> ...
     *
     * Books and Inventory are separate PHP-FPM pools with small pm.max_children. Nothing
     * recurses in the application sense — each process makes one call and blocks — so no
     * in-process check could detect it; what runs out is workers, in both pools at once,
     * and the queue answers 504.
     *
     * The acknowledgement now rides back on the response we were already waiting for, and is
     * applied here with the same UPDATE ValuationController::ackRevisions() performs. No
     * second connection, no second worker, and the ack still lands in the same moment.
     *
     * Best effort by contract: a failure leaves the revision in the unacknowledged
     * reconciliation bucket, which is exactly where the old direct call left it when it
     * failed. It must never fail the delivery — the event itself was accepted.
     *
     * @param array{ok:bool, status:int, body:?array, error:?string} $result
     */
    protected function applyPiggybackedRevisionAcks(int $cmpId, array $result): void
    {
        if ($cmpId <= 0) {
            return;
        }

        $ids = [];
        foreach (self::eventResults($result) as $eventResult) {
            $fromEvent = $eventResult['ack_revision_ids'] ?? null;
            if (!is_array($fromEvent)) {
                continue;
            }
            foreach ($fromEvent as $id) {
                $id = (int) $id;
                if ($id > 0) {
                    $ids[] = $id;
                }
            }
        }

        $ids = array_values(array_unique($ids));
        if ($ids === []) {
            return;
        }
        // Same bound the endpoint enforces, so a malformed or hostile body cannot turn one
        // acknowledgement into an unbounded UPDATE.
        if (count($ids) > 5000) {
            $ids = array_slice($ids, 0, 5000);
        }

        try {
            $db = \Config\Database::connect();
            $now = date('Y-m-d H:i:s');
            foreach (array_chunk($ids, 500) as $chunk) {
                $db->table('inv_valuation_revisions')
                    ->where('cmp_id', $cmpId)
                    ->whereIn('revision_id', $chunk)
                    ->where('acknowledged_at', null)
                    ->update(['acknowledged_at' => $now, 'acknowledged_by_app' => 'books']);
            }
        } catch (\Throwable $e) {
            log_message('warning', 'Could not apply piggybacked revision acks for company {cmp}: {msg}', ['cmp' => $cmpId, 'msg' => $e->getMessage()]);
        }
    }

    /**
     * Per-event results inside a Books delivery response, whatever shape it arrived in.
     *
     * @param array{ok:bool, status:int, body:?array, error:?string} $result
     * @return list<array<string,mixed>>
     */
    protected static function eventResults(array $result): array
    {
        $body = $result['body'] ?? null;
        if (!is_array($body)) {
            return [];
        }
        $data = $body['data'] ?? null;
        if (!is_array($data)) {
            return [];
        }
        if (!array_is_list($data)) {
            return [$data];
        }

        return array_values(array_filter($data, 'is_array'));
    }

    /**
     * What one delivery attempt did to the outbox row.
     *
     * An event Books could not apply must never be ACKed: the row would be closed with
     * last_error null while the COGS revision (or posting acknowledgement) it carried never
     * reached the ledger, and nothing would ever redeliver it. Books now answers non-2xx when
     * it failed to apply anything in the batch, but the per-event status in the body is checked
     * too, so a Books build that still answers 200 (or a deploy where Inventory is ahead)
     * cannot silently drop an event either.
     *
     * @param array{ok:bool, status:int, body:?array, error:?string} $result
     * @return array{ack:bool, error:string}
     */
    public static function deliveryOutcome(array $result): array
    {
        $applyError = self::applyFailure($result);
        if (($result['ok'] ?? false) && $applyError === null) {
            return ['ack' => true, 'error' => ''];
        }

        return ['ack' => false, 'error' => (string) (($result['error'] ?? null) ?: $applyError ?: 'Books did not acknowledge the event')];
    }

    /**
     * The reason Books gave for not applying a delivery, or null when it applied everything it
     * was sent. Books returns {data:[{event_id, status, error}, ...]} — one entry per event in
     * the POST — and status='failed' there means the event must be redelivered.
     *
     * @param array{ok:bool, status:int, body:?array, error:?string} $result
     */
    private static function applyFailure(array $result): ?string
    {
        $events = $result['body']['data'] ?? null;
        if (!is_array($events)) {
            return null;
        }
        $messages = [];
        foreach ($events as $event) {
            if (!is_array($event) || ($event['status'] ?? '') !== 'failed') {
                continue;
            }
            $messages[] = trim((string) ($event['event_type'] ?? $event['event_id'] ?? 'event')) . ': '
                . (string) ($event['error'] ?? 'not applied');
        }

        return $messages === [] ? null : 'Books did not apply the event — ' . implode('; ', $messages);
    }

    public function replay(int $cmpId, int $eventId): bool
    {
        $db = \Config\Database::connect();
        $db->table('inv_integration_events')->where('cmp_id', $cmpId)->where('event_id', $eventId)
            ->update(['status' => 'PENDING', 'next_attempt_at' => date('Y-m-d H:i:s')]);

        return $db->affectedRows() > 0;
    }
}
