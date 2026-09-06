# inventory-aicountly

Inventory for Aicountly — a React single-page app built with Vite and TypeScript,
with a small PHP API alongside it. Both halves deploy to cPanel.

| Environment | App | API |
| --- | --- | --- |
| Production | https://inventory.aicountly.com | https://inventory.aicountly.com/api |
| Sandbox | https://inventory.gh.aicountly.com | https://inventory.gh.aicountly.com/api |

## What this app does

Aicountly Inventory is the stock engine for every Aicountly product. It owns items,
units and conversions, warehouses, bills of material, batches and serials, opening
stock, inventory documents (transfers, stock journals, physical counts, production,
job work, packing, challans, revaluation, landed cost, reservations), stock movements
and balances, FIFO / LIFO / weighted-average valuation, COGS effects, back-dated
recalculation, stock reports and a reconciliation against Books' Stock-in-Hand ledger.

Books (accounting) hands it the item lines of sales, purchase, credit-note and
debit-note vouchers and receives the valuation and COGS back; Manage stays the source
of companies, branches and financial years. The contract is in
[docs/DOMAIN_OWNERSHIP.md](docs/DOMAIN_OWNERSHIP.md) and
[docs/INVENTORY_API_CONTRACT.md](docs/INVENTORY_API_CONTRACT.md); the Books
integration in [docs/BOOKS_INVENTORY_INTEGRATION.md](docs/BOOKS_INVENTORY_INTEGRATION.md).

Signing in is the AICOUNTLY portal's job, the same as every other AICOUNTLY
SaaS: the app redirects to the portal, the portal returns an `auth_token`, and
the app exchanges it for a short-lived session key. Trusted backends (Books, POS…)
call the API with a service key instead. See
[docs/auth/AICOUNTLY_AUTH_WORKFLOW.md](docs/auth/AICOUNTLY_AUTH_WORKFLOW.md).

## Layout

```
web/          React + TypeScript app (Vite). Builds to web/dist, deployed to the document root.
server-php/   CodeIgniter 4 API (PostgreSQL 16). Deployed to the api/ folder inside the document root.
  app/        controllers (Api/V1), services (posting engine, valuation, migration), commands
  database/migrations/   SQL migrations applied by `php spark inventory:sql-migrate`
  tests/      unit + PostgreSQL integration suites
docs/         ownership, API contract, integration, migration plan/runbook/validation, rollback, reconciliation
```

## Getting started

Requires Node.js 22+, PHP 8.1+ with pgsql, Composer, PostgreSQL 16.

```bash
# API
cd server-php
composer install
cp .env.example .env            # set database.default.*, INVENTORY_SERVICE_KEYS, BOOKS_SERVICE_KEY, MANAGE_API_BASE
php spark inventory:sql-migrate # creates every inv_* table
php spark serve                 # http://localhost:8080 (set app.forceGlobalSecureRequests = false locally)

# Web
cd ../web
npm install
npm run dev                     # http://localhost:5173, VITE_API_BASE_URL=http://localhost:8080
```

| Command | Purpose |
| --- | --- |
| `php spark inventory:sql-migrate` | apply pending SQL migrations |
| `php spark inventory:migrate-books --stage=precheck|migrate|validate|sequences|cutover|postcheck|rollback` | one-time migration from the Books database ([docs/DB_MIGRATION_RUNBOOK.md](docs/DB_MIGRATION_RUNBOOK.md)) |
| `php spark inventory:outbox-dispatch` | deliver integration events to Books (cron, every minute) |
| `php spark inventory:recalc-worker` | run queued back-dated valuation recalculations (cron) |
| `php spark inventory:reconcile --all` | nightly reconciliation with Books |
| `php spark inventory:rebuild-balances` | rebuild materialised on-hand balances |
| `vendor/bin/phpunit --testsuite unit` / `vendor/bin/phpunit -c phpunit-integration.xml` | tests (integration needs the `inventory_test` PostgreSQL database from `app/Config/Database.php`) |

## Deploying

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short: the workflow builds `web/`,
rsyncs it to the document root, rsyncs `server-php/` (without `vendor/`, tests or
runtime state) to `api/`, and runs `cpanel-post-deploy-api.sh` on the server, which
installs Composer dependencies, bootstraps `.env` on the first deploy, and applies
SQL migrations.
