# Feishuctral

飞书 Claude Code 桥接器 — 通过飞书控制 Claude Code CLI，支持会话结束自动推送任务摘要通知。

## 功能

- 🤖 **飞书控制 Claude Code** — 在飞书里给机器人发消息，Claude Code 自动执行
- 📊 **流式卡片输出** — 代码块、表格以飞书交互式卡片实时渲染
- 🔐 **权限控制** — 按钮交互式批准/拒绝工具调用
- 📬 **会话完成通知** — Stop Hook 自动发送任务摘要到飞书
- 🌍 **跨平台** — 支持 Windows / macOS / Linux

## 前置条件

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 20 | [下载](https://nodejs.org/) |
| Claude Code CLI | 最新版 | `npm install -g @anthropic-ai/claude-code` |
| 飞书应用 | — | 在 [飞书开放平台](https://open.feishu.cn/app) 创建 |
| Git | 任意版本 | 用于安装和版本管理 |

## 快速安装

### 1. 克隆仓库

```bash
git clone https://github.com/luojinyu121/feishuctral.git ~/.claude/skills/feishuctral
cd ~/.claude/skills/feishuctral
```

### 2. 安装依赖

```bash
# 安装技能依赖
npm install

# 构建核心包
cd core && npm install && npm run build && cd ..

# 构建守护进程 bundle
npm run build
```

### 3. 创建配置

```bash
mkdir -p ~/.claude-to-im/{data,logs,runtime,data/messages}
cp config.env.example ~/.claude-to-im/config.env
```

编辑 `~/.claude-to-im/config.env`，填入你的飞书应用凭证：

```env
CTI_FEISHU_APP_ID=cli_xxxxxxxxxx
CTI_FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 飞书应用配置

### Phase 1：权限 + 机器人 + 发布

**A. 批量添加权限**

前往 [飞书开放平台](https://open.feishu.cn/app) → 你的应用 → "权限与范围" → 批量配置，粘贴：

```json
{
  "scopes": {
    "tenant": [
      "im:message:send_as_bot",
      "im:message:readonly",
      "im:message.p2p_msg:readonly",
      "im:message.group_at_msg:readonly",
      "im:message:update",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:chat:read",
      "im:resource",
      "cardkit:card:write",
      "cardkit:card:read"
    ],
    "user": []
  }
}
```

**B. 启用机器人**

左侧 → "添加能力" → 开启 "机器人"

**C. 首次发布**

"版本管理与发布" → "创建版本" → 版本 `1.0.0` → "提交审核" → 管理员通过

### Phase 2：事件订阅（需要桥接器运行中）

**D. 启动桥接器**

```bash
bash ~/.claude/skills/feishuctral/scripts/daemon.sh start
```

**E. 配置事件**

"事件与回调" → 订阅方式选 **"使用长连接接收事件/回调"** → 添加：
- 事件：`im.message.receive_v1`
- 回调：`card.action.trigger`

> ⚠️ 保存时飞书会验证 WebSocket 连接，必须确保桥接器在运行。

**F. 第二次发布**

"版本管理与发布" → "创建版本" → 版本 `1.1.0` → "提交审核" → 管理员通过

完成后在飞书搜索你的机器人名称，发送消息即可开始使用。

## 桥接器管理

```bash
# 启动
bash ~/.claude/skills/feishuctral/scripts/daemon.sh start

# 停止
bash ~/.claude/skills/feishuctral/scripts/daemon.sh stop

# 状态
bash ~/.claude/skills/feishuctral/scripts/daemon.sh status

# 查看最近 50 条日志
bash ~/.claude/skills/feishuctral/scripts/daemon.sh logs 50

# 诊断
bash ~/.claude/skills/feishuctral/scripts/doctor.sh
```

## 会话完成通知（Stop Hook）

在 Claude Code 设置中配置 Stop Hook，会话结束时自动发送任务摘要到飞书。

### 全局配置（所有项目生效）

编辑 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/feishuctral/scripts/feishu-summary-notify.cjs"
          }
        ]
      }
    ]
  }
}
```

### 项目级配置（仅当前项目）

编辑 `<项目>/.claude/settings.local.json`，添加上面相同的 Stop hook。

> ⚠️ 项目级配置会**覆盖**全局 Stop hook。如果需要两个都生效，在项目级配置中同时添加两个 hook。

### 摘要内容优先级

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 🥇 | `~/.claude-to-im/data/last-summary.txt` | Claude 在会话结束前写入，最详细 |
| 🥈 | Git 提交 + 文件变更自动检测 | 代码项目的改动摘要 |
| 🥉 | 项目名 + 时间 | 至少知道是哪个项目 |

如需 Claude 自动写摘要，在 `~/.claude/CLAUDE.md` 中添加：

```markdown
# Stop Hook 通知摘要
当会话结束前，写入 ~/.claude-to-im/data/last-summary.txt，
简要描述本次会话完成的任务（1-2句话即可）。
```

## 常用命令

在飞书中发送以下命令：

| 命令 | 功能 |
|------|------|
| `/new` | 开始新会话 |
| `/mode code` | 切换到代码模式 |
| `/mode plan` | 切换到计划模式 |
| `/mode ask` | 切换到问答模式 |
| `/model <name>` | 切换模型 |
| `/stop` | 停止当前会话 |

## 故障排查

```bash
# 诊断常见问题
bash ~/.claude/skills/feishuctral/scripts/doctor.sh

# 查看实时日志
tail -f ~/.claude-to-im/logs/bridge.log

# 重新构建
cd ~/.claude/skills/feishuctral
npm run build
```

### 常见问题

| 问题 | 解决方法 |
|------|---------|
| 飞书发消息没反应 | 检查事件订阅是否配置为长连接模式，桥接器是否在运行 |
| 通知收不到 | 检查 `~/.claude-to-im/config.env` 飞书凭证是否正确 |
| `daemon.sh` 启动失败 | 运行 `doctor.sh` 诊断，检查 Node.js 版本 >= 20 |
| 桥接器频繁退出 | 检查 config.env 中 `CTI_FEISHU_APP_ID/APP_SECRET` 是否正确 |

## 项目结构

```
feishuctral/
├── README.md                        # 本文档
├── package.json                     # 技能包配置
├── config.env.example               # 配置模板
├── tsconfig.json                    # TypeScript 配置
├── scripts/
│   ├── daemon.sh                    # 守护进程管理脚本（主入口）
│   ├── supervisor-windows.ps1       # Windows 进程管理
│   ├── supervisor-macos.sh          # macOS 进程管理 (launchd)
│   ├── supervisor-linux.sh          # Linux 进程管理 (setsid)
│   ├── build.js                     # esbuild 构建脚本
│   ├── doctor.sh                    # 系统诊断
│   └── feishu-summary-notify.cjs    # Stop Hook 飞书通知脚本
├── src/                             # 守护进程源代码
│   ├── main.ts                      # 入口
│   ├── config.ts                    # 配置解析
│   ├── llm-provider.ts              # LLM 调用封装
│   ├── store.ts                     # 数据持久化
│   └── ...
├── core/                            # claude-to-im 核心桥接库
│   ├── package.json
│   └── src/lib/bridge/
│       ├── adapters/                # IM 平台适配器
│       │   └── feishu-adapter.ts    # 飞书适配器
│       ├── markdown/feishu.ts       # 飞书 Markdown → 卡片渲染
│       └── ...
└── references/
    └── setup-guides.md              # 详细平台设置指南
```

## License

MIT
