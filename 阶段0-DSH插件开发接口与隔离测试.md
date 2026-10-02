# 阶段 0 · DSH 插件开发接口与隔离测试（摸查结论）

> 2026-10-01 · 只读 app.asar 提取 + 官方 README 核对，未动生产。全部依据 `@deepseek-ai/dsh@0.2.0-rc.2` 的官方包文档。

## 一、三条核心结论

1. **隔离测试路径是官方现成的**：`dsh --profile headless "task"` 跑一次性任务、打印最终答案、退出，无 GUI/无端口/无后台残留；`--json` 给机器可读事件流；`DSH_HOME` 可指向独立目录 → **A/B 评测全程不碰生产**。
2. **插件开发 = 原生 Cordis 插件**（不是 `dsh-hook-protocol` 那个桥接，那是给外部 Claude Code/Codex hooks 用的）。原生插件拥有完整 harness API（`ctx.*` 服务 + `Config` schema + 生命周期）。
3. **🔴 接缝已存在（最大突破）**：`dsh-agent-loop` 已暴露认知运行时需要的全部拦截点，**不用动核心 loop**。

## 二、隔离测试路径（不动本地的机制）

| 命令 | 作用 |
|---|---|
| `dsh --profile headless "run the tests"` | 一次性任务，stdout 打印最终答案，退出码 0=完成/1=中止 |
| `dsh --profile headless --json "..."` | 按行 JSON 事件流：`session/status/text/thinking/tool_call/tool_result/final` |
| `dsh --profile headless --session-id <id>` | 延续持久化会话 |
| `dsh --dump-config` / `--dump-default-config` | 不启动，检查组合后的配置树 |
| `dsh --profile <name> --from-default-profile headless` | 从模板创建自定义 profile |
| `dsh plugin --profile <name> <pnpm args>` | 管理 profile 插件（转发 pnpm） |

**隔离做法**：`DSH_HOME` 指向独立目录（如 `G:\重构dsh\.test-home`），profile 从 headless 模板派生 + 挂我们的插件 → 跑 A/B，绝不碰 `G:\DSH-Home`（生产数据）与 43120（生产进程）。

## 三、接缝（认知运行时 hook 点，全部现成）

| 扩展点 | 出处 | 我们用它做什么 |
|---|---|---|
| `agent/pre-step` | 循环"组装提示词与工具…运行 agent/pre-step。**被拒绝的决定**…不打开步骤" | `dsh-intervention` 门禁档（拒绝/放行步骤） |
| `agent/turn-stopping` | "限制失控轮次的策略必须从…`agent/turn-stopping` 执行取消" | `dsh-convergence` 收敛判定（停止原地打转） |
| `agent/request` waterfall | 模型请求分发 | `dsh-intervention` 提示档（增量附录）+ `dsh-contract` 对照 |
| `session/event` + `agent/*` | 持久会话日志事件（`tool/call`、`tool/result`、`assistant/message`…） | `dsh-evidence` 证据追踪 + 验证债务 |

> 关键判断：**"外环套内环"不是要新造 hook，而是订阅这些既有扩展点。** 这彻底验证了"增量叠加"路线——`dsh-agent-loop` 核心一行不动，我们的四个插件只是消费它已经发出的 Decision 接口。

## 四、插件开发形态（待阶段 2 展开）

- 插件 = 一个包，含 `Config`（schemastery/zod schema）+ 服务 + 生命周期，挂进 profile 的 `bundles` 列表。
- `dsh.profile.bundles` 决定组合顺序；`cordis.patch.yml` 存用户 patch 层。
- 参考包：`dsh-goal`、`dsh-sdk-minimal`、`dsh-compaction`（已提取 README 到 `_sdk/`）。

## 五、阶段 0 剩余待办（进阶段 1 前补）

- [ ] 亲验：`dsh --profile headless --help` + `--dump-default-config`（不耗模型，验证 CLI 与 headless 能加载）
- [ ] 读 `agent/pre-step`、`agent/turn-stopping` 的**精确类型定义**（`lib/types/index.d.ts`），拿到 Decision 接口签名
- [ ] 确认本机 `dsh` CLI 入口（node bin / Python wheel）+ 模型凭据如何注入独立 DSH_HOME
