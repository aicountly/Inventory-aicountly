-- Migration 010: the indexes the pending-quantity register reads through.
--
-- InventorySqlMigrationRunner records every file it applies by FILENAME in inv_sql_migrations and
-- skips anything already recorded, so an earlier file cannot be edited to change the schema of a
-- database that already has it. Every real DDL change lives in a new file.
--
-- Everything below is CREATE INDEX IF NOT EXISTS: additive, idempotent, nothing dropped, renamed
-- or backfilled, and no row's values change. A database that applies this migration answers every
-- query it answered the minute before, and answers the register's ones without a sequential scan.
--
-- WHY THESE AND NOT MORE
--
-- The register moved its filtering, ordering, paging and aggregation out of PHP and into SQL
-- (App\Services\PendingRegisterQuery). That is what makes it hold up on a table with millions of
-- rows, and it is also what makes the access paths below matter: before, one query read every open
-- pending row for the company and sorted the array; now Postgres is asked for one page in a stated
-- order, and it needs somewhere to get it from.
--
-- 002_inventory_documents.sql already indexes the three paths that existed then:
--   idx_inv_pending_cmp_open   (cmp_id, status, direction)
--   idx_inv_pending_doc        (document_id)
--   idx_inv_pending_party      (cmp_id, party_ref, direction, status)
-- Those still serve the status-and-direction filter, the settlement lookups and the party filter.
-- Nothing here duplicates them: each index below covers a column the register filters or joins on
-- that no existing index leads with.

-- ---------------------------------------------------------------- item filter and item grouping
--
-- The item filter and the item typeahead are the most-used narrowing on the screen, and the
-- Summary view groups by item. cmp_id leads because every query is company-scoped; status trails
-- so the common "open and partial only" restriction is satisfied from the index rather than by
-- fetching rows and discarding them.
CREATE INDEX IF NOT EXISTS idx_inv_pending_cmp_item
    ON inv_pending_quantities (cmp_id, item_id, status);

-- ---------------------------------------------------------------- warehouse filter and grouping
--
-- Partial, because warehouse_id is nullable and a pending line with no warehouse is never what the
-- warehouse filter is looking for. It keeps the index off the rows that can never match it.
CREATE INDEX IF NOT EXISTS idx_inv_pending_cmp_warehouse
    ON inv_pending_quantities (cmp_id, warehouse_id, status)
    WHERE warehouse_id IS NOT NULL;

-- ---------------------------------------------------------------- kind filter
--
-- Challan / deferred purchase / job work. Three values over the whole table, so this earns its
-- place only alongside cmp_id and status — which is exactly how the register asks for it.
CREATE INDEX IF NOT EXISTS idx_inv_pending_cmp_kind
    ON inv_pending_quantities (cmp_id, pending_kind, status);

-- ---------------------------------------------------------------- "what changed recently"
--
-- The register sorts by last activity, and the display status calls a part-settled line "settling"
-- when its last settlement is inside the company's settling window. Both read updated_at, and both
-- want the recent end of it first.
CREATE INDEX IF NOT EXISTS idx_inv_pending_cmp_updated
    ON inv_pending_quantities (cmp_id, updated_at DESC);

-- ---------------------------------------------------------------- the historical comparison
--
-- The KPI deltas reconstruct the open position one month back, which asks for every settlement
-- recorded against a pending row up to a date. idx_inv_pending_settlements_pending (002) leads
-- with pending_id already; adding created_at to it lets the sum for one row be read as a range
-- rather than by visiting every settlement that row ever had.
CREATE INDEX IF NOT EXISTS idx_inv_pending_settlements_pending_date
    ON inv_pending_settlements (pending_id, created_at);

-- Settled today / settled yesterday counts the settlements of one date across the company.
CREATE INDEX IF NOT EXISTS idx_inv_pending_settlements_cmp_date
    ON inv_pending_settlements (cmp_id, created_at);

-- ---------------------------------------------------------------- the document side of the join
--
-- Every register row inner-joins its document for the date, the branch, the party and the expected
-- return date, and the register's default ordering is by document date. The branch scope and the
-- period filter are both applied there.
--
-- Not a duplicate of idx_inv_documents_cmp_fy_date (cmp_id, fy_id, bo_id, document_date) from 002:
-- that one leads cmp_id with fy_id, and this register is deliberately NOT financial-year scoped —
-- goods sent to a job worker in February are still out in April. With fy_id unconstrained in the
-- middle of the key, neither bo_id nor document_date can be read as a range from it, so the branch
-- filter and the period filter both fall back to a scan. This is the same columns minus the one
-- the register never supplies.
CREATE INDEX IF NOT EXISTS idx_inv_documents_cmp_bo_date
    ON inv_documents (cmp_id, bo_id, document_date);
