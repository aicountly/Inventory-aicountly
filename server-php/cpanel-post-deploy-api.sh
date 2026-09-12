#!/usr/bin/env bash
# Post-deploy hook for the Inventory API (server-php) on cPanel — run over SSH after rsync.
#
#   bash cpanel-post-deploy-api.sh /home/USER/public_html/inventory.aicountly.com/api
#
# - installs Composer dependencies (vendor/ is never rsynced)
# - creates .env from .env.example on first deploy only (never overwrites secrets)
# - pins app.baseURL to https://<host>/api/ and INVENTORY_APP_URL to https://<host>/
# - makes writable/ writable
# - applies pending SQL migrations (php spark inventory:sql-migrate)
# - probes public/status.php

set -euo pipefail

API_DIR="${1:-}"
API_DIR="${API_DIR//$'\r'/}"
API_DIR="${API_DIR%/}"
if [ -z "$API_DIR" ] || [[ "$API_DIR" != /* ]] || [ ! -d "$API_DIR" ]; then
  echo "ERROR: pass the absolute api directory (got: '${API_DIR}')"
  exit 1
fi
cd "$API_DIR"
API_DIR="$(pwd -P 2>/dev/null || pwd)"
echo "Post-deploy running in API_DIR=${API_DIR}"

find_composer() {
  local loc
  for loc in "${HOME}/bin/composer" "${HOME}/composer.phar" /usr/local/bin/composer /opt/cpanel/composer/bin/composer; do
    if [ -f "$loc" ]; then printf '%s' "$loc"; return 0; fi
  done
  if command -v composer >/dev/null 2>&1; then command -v composer; return 0; fi
  local phar="${HOME}/composer.phar"
  echo "Composer not found — downloading composer.phar to ${phar}" >&2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$phar" https://getcomposer.org/download/latest-stable/composer.phar
  else
    php -d allow_url_fopen=On -r "copy('https://getcomposer.org/download/latest-stable/composer.phar', '${phar}');"
  fi
  chmod +x "$phar"
  printf '%s' "$phar"
}

if [ -f vendor/autoload.php ] && [ -f vendor/codeigniter4/framework/system/Boot.php ] && [ "${FORCE_COMPOSER:-0}" != "1" ]; then
  echo "vendor/ present — running composer install to sync the lock file"
fi
COMPOSER_BIN="$(find_composer | tail -n1 | tr -d '\r')"
echo "Using composer at: ${COMPOSER_BIN}"
php -d allow_url_fopen=On "${COMPOSER_BIN}" install --optimize-autoloader --no-interaction --no-dev --no-progress
test -f vendor/codeigniter4/framework/system/Boot.php || { echo "ERROR: CodeIgniter framework missing after composer install"; exit 1; }

if [ -f .env ]; then
  echo ".env already exists — leaving server secrets unchanged"
elif [ -f .env.example ]; then
  cp .env.example .env
  echo "Created .env from .env.example — set database credentials, INVENTORY_SERVICE_KEYS and BOOKS_SERVICE_KEY on the server"
else
  echo "WARNING: missing .env and .env.example — create .env manually in ${API_DIR}"
fi
if [ -f .env ] && ! grep -qE '^[[:space:]]*CI_ENVIRONMENT[[:space:]]*=' .env; then
  printf '\nCI_ENVIRONMENT = production\n' >> .env
fi

SITE_HOST="${INVENTORY_SITE_HOST:-}"
if [ -z "$SITE_HOST" ]; then
  parent="$(basename "$(dirname "$API_DIR")")"
  [[ "$parent" == *.* ]] && SITE_HOST="$parent"
fi
if [[ -n "$SITE_HOST" && "$SITE_HOST" == *.* && -f .env ]]; then
  if grep -qE '^[[:space:]]*app\.baseURL[[:space:]]*=' .env; then
    sed -i.bak -E "s|^[[:space:]]*app\.baseURL[[:space:]]*=.*|app.baseURL = 'https://${SITE_HOST}/api/'|" .env
  else
    printf "\napp.baseURL = 'https://%s/api/'\n" "$SITE_HOST" >> .env
  fi
  if grep -qE '^[[:space:]]*INVENTORY_APP_URL[[:space:]]*=' .env; then
    sed -i.bak -E "s|^[[:space:]]*INVENTORY_APP_URL[[:space:]]*=.*|INVENTORY_APP_URL = https://${SITE_HOST}/|" .env
  else
    printf "INVENTORY_APP_URL = https://%s/\n" "$SITE_HOST" >> .env
  fi
  rm -f .env.bak
  echo "Ensured app.baseURL=https://${SITE_HOST}/api/ and INVENTORY_APP_URL=https://${SITE_HOST}/"
else
  echo "NOTE: could not resolve the site host (set INVENTORY_SITE_HOST) — app.baseURL left unchanged"
fi

mkdir -p writable/cache writable/session writable/debugbar writable/logs writable/migration
chmod -R 775 writable
test -f public/index.php || { echo "ERROR: public/index.php missing under ${API_DIR}"; exit 1; }

echo "---- Applying SQL migrations ----"
php spark inventory:sql-migrate || { echo "ERROR: inventory:sql-migrate failed"; exit 1; }

echo "---- API status probe (no CI4 boot) ----"
php public/status.php || { echo "ERROR: public/status.php failed"; exit 1; }

php -r 'if (function_exists("opcache_reset")) { opcache_reset(); echo "OPcache reset (CLI SAPI only)\n"; }' || true
echo "Post-deploy complete."
