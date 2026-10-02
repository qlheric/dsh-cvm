# DSH 官方插件规范 · 对齐清单（2026-10-03）

> 来源：DSH 官方自带 skill `cordis-plugin-development`（在 `.dsh-runtime/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`）。
> 这是"对齐 dsh 社区规范"的**权威依据**（比第三方插件更权威：官方维护、随版本更新）。
> ⚠️ 结论先行：我们**多处违规/缺失**，尤其"用 `session/event` 手搓状态"应改为 `ctx.sessionProjections`，"发新 type 的 session event"**会破坏 session 重开**。

## 一、Manifest 规范（host-plugin.md）

官方 Host-only bundle 的最小形态：

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
- insert:
    - id: my-plugin
      name: '@local/my-plugin'
      config: {}
```

**我们的差距**：

| 项 | 官方 | 我们 | 动作 |
|---|---|---|---|
| exports | `{".": "./index.js"}` | `{".": {"default": "./lib/index.js"}}` | 对齐（可保留 lib，但 exports 形态简化） |
| 元数据 | `locale/en.json` + `locale/zh.json` + `icon` | ❌ 无 | **补**（Plugin Manager 卡片读它） |
| Config | `export const Config`（激活时校验） | ❌ 硬编码 | **补** |
| patch config | `config: {}` 显式声明 | 无 | 补 |

**显示元数据**（Plugin Manager 卡片、bundle 详情在**不激活插件**时读取）：

```json
{ "meta": { "title": "My Decoration", "description": "..." } }
```
或 `locale/en.json` + `locale/zh.json`，加顶层 `icon`（SVG/PNG/JPEG/WebP ≤256KiB），并在 `files` 里列出。

## 二、Host plugin 导出形式（官方）

- `export function apply(ctx, config) {}` + 可选 `export const inject` + `export const Config`；**或** service class 作 default export。**不许混用**。
- **每个资源在 `apply` 里用 `ctx.effect` 或 `ctx.on` 注册，并返回 cleanup**。

## 三、扩展点与状态机制（practices.md，最关键）

### 3.1 🔴 我们已违规的两条

1. **不要 append 新 `type` 的 session event**：
   > *"Readers accept an unknown stored event only when its envelope carries `ignorable: true`, and live `Session.append()` cannot set that marker, so the Session would refuse to reopen."*
   - 修正：**"model-visible" 不要发新事件类型**（#365 的 `guard/intervention` event 有这个隐患），改用 **`agent.inject()`**（记入 `agent/inbox/spliced`）或 `ctx.systemPrompt.section()`。

2. **per-session 状态用 `ctx.sessionProjections`，不要订阅 `session/event` + 重扫**：
   > *"Keep per-session state derived from the log in a `ctx.sessionProjections` unit instead of subscribing to `session/event` and rescanning `session.events`. `apply(state, event)` is pure and synchronous and returns the same reference for events it ignores... Read with `stateOf()`."*
   - 修正：**我们四个插件的状态机全部改为 sessionProjections unit**（性能 + 官方推荐 + 可 checkpoint）。

### 3.2 其他关键条目

| 规范 | 内容 | 我们的状态 |
|---|---|---|
| 真相源 | session log 是唯一真相源；插件内存是 derived cache | ✅ 符合（我们只读事件） |
| 用最弱机制 | `restrict` < `guard` < waterfall < `system-prompt/assemble` | ✅ 我们用 `systemPrompt.section()`（官方明确认可） |
| waterfall | 不拥有决策必须 `return next()` | ✅ 我们只用 `session/event`（非 waterfall） |
| 加 prompt 文本 | 用 `ctx.systemPrompt.section()` | ✅ **用对了** |
| per-agent context | 用 `agent.inject()` | ⚪ 未用（可拓展） |
| per-agent 注册 | 注册在 `agent.ctx`（`agent/created` 里取），用 `agent.ctx.effect()` 包裹并保留 disposer | ⚪ 未做 |
| 可选服务 | 放 `inject`，避免在不支持的 profile 抛错 | ✅ 用的是 `inject: ['systemPrompt']` |
| **可调值** | **放插件的 `Config`**（用户在 cordis.patch.yml 改，patch 层跨升级存活） | 🔴 **硬编码，该改** |
| 性能 | 等 durable events（`turn/end`、`assistant/message`、`tool/result`），不轮询 `agent/status` | ✅ 我们等事件 |
| 计时器 | 用 `agent.followup()`（会唤醒 agent）；`agent.inject()` 不唤醒 | ⚪ 未用 |

## 四、完整接缝体系（本轮扒到）

### 4.1 工具调用流水线（比 `session/event` 更精确）

```
tools/pre-execute（允许/拒绝/询问，可异步）
  → ctx.tools.guard()（单调同步守卫，拒绝不可被后续翻转）
  → tools/execute（环绕分发：超时/重试/指标）
  → tools/post-execute（检查/替换结果、附加上下文、带反馈阻止）
  → finalizeContent
  → tools/result（仅观测的冻结最终结果）
```

签名：
```
'tools/post-execute'(exec, result: Readonly<ToolExecutionResult>, next): Promise<PostToolDecision>
```
官方告诫：**观察最终结果用 `tools/result`；`tools/post-execute` 只用于转换结果**。

### 4.2 Session 事件（含我们需要的 `error` 字段）

```
'turn/start' { turn }
'turn/end' { turn, reason }
'step/start' / 'step/end' { turn, step }
'user/message' | 'developer/message' | 'system/message'
'assistant/message' { turn, step, message, stream, usage?, interrupted? }
'tool/call' { turn, step, callId, name, arguments }
'tool/result' { turn, step, message, error?: { name, code, reason? }, meta? }   ← ★ 工具失败检测
'agent/inbox/spliced' { target, start, removedCount?, inserted, outcome? }
'approval/asked' / 'approval/decided' / 'approval/policy'
```

★ **`tool/result` 自带 `error: { name, code, reason }`** → 这正是 #365「Premature Victory」（工具报错却称完成）需要的信号，我们现在没用。

### 4.3 Agent 生命周期事件

```
'agent/pre-step'（waterfall：可拒绝/改写进入步骤）
'agent/request'（waterfall：改模型配置）
'agent/turn-stopping'（serial：可 steer 保持轮次打开）★ 收敛/预算熔断的官方落点
'agent/request-error'（重试）
'agent/created' / 'agent/disposed' / 'agent/status'
'agent/assistant-stream'（实时分片）
```

⚠️ 官方文档明确：**"No built-in turn budget — a policy that bounds runaway turns must cancel from an existing lifecycle extension point such as `agent/turn-stopping`."** → **这正是 `convergence` 该用的接缝！**

## 五、我们的对齐动作清单（按优先级）

| # | 动作 | 依据 | 方向 | 状态 |
|---|---|---|---|---|
| 1 | 四插件状态机改 `ctx.sessionProjections` unit | practices §Performance | 优化运行 | ✅ 已完成 |
| 2 | 阈值/关键词移入 `Config`（schemastery） | practices §Stability + #365 | 完善功能 | ✅ 已完成 |
| 3 | 不加新 session event type；干预用 `agent.inject()` 或 section | practices §Stability 🔴 | 提高质量 | ✅ 已遵守（删了 cvm/signal，改读投影） |
| 4 | `convergence` 改用 `agent/turn-stopping`（官方指定熔断落点） | agent-loop README | 完善功能 | ✅ 已实现（intervention 门禁 steer） |
| 5 | `evidence` 加 `tool/result.error` 检测（工具报错却称完成） | 事件表 + #365 | 完善功能 | ⏳ 待做 |
| 6 | 补 fail-open（detector 异常不阻塞） | #365 设计原则 | 提高质量 | ✅ 已完成 |
| 7 | 补 `locale/en.json` + `locale/zh.json` + `icon` | host-plugin.md | 提高质量 | ⏳ 待做 |
| 8 | 补 `.github/workflows/ci.yml` + keywords + scripts | dsh-guardian 对标 | 提高质量 | ⏳ 待做 |
| 9 | 用 `plugin_manager install_bundle` 安装（不手写 profile） | SKILL.md | 提高质量 | ⏳ 待做 |

**已完成 5/9**。第 4 项的落地方式：`intervention` 在 `agent/turn-stopping` 里读投影，有信号就 `agent.steer(createUserMessage(...))` 一次（每会话至多一次，防无限续轮）。

## 六、还有两个官方 skill 可挖

- **`cordis-composition-reference`**：loader patch 方言 + 可安装插件包列表（SKILL.md §Read next 提到）。
- **`editing-cordis-compositions`**：agent preset 改动。
