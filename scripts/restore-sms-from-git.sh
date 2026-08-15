#!/usr/bin/env bash
# 从本地 git 历史中查找 ALIYUN_SMS_* 配置并可选择写入 .env.local
# 注意：此脚本在本地运行，会读取你的本地 git 仓库历史并展示/写入敏感值。
# 仅在你本地安全环境运行，切勿将密钥粘贴到公共聊天或远端。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v git >/dev/null 2>&1; then
  echo "git 未安装或不可用。请在本地仓库运行此脚本。"
  exit 2
fi

VARS=(
  ALIYUN_SMS_ACCESS_KEY_ID
  ALIYUN_SMS_ACCESS_KEY_SECRET
  ALIYUN_SMS_SIGN_NAME
  ALIYUN_SMS_TEMPLATE_CODE
  ALIYUN_SMS_TEMPLATE_PARAM
  ALIYUN_SMS_REGION_ID
)

declare -A found
for v in "${VARS[@]}"; do
  found[$v]=""
done

echo "扫描 git 历史以查找 ALIYUN_SMS_* 配置（可能需要几秒钟）..."

# 遍历所有提交并尝试读取常见 env 文件
for rev in $(git rev-list --all); do
  for candidate in .env .env.example .env.local .env.development .env.production; do
    if git show ${rev}:$candidate >/dev/null 2>&1; then
      # 从该版本的文件中提取变量
      while IFS= read -r line; do
        for v in "${VARS[@]}"; do
          if [[ $line =~ ^[[:space:]]*${v}= ]]; then
            val=${line#*=}
            val=${val%%[#]*} # strip trailing comment
            val=$(echo "$val" | sed -e 's/^\s*"//' -e 's/"\s*$//' -e "s/^'//" -e "s/'$//")
            if [ -n "${val}" ] && [ -z "${found[$v]}" ]; then
              found[$v]="$val"
            fi
          fi
        done
      done < <(git show ${rev}:$candidate 2>/dev/null || true)
    fi
  done
  # stop early if we found all
  all=true
  for v in "${VARS[@]}"; do
    if [ -z "${found[$v]}" ]; then all=false; break; fi
  done
  $all && break
done

any=false
echo ""
for v in "${VARS[@]}"; do
  val="${found[$v]}"
  if [ -n "$val" ]; then
    # mask value for display
    prefix=${val:0:4}
    suffix=${val: -4}
    if [ ${#val} -le 10 ]; then
      display="${prefix}****"
    else
      display="${prefix}****${suffix}"
    fi
    echo "$v = $display"
    any=true
  fi
done

if [ "$any" = false ]; then
  echo "未在 git 历史中找到 ALIYUN_SMS_* 配置。请手动从备份或记忆中恢复。"
  exit 0
fi

echo ""
read -rp "是否将这些配置写入 .env.local (y/N)? " yn
yn=${yn:-N}
if [[ ! "$yn" =~ ^[Yy] ]]; then
  echo "已取消写入。若需手动写入，请将上面列出的变量复制到 .env.local。"
  exit 0
fi

OUT_FILE="$ROOT_DIR/.env.local"
echo "# Auto-restored ALIYUN_SMS_* from git history" >> "$OUT_FILE"
for v in "${VARS[@]}"; do
  val="${found[$v]}"
  if [ -n "$val" ]; then
    echo "$v=$val" >> "$OUT_FILE"
  fi
done

echo "已写入 $OUT_FILE 。请确认文件权限并勿将其提交到 Git:"
echo "  git update-index --assume-unchanged .env.local"
echo "如要撤销写入，请手动编辑或删除 .env.local。"
