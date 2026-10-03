# dsh-budget · 预算熔断

给会话的 **token / 步数** 设上限，用到阈值时**软提醒一次**（不中断）。

## 它做什么

- 数据全部取**官方已有投影**：token 来自 `dsh-token-meter` 的 `tokenUsage`，步数来自本插件的 `cvmBudget`（数 `tool/call`）。
- 用量达到 `softRatio`（默认 80%）时，在轮次收尾（`agent/turn-stopping`）**steer 一条提醒**，每个会话至多一次。
- **不中断**会话——默认不做硬熔断。

## Config

```yaml
- id: budget
  config:
    maxTokens: 1000000   # token 上限（默认 100 万）
    maxSteps: 200        # 步数上限
    softRatio: 0.8       # 到 80% 先软提醒
    steerOnce: true      # 每个会话只提醒一次
    enabled: true
```

## ⚠️ 已知边界（重要）

**本版只统计当前 session，不含子 agent。**

原因：`subagent/start` 是 **scope 事件**、不进 session log（已实测：sessionProjections 的 apply 收不到它），所以父会话无法直接从事件流认出"我委派了谁、他们烧了多少"。

**团队级聚合**（把主 + 子 agent 的消耗加总）需要额外的父子识别机制，设计见仓库内 `设计-dsh-budget-团队级预算熔断.md`，列为 v2。

## 与其他插件的关系

正交。`convergence` 管打转、`evidence` 管验证债务、`contract` 管目标漂移，本插件只管**预算**。
