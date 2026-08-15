#!/usr/bin/env bash
# 用线上环境变量在本地启动后端的辅助脚本
# 不会写入或上传任何密钥；仅检查必需 env 并启动 dev:api

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REQUIRED=(
  DATABASE_URL
  REDIS_URL
  AUTH_JWT_SECRET
  OSS_BUCKET
  OSS_ACCESS_KEY_ID
  OSS_ACCESS_KEY_SECRET
  OSS_REGION
  OSS_ENDPOINT
)

miss=false
for v in "${REQUIRED[@]}"; do
  if [ -z "${!v-}" ]; then
    echo "[ERROR] 环境变量 $v 未设置"
    miss=true
  fi
done

if [ "$miss" = true ]; then
  echo ""
  echo "提示：可在本地通过导出这些变量或在安全的 .env 文件中设置它们（不要提交到 git）。"
  echo "示例："
  echo "  export DATABASE_URL='postgresql://user:pass@host:5432/db'"
  echo "  export REDIS_URL='redis://host:6379'"
  echo "然后运行： npm run dev:api 或本脚本再次运行。"
  exit 1
fi

echo "使用线上环境变量在本地启动后端（不会修改任何远端数据）。"
echo "Working dir: $ROOT_DIR"
echo "启动命令：npm run dev:api（或 pnpm run dev:api）"

if command -v pnpm >/dev/null 2>&1; then
  echo "使用 pnpm 运行..."
  exec pnpm run dev:api
else
  echo "pnpm 未找到，使用 npm 运行..."
  exec npm run dev:api
fi
