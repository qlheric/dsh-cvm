# dsh-contract · 任务契约

把「全局目标」从用户一句话里外部化，投影进 system prompt，成为比"用户最近一句话"更稳的系统锚点。

- **订阅**：`session/event`（`user/message`，过滤 `source.kind === 'user'`）
- **投影**：`ctx.systemPrompt.variable('cvm_contract')` + `ctx.systemPrompt.section('cvm:contract')`
- **对抗**：语义锚点（"文件已存在→不用做"）、策略锚点（"你错了→投降"）

## 逻辑

```text
首条用户消息 → 定义契约（objective） → 渲染稳定文本 → 注入 system prompt
```

契约字节稳定（不含时间戳/随机 id），只在契约变化时改变渲染，守住前缀缓存。

## 注意

单契约投影**不足以**改善行为（实测 40% vs 40%）——印证"知道≠做到"。必须配合 `dsh-convergence` 的动态干预（见根 README 验证章节）。
