# dsh-budget 设计方案（团队级预算熔断）

> 2026-10-03 · objective 第④项（能力拓展）的设计调研产出。目标：补上"多 agent 场景下没人管总预算"这个空白。
> 状态：**设计定稿，未实现**。

## 一、要解决什么

现有四插件都是 **per-session** 的（每个 session 独立监督）。但多 agent 场景下：

- 主 agent 派 N 个子 agent，每个子 agent 各烧一份 token/步数；
- **没有任何机制看"这一队一共烧了多少"**；
- 一个打转的子 agent 会默默烧钱，主 agent 不知道。

⇒ 需要一个**按"委派树"聚合的预算熔断器**。

## 二、DSH 提供的机制（源码确认）

| 机制 | 证据 |
|---|---|
| 子 agent 是**独立 session** | `dsh-subagent-in-process-driver:180` — `agents.create({ sessionId: childId })` |
| **`subagent/start` / `subagent/end`** 成对事件 | api-catalog:4188 / :4164 |
| `SubagentRunInfo = { runId, provider, id: SessionId, local }` | api-catalog:7220 —— **`id` 就是子 session id**，`local` 表示能否 `ctx.agents.get` |
| 事件是 **parent-scoped** 的 | *"Scope-filtered dispatch keys the carrier by the delegating parent, so a parent-scoped listener observes only its own delegations."* |
| 每个 session 自带 token 统计 | `dsh-token-meter` 的投影 `tokenUsage`：`{ totals, last }`（`stateOf(session,'tokenUsage').totals`） |
| 轮次收尾可 steer/abort | `agent/turn-stopping`（我们已在 intervention 用过） |

## 三、设计

### 3.1 职责

**一个新插件 `dsh-budget`**（第五个，与现有四插件正交）：

- **只做一件事**：把"主 agent + 它所有后代 agent"的消耗聚合成一个总账，超限时分档处置。
- **不做**：不检测打转（那是 convergence）、不管验证（那是 evidence）。

### 3.2 状态（per-session 投影 + 插件内存）

```
投影 key: cvmBudget
state = {
  children: [sessionId, ...],   // 本 agent 直接委派的子 session（subagent/start 累加）
  ownTokens: number,            // 本 session 的 token（可从 tokenUsage 读，不必冗余存）
  ownSteps: number,
  tripped: boolean,             // 是否已熔断（防重复动作）
}
```

投影只记"我委派了谁"（从 `subagent/start` 折叠，`subagent/end` 时保留 id 以便结算）。

### 3.3 聚合与判定

在 `agent/turn-stopping`（每轮收尾）：

1. 读自己的 `stateOf(agent.session, 'tokenUsage').totals`；
2. 对 `children` 里每个 id：`ctx.agents.get(id)` → `child.session` → 读它的 `tokenUsage`；
   - 若子 agent 已结束（`get` 返回 undefined），用 `subagent/end` 时缓存下来的快照；
3. **递归**：子 agent 自己也可能有 children（读它的 `cvmBudget` 投影）；
4. 汇总 `teamTokens` / `teamSteps`；
5. 判定：
   - `teamTokens > maxTeamTokens` 或 `teamSteps > maxTeamSteps` → **熔断**（`agent.cancel(...)` 或 abort signal）；
   - `> softRatio × 上限` → **steer 一次**（提醒"团队预算已用 X%，请收窄范围"），每 session 至多一次。

### 3.4 Config

```js
export const Config = z.object({
  maxTeamTokens: z.natural().default(2_000_000),   // 整棵委派树的 input+output 上限
  maxTeamSteps: z.natural().default(200),          // 整棵树的总步数上限
  softRatio: z.number().min(0).max(1).default(0.8),// 超过这个比例先软提醒
  steerOnce: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
```

### 3.5 已知难点（实现前要想清楚）

1. **子 agent 结算后取不到 session**：`ctx.agents.get` 在 `subagent/end` 后可能失效 ⇒ 必须在 `subagent/end` 时**把子 agent 的最终 token 快照落进本 session 的投影**（`subagent/end` 的 payload 有 `runId`/`id`，但**没有 token** ⇒ 需要在 end 前读到，或用 `subagent/end` 时点同步读一次）。
2. **嵌套深度**：递归聚合要有深度上限（防环、防止被恶意构造的委派树拖死）。
3. **只读边界**：只能**读**子 session 的统计，绝不能写（否则污染别人的 session log）。
4. **熔断的语义**：`abort` 会让整轮失败；**默认应该只"软熔断"**（steer 提醒 + 拒绝再委派新 subagent），把"硬熔断"留给显式配置。

## 四、交付建议

1. **先做 MVP**：`subagent/start` 记 children + `agent/turn-stopping` 聚合 + 只做"软提醒"（steer）。先验证聚合数对不对，再谈熔断。
2. **验证方式**：跑一个"派 2 个子 agent"的任务，用诊断把聚合出的 `teamTokens` 落盘，与主 session 的 `tokenUsage` 对账。
3. **不支持嵌套**（第一版）：只聚合**一层**子 agent（覆盖绝大多数场景），嵌套留到有真实需求时再说。

## 五、结论

- 机制齐备（`subagent/start` + `tokenUsage` + `turn-stopping`），**可行性高**；
- 主要风险在"子 agent 结束后取不到 session"这一条，需在实现时用"end 时快照"解决；
- **建议先做一层的软熔断 MVP**，跑通再扩展。

---

## 六、预留式预算语义（2026-10-26 追加）

> 本节吸收自 `security-audit-skill` 的 `SKILL.md:119-134`（**只抄语义，不抄代码**）。
> 它把预算从"卡阈值"升级成"**可分配、可预留、不可静默超支**"。
> 与第一~第五节不冲突：前五节讲**怎么聚合**，本节讲**钱怎么分**。

### 6.1 可数化换算

- **1 个覆盖单元 ≈ 1 次 hunter 派活**
- **1 条存活候选 ≈ 1~2 次 verifier 派活**

于是：

```
预算需求 ≈ units_to_hunt × 1 + candidates_alive × 1.5（上界 2）
```

### 6.2 预留式分配顺序（先预留、后分配）

一次运行开始前，**严格按顺序**：

1. **预留 P1 侦察 4 次**（固定）；
2. **预留每个 wave 的覆盖批评家**（1 次 / wave）；
3. **预留独立 final-clean 批评家**（1 次）；
4. **预留验证额度**（`candidates_alive × 1.5`，上界 `× 2`）；
5. **剩下的才给 hunters**。

**hunters 只能花剩下的。** 任何"先派活、回头发现没钱验收"的顺序都是错的。

### 6.3 预留不足时的降级（不发车）

若"预留批评家 + 验证额度"之后**剩余为 0 或负数**：

- 该 wave 的计划单元**全部标 `deferred`**；
- 原因写死：`budget_cannot_reserve_critics_and_validation`；
- **一个 hunter 都不许发**。

宁可这轮不跑，也不许跑出一堆没人验收的候选。

### 6.4 不静默超支

若预算**不足以验证全部候选**：

- `run_status = "incomplete"`
- `incomplete_reason = "validation_budget_exhausted"`
- **未验证的候选不许进 `findings.json`**；
- **也不许改标成 `needs_validation` 来"绕过去"**——`needs_validation` 是独立认知状态，不是垃圾桶。

约束原文（照抄）：

> "Never exceed a user-set strict budget silently."

### 6.5 与 `agent/turn-stopping` 门禁的接线

现有 v1/v2 已用 `agent/turn-stopping` 做软提醒。预留语义接进来后，**收尾时的检查顺序**是：

1. **硬约束检查**：若 `teamTokens > maxTeamTokens` 或 `teamSteps > maxTeamSteps` → 按配置走 warning / steer / abort（**默认仍是 soft**，见第五节）；
2. **预留检查**：若本 wave 仍有 `deferred` 单元、原因是 `budget_cannot_reserve_critics_and_validation` → 收尾提示里**显式说明"这轮没跑是因为预留不足"**，避免让模型误判成能力问题；
3. **不静默超支**：若 `run_status = incomplete` → 收尾提示必须带上 `incomplete_reason`（不许静默）。

**与 v2 团队聚合的关系**：`maxTeamTokens` 的口径仍是"当前会话 + 活跃子 agent"（**下界**，见第五节已知边界）；**预留语义不改变这个口径**，只是补上"这块钱怎么分"。

