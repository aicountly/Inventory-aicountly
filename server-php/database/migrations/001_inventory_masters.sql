-- Migration 001: Inventory masters (items, groups, categories, brands, UOM, warehouses, BOM, openings).
--
-- Primary keys are BIGSERIAL and intentionally carry the SAME column names and the
-- SAME numeric values as the Books tables they were migrated from
-- (books_items.item_id -> inv_items.item_id, books_material_centres.mc_id ->
-- inv_warehouses.warehouse_id, ...). Every migrated row also records
-- legacy_source_table / legacy_source_id and a stable UUID for cross-service references.
--
-- Company, branch and financial year are Manage-owned: only their ids appear here
-- (cmp_id, bo_id, fy_id). There are deliberately no database-level foreign keys to
-- other services.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS inv_sql_migrations (
    id          BIGSERIAL PRIMARY KEY,
    filename    VARCHAR(255) NOT NULL UNIQUE,
    applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Company-level inventory settings (one row per company; created on first use)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_company_settings (
    cmp_id                      BIGINT PRIMARY KEY,
    default_valuation_method    VARCHAR(8)  NOT NULL DEFAULT 'FIFO',     -- FIFO | LIFO | WAC
    valuation_scope             VARCHAR(16) NOT NULL DEFAULT 'company',  -- company | warehouse (Books valued per company)
    negative_stock_policy       VARCHAR(8)  NOT NULL DEFAULT 'allow',    -- allow | warn | block
    approval_required           SMALLINT    NOT NULL DEFAULT 0,
    fefo_enabled                SMALLINT    NOT NULL DEFAULT 0,
    cogs_revision_mode          VARCHAR(16) NOT NULL DEFAULT 'inline',   -- inline (rewrite source COGS) | adjustment (journal on recalc date)
    base_currency_code          VARCHAR(8)  NOT NULL DEFAULT 'INR',
    settings_json               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at                  TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by                  VARCHAR(64) NULL
);

-- ---------------------------------------------------------------------------
-- Item groups (hierarchy)  <- books_item_groups (item_grp_id preserved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_item_groups (
    item_grp_id         BIGSERIAL PRIMARY KEY,
    item_grp_uuid       UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    grp_name            VARCHAR(255) NOT NULL,
    grp_alias           VARCHAR(64) NULL,
    parent_grp_id       BIGINT      NULL,
    is_primary          SMALLINT    NOT NULL DEFAULT 0,
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL,
    deleted_by          VARCHAR(64) NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_item_groups_uuid ON inv_item_groups (item_grp_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_item_groups_cmp ON inv_item_groups (cmp_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_item_groups_cmp_name ON inv_item_groups (cmp_id, bo_id, grp_name);
CREATE INDEX IF NOT EXISTS idx_inv_item_groups_parent ON inv_item_groups (parent_grp_id);

-- ---------------------------------------------------------------------------
-- Stock categories <- books_stock_categories (stock_cat_id preserved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_stock_categories (
    stock_cat_id        BIGSERIAL PRIMARY KEY,
    stock_cat_uuid      UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    cat_name            VARCHAR(255) NOT NULL,
    cat_alias           VARCHAR(64) NULL,
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL,
    deleted_by          VARCHAR(64) NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_stock_categories_uuid ON inv_stock_categories (stock_cat_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_stock_categories_cmp ON inv_stock_categories (cmp_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_stock_categories_cmp_name ON inv_stock_categories (cmp_id, bo_id, cat_name);

-- ---------------------------------------------------------------------------
-- Brands (new)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_brands (
    brand_id            BIGSERIAL PRIMARY KEY,
    brand_uuid          UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    brand_name          VARCHAR(255) NOT NULL,
    brand_alias         VARCHAR(64) NULL,
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL,
    deleted_by          VARCHAR(64) NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_brands_uuid ON inv_brands (brand_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_brands_cmp ON inv_brands (cmp_id, is_active);

-- ---------------------------------------------------------------------------
-- Units of measure <- books_item_units (unit_id preserved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_uom (
    unit_id             BIGSERIAL PRIMARY KEY,
    unit_uuid           UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    unit_name           VARCHAR(128) NOT NULL,
    unit_symbol         VARCHAR(16) NULL,
    print_name          VARCHAR(128) NULL,
    uqc_gst             VARCHAR(16) NULL,
    decimal_places      SMALLINT    NOT NULL DEFAULT 4,
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL,
    deleted_by          VARCHAR(64) NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_uom_uuid ON inv_uom (unit_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_uom_cmp ON inv_uom (cmp_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_uom_cmp_name ON inv_uom (cmp_id, bo_id, unit_name);

-- ---------------------------------------------------------------------------
-- Warehouse groups <- books_material_centre_groups (mc_grp_id preserved as warehouse_group_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_warehouse_groups (
    warehouse_group_id  BIGSERIAL PRIMARY KEY,
    warehouse_group_uuid UUID       NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    grp_name            VARCHAR(255) NOT NULL,
    parent_grp_id       BIGINT      NULL,
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL,
    deleted_by          VARCHAR(64) NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_warehouse_groups_uuid ON inv_warehouse_groups (warehouse_group_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_warehouse_groups_cmp ON inv_warehouse_groups (cmp_id, is_active);

-- ---------------------------------------------------------------------------
-- Warehouses (material centres) <- books_material_centres (mc_id preserved as warehouse_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_warehouses (
    warehouse_id        BIGSERIAL PRIMARY KEY,
    warehouse_uuid      UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    warehouse_name      VARCHAR(255) NOT NULL,
    warehouse_code      VARCHAR(32) NULL,
    warehouse_group_id  BIGINT      NULL,
    parent_warehouse_id BIGINT      NULL,
    warehouse_type      VARCHAR(16) NOT NULL DEFAULT 'standard',  -- standard | transit | damaged | quarantine | consignment | job_worker | virtual
    is_default          SMALLINT    NOT NULL DEFAULT 0,
    allow_negative      SMALLINT    NULL,                          -- NULL = follow company policy
    address_json        JSONB       NULL,
    contact_json        JSONB       NULL,
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL,
    deleted_by          VARCHAR(64) NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_warehouses_uuid ON inv_warehouses (warehouse_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_warehouses_cmp ON inv_warehouses (cmp_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_warehouses_cmp_name ON inv_warehouses (cmp_id, bo_id, warehouse_name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_warehouses_cmp_code ON inv_warehouses (cmp_id, warehouse_code) WHERE warehouse_code IS NOT NULL AND deleted_at IS NULL;

-- Bins / locations inside a warehouse (zone > rack > shelf > bin), self-referencing.
CREATE TABLE IF NOT EXISTS inv_locations (
    location_id         BIGSERIAL PRIMARY KEY,
    location_uuid       UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    warehouse_id        BIGINT      NOT NULL,
    parent_location_id  BIGINT      NULL,
    location_code       VARCHAR(64) NOT NULL,
    location_name       VARCHAR(255) NULL,
    location_type       VARCHAR(16) NOT NULL DEFAULT 'bin',   -- zone | rack | shelf | bin
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_locations_uuid ON inv_locations (location_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_locations_code ON inv_locations (cmp_id, warehouse_id, location_code) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Items <- books_items (item_id preserved)
-- books_sales_acc_id / books_purchase_acc_id / books_tax_cat_id are OPAQUE references to
-- Books-owned accounting masters (ledgers, tax categories). Inventory stores them so the
-- item master remains one screen, but never interprets them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_items (
    item_id             BIGSERIAL PRIMARY KEY,
    item_uuid           UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    item_name           VARCHAR(255) NOT NULL,
    item_alias          VARCHAR(255) NULL,
    print_name          VARCHAR(255) NULL,
    item_type           VARCHAR(16) NOT NULL DEFAULT 'stock',     -- stock | service | non_stock
    item_sku            VARCHAR(64) NULL,
    item_upc            VARCHAR(64) NULL,                         -- barcode / EAN / UPC
    hsn_sac             VARCHAR(16) NULL,
    mrp                 NUMERIC(18,4) NULL,
    unit_id             BIGINT      NULL,                          -- base UOM
    purchase_unit_id    BIGINT      NULL,
    sales_unit_id       BIGINT      NULL,
    stock_cat_id        BIGINT      NULL,
    item_grp_id         BIGINT      NULL,
    brand_id            BIGINT      NULL,
    parent_item_id      BIGINT      NULL,                          -- variant of
    variant_attributes_json JSONB   NULL,
    attributes_json     JSONB       NULL,
    valuation_method    VARCHAR(8)  NOT NULL DEFAULT 'FIFO',
    books_sales_acc_id  BIGINT      NULL,
    books_purchase_acc_id BIGINT    NULL,
    books_tax_cat_id    BIGINT      NULL,
    track_batch         SMALLINT    NOT NULL DEFAULT 0,
    track_serial        SMALLINT    NOT NULL DEFAULT 0,
    track_expiry        SMALLINT    NOT NULL DEFAULT 0,
    shelf_life_days     INT         NULL,
    negative_stock_policy VARCHAR(8) NULL,                        -- NULL = company policy
    min_stock_qty       NUMERIC(18,4) NULL,
    max_stock_qty       NUMERIC(18,4) NULL,
    reorder_point_qty   NUMERIC(18,4) NULL,
    reorder_qty         NUMERIC(18,4) NULL,
    safety_stock_qty    NUMERIC(18,4) NULL,
    lead_time_days      INT         NULL,
    default_warehouse_id BIGINT     NULL,
    standard_cost       NUMERIC(18,4) NULL,
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    version             INT         NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL,
    deleted_by          VARCHAR(64) NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_items_uuid ON inv_items (item_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_items_cmp ON inv_items (cmp_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_items_cmp_name ON inv_items (cmp_id, bo_id, item_name);
CREATE INDEX IF NOT EXISTS idx_inv_items_cmp_name_lower ON inv_items (cmp_id, lower(item_name));
CREATE INDEX IF NOT EXISTS idx_inv_items_cmp_alias_lower ON inv_items (cmp_id, lower(item_alias)) WHERE item_alias IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_items_cmp_sku ON inv_items (cmp_id, item_sku) WHERE item_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_items_cmp_upc ON inv_items (cmp_id, item_upc) WHERE item_upc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_items_group ON inv_items (item_grp_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_hsn ON inv_items (cmp_id, hsn_sac);

-- Alternate units per item <- books_item_unit_lines (item_unit_line_id preserved).
-- conversion_factor: how many BASE units make 1 of this unit (Box = 12 Pcs -> 12 on the Box row).
-- The base (is_default = 1) row always has factor 1.
CREATE TABLE IF NOT EXISTS inv_item_uoms (
    item_unit_line_id   BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    item_id             BIGINT      NOT NULL,
    unit_id             BIGINT      NOT NULL,
    is_default          SMALLINT    NOT NULL DEFAULT 0,
    conversion_factor   NUMERIC(18,4) NOT NULL DEFAULT 1,
    uom_role            VARCHAR(16) NULL,                         -- base | purchase | sales | packaging
    mc_qty_wise         SMALLINT    NOT NULL DEFAULT 0,
    created_at          TIMESTAMP   NULL,
    updated_at          TIMESTAMP   NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_item_uoms_cmp_item ON inv_item_uoms (cmp_id, item_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_item_uoms_item_unit ON inv_item_uoms (cmp_id, item_id, unit_id);

-- Item opening stock.
--   fy_id = 0  : the company's INCEPTION opening (books_item_unit_lines.opening_qty/opening_rate);
--                applies to every financial year the year-end close has not run into.
--   fy_id > 0  : carried-forward opening written by the year-end close for that year
--                (books_item_fy_openings). Rows are in the entered unit; conversion to base
--                uses inv_item_uoms at read time exactly as Books did.
CREATE TABLE IF NOT EXISTS inv_item_openings (
    opening_id          BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    fy_id               BIGINT      NOT NULL DEFAULT 0,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    item_id             BIGINT      NOT NULL,
    warehouse_id        BIGINT      NULL,
    unit_id             BIGINT      NOT NULL,
    batch_id            BIGINT      NULL,
    opening_qty         NUMERIC(18,4) NOT NULL DEFAULT 0,
    opening_valuation_rate NUMERIC(18,4) NOT NULL DEFAULT 0,
    opening_value       NUMERIC(18,4) NOT NULL DEFAULT 0,
    valuation_method    VARCHAR(8)  NULL,
    source_kind         VARCHAR(24) NOT NULL DEFAULT 'master_inception', -- master_inception | carry_forward | opening_document
    source_document_id  BIGINT      NULL,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_item_openings_key
    ON inv_item_openings (cmp_id, fy_id, item_id, unit_id, COALESCE(warehouse_id, 0), COALESCE(batch_id, 0));
CREATE INDEX IF NOT EXISTS idx_inv_item_openings_cmp_fy ON inv_item_openings (cmp_id, fy_id);
CREATE INDEX IF NOT EXISTS idx_inv_item_openings_item ON inv_item_openings (cmp_id, item_id);

-- Which financial years the year-end close has carried ITEMS into (books_fy_carryforward, modules ~ 'items').
-- Preserves Books' resolution rule: once closed into, a year opens ONLY on its carried rows.
CREATE TABLE IF NOT EXISTS inv_fy_carryforward_status (
    id                  BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    source_fy_id        BIGINT      NOT NULL,
    target_fy_id        BIGINT      NOT NULL,
    bo_id               BIGINT      NOT NULL DEFAULT 0,
    status              VARCHAR(32) NOT NULL DEFAULT 'completed',
    stock_item_count    INT         NOT NULL DEFAULT 0,
    carried_forward_at  TIMESTAMP   NULL,
    carried_forward_by  VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_fy_carryforward ON inv_fy_carryforward_status (cmp_id, source_fy_id, target_fy_id, bo_id);
CREATE INDEX IF NOT EXISTS idx_inv_fy_carryforward_target ON inv_fy_carryforward_status (cmp_id, target_fy_id);

-- ---------------------------------------------------------------------------
-- Bill of materials <- books_bom_headers / books_bom_lines (ids preserved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_bom_headers (
    bom_id              BIGSERIAL PRIMARY KEY,
    bom_uuid            UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    bom_name            VARCHAR(255) NOT NULL,
    finished_item_id    BIGINT      NOT NULL,
    yield_qty           NUMERIC(18,4) NOT NULL DEFAULT 1,
    yield_unit_id       BIGINT      NULL,
    is_active           SMALLINT    NOT NULL DEFAULT 1,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL,
    deleted_at          TIMESTAMP   NULL,
    deleted_by          VARCHAR(64) NULL,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_bom_headers_uuid ON inv_bom_headers (bom_uuid);
CREATE INDEX IF NOT EXISTS idx_inv_bom_headers_cmp ON inv_bom_headers (cmp_id, is_active);

CREATE TABLE IF NOT EXISTS inv_bom_lines (
    bom_line_id         BIGSERIAL PRIMARY KEY,
    bom_id              BIGINT      NOT NULL,
    cmp_id              BIGINT      NOT NULL,
    item_id             BIGINT      NOT NULL,
    qty                 NUMERIC(18,4) NOT NULL DEFAULT 0,
    unit_id             BIGINT      NULL,
    line_kind           VARCHAR(16) NOT NULL DEFAULT 'component',  -- component | by_product | scrap
    scrap_percent       NUMERIC(8,4) NOT NULL DEFAULT 0,
    sort_order          INT         NOT NULL DEFAULT 0,
    legacy_source_table VARCHAR(64) NULL,
    legacy_source_id    BIGINT      NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_bom_lines_bom ON inv_bom_lines (bom_id);

-- ---------------------------------------------------------------------------
-- Batches / lots and serial numbers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_batches (
    batch_id            BIGSERIAL PRIMARY KEY,
    batch_uuid          UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    item_id             BIGINT      NOT NULL,
    batch_no            VARCHAR(64) NOT NULL,
    lot_no              VARCHAR(64) NULL,
    mfg_date            DATE        NULL,
    expiry_date         DATE        NULL,
    warranty_months     INT         NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'active',    -- active | quarantine | recalled | expired | closed
    attributes_json     JSONB       NULL,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_batches_uuid ON inv_batches (batch_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_batches_item_no ON inv_batches (cmp_id, item_id, batch_no);
CREATE INDEX IF NOT EXISTS idx_inv_batches_expiry ON inv_batches (cmp_id, expiry_date) WHERE expiry_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS inv_serials (
    serial_id           BIGSERIAL PRIMARY KEY,
    serial_uuid         UUID        NOT NULL DEFAULT gen_random_uuid(),
    cmp_id              BIGINT      NOT NULL,
    item_id             BIGINT      NOT NULL,
    serial_no           VARCHAR(128) NOT NULL,
    batch_id            BIGINT      NULL,
    warehouse_id        BIGINT      NULL,
    location_id         BIGINT      NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'in_stock',  -- expected | in_stock | reserved | issued | in_transit | damaged | returned | scrapped
    unit_cost           NUMERIC(18,4) NULL,
    received_document_id BIGINT     NULL,
    issued_document_id  BIGINT      NULL,
    warranty_until      DATE        NULL,
    attributes_json     JSONB       NULL,
    created_by          VARCHAR(64) NULL,
    created_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(64) NULL,
    updated_at          TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_serials_uuid ON inv_serials (serial_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_serials_item_no ON inv_serials (cmp_id, item_id, serial_no);
CREATE INDEX IF NOT EXISTS idx_inv_serials_status ON inv_serials (cmp_id, item_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_serials_warehouse ON inv_serials (cmp_id, warehouse_id, status);

-- ---------------------------------------------------------------------------
-- Deterministic legacy id map (every migrated row lands here)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_legacy_id_map (
    id                  BIGSERIAL PRIMARY KEY,
    cmp_id              BIGINT      NOT NULL,
    legacy_table        VARCHAR(64) NOT NULL,
    legacy_id           BIGINT      NOT NULL,
    target_table        VARCHAR(64) NOT NULL,
    target_id           BIGINT      NOT NULL,
    target_uuid         UUID        NULL,
    migration_run_id    VARCHAR(64) NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_legacy_id_map ON inv_legacy_id_map (legacy_table, legacy_id, target_table);
CREATE INDEX IF NOT EXISTS idx_inv_legacy_id_map_target ON inv_legacy_id_map (target_table, target_id);
