-- Migration 010: a warehouse group's short code and its description.
--
-- InventorySqlMigrationRunner records every file it applies by FILENAME in inv_sql_migrations and
-- skips anything already recorded, so an earlier file cannot be edited to change the schema of a
-- database that already has it. Every real DDL change lives in a new file.
--
-- Everything below is ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS: additive, idempotent,
-- nothing dropped, renamed or backfilled, and no existing row's values change. Both columns are
-- NULLable with no default, so a database that applies this migration behaves exactly as it did
-- the minute before — every existing group simply has no code and no description until someone
-- gives it one.

-- ------------------------------------------------------------------ grp_code
--
-- A warehouse group was name-only, which is enough to store one and not enough to work with a
-- screenful. Operations people say "RET" and "MFG" the way they say "GEN" for the general group;
-- a register that prints "Retail Stores — North and West franchise outlets" in a column a reader
-- scans is a column nobody scans. The code is the short handle: optional, because a company that
-- has never used one must not be forced to invent one on its next edit.
--
-- VARCHAR(32) rather than the 16 a code of three or four letters needs: inv_warehouses.warehouse_code
-- is 32 and a group's code is read beside it. One width, one validation message.
ALTER TABLE inv_warehouse_groups ADD COLUMN IF NOT EXISTS grp_code VARCHAR(32) NULL;

-- --------------------------------------------------------------- description
--
-- What the group is FOR, in the words of whoever set it up. The name answers "which one"; this
-- answers "why does it exist", which is the question a reader has when they meet a grouping
-- somebody else designed two years ago.
--
-- VARCHAR(500), not TEXT: this is a line of prose in a table cell, not a document, and a bounded
-- column is a bound the API can state in one validation message instead of discovering at write
-- time. The UI clamps it to one line and reveals the rest on hover, so a longer value would be a
-- value nobody ever reads in full.
ALTER TABLE inv_warehouse_groups ADD COLUMN IF NOT EXISTS description VARCHAR(500) NULL;

-- Codes are unique per company, case-insensitively, among the groups that still exist.
--
-- The uniqueness is in the index and NOT only in PHP, for the same reason inv_warehouses has
-- uq_inv_warehouses_cmp_code: two concurrent creates both pass a SELECT-then-INSERT check and the
-- database is the only thing standing between that race and two "RET" groups. The partial
-- predicate keeps a deleted group from reserving its code forever, and LOWER() makes "ret" and
-- "RET" the same code — which is what a person typing one means.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_warehouse_groups_cmp_code
    ON inv_warehouse_groups (cmp_id, LOWER(grp_code))
    WHERE grp_code IS NOT NULL AND deleted_at IS NULL;

-- The warehouse-count decoration groups inv_warehouses by warehouse_group_id inside one company.
-- idx_inv_warehouses_cmp only covers (cmp_id, is_active), so that aggregate has been a scan.
CREATE INDEX IF NOT EXISTS idx_inv_warehouses_cmp_group
    ON inv_warehouses (cmp_id, warehouse_group_id);
