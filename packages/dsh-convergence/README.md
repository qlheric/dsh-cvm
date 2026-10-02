# dsh-convergence · 收敛判定

检测「连续只读打转」（反复 read/glob/grep 不推进），判断认知轨迹是否坍缩。

- **订阅**：`session/event`（`tool/call`）
- **发信号**：`ctx.emit('cvm/signal', { kind: 'convergence', active })`
- **对抗**：收敛坍缩（doom loop）

## 逻辑

```text
按 session 独立计数连续只读工具（read/glob/grep/ls/list）
任一 session 连续只读 ≥ 5 次 → 发 active=true
出现写/执行工具 → 该 session 计数重置
```

**按 session 独立**是关键：子会话（subagent）的打转不会被主会话的非只读工具误重置。

## 验证

这是四个插件里**唯一被验证有效**的：让 C1 退化从 40% 降到 10–30%，有 `grep×6 → edit×6` 的干预生效证据。
