快速部署（最小停机）指南

此文档配合仓库内脚本 `scripts/deploy-prod-fast.sh` 与 `ecosystem.config.js` 使用，步骤按“快速执行 + 验证”顺序列出。部署前请在测试环境完整验证一次。

一、前提与准备（手动）
- 在阿里云服务器以部署用户登录（不要用 root 直接运行脚本）。
- 确认已安装工具：`node`、`pnpm`（或 `npm`）、`pm2`（或 systemd）、`psql`、`redis-cli`、`jq`（用于检查）。
- 准备好环境信息并记录：
  - Postgres：`DATABASE_URL`（示例：postgresql://aurora:StrongPass@127.0.0.1:5432/aurora_db）
  - Redis：`REDIS_URL`（示例：redis://127.0.0.1:6379）
  - OSS：`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_REGION`、`OSS_ENDPOINT`
  - 应用关键：`AUTH_JWT_SECRET`、微信支付/第三方 API Key（如需要）
    - 短信（开发/测试）：`ALIYUN_SMS_ACCESS_KEY_ID`、`ALIYUN_SMS_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_TEMPLATE_CODE`。若在本地没有阿里云账号，可在 `.env` 中临时设置 `ALLOW_SMS_DEV=true`（仅用于本地开发/测试，生产环境请勿开启）。

二、把仓库同步到服务器（手动）
- 通过 git clone / scp / rsync 将项目放到目标路径，例如 `/opt/aurora`。

三、运行前检查（手动/运行）
- 列出文件并确认脚本存在：
```bash
ls -la /path/to/project/scripts/deploy-prod-fast.sh
ls -la /path/to/project/ecosystem.config.js
```

四、备份（运行）
- 建议在开始前做完整备份（脚本会做基础备份，但你也可以手动）：
```bash
cd /path/to/project
TIMESTAMP=$(date +%F-%H%M)
# 代码与静态
tar -czf /tmp/gnoverse-code-backup-$TIMESTAMP.tar.gz .
tar -czf /tmp/gnoverse-public-backup-$TIMESTAMP.tar.gz public || true
# Postgres（如果可用）
export DATABASE_URL='postgresql://postgres:password@127.0.0.1:5432/postgres'
pg_dump -Fc --dbname="$DATABASE_URL" -f /tmp/gnoverse-postgres-backup-$TIMESTAMP.dump || true
# Redis（如果可用）
redis-cli -u "$REDIS_URL" BGSAVE || true
```

五、建表（运行）
- 确保 `sql/create_tables.sql` 在仓库中，然后运行：
```bash
export DATABASE_URL='postgresql://aurora:StrongPassw0rd@127.0.0.1:5432/aurora_db'
psql "$DATABASE_URL" -f sql/create_tables.sql
```
- 验证表已创建：
```bash
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public';"
```

六、迁移老用户数据（运行）
- 脚本位置：`scripts/migrate-to-postgres.js`（会读取 `server/.data/users.json`）
```bash
export DATABASE_URL='postgresql://aurora:StrongPassw0rd@127.0.0.1:5432/aurora_db'
node scripts/migrate-to-postgres.js
# 查看 users 表行数
psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
```
- 抽样比对旧数据：
```bash
jq '.users | .[:10] | map({id,username,phone})' server/.data/users.json
psql "$DATABASE_URL" -c "SELECT id,username,phone FROM users LIMIT 10;"
```

七、上传素材到 OSS（运行）
- 在部署机导出 OSS 环境变量，然后运行上传脚本：
```bash
export OSS_BUCKET='your-bucket'
export OSS_ACCESS_KEY_ID='AKIAXXX'
export OSS_ACCESS_KEY_SECRET='SECRET'
export OSS_REGION='oss-cn-hangzhou'
export OSS_ENDPOINT='oss-cn-hangzhou.aliyuncs.com'
node scripts/upload-assets-to-oss.js public
```
- 验证：
```bash
curl 'http://127.0.0.1:3000/api/assets/manifest?prefix=assets/&max=20' | jq
```

八、安装依赖并构建（运行）
```bash
pnpm install --frozen-lockfile
pnpm build
# 或 npm:
# npm install
# npm run build
```

九、设置环境变量并启动（手动）
- 推荐使用 `pm2`，仓库中已有 `ecosystem.config.js` 模板。你可通过 `pm2` 环境或 systemd 注入实际 env：
```bash
# 使用 pm2
pm2 startOrReload ecosystem.config.js
pm2 logs aurora-api --lines 200
```
- 若用 systemd，我可以另外提供示例 unit 文件。

-- 环境文件示例

仓库已包含 `.env.example` 文件，建议在部署目录复制为 `.env` 并进行编辑：

```bash
cp .env.example .env
# 编辑 .env，按实际值替换占位符
vim .env

# systemd 示例（若使用本仓库的 scripts/aurora-api.service）：
sudo cp scripts/aurora-api.service /etc/systemd/system/aurora-api.service
# 编辑 unit 中的 WorkingDirectory 与 EnvironmentFile 路径（通常指向 /path/to/project/.env）
sudo systemctl daemon-reload
sudo systemctl enable --now aurora-api
sudo journalctl -u aurora-api -f
```

注意：为安全起见，`.env` 不应加入 git。若在 CI/CD 中注入环境变量，请使用平台的 Secret 管理功能。

-- 强制使用远程存储（谨慎）

如果你希望在部署时**强制**所有服务使用远程存储（Postgres / Netlify blobs / OSS）并在配置缺失时失败，设置：

```bash
export FORCE_USE_REMOTE_STORAGE=true
```

在该模式下，应用将不再回退到本地 `.data` 文件，而是抛出错误以避免隐式降级。上线前请先确认 `DATABASE_URL`、OSS/Blobs 配置均已就绪。

十、Smoke tests（运行）
- 健康检查：
```bash
curl -s 'http://127.0.0.1:3000/api/health' | jq
```
- OTP（Redis）流程检查：
```bash
curl -X POST 'http://127.0.0.1:3000/api/auth/sms/send' -H 'Content-Type: application/json' -d '{"phone":"13800000000","purpose":"register"}'
# 检查 redis 键
redis-cli -u "$REDIS_URL" GET "register:13800000000"
```
- 资产清单检查：
```bash
curl -s 'http://127.0.0.1:3000/api/assets/manifest' | jq '.entries | length'
```
- 下单与支付回调完整路径（测试）：
  - 在前端创建订单，获取 `outTradeNo`；模拟或触发支付回调；在 DB 中检查：
```bash
psql "$DATABASE_URL" -c "SELECT * FROM orders WHERE out_trade_no = '<outTradeNo>';"
psql "$DATABASE_URL" -c "SELECT * FROM sponsorships WHERE out_trade_no = '<outTradeNo>';"
```

十一、解除维护并灰度（手动）
- 若 smoke tests 通过，解除维护模式并逐步放量（Nginx/LB 按流量或头部路由切换）。

十二、回滚（若出现问题，手动执行）
- 代码回滚：
```bash
cd /path/to/project
git checkout <previous_commit>
pnpm install --frozen-lockfile
pnpm build
pm2 restart aurora-api
```
- Postgres 恢复：
```bash
pg_restore -d aurora_db -U postgres /tmp/gnoverse-postgres-backup-<ts>.dump
```
- Redis 恢复：
```bash
sudo systemctl stop redis
cp /tmp/redis-dump-<ts>.rdb /var/lib/redis/dump.rdb
sudo chown redis:redis /var/lib/redis/dump.rdb
sudo systemctl start redis
```
- OSS 恢复：从备份重新上传素材或使用 OSS 版本功能（如果预先开启）。

十三、运维与监控建议（手动配置）
- 开启阿里云监控或 Prometheus：监控 Postgres 连接数、查询延迟、Redis io/latency、应用 5xx 率、支付失败率等。
- 设置告警（邮件/飞书/钉钉/Slack）。

十四、运行脚本示例（在部署机）
```bash
# 赋予快速部署脚本可执行权限（只需执行一次）
chmod +x scripts/deploy-prod-fast.sh
# 设置必需 env，然后运行
export DATABASE_URL='postgresql://aurora:StrongPassw0rd@127.0.0.1:5432/aurora_db'
export REDIS_URL='redis://127.0.0.1:6379'
export OSS_BUCKET='your-bucket'
export OSS_ACCESS_KEY_ID='AKIAXXX'
export OSS_ACCESS_KEY_SECRET='SECRET'
export OSS_REGION='oss-cn-hangzhou'
export OSS_ENDPOINT='oss-cn-hangzhou.aliyuncs.com'
./scripts/deploy-prod-fast.sh
```

本仓库新增辅助脚本可在本地使用线上环境变量直接启动后端（不会写入或覆盖服务器上的 `.env`）：

```bash
# 在本地终端确保已导出线上环境变量后运行：
chmod +x scripts/run-local-using-prod-env.sh
./scripts/run-local-using-prod-env.sh
```


-- 如果这是全新环境（无需备份），可额外执行以下步骤用于幂等性验证：

1) 应用唯一索引迁移（防止并发插入）：

```bash
psql "$DATABASE_URL" -f sql/20260814_unique_sponsorship_out_trade_no.sql
```

2) 启动应用并在另一终端运行并发回调测试（模拟微信回调）：

```bash
# 假设已有 pending 订单，替换为实际 outTradeNo 与 transactionId
export TARGET='http://127.0.0.1:3000/api/pay/notify'
node scripts/test-payment-concurrency.js AUR12345 TRANX12345
```

查看 `orders` 与 `sponsorships` 表，确认只有一条对应赞赏记录。


十五、我可以代劳的事情（按需）
- 生成 `systemd` unit 文件示例并提交。
- 生成更保守的“多步骤交互式”部署脚本（包含每步手动确认）。
- 帮你调试迁移脚本输出或排查出错信息（你把控制台输出贴给我）。

如同意，我将：
- 标记 `scripts/deploy-prod-fast.sh` 可执行（无法直接在你的服务器上执行——你需要运行上面的 `chmod`），
- 并继续为你生成 `systemd` unit 文件或交互式版本脚本。请选择：
- 1) 我现在生成 `systemd` 单元文件；
- 2) 我生成交互式部署脚本；
- 3) 你现在要我继续下一步（例如运行迁移），请回复并贴出你要运行的命令输出以继续调试。