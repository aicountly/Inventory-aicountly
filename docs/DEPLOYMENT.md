# Deploying Inventory

## Layout

```
web/          React app (Vite). Builds to web/dist.
server-php/   CodeIgniter 4 API. Deployed as source; Composer runs on the server (post-deploy hook).
docs/         this file, plus the auth notes
```

## What lands where on cPanel

| Workflow | Deploys | Destination | Reachable at |
| --- | --- | --- | --- |
| Deploy to cPanel Production | `web/dist/` then `server-php/` (then `cpanel-post-deploy-api.sh` over SSH) | `<remote root>/` and `<remote root>/api/` | https://inventory.aicountly.com (+ `/api`) |
| Deploy to cPanel Sandbox | `web/dist/` then `server-php/` (then `cpanel-post-deploy-api.sh` over SSH) | `<remote root>/` and `<remote root>/api/` | https://inventory.gh.aicountly.com (+ `/api`) |

`<remote root>` is the `*_SSH_REMOTE_ROOT` secret for that environment,
normally `public_html` (or the subdomain's own document root).

Deployment is manual only — **Actions → pick a workflow → Run workflow**.
Nothing deploys on push or merge.

## One workflow per environment, not per half

Production and sandbox are genuinely separate targets — different SSH
credentials, different servers — so each gets its own workflow. Within one
environment, though, the web build and the API are deployed by the same run,
one after the other: first `web/dist/` to the document root, then
`server-php/` to `api/` inside it. Splitting those into separate workflows
would only mean clicking twice for something that is always meant to happen
together, with two SSH sessions and two sets of runner setup instead of one.

### Why the api folder survives the web deploy step

The web deploy step runs `rsync --delete` against the document root, which
would otherwise remove everything not in the build — including `api/`, since
the API lives inside the document root. That step therefore excludes `api/`
explicitly. **Removing that exclude would delete the entire backend on the
next deploy.**

### Why the API's .env survives the API deploy step

The API deploy step also runs `rsync --delete`, this time against `api/`. The
API's `.env` is created once by hand on the server and exists nowhere else, so
both `--exclude='.env'` and `--exclude='.env.*'` are what keep it alive.
Removing them would wipe the live configuration on the next deploy.

Neither `.env` is ever uploaded either: `.gitignore` keeps them out of the
repository, and the workflow fails the build outright if a committed `.env`
appears under `server-php/`.

## Configuration: two different mechanisms

This is the part worth reading carefully, because the frontend and the backend
behave in opposite ways.

### React (web/) — build time

Vite inlines every `VITE_*` value into the JavaScript bundle when the app is
compiled. The deployed result is plain static files that **never read a `.env`
from disk**. Putting a `.env` in the document root has no effect.

To change a frontend value: change it in the workflow (or in the optional
repository variable), then re-run the workflow. The rebuild is what applies it.

Never put a secret in a `VITE_` variable — anything inlined into the bundle is
public to anyone who views the page source.

The API URL needs no configuration in the normal case: with
`PROD_API_BASE_URL` / `SANDBOX_API_BASE_URL` unset, the app calls its own origin
+ `/api`, which is where the same workflow's API step deploys `server-php`.
Those repository variables exist only to override that — for example if the API
moves to its own domain.

### server-php — runtime

PHP reads its `.env` on **every request**. So the API's `.env` belongs on the
server, and only on the server.

Create it once by hand — cPanel File Manager or SSH — at
`<remote root>/api/.env`, from `server-php/.env.example`:

```
APP_ENV=production
```

That is the whole file for a production deploy; `APP_ENV=sandbox` for the
sandbox. `GET /api/health` reports the value back, which is how you confirm
you are looking at the environment you think you are.

The API has no database yet. When the product needs one, add the credentials to
this same file — and note that cPanel prefixes both database and user with the
account name, so a database entered as `app` becomes `<cpaneluser>_app`. Use the
full prefixed names, add the user to the database with **ALL PRIVILEGES**, and
set `DB_HOST=localhost` (on cPanel the database is on the same machine).

### Protecting the API's .env over HTTP

Because `api/` sits inside the document root, `.env` would be fetchable at
`https://inventory.aicountly.com/api/.env` unless Apache is told otherwise.
`server-php/.htaccess` ships the rule that denies it:

```apache
RedirectMatch 404 /\.(?!well-known)
```

The web build does the same for the document root via `web/public/.htaccess`,
but those rules stop applying inside `api/` once the API's own take over.

### The Authorization header

`server-php/.htaccess` also copies the `Authorization` header into the request
environment. Apache does not pass it to PHP under CGI/FastCGI unless told to,
and without it the auth relay forwards no credential — the portal answers 401
and sign-in fails for everyone, with nothing in the logs to explain why.

## Required secrets

Per environment, under Settings → Secrets and variables → Actions → Secrets:

`PROD_SSH_HOST`, `PROD_SSH_PORT`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`,
`PROD_SSH_REMOTE_ROOT` — and the same five with a `SANDBOX_` prefix.

Both workflows validate these before building, and verify SSH authentication
before writing anything to the server. Because the deploys run with
`--delete`, a `*_SSH_REMOTE_ROOT` that would resolve to the home directory
itself, a system directory, or anything containing `..` is refused.

## First deploy checklist

1. Create the subdomain in cPanel and note its document root.
2. Add the five SSH secrets for that environment.
3. Run **Deploy to cPanel …**. This deploys web and API together; the API is
   deployed but unconfigured until the next step.
4. Create `api/.env` on the server (see above), from `server-php/.env.example`.
5. Re-run **Deploy to cPanel …** (or just confirm the API), then confirm
   `https://<host>/api/health` returns the right `env` and open the site to
   sign in. See [auth/AICOUNTLY_AUTH_WORKFLOW.md](auth/AICOUNTLY_AUTH_WORKFLOW.md)
   for what a healthy login looks like.


## The API on the server (CodeIgniter 4)

`api/.htaccess` rewrites every request to `api/public/index.php`, so `https://<host>/api/v1/...`
reaches the framework with `app.baseURL = https://<host>/api/`. The deploy rsyncs `server-php/`
without `vendor/`, `tests/` and `writable/` state (see `scripts/cpanel-rsync-api.filters`), then
runs `cpanel-post-deploy-api.sh <api dir>` over SSH, which:

1. installs Composer dependencies (`composer install --no-dev --optimize-autoloader`, bootstrapping
   `composer.phar` in the account's home if cPanel has none);
2. creates `.env` from `.env.example` on the very first deploy only (never overwrites secrets) and pins
   `app.baseURL` / `INVENTORY_APP_URL` to the site host;
3. makes `writable/` writable;
4. applies pending SQL migrations: `php spark inventory:sql-migrate` (tracked in `inv_sql_migrations`);
5. probes `public/status.php` and resets the CLI OPcache.

Settings that must exist in `api/.env` (see `server-php/.env.example`): `database.default.*` (PostgreSQL 16),
`INVENTORY_SERVICE_KEYS` (`books:<key>,pos:<key>`), `BOOKS_SERVICE_KEY`, `BOOKS_API_BASE`,
`MANAGE_API_BASE`, `PORTAL_AUTH_BASE`, `CORS_ALLOWED_ORIGINS`, and for the one-time migration the
read-only Books connection `BOOKS_DB_*`.

Cron (cPanel → Cron Jobs), every minute:

```
cd /home/<user>/public_html/<host>/api && php spark inventory:outbox-dispatch >/dev/null 2>&1
cd /home/<user>/public_html/<host>/api && php spark inventory:recalc-worker  >/dev/null 2>&1
```
every five minutes `php spark inventory:expire-reservations` (releases reservations whose
`expires_at` has passed), and nightly `php spark inventory:reconcile --all`.
