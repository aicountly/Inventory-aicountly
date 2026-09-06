-- Migration 003: Valuation — cost layers, weighted-average state, revaluation and
-- backdated recalculation queue.
--
-- Valuation scope follows inv_company_settings.valuation_scope. Books valued stock per
-- COMPANY-ITEM (its cost layers carry no material centre), so migrated layers have
-- warehouse_id NULL and 'company' scope preserves every historical COGS figure.

-- <- books_inventory_cost_layers (layer_id preserved)
CREATE TABLE IF NOT EXISTS inv_cost_layers (
    layer_id            BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NOT NULL,
    item_id             BIGINT      NOT NULL,
    warehouse_id        BIGINT      NULL,                          -- NULL = company scope
    batch_id            BIGINT      NULL,
    layer_kind          VARCHAR(16) NOT NULL DEFAULT 'receipt',    -- opening | receipt | backorder | revaluation
    qty_received        NUMERIC(18,4) NULL,
    qty_remaining       NUMERIC(18,4) NOT NULL,
    unit_cost           NUMERIC(18,4) NOT NULL,
    received_at         TIMESTAMP   NOT NULL,
    source_document_id  BIGINT      NULL,
    source_line_id      BIGINT      NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_cost_layers_item ON inv_cost_layers (cmp_id, item_id, COALESCE(warehouse_id, 0), received_at, layer_id);
CREATE INDEX IF NOT EXISTS idx_inv_cost_layers_open ON inv_cost_layers (cmp_id, item_id) WHERE qty_remaining > 0;
CREATE INDEX IF NOT EXISTS idx_inv_cost_layers_source ON inv_cost_layers (source_document_id);

-- Consumption trail: which layers an issue consumed (needed for reversal + FIFO audit).
CREATE TABLE IF NOT EXISTS inv_cost_layer_consumptions (
    consumption_id      BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    layer_id            BIGINT      NOT NULL,
    document_id         BIGINT      NOT NULL,
    line_id             BIGINT      NOT NULL,
    movement_id         BIGINT      NULL,
    qty                 NUMERIC(18,4) NOT NULL,
    unit_cost           NUMERIC(18,4) NOT NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_cost_layer_consumptions_layer ON inv_cost_layer_consumptions (layer_id);
CREATE INDEX IF NOT EXISTS idx_inv_cost_layer_consumptions_line ON inv_cost_layer_consumptions (line_id);

-- <- books_inventory_wac_state
CREATE TABLE IF NOT EXISTS inv_wac_state (
    cmp_id              BIGINT      NOT NULL,
    item_id             BIGINT      NOT NULL,
    warehouse_id        BIGINT      NOT NULL DEFAULT 0,             -- 0 = company scope
    qty_on_hand         NUMERIC(18,4) NOT NULL DEFAULT 0,
    average_cost        NUMERIC(18,4) NOT NULL DEFAULT 0,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cmp_id, item_id, warehouse_id)
);

-- Landed cost allocations (freight, duty, insurance ... spread over receipt lines)
CREATE TABLE IF NOT EXISTS inv_landed_costs (
    landed_cost_id      BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    document_id         BIGINT      NOT NULL,                      -- LANDED_COST document
    target_document_id  BIGINT      NOT NULL,                      -- receipt being loaded
    cost_type           VARCHAR(32) NOT NULL,                      -- freight | duty | insurance | handling | other
    amount              NUMERIC(18,4) NOT NULL,
    allocation_basis    VARCHAR(16) NOT NULL DEFAULT 'value',      -- value | qty | weight | manual
    books_acc_ref       BIGINT      NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inv_landed_cost_lines (
    id                  BIGSERIAL PRIMARY KEY,
    landed_cost_id      BIGINT      NOT NULL,
    cmp_id              BIGINT      NOT NULL,
    target_line_id      BIGINT      NOT NULL,
    allocated_amount    NUMERIC(18,4) NOT NULL,
    per_unit_amount     NUMERIC(18,4) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_landed_cost_lines_lc ON inv_landed_cost_lines (landed_cost_id);

-- ---------------------------------------------------------------------------
-- Backdated recalculation queue. A backdated receipt / issue / revaluation enqueues a job
-- for (company, item, from_date). The worker replays layers from the opening, rewrites
-- valuation_rate / valuation_amount on every affected line, records each change in
-- inv_valuation_revisions and publishes them to Books through the outbox.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_valuation_recalc_jobs (
    job_id              BIGSERIAL PRIMARY KEY,
    job_uuid            UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NULL,
    item_id             BIGINT      NULL,                          -- NULL = all items
    warehouse_id        BIGINT      NULL,
    from_date           DATE        NOT NULL,
    to_date             DATE        NULL,
    trigger_kind        VARCHAR(32) NOT NULL,                      -- backdated_document | reversal | revaluation | method_change | manual | migration_rebuild
    trigger_document_id BIGINT      NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'QUEUED',     -- QUEUED | RUNNING | COMPLETED | FAILED | CANCELLED
    dry_run             SMALLINT    NOT NULL DEFAULT 0,
    affected_documents_json JSONB   NULL,
    affected_line_count INT         NOT NULL DEFAULT 0,
    revised_line_count  INT         NOT NULL DEFAULT 0,
    cogs_delta          NUMERIC(18,4) NOT NULL DEFAULT 0,
    failure_reason      TEXT        NULL,
    requested_by        VARCHAR(64) NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at          TIMESTAMP   NULL,
    finished_at         TIMESTAMP   NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_valuation_recalc_jobs_uuid ON inv_valuation_recalc_jobs (job_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_valuation_recalc_jobs_status ON inv_valuation_recalc_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_valuation_recalc_jobs_cmp ON inv_valuation_recalc_jobs (cmp_id, created_at);

CREATE TABLE IF NOT EXISTS inv_valuation_revisions (
    revision_id         BIGSERIAL PRIMARY KEY,
    revision_uuid       UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    job_id              BIGINT      NOT NULL,
    document_id         BIGINT      NOT NULL,
    line_id             BIGINT      NOT NULL,
    source_app          VARCHAR(24) NULL,
    source_document_type VARCHAR(48) NULL,
    source_document_id  BIGINT      NULL,
    source_document_uuid UUID       NULL,
    old_valuation_rate  NUMERIC(18,4) NULL,
    new_valuation_rate  NUMERIC(18,4) NULL,
    old_valuation_amount NUMERIC(18,4) NULL,
    new_valuation_amount NUMERIC(18,4) NULL,
    delta_amount        NUMERIC(18,4) NOT NULL DEFAULT 0,
    published_at        TIMESTAMP   NULL,
    acknowledged_at     TIMESTAMP   NULL,
    acknowledged_by_app VARCHAR(24) NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_valuation_revisions_uuid ON inv_valuation_revisions (revision_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_valuation_revisions_job ON inv_valuation_revisions (job_id);
CREATE INDEX IF NOT EXISTS idx_inv_valuation_revisions_doc ON inv_valuation_revisions (document_id);
CREATE INDEX IF NOT EXISTS idx_inv_valuation_revisions_unack ON inv_valuation_revisions (cmp_id) WHERE acknowledged_at IS NULL;
