-- Migration 010: the brand's own descriptive fields — a short code and a description.
--
-- InventorySqlMigrationRunner records every file it applies by FILENAME in inv_sql_migrations and
-- skips anything already recorded, so an earlier file cannot be edited to change the schema of a
-- database that already has it. Every real DDL change lives in a new file.
--
-- Everything below is ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS: additive, idempotent,
-- nothing dropped, renamed or backfilled. Both columns are NULL for every row that already exists,
-- which is exactly what they mean — "not stated" — so a database that applies this migration
-- behaves the minute after as it did the minute before.
--
-- Why these two and nothing else. A brand is Inventory's own master, so its descriptive fields are
-- Inventory's to own; the Brands screen searches "name, alias or description", and a search
-- contract that names a column the table does not have is a promise the API cannot keep. The code
-- is the short handle the rest of the business already uses for a brand on a label or a purchase
-- order, and having it here is what lets an import file match on something other than a display
-- name that people spell three ways.
--
-- What is deliberately NOT here: anything a sibling AICOUNTLY product owns. A brand's SALES, its
-- revenue and its ranking belong to Sales / Books and are read over their live APIs at the moment
-- the screen asks. Copying them into inv_brands would make this table a stale second copy of
-- another product's ledger, which is the one thing the platform does not do.

ALTER TABLE inv_brands ADD COLUMN IF NOT EXISTS brand_code  VARCHAR(64) NULL;
ALTER TABLE inv_brands ADD COLUMN IF NOT EXISTS description TEXT        NULL;

-- The code is a handle, so it has to be unique per company to be worth typing — but only where one
-- was given. A partial index leaves every brand without a code alone (NULLs are distinct in a plain
-- unique index anyway; stating the predicate keeps the index small and the intent readable), and
-- LOWER() makes "APPLE" and "apple" the same handle, the way brand_name uniqueness already works.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_brands_cmp_code
    ON inv_brands (cmp_id, LOWER(brand_code))
    WHERE brand_code IS NOT NULL AND deleted_at IS NULL;

-- The list's default order (name, within a company, excluding deleted rows) and its commonest
-- filter (status) are one index away from a sequential scan once a company has a few thousand
-- brands. The existing idx_inv_brands_cmp covers (cmp_id, is_active); this covers the sort.
CREATE INDEX IF NOT EXISTS idx_inv_brands_cmp_name ON inv_brands (cmp_id, brand_name);

-- "Added this month" and the Created filter both range over created_at inside one company.
CREATE INDEX IF NOT EXISTS idx_inv_brands_cmp_created ON inv_brands (cmp_id, created_at);
