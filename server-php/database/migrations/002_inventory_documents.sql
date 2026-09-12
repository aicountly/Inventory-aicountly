-- Migration 002: Inventory documents, lines, stock movements, balances, status buckets,
-- pending (challan / job work / deferred purchase) quantities, reservations, snapshots.
--
-- One inventory document = one physical stock event (native: transfer, adjustment,
-- production ... ; or the stock half of a Books commercial voucher: sales issue,
-- purchase receipt, sales return, purchase return, journal with item).
--
-- Migrated Books vouchers keep their identity: inv_documents.document_id =
-- books_voucher_headers.vch_txn_id and inv_document_lines.line_id =
-- books_voucher_inventory_lines.inv_line_id. New documents continue from the
-- sequence, which the migration resets above MAX(id).

-- ---------------------------------------------------------------------------
-- Document numbering series per company / FY / document type
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_document_series (
    series_id           BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    document_type       VARCHAR(32) NOT NULL,
    series_name         VARCHAR(128) NOT NULL DEFAULT 'Default',
    prefix              VARCHAR(32) NULL,
    suffix              VARCHAR(32) NULL,
    next_number         BIGINT      NOT NULL DEFAULT 1,
    min_num_length      SMALLINT    NOT NULL DEFAULT 0,
    numbering_mode      VARCHAR(16) NOT NULL DEFAULT 'auto',   -- auto | manual
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_document_series ON inv_document_series (cmp_id, fy_id, bo_id, document_type, series_name);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_documents (
    document_id         BIGSERIAL PRIMARY KEY,
    document_uuid       UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    fy_id               BIGINT      NOT NULL,
    document_type       VARCHAR(32) NOT NULL,
    document_no         VARCHAR(64) NULL,
    series_id           BIGINT      NULL,
    document_date       DATE        NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
        -- DRAFT | PENDING_APPROVAL | APPROVED | POSTING | POSTED | PARTIALLY_FULFILLED | COMPLETED | CANCELLED | REVERSED | FAILED
    -- Source (who created the business transaction)
    source_app          VARCHAR(24) NOT NULL DEFAULT 'inventory',   -- inventory | books | sales | purchases | pos | billing | migration
    source_document_type VARCHAR(48) NULL,                          -- e.g. books.sales, books.purchase, books.credit_note, books.debit_note, books.journal
    source_document_id  BIGINT      NULL,                           -- e.g. Books vch_txn_id
    source_document_uuid UUID       NULL,                           -- stable cross-service transaction id (Books vch_uuid)
    source_document_no  VARCHAR(64) NULL,
    source_document_date DATE       NULL,
    -- Parties / places (opaque references to Books ledgers / Manage branches)
    party_ref           BIGINT      NULL,                           -- Books acc_id (customer / supplier / job worker / consignee)
    party_name          VARCHAR(255) NULL,
    dest_party_ref      BIGINT      NULL,
    from_warehouse_id   BIGINT      NULL,
    to_warehouse_id     BIGINT      NULL,
    dest_bo_id          BIGINT      NULL,
    -- Behaviour flags
    stock_effect        VARCHAR(32) NULL,                           -- on_invoice | from_challan | defer_inward | settle_deferred | challan_only
    returnable          BOOLEAN     NULL,
    expected_return_date DATE       NULL,
    movement_reason     VARCHAR(64) NULL,
    reason_code         VARCHAR(32) NULL,
    narration           TEXT        NULL,
    currency_code       VARCHAR(8)  NOT NULL DEFAULT 'INR',
    exchange_rate       NUMERIC(18,6) NOT NULL DEFAULT 1,
    metadata_json       JSONB       NULL,                           -- production bom_id / production_qty / finished_rate, transport, packing marks ...
    accounting_effects_json JSONB   NULL,                           -- computed accounting impact handed to Books (see 004)
    -- Lifecycle
    reverses_document_id BIGINT     NULL,
    reversed_by_document_id BIGINT  NULL,
    approved_by         VARCHAR(64) NULL,
    approved_at         TIMESTAMP   NULL,
    posted_by           VARCHAR(64) NULL,
    posted_at           TIMESTAMP   NULL,
    cancelled_by        VARCHAR(64) NULL,
    cancelled_at        TIMESTAMP   NULL,
    cancel_reason       TEXT        NULL,
    failure_reason      TEXT        NULL,
    idempotency_key     VARCHAR(128) NULL,
    version             INT         NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL,
    legacy_vch_type_id  INT         NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_documents_uuid ON inv_documents (document_uuid);
-- Duplicate-posting guard: one inventory document per external source document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_documents_source
    ON inv_documents (cmp_id, source_app, source_document_type, source_document_id)
    WHERE source_document_id IS NOT NULL AND status NOT IN ('CANCELLED', 'REVERSED', 'FAILED');
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_documents_source_uuid
    ON inv_documents (cmp_id, source_document_uuid)
    WHERE source_document_uuid IS NOT NULL AND status NOT IN ('CANCELLED', 'REVERSED', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_inv_documents_cmp_fy_date ON inv_documents (cmp_id, fy_id, bo_id, document_date);
CREATE INDEX IF NOT EXISTS idx_inv_documents_cmp_type_status ON inv_documents (cmp_id, document_type, status);
CREATE INDEX IF NOT EXISTS idx_inv_documents_source ON inv_documents (source_app, source_document_type, source_document_id);
CREATE INDEX IF NOT EXISTS idx_inv_documents_party ON inv_documents (cmp_id, party_ref) WHERE party_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_documents_no ON inv_documents (cmp_id, document_no);
CREATE INDEX IF NOT EXISTS idx_inv_documents_legacy ON inv_documents (legacy_source_table, legacy_source_id);

-- ---------------------------------------------------------------------------
-- Document lines
-- qty is in the entered unit; base_qty in the item's base unit. Two value families are
-- kept apart on purpose:
--   source_transaction_rate / _amount : the COMMERCIAL figure the source app booked
--                                       (immutable audit snapshot, never the authority)
--   valuation_rate / valuation_amount : what the stock cost (Inventory authority; COGS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_document_lines (
    line_id             BIGSERIAL PRIMARY KEY,
    line_uuid           UUID        NOT NULL DEFAULT gen_random_uuid(),
    document_id         BIGINT      NOT NULL,
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    item_id             BIGINT      NOT NULL,
    warehouse_id        BIGINT      NULL,
    location_id         BIGINT      NULL,
    dest_warehouse_id   BIGINT      NULL,
    dest_location_id    BIGINT      NULL,
    batch_id            BIGINT      NULL,
    unit_id             BIGINT      NULL,
    direction           VARCHAR(4)  NOT NULL,                       -- in | out | none (challan_only / reservation)
    qty                 NUMERIC(18,4) NOT NULL DEFAULT 0,
    conversion_factor   NUMERIC(18,4) NOT NULL DEFAULT 1,
    base_qty            NUMERIC(18,4) NOT NULL DEFAULT 0,
    source_transaction_rate   NUMERIC(18,4) NULL,
    source_transaction_amount NUMERIC(18,4) NULL,
    source_fc_rate      NUMERIC(18,4) NULL,
    source_fc_amount    NUMERIC(18,4) NULL,
    source_exchange_rate NUMERIC(18,6) NULL,
    valuation_rate      NUMERIC(18,4) NULL,                          -- per BASE unit
    valuation_amount    NUMERIC(18,4) NULL,
    valuation_method_applied VARCHAR(8) NULL,
    landed_cost_amount  NUMERIC(18,4) NOT NULL DEFAULT 0,
    book_qty            NUMERIC(18,4) NULL,                          -- physical adjustment: system qty at count time
    physical_qty        NUMERIC(18,4) NULL,                          -- physical adjustment: counted qty
    books_tax_cat_id    BIGINT      NULL,                            -- snapshot of Books tax category ref
    hsn_sac             VARCHAR(16) NULL,
    source_line_ref     BIGINT      NULL,                            -- Books txn_id / commercial line id
    description         VARCHAR(512) NULL,
    sort_order          INT         NOT NULL DEFAULT 0,
    metadata_json       JSONB       NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_document_lines_uuid ON inv_document_lines (line_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_document_lines_doc ON inv_document_lines (document_id);
CREATE INDEX IF NOT EXISTS idx_inv_document_lines_cmp_item ON inv_document_lines (cmp_id, fy_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inv_document_lines_warehouse ON inv_document_lines (cmp_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inv_document_lines_batch ON inv_document_lines (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_document_lines_legacy ON inv_document_lines (legacy_source_table, legacy_source_id);

-- Serial numbers attached to a line (issued / received).
CREATE TABLE IF NOT EXISTS inv_document_line_serials (
    id                  BIGSERIAL PRIMARY KEY,
    line_id             BIGINT      NOT NULL,
    document_id         BIGINT      NOT NULL,
    cmp_id              BIGINT      NOT NULL,
    serial_id           BIGINT      NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_document_line_serials ON inv_document_line_serials (line_id, serial_id);
CREATE INDEX IF NOT EXISTS idx_inv_document_line_serials_serial ON inv_document_line_serials (serial_id);

-- ---------------------------------------------------------------------------
-- Stock movements: the append-only stock ledger. One row per (line, direction).
-- qty is SIGNED in base units (+in / -out). Reversal inserts opposite rows, never deletes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_stock_movements (
    movement_id         BIGSERIAL PRIMARY KEY,
    movement_uuid       UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    document_id         BIGINT      NOT NULL,
    line_id             BIGINT      NOT NULL,
    document_type       VARCHAR(32) NOT NULL,
    movement_date       DATE        NOT NULL,
    sequence_no         BIGINT      NOT NULL DEFAULT 0,             -- ordering within a day (document_id, line_id)
    item_id             BIGINT      NOT NULL,
    warehouse_id        BIGINT      NULL,
    location_id         BIGINT      NULL,
    batch_id            BIGINT      NULL,
    direction           VARCHAR(4)  NOT NULL,                       -- in | out
    qty                 NUMERIC(18,4) NOT NULL,                     -- signed, base unit
    unit_cost           NUMERIC(18,4) NULL,
    value               NUMERIC(18,4) NULL,                         -- signed
    movement_kind       VARCHAR(24) NOT NULL DEFAULT 'physical',    -- physical | reversal | revaluation
    reversal_of_movement_id BIGINT  NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          VARCHAR(64) NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_stock_movements_uuid ON inv_stock_movements (movement_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_stock_movements_line
    ON inv_stock_movements (line_id, direction, movement_kind, COALESCE(reversal_of_movement_id, 0));
CREATE INDEX IF NOT EXISTS idx_inv_stock_movements_item_date ON inv_stock_movements (cmp_id, item_id, movement_date, document_id, line_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_movements_wh_item ON inv_stock_movements (cmp_id, warehouse_id, item_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_inv_stock_movements_fy ON inv_stock_movements (cmp_id, fy_id, bo_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_inv_stock_movements_doc ON inv_stock_movements (document_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_movements_batch ON inv_stock_movements (batch_id) WHERE batch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Stock balances (materialised, base unit). Rebuilt from movements at any time;
-- kept current on every posting for POS-speed availability.
--   on_hand      physical quantity in the warehouse (all statuses)
--   available    = on_hand - reserved - packed - quality_hold - damaged - blocked (derived at read)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_stock_balances (
    balance_id          BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    item_id             BIGINT      NOT NULL,
    warehouse_id        BIGINT      NULL,
    batch_id            BIGINT      NULL,
    on_hand_qty         NUMERIC(18,4) NOT NULL DEFAULT 0,
    reserved_qty        NUMERIC(18,4) NOT NULL DEFAULT 0,
    committed_qty       NUMERIC(18,4) NOT NULL DEFAULT 0,
    packed_qty          NUMERIC(18,4) NOT NULL DEFAULT 0,
    in_transit_qty      NUMERIC(18,4) NOT NULL DEFAULT 0,
    job_worker_qty      NUMERIC(18,4) NOT NULL DEFAULT 0,
    quality_hold_qty    NUMERIC(18,4) NOT NULL DEFAULT 0,
    damaged_qty         NUMERIC(18,4) NOT NULL DEFAULT 0,
    blocked_qty         NUMERIC(18,4) NOT NULL DEFAULT 0,
    expected_qty        NUMERIC(18,4) NOT NULL DEFAULT 0,
    last_movement_at    TIMESTAMP   NULL,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_stock_balances_key
    ON inv_stock_balances (cmp_id, item_id, COALESCE(warehouse_id, 0), COALESCE(batch_id, 0));
CREATE INDEX IF NOT EXISTS idx_inv_stock_balances_wh ON inv_stock_balances (cmp_id, warehouse_id);

-- Status-bucket transitions (pack / unpack / send to job worker / reserve ...), append-only.
-- <- books_stock_bucket_ledger (ledger_id preserved)
CREATE TABLE IF NOT EXISTS inv_stock_status_movements (
    ledger_id           BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    item_id             BIGINT      NOT NULL,
    unit_id             BIGINT      NULL,
    warehouse_id        BIGINT      NULL,
    batch_id            BIGINT      NULL,
    document_id         BIGINT      NOT NULL,
    movement_type       VARCHAR(32) NOT NULL,   -- pack | unpack | sale_issue | job_work_send | job_work_return | job_work_consume | job_work_receive | reserve | release | hold | unhold | damage | transit_out | transit_in
    qty                 NUMERIC(18,4) NOT NULL, -- entered unit
    base_qty            NUMERIC(18,4) NOT NULL DEFAULT 0,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_stock_status_movements_doc ON inv_stock_status_movements (document_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_status_movements_item ON inv_stock_status_movements (cmp_id, item_id);

-- ---------------------------------------------------------------------------
-- Pending quantities: goods out on challan / with job worker / purchase invoiced but not
-- yet received. Settled by a later document. <- books_inventory_pending (pending_id preserved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_pending_quantities (
    pending_id          BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NOT NULL,
    document_id         BIGINT      NOT NULL,
    line_id             BIGINT      NULL,
    pending_kind        VARCHAR(32) NOT NULL DEFAULT 'challan',  -- challan | deferred_purchase | job_work
    direction           VARCHAR(8)  NOT NULL,                    -- in | out
    item_id             BIGINT      NOT NULL,
    unit_id             BIGINT      NULL,
    warehouse_id        BIGINT      NULL,
    party_ref           BIGINT      NULL,
    qty_original        NUMERIC(18,4) NOT NULL,
    qty_settled         NUMERIC(18,4) NOT NULL DEFAULT 0,
    status              VARCHAR(16) NOT NULL DEFAULT 'open',     -- open | partial | settled | cancelled
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_pending_cmp_open ON inv_pending_quantities (cmp_id, status, direction);
CREATE INDEX IF NOT EXISTS idx_inv_pending_doc ON inv_pending_quantities (document_id);
CREATE INDEX IF NOT EXISTS idx_inv_pending_party ON inv_pending_quantities (cmp_id, party_ref, direction, status);

-- <- books_inventory_settlement (settlement_id preserved)
CREATE TABLE IF NOT EXISTS inv_pending_settlements (
    settlement_id       BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    pending_id          BIGINT      NOT NULL,
    settle_document_id  BIGINT      NOT NULL,
    settle_line_id      BIGINT      NULL,
    settlement_type     VARCHAR(16) NULL,                       -- consumed | returned (job work)
    qty_settled         NUMERIC(18,4) NOT NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_pending_settlements_pending ON inv_pending_settlements (pending_id);
CREATE INDEX IF NOT EXISTS idx_inv_pending_settlements_doc ON inv_pending_settlements (settle_document_id);

-- Packing list state <- books_voucher_packing_meta (keyed by document_id = vch_txn_id)
CREATE TABLE IF NOT EXISTS inv_packing_meta (
    document_id         BIGINT      PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    consignee_ref       BIGINT      NOT NULL,
    packing_status      VARCHAR(16) NOT NULL DEFAULT 'open',     -- open | locked | consumed | unpacked
    locked_by_document_id BIGINT    NULL,
    locked_by_external_ref VARCHAR(128) NULL,                     -- Books draft id while a sale is being keyed
    locked_at           TIMESTAMP   NULL,
    box_marks_json      JSONB       NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_packing_meta_cmp_status ON inv_packing_meta (cmp_id, packing_status);

-- ---------------------------------------------------------------------------
-- Reservations (soft allocation of available stock to an order / invoice draft)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_reservations (
    reservation_id      BIGSERIAL PRIMARY KEY,
    reservation_uuid    UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    document_id         BIGINT      NULL,
    item_id             BIGINT      NOT NULL,
    warehouse_id        BIGINT      NULL,
    batch_id            BIGINT      NULL,
    qty                 NUMERIC(18,4) NOT NULL,                  -- base unit
    fulfilled_qty       NUMERIC(18,4) NOT NULL DEFAULT 0,
    status              VARCHAR(16) NOT NULL DEFAULT 'active',    -- active | partially_fulfilled | fulfilled | released | expired
    source_app          VARCHAR(24) NOT NULL DEFAULT 'inventory',
    source_document_type VARCHAR(48) NULL,
    source_document_id  BIGINT      NULL,
    source_document_uuid UUID       NULL,
    expires_at          TIMESTAMP   NULL,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_reservations_uuid ON inv_reservations (reservation_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_reservations_item ON inv_reservations (cmp_id, item_id, warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_reservations_source ON inv_reservations (source_app, source_document_type, source_document_id);

-- ---------------------------------------------------------------------------
-- Immutable print snapshots for inventory documents <- books_movement_document_snapshots (snap_id preserved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_document_snapshots (
    snap_id                        BIGSERIAL PRIMARY KEY,
    cmp_id                         BIGINT NOT NULL,
    bo_id                          BIGINT NULL,
    document_id                    BIGINT NOT NULL,
    document_variant               VARCHAR(48) NOT NULL,
    document_no                    VARCHAR(64) NULL,
    document_date                  DATE NULL,
    currency_code                  VARCHAR(8) NOT NULL DEFAULT 'INR',
    header_snapshot_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_dest_snapshot_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    item_lines_snapshot_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
    transport_snapshot_json        JSONB NULL,
    variant_extras_snapshot_json   JSONB NULL,
    footer_snapshot_json           JSONB NULL,
    print_configuration_id         BIGINT NULL,
    print_configuration_version    INT NULL,
    template_version               VARCHAR(32) NOT NULL DEFAULT 'v1',
    status                         VARCHAR(16) NOT NULL DEFAULT 'active',
    legacy_reconstructed           BOOLEAN NOT NULL DEFAULT FALSE,
    created_by                     VARCHAR(64) NULL,
    created_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table            VARCHAR(64) NULL,
    legacy_source_id               BIGINT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_document_snapshots_doc ON inv_document_snapshots (cmp_id, document_id);
CREATE INDEX IF NOT EXISTS idx_inv_document_snapshots_variant ON inv_document_snapshots (cmp_id, document_variant, document_date);

-- ---------------------------------------------------------------------------
-- Period locks & approvals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_period_locks (
    lock_id             BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    locked_upto_date    DATE        NOT NULL,
    reason              TEXT        NULL,
    locked_by           VARCHAR(64) NULL,
    locked_at           TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_by         VARCHAR(64) NULL,
    released_at         TIMESTAMP   NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_period_locks_cmp ON inv_period_locks (cmp_id, bo_id, released_at);

CREATE TABLE IF NOT EXISTS inv_document_approvals (
    approval_id         BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    document_id         BIGINT      NOT NULL,
    action              VARCHAR(16) NOT NULL,        -- submitted | approved | rejected
    actor_uuid          VARCHAR(64) NULL,
    notes               TEXT        NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_document_approvals_doc ON inv_document_approvals (document_id);
