#!/usr/bin/env bash
set -euo pipefail

# Quick deploy script (minimal downtime)
# Usage: export required env vars below, then run as deploy user on target server.

if [ "$EUID" -eq 0 ]; then
  echo "Run as deploy user, not root." >&2
fi

PROJECT_DIR=${PROJECT_DIR:-/path/to/project}
PM2_APP_NAME=${PM2_APP_NAME:-aurora-api}
TIMESTAMP=$(date +%F-%H%M%S)

required=(DATABASE_URL REDIS_URL OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_REGION OSS_ENDPOINT)
for v in "${required[@]}"; do
  if [ -z "${!v:-}" ]; then
    echo "Environment variable $v is not set. Aborting." >&2
    exit 2
  fi
done

echo "Quick deploy started at $TIMESTAMP"
echo "Project dir: $PROJECT_DIR"

cd "$PROJECT_DIR"

######### 1) Backups #########
echo "Backing up code and public assets..."
tar -czf /tmp/gnoverse-code-backup-$TIMESTAMP.tar.gz -C "$PROJECT_DIR" .
tar -czf /tmp/gnoverse-public-backup-$TIMESTAMP.tar.gz -C "$PROJECT_DIR" public || true

echo "Backing up Postgres (logical dump)..."
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump -Fc --dbname="$DATABASE_URL" -f /tmp/gnoverse-postgres-backup-$TIMESTAMP.dump || echo 'pg_dump failed'
else
  echo 'pg_dump not found, skip DB backup'
fi

echo "Triggering Redis BGSAVE..."
if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -u "$REDIS_URL" BGSAVE || echo 'redis bgsave failed'
  if [ -f /var/lib/redis/dump.rdb ]; then
    cp /var/lib/redis/dump.rdb /tmp/redis-dump-$TIMESTAMP.rdb || true
  fi
else
  echo 'redis-cli not found, skip Redis backup'
fi

######### 2) Apply DB schema #########
echo "Applying DB schema (sql/create_tables.sql)"
if command -v psql >/dev/null 2>&1; then
  PSQL_CONN="$DATABASE_URL"
  psql "$PSQL_CONN" -f sql/create_tables.sql || { echo 'DDL failed'; exit 3; }
else
  echo 'psql not found; please install postgresql client'; exit 3
fi

######### 3) Data migration (users) #########
echo "Running migration script scripts/migrate-to-postgres.js"
if command -v node >/dev/null 2>&1; then
  node scripts/migrate-to-postgres.js || echo 'migration script reported errors'
else
  echo 'node not found'; exit 4
fi

######### 4) Upload assets to OSS #########
echo "Uploading assets to OSS"
node scripts/upload-assets-to-oss.js public || echo 'asset upload failed'

######### 5) Install deps & build #########
echo "Installing dependencies and building"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
  pnpm build
else
  echo 'pnpm not found; try npm install && npm run build'; exit 5
fi

######### 6) Deploy / restart (pm2) #########
echo "Restarting application via pm2"
if command -v pm2 >/dev/null 2>&1; then
  if [ -f ecosystem.config.js ]; then
    pm2 startOrReload ecosystem.config.js || pm2 restart "$PM2_APP_NAME" || { echo 'pm2 restart failed'; exit 6; }
  else
    pm2 restart "$PM2_APP_NAME" || pm2 start server/index.js --name "$PM2_APP_NAME" || { echo 'pm2 start failed'; exit 6; }
  fi
else
  echo 'pm2 not found; please start the process manually'; exit 6
fi

######### 7) Smoke tests #########
echo "Running smoke checks"
HEALTH=$(curl -sS --max-time 5 http://127.0.0.1:3000/api/health || true)
echo "Health: $HEALTH"
curl -sS --max-time 5 http://127.0.0.1:3000/api/assets/manifest | jq '.entries | length' || true

echo "Quick deploy finished. If errors occurred, check logs: pm2 logs $PM2_APP_NAME"

cat <<'EOF'
Rollback hints:
- To rollback code: git checkout <previous_commit> && pnpm install && pnpm build && pm2 restart <app>
- To rollback Postgres: pg_restore -d <db> /tmp/gnoverse-postgres-backup-<ts>.dump
- To rollback Redis: stop redis, restore /tmp/redis-dump-<ts>.rdb to /var/lib/redis/dump.rdb, start redis
EOF
