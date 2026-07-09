---
name: feishuctral
description: 飞书 Claude Code 桥接器 — 通过飞书控制 Claude Code，支持会话结束自动推送任务摘要通知
---

# Feishuctral - 飞书 Claude Code 桥接器

你正在管理 Feishuctral 桥接器。用户数据存储在 `~/.claude-to-im/`。

## 子命令

| 用户说 | 子命令 |
|--------|--------|
| `setup`, `configure`, `配置`, `连接飞书`, `设置` | setup |
| `start`, `start bridge`, `启动` | start |
| `stop`, `stop bridge`, `停止` | stop |
| `status`, `bridge status`, `状态`, `运行状态` | status |
| `logs`, `查看日志` | logs |
| `reconfigure`, `修改配置`, `改 token`, `换个应用` | reconfigure |
| `doctor`, `diagnose`, `诊断`, `挂了`, `没反应了`, `出问题了` | doctor |

### setup

收集飞书凭证（App ID + App Secret），创建 `~/.claude-to-im/config.env`。

引导用户完成飞书应用的两阶段配置：
- Phase 1：权限 + 机器人 + 首次发布（桥接器未运行时）
- Phase 2：启动桥接器 → 事件订阅（长连接模式）→ 二次发布

### start / stop / status / logs

```bash
bash SKILL_DIR/scripts/daemon.sh start|stop|status|logs [N]
```

### reconfigure

读取当前配置，更新指定项，重新验证。

### doctor

运行 `bash SKILL_DIR/scripts/doctor.sh` 诊断问题。

## 通知摘要

Stop Hook 脚本 `scripts/feishu-summary-notify.cjs` 在会话结束时发送通知。

**最佳实践**：让 Claude 在会话结束前写入 `~/.claude-to-im/data/last-summary.txt`，内容为 1-2 句话的会话摘要。在 `~/.claude/CLAUDE.md` 中添加提醒。
