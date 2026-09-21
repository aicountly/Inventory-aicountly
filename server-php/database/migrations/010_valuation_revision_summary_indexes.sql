-- Migration 010: indexes for the valuation-revisions screen's summary aggregates.
--
-- InventorySqlMigrationRunner records every file it applies by FILENAME in inv_sql_migrations and
-- skips anything already recorded, so an earlier file cannot be edited to change the schema of a
-- database that already has it. Every real DDL change lives in a new file.
--
-- Index-only, additive, idempotent: no column is added, dropped or rewritten, no row's values
-- change, and a database that applies this returns exactly the same answers it did the minute
-- before — it simply stops reading the whole table to produce them.
--
-- WHY
--
-- `GET /v1/valuation/revisions/summary` answers the revisions screen's KPI cards, timeline,
-- source split and insight panel with SQL aggregates over the whole filtered set rather than over
-- the page the browser is holding. That is the right trade — a KPI that counted 25 visible rows
-- would understate a company's exposure by whatever nobody scrolled to — but it means several
-- aggregate passes per page load, and `inv_valuation_revisions` had exactly one index for them:
--
--   idx_inv_valuation_revisions_unack ON (cmp_id) WHERE acknowledged_at IS NULL
--
-- a partial index that helps the pending backlog and nothing else. The acknowledgement progress
-- ring counts EVERY revision in the company, acknowledged ones included, and the timeline and the
-- trend both bound `created_at` — neither could use it, so both fell back to a sequential scan
-- that grows with the company's whole revision history.

-- The screen's own axis: company (and, through the joined line, branch) plus the created_at
-- window every windowed query bounds. Also serves the unwindowed company totals, since a
-- leading-column scan of this index is cheaper than reading the table.
CREATE INDEX IF NOT EXISTS idx_inv_valuation_revisions_cmp_created
    ON inv_valuation_revisions (cmp_id, created_at);

-- "Acknowledged today" and "vs yesterday" filter on acknowledged_at, which nothing indexed.
-- Partial, because a row that was never acknowledged can never satisfy those predicates and
-- there is no reason to carry it in the index.
CREATE INDEX IF NOT EXISTS idx_inv_valuation_revisions_cmp_acked
    ON inv_valuation_revisions (cmp_id, acknowledged_at)
    WHERE acknowledged_at IS NOT NULL;
