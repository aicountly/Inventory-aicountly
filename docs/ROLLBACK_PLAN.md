# Rollback plan

Two different situations, two different rollbacks. In both, **Books' data is never touched by the migration**, so the accounting truth is intact at every point.

## A. Before `INVENTORY_MODE=live` (migration or validation failed)
Nothing has changed for users. Options, from cheapest:
1. Fix the cause in Books (orphans, duplicates) or in the migration, then `migrate --company=<id> --replace` for the affected company and `validate` again.
2. Drop the run entirely: `php spark inventory:migrate-books --stage=rollback --run-id=<id> --yes` deletes every row the run wrote (via `inv_legacy_id_map`), materialised balances for those companies, and resets sequences. Or simply `dropdb inventory && createdb inventory && php spark inventory:sql-migrate`.

   **Use the exact `<id>` the `migrate` stage itself was given (or printed) — never omit `--run-id` and never reuse a different stage's own value.** Omitting it does not reuse the last one you typed; the command silently invents a fresh timestamp-based id, matches zero rows in `inv_legacy_id_map`, and still prints `ROLLBACK complete` having deleted nothing. A rehearsal on this branch hit exactly this. After any rollback, **verify before trusting the message**: `SELECT count(*) FROM inv_legacy_id_map WHERE migration_run_id = '<id>'` (expect 0) and re-check the tables' row counts directly — do not rely on the exit message alone.
3. Postpone the window; Books keeps running in `legacy` mode.

## B. After `INVENTORY_MODE=live` (cutover done, problem found in production)
Time matters because vouchers posted since cutover have their stock side in Inventory only.

1. **Stop the bleed**: Books `.env` → `INVENTORY_MODE = legacy`, restart PHP. Books immediately values stock itself again from its own frozen tables (`books_inventory_cost_layers`, `books_inventory_wac_state`, buckets, pending) — they were never modified. New vouchers post as before the migration.
2. **Decide the scope**:
   * *Inventory-only defect (UI, report, permission)*: fix forward; do not roll back data. Books in `legacy` for the hours it takes, then back to `live`; Inventory's `reconciliation` shows which vouchers posted in Books during the legacy interval have no inventory document (`MISSING_IN_INVENTORY`) — post them with `php spark books:inventory-retry --vch <id> --cmp <cmp> --resync` (rebuilds the document from the Books voucher) and re-validate.
   * *Wrong stock data (valuation, quantities)*: keep Books in `legacy`. For the vouchers posted while live, Books' frozen cost layers were **not** consumed (Books did not value them); run Books' rebuild for the affected items (`Stock COGS integrity → Rebuild`, i.e. `StockValuationRebuildService`) so Books' layers/COGS include those vouchers. Then either fix Inventory and re-migrate the affected companies (`migrate --company … --replace` from a fresh precheck) or abandon the cutover.
3. **Restore only if Books itself was damaged** (it should not be — the migration never writes Books, and live mode only adds tracker/event rows and COGS lines): `pg_restore -d books --clean --if-exists /backups/books_pre_inventory_*.dump`. This loses every voucher posted after T0; export them first (`books_voucher_headers` where `created_at > T0`) and re-enter.

## Guarantees that make rollback safe
* Migration reads Books through a read-only session.
* Live mode writes to Books only: `books_voucher_headers.vch_uuid`, `books_inventory_postings`, `books_inventory_events`, `books_inventory_cogs_revisions`, item-line cost columns, and COGS journal pairs — all of which are also what Books wrote itself before.
* Books' frozen inventory tables are not dropped at cutover.
* Every Inventory row from the migration is tagged with its run id and legacy id; every Books-sourced document carries `source_document_id/uuid`, so a partial roll-forward is always possible.

## Drill
Rehearsed: `migrate` → `rollback --yes` → 0 rows left for the company → `migrate` again → `validate ok` (see `DB_MIGRATION_VALIDATION.md`).
