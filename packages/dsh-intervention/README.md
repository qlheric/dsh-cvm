# dsh-intervention · 分档干预

唯一注入点：收 convergence/evidence 的信号，按优先级合并成动态提示注入 system prompt。

- **订阅**：`cvm/signal`（自定义事件）
- **注入**：`ctx.systemPrompt.variable('cvm_intervention_hint')` + `ctx.systemPrompt.section('cvm:intervention')`
- **职责**：把"检测"变成"行动"

## 逻辑

```text
convergence.active → 注入"你在打转，换方法"
evidence.active    → 注入"你声称完成但没验证，先验证"
都无               → 空（不注入，守前缀缓存）
```

优先级：convergence（打转）> evidence（验证债务）。

## 为什么是"唯一注入点"

正交性要求：检测插件（convergence/evidence）只发信号，不注入；intervention 只收信号、注入。这样新增一个"检测"不需要改"注入"，新增一个"干预动作"不需要改"检测"——这正是 Cordis 可组合性的价值。
