-- Migration 008: Landed cost allocation.
--
-- 003_inventory_valuation.sql created inv_landed_costs / inv_landed_cost_lines and nothing ever
-- wrote a row into either: the LANDED_COST document type was declared and never implemented, and
-- a receipt that arrived with freight on it capitalised nothing. This migration finishes the two
-- tables for the allocator that now writes them.
--
-- InventorySqlMigrationRunner records every file it applies by FILENAME in inv_sql_migrations and
-- skips anything already recorded, so 003 cannot be edited to change the schema of a database that
-- already has it. 003 keeps comment-only edits; every real DDL change lives here.
--
-- Everything below is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS: additive, idempotent, nothing
-- dropped, renamed or backfilled, and no existing row's values change.

-- A charge is entered with ONE basis, but the user may override a single line's share by hand, and
-- then that line's share was not derived the way the parent row says it was. Without a per-line
-- basis the override is flattened into the parent's single value and the detail reads as though the
-- allocator produced it.
ALTER TABLE inv_landed_cost_lines ADD COLUMN IF NOT EXISTS allocation_basis VARCHAR(16) NULL;  -- value | qty | manual | direct (NULL = as the parent row says)

-- Every other table in this schema stamps its rows; these two were written before anything wrote
-- to them, and the allocation detail is deleted and rewritten on a re-post, so the stamp says which
-- posting produced the rows now in the table.
ALTER TABLE inv_landed_cost_lines ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Posting deletes and rewrites the allocation detail of the document it is posting, so the
-- delete-by-document scan runs on every post of every valued receipt; there was no index for it.
CREATE INDEX IF NOT EXISTS idx_inv_landed_costs_doc ON inv_landed_costs (cmp_id, document_id);
-- "What has been loaded onto this receipt?" — the reconciliation question, and the one a LANDED_COST
-- document asks of its target before it allocates anything more onto it.
CREATE INDEX IF NOT EXISTS idx_inv_landed_costs_target ON inv_landed_costs (cmp_id, target_document_id);
CREATE INDEX IF NOT EXISTS idx_inv_landed_cost_lines_target ON inv_landed_cost_lines (target_line_id);

-- No CHECK constraint on cost_type or allocation_basis. 'non_creditable_tax' (18 chars) fits
-- VARCHAR(32) and 'direct' fits VARCHAR(16); the enums are enforced in PHP as a 422 with a message
-- naming the offending value, and adding a CHECK over live production rows is a deploy risk for
-- validation that already happens before a row is ever written.
