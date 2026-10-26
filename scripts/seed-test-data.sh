#!/bin/bash
# Seeds test data into the live SQLite database.
#   ./seed-test-data.sh          accounts + a first set of orders (seed-test-data.mjs)
#   ./seed-test-data.sh more     extra shops/services + ~2 months of orders (seed-more-orders.mjs)
# Briefly stops the API (and the watchdog), backs up the database, seeds, then restarts.
set -euo pipefail
cd "$(dirname "$0")/../hogulink-api"
ORIGIN=${SEED_WEB_ORIGIN:-http://43.165.176.24}
if [ "${1:-}" = more ]; then SCRIPT=seed-more-orders.mjs CATALOG=1 DAYS_BACK=62; else SCRIPT=seed-test-data.mjs CATALOG=0 DAYS_BACK=40; fi
TOKEN=$(openssl rand -hex 16)
BACKUP=~/hogulink-backups/hogulink-before-seed-$(date +%Y%m%d-%H%M%S).sqlite
mkdir -p ~/hogulink-backups

restart() {
  [ -n "${SEED_PID:-}" ] && kill "$SEED_PID" 2>/dev/null || true
  sudo systemctl start hogulink-api hogulink-web hogulink-watchdog.timer
}
trap restart EXIT

sudo systemctl stop hogulink-watchdog.timer hogulink-api
node -e "new (require('node:sqlite').DatabaseSync)('data/hogulink.sqlite').exec(\"VACUUM INTO '$BACKUP'\")"
echo "Backup: $BACKUP"

API_PORT=4100 SEED_TOKEN=$TOKEN SEED_CATALOG=$CATALOG SEED_START_OFFSET_MS=$((-DAYS_BACK * 86400000)) \
  WEB_ORIGIN=$ORIGIN PUBLIC_WEB_URL=$ORIGIN \
  node --import tsx ../scripts/fixtures/seed-server.mts &
SEED_PID=$!
for _ in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:4100/v1/health && break; sleep 1; done

SEED_API_ORIGIN=http://127.0.0.1:4100 SEED_WEB_ORIGIN=$ORIGIN SEED_TOKEN=$TOKEN \
  SEED_OUTPUT=~/hogulink-test-data-${1:-base}.json node ../scripts/$SCRIPT
