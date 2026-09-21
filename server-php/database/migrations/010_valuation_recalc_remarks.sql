-- Migration 010: why a valuation recalculation was run, and when it was cancelled.
--
-- InventorySqlMigrationRunner records every file it applies by FILENAME in inv_sql_migrations and
-- skips anything already recorded, so an earlier file cannot be edited to change the schema of a
-- database that already has it. Every real DDL change lives in a new file.
--
-- Both statements are ADD COLUMN IF NOT EXISTS: additive, idempotent, nothing dropped, renamed or
-- backfilled. Both columns are nullable with no default, so every job already in the table keeps
-- exactly the values it has and a database that applies this migration behaves as it did the
-- minute before.

-- ------------------------------------------------------------------------------- remarks
--
-- A recalculation restates historical inventory valuation and publishes COGS revisions to Books.
-- Six months later the questions asked of it are "who re-costed July, and on what grounds" — the
-- job row already answers the first (requested_by) and could not answer the second at all.
-- trigger_kind says only 'manual', which is the category, not the reason.
--
-- TEXT rather than VARCHAR(n): the value is written once by a person explaining a correction
-- ("supplier's revised invoice for the July receipts"), never indexed, compared or joined on, and
-- Postgres stores the two identically. The API caps what it accepts so a runaway paste cannot
-- become an unbounded row; the column itself does not need to.
--
-- NULL is not "no reason given" for a job the system enqueued — DocumentPostingService and the
-- reversal path enqueue with a trigger_kind that IS the reason. It means only that no one typed
-- one, which is the correct state for every row that predates this column.
ALTER TABLE inv_valuation_recalc_jobs
    ADD COLUMN IF NOT EXISTS remarks TEXT NULL;

-- ------------------------------------------------------------------------------- cancelled_by
--
-- CANCELLED has been in the status vocabulary since 003 with nothing able to set it. Cancelling a
-- queued job is a decision about company valuation that someone made, and the job row records the
-- actor for every other transition it has (requested_by), so it records this one too rather than
-- leaving the audit log as the only place the name exists.
--
-- Deliberately NOT a second timestamp: run() already stamps finished_at on the terminal states,
-- and cancellation is terminal, so the time a job stopped is read from one column whatever stopped
-- it. VARCHAR(64) matches requested_by — both hold a session UUID.
ALTER TABLE inv_valuation_recalc_jobs
    ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(64) NULL;
