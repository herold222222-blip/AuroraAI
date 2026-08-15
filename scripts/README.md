# scripts

此目录包含若干用于部署与本地联调的辅助脚本。

- `run-local-using-prod-env.sh`：使用线上环境变量在本地启动后端（不会写入服务器 `.env`）。
- `restore-sms-from-git.sh`：从本地 Git 历史中查找 `ALIYUN_SMS_*` 相关配置并可选择写入 `.env.local`。**仅在本地安全环境运行**，脚本会掩码展示找到的值并要求确认后写入。

使用 `restore-sms-from-git.sh` 的安全注意事项：

- 仅在受信任的本地机器上运行；不要在 CI、共享主机或未经授权的环境运行。
- 写入前脚本会显示掩码值并要求确认。请勿将生成的 `.env.local` 提交到 Git（仓库已在 `.gitignore` 忽略该文件）。
- 若脚本未找到值，请从你公司的密钥管理或安全备份恢复，或联系负责密钥的人。

示例：

```bash
chmod +x scripts/restore-sms-from-git.sh
./scripts/restore-sms-from-git.sh
```

若需要我帮助把恢复后的 `.env.local` 的内容（不含敏感值）进行验证，请把 `ALIYUN_SMS_SIGN_NAME` 和 `ALIYUN_SMS_TEMPLATE_CODE`（非秘密）或控制台输出粘给我，我可以继续检查配置是否完整。
