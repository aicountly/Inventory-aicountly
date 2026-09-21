<?php

namespace App\Services;

/**
 * Persistence for the synchronous Inventory -> Books journal handoff
 * (inv_books_journal_handoffs).
 *
 * States: AWAITING_BOOKS -> ACCEPTED
 *         AWAITING_BOOKS -> REVERSAL_PENDING -> REVERSED
 *
 * WHY THE ROW IS CLAIMED BEFORE THE CALL, NEVER AFTER
 * ---------------------------------------------------
 * {@see claim()} is called inside the document's own transaction, so it commits with the
 * document and is on disk before anything is sent. The orphan bug earlier in this project was
 * a tracker row written on the connection whose rollback it was meant to outlive: it
 * disappeared with the work it was the only record of. Here the row must outlive a *worker*,
 * not a rollback — max_execution_time or a killed pool child between the commit and the reply
 * from Books — so it is committed with the document and settled afterwards.
 *
 * Every write is best effort and swallows its own failure: this is a record OF a posting, not
 * part of one, and it must never be the reason a document that posted cleanly reports an
 * error. The one thing it may not do is lie, so a failed write is logged.
 */
class BooksJournalHandoffTracker
{
    public const AWAITING_BOOKS = 'AWAITING_BOOKS';
    public const ACCEPTED = 'ACCEPTED';
    public const REVERSAL_PENDING = 'REVERSAL_PENDING';
    public const REVERSED = 'REVERSED';
    public const ABANDONED = 'ABANDONED';

    private const TABLE = 'inv_books_journal_handoffs';

    private static ?bool $tableKnown = null;

    /** Beyond this the row stops being retried and waits for a human; reconcile still reports it. */
    public const MAX_REPAIR_ATTEMPTS = 12;

    /**
     * The table is the feature switch.
     *
     * Code deploys and SQL migrations are separate steps on this deployment, and a build that
     * reached the servers before 010 did must behave exactly as the build before it — queue the
     * event and let the dispatcher deliver it — rather than fail every post on a missing table.
     */
    public static function tableExists(): bool
    {
        if (self::$tableKnown === null) {
            try {
                self::$tableKnown = \Config\Database::connect()->tableExists(self::TABLE, false);
            } catch (\Throwable $e) {
                log_message('error', 'Could not check for ' . self::TABLE . ': {msg}', ['msg' => $e->getMessage()]);
                self::$tableKnown = false;
            }
        }

        return self::$tableKnown;
    }

    /** Test seam, and the way a long-lived worker picks the table up after 010 lands. */
    public static function forgetTableProbe(?bool $pretend = null): void
    {
        self::$tableKnown = $pretend;
    }

    /**
     * Claim the handoff for an outbox event. MUST be called inside the document's transaction.
     *
     * @return int the handoff id, or 0 when nothing was recorded
     */
    public function claim(int $cmpId, int $documentId, ?string $documentUuid, int $eventId, ?string $actor): int
    {
        if (!self::tableExists() || $eventId <= 0) {
            return 0;
        }
        $now = date('Y-m-d H:i:s');
        try {
            $db = \Config\Database::connect();
            $db->table(self::TABLE)->insert([
                'cmp_id'        => $cmpId,
                'document_id'   => $documentId,
                'document_uuid' => $documentUuid,
                'event_id'      => $eventId,
                'state'         => self::AWAITING_BOOKS,
                'attempts'      => 0,
                'created_by'    => $actor,
                'created_at'    => $now,
                'updated_at'    => $now,
            ]);

            return (int) $db->insertID();
        } catch (\Throwable $e) {
            // Inside the document's transaction, so on PostgreSQL a failed INSERT has already
            // aborted it and the post will fail on the next statement anyway — which is the
            // correct outcome: without this row the synchronous handoff has no durable record.
            log_message('error', 'Could not claim the Books journal handoff for document {doc}: {msg}', ['doc' => $documentId, 'msg' => $e->getMessage()]);
            throw $e;
        }
    }

    /** @return array<string, mixed>|null */
    public function find(int $handoffId): ?array
    {
        if (!self::tableExists() || $handoffId <= 0) {
            return null;
        }
        // DBDebug is off in every deployed environment: ->get() answers false on a query error
        // and ->getRowArray() on false is a fatal with no message.
        $q = \Config\Database::connect()->table(self::TABLE)->where('handoff_id', $handoffId)->get();

        return $q === false ? null : ($q->getRowArray() ?: null);
    }

    /** @param array<string, mixed> $fields */
    public function transition(int $handoffId, string $state, array $fields = []): void
    {
        if (!self::tableExists() || $handoffId <= 0) {
            return;
        }
        $row = array_merge(['state' => $state, 'updated_at' => date('Y-m-d H:i:s')], $fields);
        if (in_array($state, [self::ACCEPTED, self::REVERSED, self::ABANDONED], true) && !array_key_exists('completed_at', $row)) {
            $row['completed_at'] = date('Y-m-d H:i:s');
            $row['next_retry_at'] = null;
        }
        $this->write(static fn ($db) => $db->table(self::TABLE)->where('handoff_id', $handoffId)->update($row), $handoffId);
    }

    /** Record one failed repair attempt and schedule the next. */
    public function recordFailure(int $handoffId, string $state, string $error): void
    {
        if (!self::tableExists() || $handoffId <= 0) {
            return;
        }
        $attempts = (int) ($this->find($handoffId)['attempts'] ?? 0) + 1;
        $this->write(static fn ($db) => $db->table(self::TABLE)->where('handoff_id', $handoffId)->update([
            'state'         => $state,
            'attempts'      => $attempts,
            'last_error'    => mb_substr($error, 0, 4000),
            'next_retry_at' => $attempts >= self::MAX_REPAIR_ATTEMPTS ? null : date('Y-m-d H:i:s', time() + self::backoffSeconds($attempts)),
            'updated_at'    => date('Y-m-d H:i:s'),
        ]), $handoffId);
    }

    /**
     * Close the handoff an outbox delivery just settled.
     *
     * This is the residual window's own ending: the synchronous send got as far as Books and
     * the worker died before it could record that, so the row still reads AWAITING_BOOKS while
     * the event is delivered by the dispatcher a minute later. Books is idempotent on the
     * event_uuid, so that redelivery is the same journal, not a second one.
     */
    public function completeForEvent(int $eventId): void
    {
        if (!self::tableExists() || $eventId <= 0) {
            return;
        }
        $now = date('Y-m-d H:i:s');
        $this->write(static fn ($db) => $db->table(self::TABLE)
            ->where('event_id', $eventId)
            ->where('state', self::AWAITING_BOOKS)
            ->update(['state' => self::ACCEPTED, 'last_error' => null, 'next_retry_at' => null, 'completed_at' => $now, 'updated_at' => $now]), 0);
    }

    /**
     * Handoffs whose repair is due: a reversal this code already decided on, in a request the
     * user was present for, that did not finish. Nothing here ever decides to reverse — it only
     * finishes an interrupted decision.
     *
     * @return list<array<string, mixed>>
     */
    public function dueRepairs(int $limit = 20): array
    {
        if (!self::tableExists()) {
            return [];
        }
        $q = \Config\Database::connect()->table(self::TABLE)
            ->where('state', self::REVERSAL_PENDING)
            ->where('attempts <', self::MAX_REPAIR_ATTEMPTS)
            ->groupStart()->where('next_retry_at', null)->orWhere('next_retry_at <=', date('Y-m-d H:i:s'))->groupEnd()
            ->orderBy('handoff_id', 'ASC')->limit($limit)->get();
        if ($q === false) {
            // Same reasoning as OutboxService::dispatch(): an unreadable table is a database
            // fault, and answering "nothing due" would report it to the cron monitor as a healthy
            // quiet run while documents sat posted with no journal behind them.
            throw new \RuntimeException('Could not read ' . self::TABLE . ': the journal-handoff repair queue could not be read, so nothing was repaired.');
        }

        return $q->getResultArray();
    }

    /** Back-off: 30s, 1m, 2m, 4m ... capped at 30 minutes, the same shape Books uses. */
    public static function backoffSeconds(int $attempts): int
    {
        return (int) min(1800, 30 * (2 ** max(0, min(10, $attempts) - 1)));
    }

    /** @param callable(\CodeIgniter\Database\BaseConnection):mixed $fn */
    private function write(callable $fn, int $handoffId): void
    {
        try {
            $fn(\Config\Database::connect());
        } catch (\Throwable $e) {
            log_message('error', 'Could not update Books journal handoff {id}: {msg}', ['id' => $handoffId, 'msg' => $e->getMessage()]);
        }
    }
}
