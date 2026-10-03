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

## ⚠️ 已知边界（重要，v2 仍然是近似）

**v2 能把「当前活跃的子 agent」的消耗计入团队总量**，但有两个限制：

1. **已结束的子 agent 不计入**。实测确认：`child` 上没有 parent 字段（`parent: null`），无法把已结束子 agent 的消耗可靠归到某个父会话。**更关键的是实测发现：子 agent 通常在自己的 `turn-stopping` 之前就结束了**，所以父会话在收尾时往往看到 `childTokens = 0` —— **这个团队总量实际上是个下界**，不是精确值。
2. **活跃集合是插件级的**：多会话同时派人时会互相看到（单会话无影响）。

**修过的一个真 bug**：`turn-stopping` 在**子 agent 自己的会话里也会触发**，而活跃集合是插件级的、里面就有它自己 ⇒ 不排除会**重复计算**（实测 `ownTokens == childTokens == 16199`，团队量被算成 32398 翻倍）。现在聚合时按 session id 排除自己。

**用法**：`countSubagents: false` 可退回"只看当前会话"。

## 与其他插件的关系

正交。`convergence` 管打转、`evidence` 管验证债务、`contract` 管目标漂移，本插件只管**预算**。

