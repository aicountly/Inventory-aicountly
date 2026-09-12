# WHM / cPanel terminal — exact cutover steps, one block at a time

This is the copy-paste companion to `DB_MIGRATION_RUNBOOK.md`, `DB_MIGRATION_VALIDATION.md`
and `ROLLBACK_PLAN.md` — read those for *why*; this file is *what to type, in what order*, for
this specific account/hosting setup. Grounded in what actually exists on this branch:
`.github/workflows/deploy-production.yml` (Inventory and Books, both `workflow_dispatch`-only —
"Actions → Run workflow", nothing deploys on push/merge), `server-php/cpanel-post-deploy-api.sh`,
and `docs/DEPLOYMENT.md`.

**I do not have SSH/WHM/cPanel access to your production server, and I cannot trigger a GitHub
Actions deploy myself.** Every command below is for you to run in your own WHM/cPanel terminal.
Work through it one numbered step at a time: run the block, paste the output back, and wait for
me to confirm before the next one — exactly as you asked. Nothing here substitutes your own
judgement about your account's actual paths; wherever a value is genuinely account-specific
(document root, DB host) the first steps below have you confirm it from what Books already runs
in production, rather than guessing.

### Never paste secrets back

No step in this document needs a password, service key, or private key sent to anyone. If a
command's output would contain one, redact it or run the narrower version instead. Specifically:

* `.env` greps here are always restricted to non-secret keys (`hostname`, `port`, `database`,
  `CI_ENVIRONMENT`, `app.baseURL`, `INVENTORY_MODE`). Never `grep` the whole file and paste it.
* `/var/cpanel/databases/grants_*.yaml` and `*.json` contain credentials. Extract names only.
* The two health checks read the service key inline with `$(grep … .env | cut -d= -f2-)` so the
  key is substituted by your shell and never appears in what you copy or in what comes back.
* `~/.pgpass` holds passwords by design. You type into it; you never read it back out.

If you are ever unsure whether an output is safe to share, describe it in words instead. "Yes,
an inventory database already exists" carries every bit of information the next step needs.

Non-negotiables carried through this whole document: Books' data is only ever read, never
written, until cutover flips one flag; every stage keeps the same `--run-id`; a rehearsal against
a restored copy of your real production backup runs before anything touches the real databases;
nothing is skipped because it's 2am.

---

## Which terminal, and as which user — read this first

Three different things run in three different places, and getting this wrong is the one
mistake in this whole document that can quietly break the live app:

| What | Where | As whom |
|---|---|---|
| `php spark inventory:*` | Inventory's `api/` directory | the cPanel account that owns **Inventory**, never root |
| `php spark books:*` | Books' `api/` directory | the cPanel account that owns **Books**, never root |
| `pg_dump`, `pg_restore`, `psql`, `createdb`, `dropdb` | anywhere | root or either account — whoever owns the `~/.pgpass` you set up in B1 |

**Never run `php spark` as root.** CodeIgniter writes into `writable/` on every single run —
logs, cache, and this migration's own `writable/migration/<run-id>/` evidence files. Run it as
root and those land root-owned inside an account whose web server runs as the account user,
which breaks the live app's logging afterwards and needs a `chown -R` to undo. This is not
theoretical and it is easy to do by accident from a WHM root prompt.

From a WHM root terminal, switch first — `su - <cpaneluser>`, then `cd` to the app's `api/`
directory and run the spark command there. From a per-account cPanel Terminal you are already
the right user and can run them directly.

One consequence A1 settles: if Books and Inventory are **separate** cPanel accounts, then `~`
means a different directory in each, so the Books snapshot exported in B4 is not somewhere
Inventory's validate can read it in Phase D. A1 tells us which case you are in, and we agree
one shared readable path before Phase B starts rather than discovering the problem mid-window.

---

## Confirmed environment (checked on the live server, 2026-09-12)

| | |
|---|---|
| Server | `server1`, RHEL 9 family, WHM root available |
| Books account | `booksaicountly`, app at `/home/booksaicountly/public_html/api` |
| Inventory account | `inventoryaic`, app at `/home/inventoryaic/public_html/api` |
| Manage account | `manageaicountly` (unchanged by this cutover) |
| PHP | 8.2.33 at root and in both accounts, above the 8.1 floor |
| PostgreSQL | server **13.23**, client **13.23**, distribution packages, no `/usr/pgsql-*` side-by-side install |
| Books database | `booksaicountly_smartbooksaic` on `127.0.0.200:5432`, user `booksaicountly_smartbooksaic_user` |
| Inventory database | not created yet — create it in cPanel for the `inventoryaic` account (A5) |
| Inventory `api/` today | a placeholder from an earlier SSH/workflow test (`index.php`, `src/`, no `.env`); the deploy rsyncs with `--delete`, so it is replaced wholesale. Owner has confirmed it can be overwritten |

PostgreSQL 13 is fine here. The schema and the migration toolkit need `SERIAL`,
`gen_random_uuid()` (native from 13), `JSONB`, `pg_get_serial_sequence` and `information_schema`,
and nothing newer. The "PostgreSQL 16" in the other documents described the rehearsal machine,
not a floor, and has been corrected. Client and server being the same version also matters more
than it sounds: a `pg_dump` older than its server refuses to run at all, which would have stopped
B3 dead.

**Books and Inventory are separate cPanel accounts, so `~` means a different directory in each.**
Every path below is therefore absolute. All PostgreSQL CLI work runs as **root** (one `.pgpass`,
dumps under `/root`), all `php spark` work runs as the **owning account user**, and the one file
that must cross between accounts, the Books stock snapshot, is copied over by root in B4.

Two bash details this document now avoids deliberately: `--opt=~/path` does **not** expand the
tilde (bash only does that in assignments), and `psql` without `-w` will sit forever on a
password prompt instead of failing. Absolute paths and `-w` throughout.

### Two things verified in the code before any of this is allowed to touch production

**Deploying Books is genuinely a no-op until you flip the flag.** Books' production `.env` has
no `INVENTORY_MODE` key at all today. `InventoryBridgeService::mode()` reads
`getenv('INVENTORY_MODE') ?: 'legacy'` and then returns `live` only on an exact match, so
absent, empty, or misspelled all resolve to `legacy`. There is no value of that variable, or
absence of it, that silently turns the new path on.

**Books migration 150 is safe to run against the live database with users online.** It adds
`vch_uuid` as `UUID NULL` with no default, which is a metadata-only change on PostgreSQL 11+
rather than a table rewrite. Its unique index is partial on `vch_uuid IS NOT NULL`, and at the
moment it is created every row is still NULL, so it builds over zero rows however large
`books_voucher_headers` is. Everything else is `CREATE TABLE IF NOT EXISTS`. All statements are
idempotent.

**Why the backup is taken before the UUID backfill, and why that does not weaken the rehearsal.**
B3 backs up before B5 writes `vch_uuid` to every voucher, which keeps the safety net ahead of
the first write. That means `books_verify` carries NULL UUIDs while production will carry real
ones by migrate time — and it does not matter, because the migrator never reads Books'
`vch_uuid`. It derives the same id itself from `books_voucher_headers:<vch_txn_id>`
(`Migrator::deterministicUuid`), and the Books backfill independently reproduces exactly that
value (`VoucherUuid::deterministic`). Verified: both produce
`84f61b71-3067-5d1e-9f31-0eab056e4ee1` for voucher 12345. The rehearsal therefore builds
identical Inventory documents to the real run. Do not "fix" this ordering by moving the backup
after the backfill.

---

## Phase A — Get the code live (do this ahead of the overnight window)

Nothing here is time-critical and nothing is visible to your users yet: Inventory is a brand
new, unused product until cutover, and Books keeps `INVENTORY_MODE=legacy` (today's behaviour)
all the way through Phase A. Do this whenever is convenient, then start Phase B when you're ready
for the actual overnight window.

### A1. Establish which accounts exist, and what tooling each one has (read-only)
In your WHM root terminal:
```bash
whoami
ls -1 /var/cpanel/users 2>/dev/null || ls -1 /home
php -v
psql --version
pg_dump --version
```
**Paste this back.** It tells me whether Books and Inventory are one cPanel account or two —
which decides the shared-path question above — and what the root-level tooling is.

Then, in each account that owns one of the two apps (`su - <cpaneluser>` from root, or open
that account's own cPanel Terminal):
```bash
whoami
php -v
find ~ -maxdepth 4 -type d -iname "api" 2>/dev/null
```
PHP must report 8.1 or newer **in the account's own shell** — that is the one that matters, not
root's. cPanel sets the PHP version per account (MultiPHP Manager), so root's `php -v` and an
account's can legitimately differ. Books already runs CodeIgniter 4 in production, so its
account's PHP is adequate by definition; Inventory's account needs the same or newer.

Finally, in the Books account, from its `api/` directory:
```bash
pwd
grep -E "^(database\.default\.(hostname|port|database|username)|INVENTORY_MODE|CI_ENVIRONMENT|app\.baseURL) " .env
```
I need the real Books `api/` path and its database host/port — Inventory's database should live
on the same PostgreSQL server unless you tell me otherwise — plus confirmation that
`INVENTORY_MODE` really is `legacy` right now, before anything else happens.

### A2. Merge the branch
This is yours to do (I won't push to `main` or open PRs unless you ask me to). For each of
`aicountly/books-react-app` and `aicountly/Inventory-aicountly`: merge
`claude/inventory-migration-books-refactor-i10man` into whatever branch your production deploy
workflow actually builds from (check the workflow's `Check out repository` step / your own
convention — commonly `main`). `aicountly/manage-aicountly` needs no merge: nothing on this
branch changed it.

### A3. GitHub Actions secrets for Inventory production (one-time, skip if already set)
Repo → Settings → Secrets and variables → Actions → Secrets, for `Inventory-aicountly`:
`PROD_SSH_HOST`, `PROD_SSH_PORT`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`, `PROD_SSH_REMOTE_ROOT`
(the document root for the `inventory.aicountly.com` subdomain — create the subdomain in cPanel
first if it doesn't exist yet). Tell me once this is done; I can't see or set GitHub secrets.

### A4. First Inventory deploy
GitHub → `Inventory-aicountly` → Actions → **Deploy to cPanel Production** → Run workflow.
This deploys `web/dist/` and `server-php/` and runs `cpanel-post-deploy-api.sh`, which installs
Composer, applies `inventory:sql-migrate`, and probes `status.php` — but there's no `api/.env`
yet, so the health probe will warn. That's expected on a first deploy; continue to A5.

### A5 part 1. Create the two database roles in cPanel (before the deploy, any time)

**The Inventory database.** In cPanel for the **`inventoryaic`** account, PostgreSQL Databases:
create database `inventory`, create user `inventory_user`, then add that user to that database
with **ALL PRIVILEGES**. cPanel prefixes both with the account name, giving:

| | |
|---|---|
| database | `inventoryaic_inventory` |
| user | `inventoryaic_inventory_user` |
| host / port | `127.0.0.200` / `5432` (same server Books uses) |

That matches Books (`booksaicountly_smartbooksaic` / `..._user`) and the sandbox naming in
`server-php/.env.example`. Create it through the cPanel UI, not raw SQL, so cPanel registers the
ownership and grants in its own bookkeeping — that registration is what makes the database show
up and be manageable in phpPgAdmin for the account.

On PostgreSQL 13 the `public` schema still grants `CREATE` to `PUBLIC` by default (this changed
in 15), so `inventoryaic_inventory_user` can create the `inv_*` tables via
`inventory:sql-migrate` with no extra grant needed.

**The Books read-only role.** The migration reads Books from the Inventory app, and it must be
incapable of writing there. Create this one under the **`booksaicountly`** account, PostgreSQL
Databases: create user `invread` (becomes `booksaicountly_invread`) and add it to
`booksaicountly_smartbooksaic`.

cPanel's PostgreSQL screen does not offer a read-only privilege level the way its MySQL screen
does, so tighten it yourself. Connect as the Books database owner, which can grant on its own
tables without any superuser access:
```bash
psql -w -h 127.0.0.200 -p 5432 -U booksaicountly_smartbooksaic_user -d booksaicountly_smartbooksaic
```
then:
```sql
GRANT USAGE ON SCHEMA public TO booksaicountly_invread;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO booksaicountly_invread;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO booksaicountly_invread;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO booksaicountly_invread;
ALTER ROLE booksaicountly_invread SET default_transaction_read_only = on;
\q
```
The last line is the belt-and-braces one: every session that role opens starts read-only, so a
write fails even if some grant slips through later.

**Prove it before trusting it.** Connect as the read-only role and confirm both halves:
```bash
psql -w -h 127.0.0.200 -p 5432 -U booksaicountly_invread -d booksaicountly_smartbooksaic \
  -c "SELECT count(*) FROM books_voucher_headers;" \
  -c "CREATE TABLE should_not_work (x int);"
```
**Paste back both results.** The `SELECT` must return a count and the `CREATE TABLE` must fail
with a read-only transaction error. If the `CREATE TABLE` succeeds, stop and tell me — we do not
run a migration with a role that can write to Books.

### A5 part 2. Write Inventory's `api/.env` (the one file the deploy never touches)
Do this after the first deploy in A4, since `.env.example` arrives with it.
```bash
cd /home/inventoryaic/public_html/api
cp .env.example .env
```
Edit `.env` (terminal `nano .env`, or cPanel File Manager) and set:
- `CI_ENVIRONMENT = production`
- `app.baseURL = 'https://inventory.aicountly.com/api/'`
- `INVENTORY_APP_URL = https://inventory.aicountly.com/`
- `database.default.hostname = 127.0.0.200`, `database.default.port = 5432`
- `database.default.database = inventoryaic_inventory`
- `database.default.username = inventoryaic_inventory_user`, and its password
- `INVENTORY_SERVICE_KEYS = books:<strong random key>` and `BOOKS_SERVICE_KEY = <a different
  strong random key>`. The same two values go into Books' `.env` in A8, in the matching
  direction. Generate them with `openssl rand -hex 32`.
- `BOOKS_DB_HOST = 127.0.0.200`, `BOOKS_DB_PORT = 5432`,
  `BOOKS_DB_NAME = booksaicountly_smartbooksaic`,
  `BOOKS_DB_USER = booksaicountly_invread` and its password
- Leave `INVENTORY_ACCESS_BYPASS=0`

**Paste back** only:
```bash
grep -E "^(CI_ENVIRONMENT|app\.baseURL|database\.default\.(hostname|port|database)|BOOKS_DB_(HOST|PORT|NAME|USER)) " .env
```
That pattern excludes every password and key by construction.

### A6. Confirm Inventory is healthy
Re-run **Deploy to cPanel Production** for Inventory (picks up the new `.env`, re-applies
`inventory:sql-migrate` idempotently), then:
```bash
curl -s https://inventory.aicountly.com/api/health
```
Paste the JSON response back.

### A7. Inventory's cron (cPanel → Cron Jobs, or `crontab -e` in this terminal)
```
* * * * * cd /home/inventoryaic/public_html/api && php spark inventory:outbox-dispatch >/dev/null 2>&1
* * * * * cd /home/inventoryaic/public_html/api && php spark inventory:recalc-worker  >/dev/null 2>&1
*/5 * * * * cd /home/inventoryaic/public_html/api && php spark inventory:expire-reservations >/dev/null 2>&1
0 2 * * * cd /home/inventoryaic/public_html/api && php spark inventory:reconcile --all >/dev/null 2>&1
```

### A8. Deploy Books (still `INVENTORY_MODE=legacy` — no user-visible change yet)
In Books' `.env`, add/confirm: `INVENTORY_MODE = legacy`, `INVENTORY_API_BASE = https://inventory.aicountly.com/api`,
`INVENTORY_SERVICE_KEY` (= the `books:` key from A5), `INVENTORY_INBOUND_SERVICE_KEY` (= Inventory's
`BOOKS_SERVICE_KEY` from A5), `INVENTORY_POSTING_MODE = strict`, `INVENTORY_COGS_REVISION_MODE = inline`.
Then GitHub → `books-react-app` → Actions → **Deploy to cPanel Production** → Run workflow.

Confirm nothing changed for users (this endpoint checks `X-Service-Key` against Books' own
`INVENTORY_SERVICE_KEY`, so read it straight out of the `.env` you're sitting in — the header
value never needs to be typed or pasted anywhere):
```bash
curl -s -H "X-Service-Key: $(grep '^INVENTORY_SERVICE_KEY' .env | cut -d= -f2- | xargs)" \
    https://books.aicountly.com/api/integration/inventory/health
```
Expect `mode: legacy`. Log in to Books yourself and confirm it behaves exactly as before —
because it should be a no-op today.

### A9. Confirm Books' own retry cron is present
```
* * * * * cd /home/booksaicountly/public_html/api && php spark books:inventory-retry >/dev/null 2>&1
```

**Phase A is done when**: Inventory's `/api/health` is green, Books' `/api/integration/inventory/health`
reports `mode: legacy` and the app behaves normally. Nothing above touched a single row of real
data. This is a good place to stop and pick up Phase B later, fresh, whenever your overnight
window starts.

---

## Phase B — Freeze, back up, and rehearse against that exact backup

Start the real overnight window here.

### B1. Set up the Postgres connection once, as root (no password typed into any command)
Fill in the host/port/database/user from the Books `.env` values A1 asked for. Run as **root**:
```bash
mkdir -p /root/inv_migration_backups
touch /root/.pgpass && chmod 600 /root/.pgpass
echo "127.0.0.200:5432:*:booksaicountly_smartbooksaic_user:<books db password>" >> /root/.pgpass
echo "127.0.0.200:5432:*:<inventory db user>:<inventory db password>" >> /root/.pgpass
export PGHOST=127.0.0.200 PGPORT=5432
psql -w -U booksaicountly_smartbooksaic_user -d booksaicountly_smartbooksaic -c "SELECT current_user, now();"
```
Paste back that `SELECT`. Connecting without a password prompt means `.pgpass` is working. The
`-w` flag makes `psql` fail fast rather than hang if it isn't.

### B2. Announce and freeze
Put Books in maintenance mode. No voucher may post from this point until cutover finishes. The
migration is a point-in-time copy, and anything posted during the freeze would be missed by it.

### B3. Back up Books, and prove the backup is real (root)
```bash
pg_dump -Fc -Z6 --no-owner --no-acl -w -U booksaicountly_smartbooksaic_user -d booksaicountly_smartbooksaic \
  -f /root/inv_migration_backups/books_pre_inventory_$(date +%Y%m%d_%H%M).dump
pg_dump -Fc -w -U booksaicountly_smartbooksaic_user -d booksaicountly_smartbooksaic --schema-only \
  -f /root/inv_migration_backups/books_globals_$(date +%Y%m%d).dump
pg_restore --list /root/inv_migration_backups/books_pre_inventory_*.dump | wc -l
createdb -w -U booksaicountly_smartbooksaic_user books_verify
pg_restore --no-owner --no-acl -w -U booksaicountly_smartbooksaic_user -d books_verify \
  /root/inv_migration_backups/books_pre_inventory_*.dump
psql -w -U booksaicountly_smartbooksaic_user -d books_verify -c "SELECT count(*) FROM books_voucher_headers;"
```
Paste back the `pg_restore --list | wc -l` count and the voucher count from `books_verify`. A
backup nobody has restored is not yet a backup.

### B4. Export Books' stock snapshot, then hand it to the Inventory account
First as the **Books** account user:
```bash
su -s /bin/bash - booksaicountly
cd /home/booksaicountly/public_html/api
php spark books:export-inventory-snapshot \
  --out-dir /home/booksaicountly/inv_migration_backups/books_snapshots_$(date +%Y%m%d) --company all
ls -la /home/booksaicountly/inv_migration_backups/books_snapshots_$(date +%Y%m%d) | head
exit
```
Then as **root**, copy it where the Inventory account can read it. Inventory's validate runs as
`inventoryaic` and cannot see into another account's home:
```bash
mkdir -p /home/inventoryaic/inv_migration_backups
cp -r /home/booksaicountly/inv_migration_backups/books_snapshots_$(date +%Y%m%d) \
      /home/inventoryaic/inv_migration_backups/
chown -R inventoryaic:inventoryaic /home/inventoryaic/inv_migration_backups
ls -la /home/inventoryaic/inv_migration_backups/books_snapshots_$(date +%Y%m%d) | head
```
Paste back both listings. They must show the same files.

### B5. Backfill voucher UUIDs (idempotent, Books account)
```bash
su -s /bin/bash - booksaicountly -c 'cd /home/booksaicountly/public_html/api && php spark books:backfill-vch-uuid'
```

### B6. MANDATORY — rehearse the whole cycle against `books_verify`, not the real databases
This is what catches anything specific to *your* data before it can touch the real Inventory
database. Do not skip it, even at 3am.

As **root**, create the throwaway database:
```bash
createdb -w -U <inventory db user> inventory_verify
```
As the **Inventory** account user, make a throwaway copy of the app so the real `api/.env` is
never touched:
```bash
su -s /bin/bash - inventoryaic
cd /home/inventoryaic/public_html
cp -r api api_verify
```
Edit `/home/inventoryaic/public_html/api_verify/.env` and set `database.default.database` to
`inventory_verify` and `BOOKS_DB_NAME` to `books_verify`. Confirm before running anything:
```bash
grep -E "^(database\.default\.database|BOOKS_DB_NAME) " /home/inventoryaic/public_html/api_verify/.env
```
**Paste that back** — it is the one check that proves the rehearsal cannot reach a real database.
Then:
```bash
cd /home/inventoryaic/public_html/api_verify
php spark inventory:sql-migrate
export RUN=verify-$(date +%Y%m%d-%H%M)
echo "$RUN" | tee /home/inventoryaic/inv_migration_run_id_verify.txt
php spark inventory:migrate-books --stage=precheck --run-id="$RUN"
```
**Paste back** the precheck output. The company list and row counts should look like your real
companies, because `books_verify` is a full restore. Then:
```bash
php spark inventory:migrate-books --stage=migrate --run-id="$RUN" --dry-run
php spark inventory:migrate-books --stage=migrate --run-id="$RUN"
php spark inventory:migrate-books --stage=validate --run-id="$RUN" \
    --books-snapshot=/home/inventoryaic/inv_migration_backups/books_snapshots_$(date +%Y%m%d)
```
**Paste back** the last line of each, plus:
```bash
grep -oE '"(failures|warnings)":\[[^]]*\]' writable/migration/$RUN/validate.summary.json | head
```
It must reach `VALIDATE ok` with no unexplained failures before Phase C. If anything fails here,
stop and send me the summary. We fix it against the rehearsal copy, never against production.

Once validate is clean, discard the rehearsal. As the Inventory user:
```bash
rm -rf /home/inventoryaic/public_html/api_verify
exit
```
As root:
```bash
dropdb -w -U <inventory db user> inventory_verify
dropdb -w -U booksaicountly_smartbooksaic_user books_verify
```

---

## Phase C — Migrate (the real Inventory database)

### C1. Confirm the real Inventory database is still empty (root)
```bash
psql -w -U <inventory db user> -d <inventory db name> -c "SELECT count(*) FROM inv_document_lines;"
```
Expect `0`. It was created and schema-migrated in Phase A; this confirms nothing test-shaped
ended up in it since.

### C2. Precheck — capture the real run-id now, in a file, immediately
Everything from here to the end of Phase F is `php spark`, so it runs as the **Inventory account
user**, never as root:
```bash
su -s /bin/bash - inventoryaic
cd /home/inventoryaic/public_html/api
export RUN=prod-$(date +%Y%m%d)
echo "$RUN" | tee /home/inventoryaic/inv_migration_run_id_$(date +%Y%m%d).txt
php spark inventory:migrate-books --stage=precheck --run-id="$RUN"
```
`$RUN` lives only in that shell. If you lose it — closed tab, timeout, `exit` — restore it
before running anything else, and read the echo back to yourself:
```bash
su -s /bin/bash - inventoryaic
cd /home/inventoryaic/public_html/api
export RUN=$(cat /home/inventoryaic/inv_migration_run_id_$(date +%Y%m%d).txt)
echo "$RUN"
```
**Paste back** the full output. Must print `PRECHECK ok`. Any blocking finding gets fixed in
Books (or explicitly approved by you in writing) before continuing — do not proceed past a
blocking precheck finding.

### C3. Dry-run migrate
```bash
php spark inventory:migrate-books --stage=migrate --run-id="$RUN" --dry-run
```
Paste back the summary (items/documents/lines per company). This is fully rolled back
automatically — nothing is written yet.

### C4. Real migrate
```bash
php spark inventory:migrate-books --stage=migrate --run-id="$RUN"
```
**Paste back** the full output. If it stops on a failing company, that company alone was rolled
back — the others are fine. Re-run for just that company with `--company=<id>` after we've
looked at the cause together; do not re-run the whole batch.

---

## Phase D — Validate

```bash
php spark inventory:migrate-books --stage=validate --run-id="$RUN" \
    --books-snapshot=/home/inventoryaic/inv_migration_backups/books_snapshots_$(date +%Y%m%d)
```
**Paste back** the final line plus:
```bash
cat writable/migration/$RUN/validate.summary.json | python3 -m json.tool | grep -E '"failures"|"warnings"' -A3
```
Must be `VALIDATE ok`. Any `failures[]` entry stops the cutover here — send it to me before
going any further. `warnings[]` entries (challan/deferred explained differences, stock-transfer
zero-cost explained differences) are expected and fine to proceed past; every one names the
items and vouchers involved in `validate.summary.json` if you want to spot-check any of them.

---

## Phase E — Cutover

Only start this phase once Phase D said `VALIDATE ok`. This is the point past which Books stops
valuing its own stock.

### E1. Cutover stage
```bash
php spark inventory:migrate-books --stage=cutover --run-id="$RUN"
```
Paste back the output — validates once more, resets sequences, writes the cutover marker.

### E2. Flip Books to live (Books account user, so the file keeps its ownership)
```bash
su -s /bin/bash - booksaicountly
cd /home/booksaicountly/public_html/api
grep -n "^INVENTORY_MODE" .env
```
Edit `.env`, change `INVENTORY_MODE = legacy` to `INVENTORY_MODE = live`. CodeIgniter reads
`.env` fresh on every request, so the very next request after you save the file uses it — no
restart needed. Confirm:
```bash
grep -n "^INVENTORY_MODE" .env
curl -s -H "X-Service-Key: $(grep '^INVENTORY_SERVICE_KEY' .env | cut -d= -f2- | xargs)" \
    https://books.aicountly.com/api/integration/inventory/health
```
**Paste back** — must now report `mode: live`.

### E3. Resync masters (proves the channel works; Books' mirror should already match exactly)
```bash
cd /home/inventoryaic/public_html/api
php spark inventory:resync-masters --all
```
Paste back the output.

### E4. Cross-check Books now reads stock from Inventory (use the logged-in apps, not curl)
Both the report Books shows and Inventory's own warehouse-stock report are gated by company/FY
context and permissions resolved from a real logged-in session, not something a bare curl call
can reproduce meaningfully — so do this from the browser, already signed in:
1. In Books, open the inventory/stock report for one real company and note its closing
   quantity for a couple of items.
2. In Inventory's own web app, open **Reports → Warehouse Stock** for the same company and
   compare the same items' closing quantities.
Tell me whether they agree — this is a real cross-check, not a formality.

### E5. Smoke test with one real company
In the live Books app: post a purchase with items, post a sales invoice, cancel a test invoice,
print a historical invoice, then open Inventory's web app and check that item's stock ledger
reflects each of those. Tell me how each one went — this step needs a human eyeballing the UI,
not a paste-back.

### E6. Lift maintenance mode
Only after E5 looks right. Books web and mobile already point at Inventory as of the Phase A8
deploy, so there's no separate frontend deploy at this point.

---

## Phase F — Post-check

### F1. Immediately after lifting maintenance
```bash
cd /home/inventoryaic/public_html/api
php spark inventory:migrate-books --stage=postcheck --run-id="$RUN"
php spark inventory:migrate-books --stage=sequences --run-id="$RUN" --dry-run
```
Paste back both outputs.

### F2. Reconciliation, once per active company
In Inventory's web app (signed in), open **Reconciliation** for each active company and run it
there — the same permission/company context that gates the report screens in E4 applies here,
so this is a UI action, not a curl call. Confirm the posting-status view shows only `IN_SYNC`
entries; paste back (or describe) anything that isn't.

### F3. T0+1h and T0+1day
Re-run F1 and F2 again at both marks. Nothing needs to change in this document for those — just
re-run the same two blocks and paste the output.

---

## Rollback quick reference

Full detail in `ROLLBACK_PLAN.md`. The one thing worth repeating here because it bit us once
during rehearsal: **rollback needs the exact `$RUN` value from Phase C2** (the file you wrote to
`/home/inventoryaic/inv_migration_run_id_*.txt`), not whatever `validate`/`cutover` used — every stage
silently invents its own fresh run-id if you forget `--run-id`, so pasting a rollback command
without it looks like it works (`ROLLBACK complete`) while quietly touching zero rows.

Before `INVENTORY_MODE=live` (Phase A–D): `php spark inventory:migrate-books --stage=rollback --run-id="$RUN" --yes`,
then verify — don't trust the message:
```bash
psql -w -U <inventory db user> -d <inventory db name> -c "SELECT count(*) FROM inv_legacy_id_map WHERE migration_run_id = '$RUN';"
```
Expect `0`.

After `INVENTORY_MODE=live` (Phase E onward): first `INVENTORY_MODE = legacy` back in Books'
`.env` (stops the bleed immediately, Books values stock itself again from its own untouched
frozen tables), then follow `ROLLBACK_PLAN.md` section B for the rest. Send me what you're
seeing before running anything here — this branch is the one place in the whole runbook worth a
second pair of eyes before you type the command, not after.
