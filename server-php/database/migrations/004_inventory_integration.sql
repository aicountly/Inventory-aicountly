-- Migration 004: Integration — idempotency, outbox (integration events), inbound event log,
-- audit trail, reconciliation snapshots.

-- Durable request idempotency. Any request able to move stock must carry Idempotency-Key.
CREATE TABLE IF NOT EXISTS inv_idempotency_keys (
    id                  BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    idempotency_key     VARCHAR(128) NOT NULL,
    request_hash        VARCHAR(64) NULL,
    resource_type       VARCHAR(64) NOT NULL,
    resource_id         BIGINT      NULL,
    resource_uuid       UUID        NULL,
    response_status     SMALLINT    NULL,
    response_json       JSONB       NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_idempotency_keys ON inv_idempotency_keys (cmp_id, idempotency_key);

-- Outbox: events Inventory must deliver to other products (Books first).
CREATE TABLE IF NOT EXISTS inv_integration_events (
    event_id            BIGSERIAL PRIMARY KEY,
    event_uuid          UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    target_app          VARCHAR(24) NOT NULL DEFAULT 'books',
    event_type          VARCHAR(64) NOT NULL,      -- inventory.document.posted | inventory.document.reversed | inventory.accounting_effects | inventory.valuation.revised | inventory.item.changed ...
    aggregate_type      VARCHAR(32) NOT NULL,
    aggregate_id        BIGINT      NOT NULL,
    aggregate_uuid      UUID        NULL,
    payload_json        JSONB       NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'PENDING',   -- PENDING | SENT | ACKED | FAILED | DEAD
    attempts            INT         NOT NULL DEFAULT 0,
    next_attempt_at     TIMESTAMP   NULL,
    last_error          TEXT        NULL,
    sent_at             TIMESTAMP   NULL,
    acked_at            TIMESTAMP   NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_integration_events_uuid ON inv_integration_events (event_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_integration_events_due ON inv_integration_events (status, next_attempt_at) WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_inv_integration_events_agg ON inv_integration_events (aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_inv_integration_events_cmp ON inv_integration_events (cmp_id, created_at);

-- Inbound: events received from other products (dedup by event_uuid).
CREATE TABLE IF NOT EXISTS inv_inbound_events (
    id                  BIGSERIAL PRIMARY KEY,
    event_uuid          UUID        NOT NULL,
    cmp_id              BIGINT      NOT NULL,
    source_app          VARCHAR(24) NOT NULL,
    event_type          VARCHAR(64) NOT NULL,
    payload_json        JSONB       NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',  -- RECEIVED | PROCESSED | FAILED | IGNORED
    result_json         JSONB       NULL,
    error               TEXT        NULL,
    received_at         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at        TIMESTAMP   NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_inbound_events_uuid ON inv_inbound_events (event_uuid);

-- Audit trail for every sensitive change.
CREATE TABLE IF NOT EXISTS inv_audit_log (
    audit_id            BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    entity_type         VARCHAR(64) NOT NULL,
    entity_id           BIGINT      NOT NULL,
    entity_uuid         UUID        NULL,
    action              VARCHAR(48) NOT NULL,
    actor_uuid          VARCHAR(64) NULL,
    source_app          VARCHAR(24) NULL,
    source_document_type VARCHAR(48) NULL,
    source_document_id  BIGINT      NULL,
    source_document_uuid UUID       NULL,
    reason              TEXT        NULL,
    approval_ref        VARCHAR(64) NULL,
    reversal_ref        BIGINT      NULL,
    before_json         JSONB       NULL,
    after_json          JSONB       NULL,
    meta_json           JSONB       NULL,
    request_id          VARCHAR(64) NULL,
    ip_address          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_audit_log_entity ON inv_audit_log (cmp_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_inv_audit_log_cmp_time ON inv_audit_log (cmp_id, created_at);

-- Reconciliation runs: Inventory closing valuation vs Books stock ledger balance.
CREATE TABLE IF NOT EXISTS inv_reconciliation_runs (
    run_id              BIGSERIAL PRIMARY KEY,
    run_uuid            UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    as_of_date          DATE        NOT NULL,
    inventory_closing_value NUMERIC(18,4) NOT NULL DEFAULT 0,
    inventory_closing_qty   NUMERIC(18,4) NOT NULL DEFAULT 0,
    books_stock_ledger_balance NUMERIC(18,4) NULL,
    difference          NUMERIC(18,4) NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'COMPLETED',  -- COMPLETED | FAILED | BOOKS_UNAVAILABLE
    breakdown_json      JSONB       NULL,     -- opening_difference, pending_posting, failed_posting, manual_journal, backdated_recalc, revaluation, rounding, cancelled_reversed, missing_source
    document_status_json JSONB      NULL,     -- per composite transaction posting status
    requested_by        VARCHAR(64) NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_reconciliation_runs_cmp ON inv_reconciliation_runs (cmp_id, fy_id, created_at);

-- Local memory of financial-year date ranges learned from Manage (cache, not a master).
CREATE TABLE IF NOT EXISTS inv_fy_ranges (
    cmp_id      BIGINT NOT NULL,
    fy_id       BIGINT NOT NULL,
    fy_start    DATE   NOT NULL,
    fy_end      DATE   NOT NULL,
    updated_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cmp_id, fy_id)
);
