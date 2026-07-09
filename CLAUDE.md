# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Feishuctral — 飞书 Claude Code 桥接器。通过飞书控制 Claude Code CLI，支持流式卡片输出、权限按钮交互、会话结束自动推送任务摘要通知。

## Build & Run

```bash
# 构建守护进程 bundle
npm run build              # → dist/daemon.mjs (esbuild, targets Node 20 ESM)

# TypeScript 类型检查
npm run typecheck          # tsc --noEmit

# 开发模式（直接运行 TS）
npm run dev                # tsx src/main.ts

# 构建核心包（core/ 目录）
cd core && npm install && npm run build   # tsc -p tsconfig.build.json → core/dist/
```

- **构建入口**: `scripts/build.js` — esbuild 将 `src/main.ts` 打包为 `dist/daemon.mjs`
- **外部依赖**: `@anthropic-ai/claude-agent-sdk`、`@openai/codex-sdk`、discord.js native deps 保持 unbundled
- **Node 版本**: >= 20
- **守护进程管理**: `bash scripts/daemon.sh {start|stop|status|logs [N]}`

## Architecture

### 数据流

```
飞书消息 → WSClient (WebSocket 长连接)
  → feishu-adapter.handleIncomingEvent()
    → InboundMessage → 内部队列
      → bridge-manager 消费 → conversation-engine
        → LLM Provider (Claude Code SDK / Codex SDK)
          → SSE 流式响应 → feishu-adapter.send()
            → 飞书 REST API (im.message.create)
```

### 两层结构

| 层 | 位置 | 职责 |
|----|------|------|
| 守护进程 | `src/` | 配置加载、LLM 调用、数据持久化、进程管理 |
| 桥接核心 | `core/src/lib/bridge/` | 多通道适配器、消息路由、会话管理、Markdown 渲染 |

### 守护进程 (`src/`)

**启动序列** (`main.ts`):
1. `loadConfig()` 读 `~/.claude-to-im/config.env`
2. `setupLogger()` 重定向 console 输出到 `bridge.log`
3. `resolveProvider()` 根据 `CTI_RUNTIME` 选择 Claude/Codex/Auto
4. `initBridgeContext()` 注入 store、llm provider、permissions gateway
5. `bridgeManager.start()` 启动所有已启用通道的适配器
6. 注册 SIGTERM/SIGINT/SIGHUP 优雅退出

**关键模块**:

- `config.ts` — `loadConfig()` 解析 config.env → `Config` 对象；`configToSettings()` 转换为 `bridge_*` 前缀的 `Map<string,string>` 供 core 使用；`saveConfig()` 原子写入
- `store.ts` — `JsonFileStore` 实现 `BridgeStore` 接口。数据存储在 `~/.claude-to-im/data/` 下：`sessions.json`、`bindings.json`、`audit.json`、`permissions.json`、`offsets.json`、`messages/` 目录。所有写入通过 `atomicWrite()`（写临时文件 → rename）
- `llm-provider.ts` — `SDKLLMProvider` 封装 `@anthropic-ai/claude-agent-sdk` 的 `query()`。将 SDK 的 `SDKMessage` 事件转换为 SSE 格式（`sseEvent()`），处理权限请求（`hasPermission` 回调 → `pendingPerms`），检测认证失败模式。环境变量白名单过滤后传给 CLI 子进程
- `codex-provider.ts` — `CodexProvider` 封装 `@openai/codex-sdk`，同上 SSE 转换模式
- `permission-gateway.ts` — `PendingPermissions` 管理待处理的工具调用权限请求，支持超时自动拒绝
- `logger.ts` — `setupLogger()` 重定向 `console.log/error/warn` 到 `~/.claude-to-im/logs/bridge.log`
- `sse-utils.ts` — `sseEvent()` 生成标准 SSE 格式字符串

### 桥接核心 (`core/src/lib/bridge/`)

- `bridge-manager.ts` — 多适配器生命周期管理。`start()` 并行启动所有启用的适配器，`stop()` 优雅停止
- `context.ts` — DI 容器。`initBridgeContext()` 设置全局单例，`getBridgeContext()` 在任何模块中获取 store/llm/permissions
- `channel-adapter.ts` — `BaseChannelAdapter` 抽象类，所有适配器继承它：`start()`、`stop()`、`consumeOne()`（消息队列）、`send()`、`acknowledgeUpdate()`
- `conversation-engine.ts` — 会话路由引擎，管理多个并发 Claude Code 会话
- `delivery-layer.ts` — 消息分发：SSE 流解析、进度报告、结果回传
- `channel-router.ts` — 入站消息路由到正确的会话
- `host.ts` — 定义了 `LLMProvider`、`BridgeStore`、`StreamChatParams` 等核心接口
- `types.ts` — 共享类型：`ChannelType`、`InboundMessage`、`OutboundMessage`、`SendResult`、`FileAttachment`、`ChannelBinding`

### 适配器 (`core/src/lib/bridge/adapters/`)

每个适配器通过 `registerAdapterFactory()` 自注册：

- `feishu-adapter.ts` — 飞书实现。使用 `@larksuiteoapi/node-sdk` 的 `WSClient`（长连接事件订阅）和 `Client`（REST API）。渲染策略：代码块/表格 → 交互式卡片（`msg_type: interactive`），普通文本 → `msg_type: post`。支持流式卡片更新（throttle 200ms）、权限按钮卡片、typing indicator
- `telegram-adapter.ts` — Telegram Bot API（长轮询）
- `discord-adapter.ts` — Discord.js（WebSocket）
- `qq-adapter.ts` — QQ C2C 私聊

### Markdown 渲染 (`core/src/lib/bridge/markdown/`)

- `feishu.ts` — HTML/Markdown → 飞书卡片 JSON（schema 2.0）。`buildCardContent()` 用于静态卡片，`buildStreamingContent()` 用于流式更新，`hasComplexMarkdown()` 判断是否需要卡片渲染
- `ir.ts` — 中间表示（IR），统一的 Markdown AST
- `render.ts` — 通用渲染管线
- `telegram.ts`、`discord.ts` — 各自平台的渲染

### 通知脚本 (`scripts/feishu-summary-notify.cjs`)

Stop Hook 触发的飞书通知。三层策略：
1. 读取 `~/.claude-to-im/data/last-summary.txt`（Claude 写入的自定义摘要）
2. 自动检测 Git 提交 + 文件变更（仅真实项目目录，跳过家目录/系统目录）
3. 兜底：项目名 + 时间戳

通过飞书 REST API 发送：`tenant_access_token` → `im/v1/messages`。

## Data Directory (`~/.claude-to-im/`)

```
~/.claude-to-im/
├── config.env              # 守护进程配置（App ID/Secret、通道、模型等）
├── data/
│   ├── sessions.json       # 活跃会话状态
│   ├── bindings.json       # 通道绑定（chatId → 工作目录/模型/模式）
│   ├── audit.json          # 审计日志（入站/出站消息摘要）
│   ├── permissions.json    # 权限记录
│   ├── offsets.json        # 通道轮询偏移量
│   ├── last-summary.txt    # 会话摘要（Stop Hook 读取后删除）
│   └── messages/           # 消息历史（按会话存储）
├── logs/
│   ├── bridge.log          # 守护进程日志
│   └── notify.log          # 通知脚本日志
└── runtime/
    ├── bridge.pid          # 守护进程 PID
    └── status.json         # 运行状态 {"running": true/false, ...}
```

## Config Keys (config.env → internal)

配置通过 `configToSettings()` 转换为 `bridge_*` 前缀的键名。飞书相关映射：

| config.env | 内部键 |
|------------|--------|
| `CTI_FEISHU_APP_ID` | `bridge_feishu_app_id` |
| `CTI_FEISHU_APP_SECRET` | `bridge_feishu_app_secret` |
| `CTI_FEISHU_DOMAIN` | `bridge_feishu_domain` |
| `CTI_FEISHU_ALLOWED_USERS` | `bridge_feishu_allowed_users` |
| `CTI_ENABLED_CHANNELS` (含 feishu) | `bridge_feishu_enabled=true` |

适配器内部通过 `getBridgeContext().store.getSetting('bridge_feishu_app_id')` 读取。

## Key Patterns

- **适配器注册**: 适配器文件在 import 时通过 `registerAdapterFactory('channelName', () => new Adapter())` 自注册。`adapters/index.ts` 统一 import 所有适配器，`src/main.ts` import 它触发注册
- **消息队列模式**: 适配器内部使用 `queue: InboundMessage[]` + `waiters: Array<(msg) => void>` 实现异步消息投递，`consumeOne()` 被 bridge-manager 消费
- **原子写入**: 配置和数据文件通过写 `.tmp` → `rename` 实现原子更新
- **环境变量隔离**: `ENV_WHITELIST` 和 `ENV_ALWAYS_STRIP` 控制传给 CLI 子进程的环境变量，防止 Claude Code 递归启动
- **SSE 格式**: LLM 响应统一转换为 `data: <json>\n\n` 的 SSE 事件流
- **飞书长连接**: 使用 WSClient（WebSocket），不是 HTTP webhook。事件订阅模式必须是"长连接"
- **飞书卡片渲染**: 代码块/表格自动使用交互式卡片（`cardkit:card:write` 权限），其他内容用 `msg_type: post` 的 md tag

## Dependencies

| 包 | 用途 |
|----|------|
| `@anthropic-ai/claude-agent-sdk` | Claude Code SDK — query() 启动会话 |
| `@larksuiteoapi/node-sdk` | 飞书 SDK — WSClient + REST Client |
| `claude-to-im` (file:./core) | 桥接核心库（本地包） |
| `esbuild` (devDep) | 打包 daemon.mjs |
| `tsx` (devDep) | 开发模式运行 TypeScript |
| `@openai/codex-sdk` (optionalDep) | Codex 替代运行时 |
