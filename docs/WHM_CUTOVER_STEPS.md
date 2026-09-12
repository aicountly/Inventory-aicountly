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

### A5. Create Inventory's `api/.env` by hand (this is the one file the deploy never touches)
```bash
cd <inventory api path from PROD_SSH_REMOTE_ROOT>/api
cp .env.example .env
```
Edit `.env` (via terminal `nano .env`/`vi .env`, or cPanel File Manager) and set, at minimum:
- `CI_ENVIRONMENT = production`
- `app.baseURL = 'https://inventory.aicountly.com/api/'`
- `INVENTORY_APP_URL = https://inventory.aicountly.com/`
- `database.default.hostname/port` — same values you just read from Books' `.env` in A1
- `database.default.database` / `.username` / `.password` — a **new** database for Inventory.
  Create it in **cPanel → PostgreSQL Databases**: create the database (cPanel prefixes it with
  the account name, so naming it `inventory` gives `<cpaneluser>_inventory`), create a user the
  same way (gives `<cpaneluser>_inventory_user`), then add that user to that database with **ALL
  PRIVILEGES**. Use the full prefixed names in `.env`. (If your account's Postgres role can run
  raw DDL instead, the equivalent is `CREATE DATABASE`/`CREATE ROLE`/`GRANT ALL PRIVILEGES ON
  DATABASE … TO …` — but the cPanel UI is the documented path for this hosting setup and prefixes
  names correctly on its own.)
- `INVENTORY_SERVICE_KEYS = books:<generate a strong random key>` and
  `BOOKS_SERVICE_KEY = <generate a different strong random key>` — you'll paste the same two
  keys into Books' `.env` in A8, in the matching direction.
- `BOOKS_DB_HOST/PORT/NAME/USER/PASSWORD` — a **read-only** role for the migration to read Books
  through. Same idea in **cPanel → PostgreSQL Databases**: create a user (e.g. `books_readonly`),
  add it to the existing Books database, and set its **privilege level to read-only** in the
  "Manage User Privileges" screen (cPanel's Postgres UI offers a read-only grant directly — it is
  the same as `GRANT SELECT ON ALL TABLES/SEQUENCES IN SCHEMA public`, without write access).
Leave `INVENTORY_ACCESS_BYPASS=0`.

**Paste back**: the output of
`grep -E "^(CI_ENVIRONMENT|app\.baseURL|database\.default\.(hostname|port|database)) " .env`
(values only, never paste passwords/keys to me) so I can sanity-check before you continue.

### A6. Confirm Inventory is healthy
Re-run **Deploy to cPanel Production** for Inventory (picks up the new `.env`, re-applies
`inventory:sql-migrate` idempotently), then:
```bash
curl -s https://inventory.aicountly.com/api/health
```
Paste the JSON response back.

### A7. Inventory's cron (cPanel → Cron Jobs, or `crontab -e` in this terminal)
```
* * * * * cd <inventory api path>/api && php spark inventory:outbox-dispatch >/dev/null 2>&1
* * * * * cd <inventory api path>/api && php spark inventory:recalc-worker  >/dev/null 2>&1
*/5 * * * * cd <inventory api path>/api && php spark inventory:expire-reservations >/dev/null 2>&1
0 2 * * * cd <inventory api path>/api && php spark inventory:reconcile --all >/dev/null 2>&1
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
* * * * * cd <books api path>/api && php spark books:inventory-retry >/dev/null 2>&1
```

**Phase A is done when**: Inventory's `/api/health` is green, Books' `/api/integration/inventory/health`
reports `mode: legacy` and the app behaves normally. Nothing above touched a single row of real
data. This is a good place to stop and pick up Phase B later, fresh, whenever your overnight
window starts.

---

## Phase B — Freeze, back up, and rehearse against that exact backup

Start the real overnight window here.

### B1. Set up the Postgres connection once (no passwords typed into any command below)
Using the host/port you confirmed in A1, and the Books admin credentials you already have plus
the Inventory admin credentials you set in A5:
```bash
touch ~/.pgpass && chmod 600 ~/.pgpass
echo "<books db host>:<books db port>:*:<books admin user>:<books admin password>" >> ~/.pgpass
echo "<books db host>:<inventory db port>:*:<inventory admin user>:<inventory admin password>" >> ~/.pgpass
export PGHOST=<books db host> PGPORT=<books db port>
mkdir -p ~/inv_migration_backups
psql -U <books admin user> -d <books db name> -c "SELECT current_user, now();"
```
Paste back the result of that last `SELECT` — if it connects without prompting for a password,
`.pgpass` is working and nothing below needs a password typed into it. (If Inventory's database
is on a different host/port than Books, add a second `export`/line pair and pass `-h`/`-p`
explicitly on the Inventory-side commands further down — tell me if that's the case.)

### B2. Announce and freeze
Put Books in maintenance mode. No voucher may post from this point until cutover finishes —
the migration is a point-in-time copy, and every voucher posted during the freeze would be
missed by it.

### B3. Backup Books, and prove the backup is real
```bash
pg_dump -Fc -Z6 --no-owner --no-acl -U <books admin user> -d <books db name> \
  -f ~/inv_migration_backups/books_pre_inventory_$(date +%Y%m%d_%H%M).dump
pg_dump -Fc -U <books admin user> -d <books db name> \
  -f ~/inv_migration_backups/books_globals_$(date +%Y%m%d).dump --schema-only
pg_restore --list ~/inv_migration_backups/books_pre_inventory_*.dump | wc -l
createdb -U <books admin user> books_verify
pg_restore --no-owner --no-acl -U <books admin user> -d books_verify ~/inv_migration_backups/books_pre_inventory_*.dump
psql -U <books admin user> -d books_verify -c "SELECT count(*) FROM books_voucher_headers;"
```
Paste back the line count from `pg_restore --list | wc -l` and the voucher count from
`books_verify` — a backup that hasn't been restored and checked isn't a backup yet.

### B4. Export Books' own stock snapshot
Run as the **Books** account user. If Books and Inventory turned out to be separate cPanel
accounts in A1, replace `~/inv_migration_backups` here with the shared path we agreed then —
Inventory's validate in Phase D has to be able to read this directory, and it runs as a
different user.
```bash
cd <books api path>/api
php spark books:export-inventory-snapshot --out-dir ~/inv_migration_backups/books_snapshots_$(date +%Y%m%d) --company all
```

### B5. Backfill voucher UUIDs (idempotent)
```bash
php spark books:backfill-vch-uuid
```

### B6. MANDATORY — rehearse the full cycle against `books_verify`, not the real databases
This is the step that catches anything specific to *your* real data before it can touch the
real Inventory database. Do not skip it, even at 3am.
```bash
cd <inventory api path>
cp -r api api_verify
createdb -U <inventory admin user> inventory_verify
cd api_verify
```
Edit `api_verify/.env` (a throwaway copy — the real `api/.env` is untouched): set
`database.default.database` to `inventory_verify`, and `BOOKS_DB_NAME` to `books_verify`
(the `books_verify` role/user can stay the same `<books admin user>` you used above — it's a
throwaway database anyway).
```bash
php spark inventory:sql-migrate
export RUN=verify-$(date +%Y%m%d-%H%M)
echo "$RUN" | tee ~/inv_migration_run_id_verify.txt
php spark inventory:migrate-books --stage=precheck --run-id="$RUN"
```
**Paste back** the precheck output — confirm the company list and row counts look like your real
companies (they should: `books_verify` is a full restore), then:
```bash
php spark inventory:migrate-books --stage=migrate --run-id="$RUN" --dry-run
php spark inventory:migrate-books --stage=migrate --run-id="$RUN"
php spark inventory:migrate-books --stage=validate --run-id="$RUN" \
    --books-snapshot=~/inv_migration_backups/books_snapshots_$(date +%Y%m%d)
```
**Paste back** the final line of each command and the `failures`/`warnings` counts from
`writable/migration/$RUN/validate.summary.json`. Must be `VALIDATE ok` with no unexplained
failures before you're clear to continue to Phase C. If anything fails here, stop — do not
proceed to Phase C — and send me the summary so we fix it against the rehearsal copy, not
production.

Once validate is clean, discard the rehearsal (it already did its job):
```bash
cd <inventory api path>
rm -rf api_verify
dropdb -U <inventory admin user> inventory_verify
dropdb -U <books admin user> books_verify
```

---

## Phase C — Migrate (the real Inventory database)

### C1. Confirm the real Inventory database is still empty
```bash
cd <inventory api path>/api
psql -U <inventory admin user> -d <inventory db name> -c "SELECT count(*) FROM inv_document_lines;"
```
Expect `0`. (It was created and schema-migrated in Phase A; this just confirms nothing test-ish
ended up in it since.)

### C2. Precheck — capture the real run-id now, in a file, immediately
```bash
export RUN=prod-$(date +%Y%m%d)
echo "$RUN" | tee ~/inv_migration_run_id_$(date +%Y%m%d).txt
php spark inventory:migrate-books --stage=precheck --run-id="$RUN"
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
    --books-snapshot=~/inv_migration_backups/books_snapshots_$(date +%Y%m%d)
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

### E2. Flip Books to live
```bash
cd <books api path>/api
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
cd <inventory api path>/api
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
cd <inventory api path>/api
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
`~/inv_migration_run_id_*.txt`), not whatever `validate`/`cutover` used — every stage
silently invents its own fresh run-id if you forget `--run-id`, so pasting a rollback command
without it looks like it works (`ROLLBACK complete`) while quietly touching zero rows.

Before `INVENTORY_MODE=live` (Phase A–D): `php spark inventory:migrate-books --stage=rollback --run-id="$RUN" --yes`,
then verify — don't trust the message:
```bash
psql -U <inventory admin user> -d <inventory db name> -c "SELECT count(*) FROM inv_legacy_id_map WHERE migration_run_id = '$RUN';"
```
Expect `0`.

After `INVENTORY_MODE=live` (Phase E onward): first `INVENTORY_MODE = legacy` back in Books'
`.env` (stops the bleed immediately, Books values stock itself again from its own untouched
frozen tables), then follow `ROLLBACK_PLAN.md` section B for the rest. Send me what you're
seeing before running anything here — this branch is the one place in the whole runbook worth a
second pair of eyes before you type the command, not after.
