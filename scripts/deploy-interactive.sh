#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

echo "Interactive deploy helper — 跟随提示执行每一步，按 Ctrl+C 可中断。"

confirm() {
  local prompt="$1"
  read -p "$prompt [y/N]: " ans
  case "$ans" in
    [Yy]* ) return 0 ;;
    * ) return 1 ;;
  esac
}

run_or_show() {
  echo "+ $*"
  "$@"
}

if [ -f .env ]; then
  echo "加载 .env"
  # shellcheck disable=SC1091
  set -o allexport; source .env; set +o allexport
else
  echo ".env 未找到，请先复制 .env.example 并编辑为 .env，然后再次运行本脚本。"
  exit 1
fi

echo "步骤 1 — 备份（建议）"
if confirm "是否现在执行代码与数据库备份?"; then
  TIMESTAMP=$(date +%F-%H%M)
  mkdir -p /tmp/aurora-backups
  tar -czf /tmp/aurora-backups/aurora-code-$TIMESTAMP.tar.gz . || true
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "备份 Postgres..."
    pg_dump -Fc --dbname="$DATABASE_URL" -f /tmp/aurora-backups/aurora-postgres-$TIMESTAMP.dump || true
  fi
  if [ -n "${REDIS_URL:-}" ]; then
    echo "触发 Redis BGSAVE..."
    redis-cli -u "$REDIS_URL" BGSAVE || true
  fi
  echo "备份写入 /tmp/aurora-backups"
fi

echo "步骤 2 — 建表"
if confirm "是否运行 sql/create_tables.sql? (需要 psql 可用)"; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL 未设置，跳过。"
  else
    run_or_show psql "$DATABASE_URL" -f sql/create_tables.sql
    run_or_show psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
  fi
fi

echo "步骤 3 — 迁移 users 至 Postgres"
if [ -f scripts/migrate-to-postgres.js ]; then
  if confirm "是否运行 scripts/migrate-to-postgres.js?"; then
    run_or_show node scripts/migrate-to-postgres.js
    if [ -n "${DATABASE_URL:-}" ]; then
      run_or_show psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
    fi
  fi
else
  echo "scripts/migrate-to-postgres.js 不存在，跳过。"
fi

echo "步骤 4 — 迁移 orders 与 sponsorships 至 Postgres"
if [ -f scripts/migrate-orders-sponsorships.js ]; then
  if confirm "是否运行 scripts/migrate-orders-sponsorships.js?"; then
    run_or_show node scripts/migrate-orders-sponsorships.js
    if [ -n "${DATABASE_URL:-}" ]; then
      run_or_show psql "$DATABASE_URL" -c "SELECT count(*) FROM orders;"
      run_or_show psql "$DATABASE_URL" -c "SELECT count(*) FROM sponsorships;"
    fi
  fi
else
  echo "scripts/migrate-orders-sponsorships.js 不存在，跳过。"
fi

echo "步骤 5 — 上传素材到 OSS"
if confirm "是否运行脚本上传 public 目录到 OSS (scripts/upload-assets-to-oss.js)?"; then
  if [ -z "${OSS_BUCKET:-}" ]; then
    echo "OSS_BUCKET 未设置，跳过上传。"
  else
    run_or_show node scripts/upload-assets-to-oss.js public
  fi
fi

echo "步骤 6 — 安装依赖与构建"
if confirm "是否执行 pnpm install && pnpm build?"; then
  if command -v pnpm >/dev/null 2>&1; then
    run_or_show pnpm install --frozen-lockfile
    run_or_show pnpm build
  else
    echo "pnpm 未安装，请手动安装或使用 npm。"
  fi
fi

echo "步骤 7 — 启动服务 (pm2 或 systemd)"
if confirm "你想使用 pm2 启动吗? (否则使用 systemd)"; then
  if confirm "要用 pm2 启动并加载 ecosystem.config.js 吗?"; then
    run_or_show pm2 startOrReload ecosystem.config.js
    run_or_show pm2 logs aurora-api --lines 200
  fi
else
  echo "请确保已将 scripts/aurora-api.service 复制到 /etc/systemd/system 并正确设置 .env 路径"
  if confirm "现在重载并启用 systemd 单元 aurora-api?"; then
    sudo systemctl daemon-reload
    sudo systemctl enable --now aurora-api
    sudo journalctl -u aurora-api -n 200 --no-pager
  fi
fi

echo "步骤 8 — Smoke tests"
if confirm "是否运行基本 smoke tests?"; then
  echo "健康检查:"
  curl -s "http://127.0.0.1:${PORT:-3000}/api/health" | jq || true
  echo "资产清单检查:"
  curl -s "http://127.0.0.1:${PORT:-3000}/api/assets/manifest" | jq '.entries | length' || true
fi

echo "交互式部署完成。请把关键命令输出（尤其发生错误的部分）贴回给我以继续排查。"
