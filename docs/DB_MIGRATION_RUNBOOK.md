# Cutover runbook — backup Books, stand up Inventory, migrate, compare

Roles: DBA (PostgreSQL), release engineer (deploys, env), accountant/owner (sign-off). Everything below was rehearsed on a local PostgreSQL 16 with 4 seeded companies; run the rehearsal on a **restored production backup** first, then the real thing.

## 0. Before the window
1. Deploy Books (branch `claude/inventory-migration-books-refactor-i10man`) with `INVENTORY_MODE=legacy`. It behaves exactly as before. Apply its SQL migration (`php spark books:sql-migrate` runs in the post-deploy hook; migration 150 adds `vch_uuid`, `books_inventory_postings`, `books_inventory_events`, `books_inventory_cogs_revisions`).
2. Deploy Inventory (same branch). The post-deploy hook runs `composer install`, creates `.env` from `.env.example` on first deploy and applies `inventory:sql-migrate`. Set in Inventory `.env`: database, `INVENTORY_SERVICE_KEYS = books:<strong key>`, `BOOKS_SERVICE_KEY = <another strong key>`, `BOOKS_API_BASE = https://books.aicountly.com/api`, `MANAGE_API_BASE`, `PORTAL_AUTH_BASE`, plus the Books source for the migration: `BOOKS_DB_HOST/PORT/NAME/USER/PASSWORD` (a **read-only** role). In Books `.env`: `INVENTORY_API_BASE = https://inventory.aicountly.com/api`, `INVENTORY_SERVICE_KEY` (= the `books:` key), `INVENTORY_INBOUND_SERVICE_KEY` (= Inventory's `BOOKS_SERVICE_KEY`), `INVENTORY_POSTING_MODE = strict`, `INVENTORY_COGS_REVISION_MODE = inline`.
3. Create the read-only role on the Books database:
   ```sql
   CREATE ROLE books_readonly LOGIN PASSWORD '…';
   GRANT CONNECT ON DATABASE books TO books_readonly;
   GRANT USAGE ON SCHEMA public TO books_readonly;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO books_readonly;
   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO books_readonly;
   ```
4. Rehearse (sections 2–5) against a restore of last night's Books backup into a scratch database, with `BOOKS_DB_NAME` pointing at the restore and a scratch Inventory database. Keep the summaries.
5. Cron on the Inventory host: `* * * * * cd …/api && php spark inventory:outbox-dispatch`, `* * * * * php spark inventory:recalc-worker`. On the Books host: `* * * * * php spark books:inventory-retry`.

## 1. Freeze and back up Books (T0)
1. Announce maintenance; put Books in maintenance mode (no vouchers may post while the copy runs — the migration is a point-in-time copy).
2. Backup, keep it until sign-off + 30 days:
   ```bash
   pg_dump -Fc -Z6 --no-owner --no-acl -h $BOOKS_HOST -U $BOOKS_ADMIN -d books \
     -f /backups/books_pre_inventory_$(date +%Y%m%d_%H%M).dump
   pg_dump -Fc -h $BOOKS_HOST -U $BOOKS_ADMIN -d books -f /backups/books_globals_$(date +%Y%m%d).dump --schema-only
   ```
   Verify: `pg_restore --list /backups/books_pre_inventory_*.dump | wc -l` and restore it into a scratch database (`createdb books_verify && pg_restore -d books_verify …`) — a backup that has not been restored is not a backup.
3. Export Books' own stock figures for the comparison (uses Books' StockBalanceService / StockValuationService, read-only):
   ```bash
   cd books/api && php spark books:export-inventory-snapshot --out-dir /backups/books_snapshots_$(date +%Y%m%d) --company all
   ```
4. Give every historical voucher its shared UUID (idempotent, batched):
   ```bash
   php spark books:backfill-vch-uuid
   ```

## 2. New Inventory database
```bash
createdb -O inventory_app inventory           # empty database, PostgreSQL 16
cd inventory/api && php spark inventory:sql-migrate    # creates every inv_* table
export RUN=prod-$(date +%Y%m%d)                # set ONCE for the whole batch, see warning below
echo "$RUN" | tee /root/inv_migration_run_id_$(date +%Y%m%d).txt   # persisted in case the shell session is lost
php spark inventory:migrate-books --stage=precheck --run-id=$RUN
```
**`--run-id` safety.** The command silently defaults to the current timestamp (`date('Ymd-His')`) whenever `--run-id` is omitted — it does not error and does not warn. Passing it on `precheck` but forgetting it on a later stage does not reuse `$RUN`; it invents a *different* run-id for that stage, and every table lookup keyed on `migration_run_id` (validate's own bookkeeping, and especially `rollback`) then silently operates on an empty or wrong run. A rehearsal of a second batch on this branch hit exactly this: `rollback` printed `ROLLBACK complete` for a run-id that matched zero rows, while the real migrated rows were untouched. **Export `$RUN` once here, persist it to a file as shown, and pass `--run-id="$RUN"` explicitly on every single `validate` / `cutover` / `postcheck` / `rollback` invocation for this batch — never rely on shell history or "the last one I typed."** If a new terminal session is opened mid-cutover, re-load it with `RUN=$(cat /root/inv_migration_run_id_*.txt)` before continuing, and echo it back to confirm before running anything.

Precheck must print `PRECHECK ok`. Blocking findings (orphan lines, items without company) are fixed in Books **before** continuing, or documented and approved in writing. Warnings (duplicate names, `dr_cr` contradictions, missing units) are reviewed: they tell you where Books' reports and Books' valuation disagree today.

## 3. Migrate
```bash
php spark inventory:migrate-books --stage=migrate --run-id=$RUN --dry-run     # full run, rolled back
php spark inventory:migrate-books --stage=migrate --run-id=$RUN               # the real copy
```
The command reports items/documents/lines per company and stops on the first failing company (that company is rolled back; the others stay). Re-run for the failed company only with `--company=<id>` after fixing the cause.

## 4. Compare with the backed-up Books database
```bash
php spark inventory:migrate-books --stage=validate --run-id=$RUN \
    --books-snapshot=/backups/books_snapshots_YYYYMMDD
```
It must print `VALIDATE ok`. Read `writable/migration/$RUN/validate.summary.json` with the accountant: row counts, voucher counts by type/status and by company/FY, movement totals, openings, cost layers, WAC, pending, buckets, destination integrity, sequences, the stock rebuild (balances vs openings+movements, Books walk vs Inventory walk) and the item-by-item comparison with Books' snapshots (quantity **and** value). Explained differences (challan/deferred lines Books counted twice) are listed per item with the vouchers involved; anything unexplained fails the stage. Financial totals (ledger debit/credit, COGS journal totals, bills, allocations) are recorded from Books and must be identical to the precheck baseline of the same run — the migration never touched them.

## 5. Cutover
```bash
php spark inventory:migrate-books --stage=cutover --run-id=$RUN      # validate + sequences + marker
```
Then, in this order:
1. Books `.env`: `INVENTORY_MODE = live`. Restart PHP-FPM / clear opcache (`cpanel-post-deploy-api.sh` does it).
2. Inventory: `php spark inventory:resync-masters --all` (sends the item/unit/warehouse mirror events once; Books' mirror is already identical, this proves the channel works).
3. Books: `GET /api/reports/inventory-status?as_on=<today>` must answer with `"source": "inventory"` and the same closing quantities as `GET /v1/reports/warehouse-stock` here — the proof that Books now reads stock from Inventory.
4. Smoke test with one real company: post a purchase with items and a sales invoice, cancel a test invoice, print a historical invoice, open Inventory and check the stock ledger of the item. `GET books/api/integration/inventory/health` with the service key must return `mode: live`.
5. Lift maintenance mode. Deploy the new Books web and mobile builds (they only need the API URLs).

## 6. Post-check (T0 + 1 h, + 1 day)
```bash
php spark inventory:migrate-books --stage=postcheck --run-id=$RUN
php spark inventory:migrate-books --stage=sequences --run-id=$RUN --dry-run
```
plus one `POST /v1/reconciliation/run` per active company from the Inventory UI (or curl with the service key) — the Books Stock-in-Hand balance and Inventory's closing value must reconcile to explained buckets. `GET /v1/reconciliation/posting-status` must show only `IN_SYNC`.

## What is deliberately not done
* Source inventory tables in Books are **not** dropped. They are frozen; a later release may archive them.
* No dual-write period: Books stops valuing stock at the moment `INVENTORY_MODE=live` is set.
* No opening restatement for the challan double-count; see `DB_MIGRATION_PLAN.md`.
