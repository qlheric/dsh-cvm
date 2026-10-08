# 调研：DSH 插件文档缺口与 PR 草案

> 2026-10-07 · 开发 dsh-cvm（运行时监督插件）时对照官方 skill `cordis-plugin-development`，发现官方文档覆盖了「UI 插件 + 基础 bundle」，但「给 agent 加运行时观察/监督」这一类插件的关键接缝几乎没写，只能读源码拼出来。本文记录缺口清单 + 最硬两个缺口合成的 PR 草案。

## 一、缺口清单（5 个，按优先级）

### 1. agent 生命周期事件表（最高）
- **缺什么**：`practices.md` 只零散提 `agent/pre-step`、`agent/request`、`agent/created`，没有完整事件表，尤其漏了 `agent/turn-stopping`（可反对关闭的 hook）。
- **踩坑**：`dsh-intervention` 的终局门禁靠 `ctx.on('agent/turn-stopping')`，读源码才找到。
- **建议补**：`practices.md` 加「agent 生命周期事件表」（触发时机 / 能否反对 / 典型用途）。

### 2. inject / followup / steer 三机制对照（高）
- **缺什么**：提了 `inject`/`followup`，没提 `steer`（尾部追加 user message + 强制再走一步，不碰前缀缓存）。
- **踩坑**：`dsh-intervention` 用 `agent.steer(createUserMessage(...))`；归因实测证明 steer 保缓存，`systemPrompt` 动态注入才伤缓存。
- **建议补**：三机制对照表。

### 3. 官方预置投影清单（tokenUsage 等）（中高）
- **缺什么**：讲了 `sessionProjections` 通用，没列官方预置投影（`tokenUsage` 的 `{totals, last}` 结构 + cache 命中计费差 10 倍）。
- **踩坑**：`dsh-budget` 读 `stateOf(session, 'tokenUsage')?.totals`，读源码才搞清结构。

### 4. systemPrompt.variable vs section（中）
- **缺什么**：只提 `section()`，没提 `variable()`（每步渲染的动态变量）。
- **踩坑**：`dsh-intervention` 用 `variable` + `section` 组合做「有信号注入、无信号空串」。

### 5. headless --json 输出格式（中）
- **缺什么**：没覆盖 `--json` 输出格式（`step_end` 带 `usage`、`tool_call` 字段是 `name` 不是 `tool`）。
- **踩坑**：`eval/drive.mjs` 靠读 `dsh-headless` 源码才搞清事件结构。

## 二、PR 草案（最硬的 1+2 合成一个）

- **目标仓库**：`deepseek-ai/deepseek-harness`
- **目标文件**：`packages/…/dsh-agent-preset/skills/cordis-plugin-development/references/practices.md`（以仓库内实际路径为准）
- **类型**：docs（纯文档补充，不改代码）

**标题**：`docs: 补齐 agent 运行时接缝文档 —— 生命周期事件表 + 消息注入机制对照`

**描述**：开发运行时监督类插件（dsh-cvm）时发现 `practices.md` 对「给 agent 加运行时观察/干预」这类插件要用的接缝覆盖不全（`agent/turn-stopping`、`agent.steer` 等关键机制零散或缺失），只能读源码拼出来。本 PR 补两张表：① agent 生命周期事件表（含可反对关闭的 `agent/turn-stopping`）② `inject / followup / steer` 三种消息注入机制对照（含「steer 尾部追加、不碰前缀缓存」这一关键差异）。无行为改动。

**diff 一：agent 生命周期事件表**（加在 `practices.md` Stability 段后）

| 事件 | 触发时机 | 能否反对/改写 | 典型用途 |
|---|---|---|---|
| `agent/created` | agent 创建 | 否 | 拿 `agent.ctx` 注册 per-agent 行为 |
| `agent/pre-step` | 每步前 | waterfall，可改写 decision（放行需 `next()`） | 注入/改写步决策 |
| `agent/request` | 发请求时 | waterfall，不能改 request messages | 观察/拦截请求 |
| `agent/assistant-stream` | assistant 流式输出 | 否 | 渲染 live token |
| `agent/turn-stopping` | turn 要关闭时 | **可反对关闭**（`agent.steer` 让 agent 再走一步） | 终局门禁、强制继续 |
| `turn/end` / `assistant/message` / `tool/result` | 各自提交时 | 否（durable） | 等待稳定状态、投影 fold 落点 |

**diff 二：给 agent 追加消息的三种机制**

| 机制 | 是否唤醒 agent | 是否进 session log | 典型用途 |
|---|---|---|---|
| `agent.inject()` | 否（等在 inbox，直到其它输入到达） | 是（`agent/inbox/spliced`） | 追加 per-agent 上下文 |
| `agent.followup()` | 是 | 视情况 | 定时器启动后续工作 |
| `agent.steer()` | 是（机器重读 inbox） | 是 | 尾部追加 user message 并强制再走一步；不碰 system 前缀、不破坏前缀缓存 |

> 关键说明：`steer` 是运行时监督场景最合适的注入通道——把消息追加到对话**尾部**而非 system 前缀，实测缓存命中率不受影响；用 `systemPrompt` 每步渲染动态提示则会改写前缀。

## 备注

- 只动 `practices.md` 一处，两张表基于官方已有但零散的信息收敛，不引入新 API 假设。
- 每个条目都有 dsh-cvm 实际踩坑作证；3/4/5 缺口偏「内部 API / 未承诺文档化」，暂缓，先提 1+2。
