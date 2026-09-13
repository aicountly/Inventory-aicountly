-- Make the audit trail append-only in the database, not just by convention.
--
-- AuditService has called inv_audit_log append-only in its docblock since it was written, and
-- nothing enforced it: any DELETE succeeded. The company purge found this the hard way — its
-- first production dry run listed inv_audit_log among the tables it would remove, and only a
-- constant in InventoryPurgeCompany::RETAINED stopped it. A policy that lives in one command is
-- one refactor away from being gone.
--
-- Books hardened the same tables in its migration 134. This mirrors it, including the function
-- name, because InventoryPurgeCompany::appendOnlyTables() finds protected tables by looking for
-- a trigger function named *_deny_mutation: a table hardened here but not declared as retained
-- stops the purge instead of being deleted by it.
--
-- Nothing writes an UPDATE or DELETE to either table today (AuditService only inserts,
-- AuditController only reads), so this rejects nothing that currently works.
--
-- Deliberately no BEFORE TRUNCATE trigger: row-level triggers do not fire on TRUNCATE, and the
-- integration suite truncates every inv_ table between tests. The guard is against the ordinary
-- mistake — a DELETE in a cleanup script or a purge — not against someone with rights to
-- TRUNCATE a production table.

CREATE OR REPLACE FUNCTION inv_audit_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'inventory audit tables are append-only; % is not allowed on %',
        TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_audit_log_no_update ON inv_audit_log;
CREATE TRIGGER trg_inv_audit_log_no_update
    BEFORE UPDATE ON inv_audit_log
    FOR EACH ROW EXECUTE PROCEDURE inv_audit_deny_mutation();

DROP TRIGGER IF EXISTS trg_inv_audit_log_no_delete ON inv_audit_log;
CREATE TRIGGER trg_inv_audit_log_no_delete
    BEFORE DELETE ON inv_audit_log
    FOR EACH ROW EXECUTE PROCEDURE inv_audit_deny_mutation();

DROP TRIGGER IF EXISTS trg_inv_access_audit_log_no_update ON inv_access_audit_log;
CREATE TRIGGER trg_inv_access_audit_log_no_update
    BEFORE UPDATE ON inv_access_audit_log
    FOR EACH ROW EXECUTE PROCEDURE inv_audit_deny_mutation();

DROP TRIGGER IF EXISTS trg_inv_access_audit_log_no_delete ON inv_access_audit_log;
CREATE TRIGGER trg_inv_access_audit_log_no_delete
    BEFORE DELETE ON inv_access_audit_log
    FOR EACH ROW EXECUTE PROCEDURE inv_audit_deny_mutation();
