-- 010: the synchronous Inventory -> Books journal handoff.
--
-- Posting a stock document used to write the document, commit, and leave an outbox row for
-- the dispatcher to deliver a minute later. Between those two moments stock had moved and no
-- accounting entry existed. The journal is now accepted by Books BEFORE the user is told the
-- post worked, and this table is the durable record of that handshake.
--
-- One row per attempted handoff, claimed INSIDE the document's own transaction (so it is on
-- disk before the HTTP call, not after) and settled after it. The row exists to name the
-- residual window: Inventory committed, Books may or may not have accepted, and the worker
-- died before the outcome could be recorded. inv_integration_events still carries the event
-- itself — this says what the synchronous attempt made of it.
CREATE TABLE IF NOT EXISTS inv_books_journal_handoffs (
    handoff_id      BIGSERIAL   PRIMARY KEY,
    cmp_id          BIGINT      NOT NULL,
    document_id     BIGINT      NOT NULL,
    document_uuid   UUID        NULL,
    -- The inv_integration_events row this handoff delivers. Books is idempotent on its
    -- event_uuid, which is what makes the synchronous send and a later redelivery one journal.
    event_id        BIGINT      NOT NULL,
    -- AWAITING_BOOKS  claimed, outcome not yet known (the residual window)
    -- ACCEPTED        Books took the event; nothing more to do
    -- REVERSAL_PENDING Books refused or could not be reached; the document must be reversed
    -- REVERSED        the document was reversed, so no stock moved without a journal
    -- ABANDONED       closed by hand / by reconciliation
    state           VARCHAR(24) NOT NULL DEFAULT 'AWAITING_BOOKS',
    attempts        INT         NOT NULL DEFAULT 0,
    books_status    INT         NULL,
    last_error      TEXT        NULL,
    next_retry_at   TIMESTAMP   NULL,
    created_by      VARCHAR(64) NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at    TIMESTAMP   NULL
);
-- One handoff per outbox event: the claim is idempotent under a retried post.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_books_handoff_event ON inv_books_journal_handoffs (event_id);
CREATE INDEX IF NOT EXISTS idx_inv_books_handoff_due ON inv_books_journal_handoffs (state, next_retry_at)
    WHERE state IN ('AWAITING_BOOKS', 'REVERSAL_PENDING');
CREATE INDEX IF NOT EXISTS idx_inv_books_handoff_doc ON inv_books_journal_handoffs (cmp_id, document_id);
