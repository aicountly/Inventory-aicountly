-- Migration 006: inv_reconciliation_runs.status must hold 'BOOKS_UNAVAILABLE' (17 chars);
-- 004 created it as VARCHAR(16). Widening is idempotent and preserves data.
ALTER TABLE inv_reconciliation_runs ALTER COLUMN status TYPE VARCHAR(24);
