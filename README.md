# dsh-cvm · DSH 认知运行时插件集

> 给 DeepSeek Harness（DSH）加一层**认知运行时（Cognitive Runtime）**——用确定性监督对抗 LLM 的"认知锚点坍缩"。
> 四个正交的 Cordis 插件，零侵入、可组合、可演进。模型提供认知，这里提供执行语义。

## 一句话

LLM 在真实工程里反复做出**低于它能力上限**的行为（被局部信号吸走、原地打转、空口说完成），根因不是能力不够，是运行时缺一层"确定性监督"。这四个插件把**任务契约 / 收敛判定 / 验证债务 / 分档干预**从模型上下文里外部化，用确定性规则管理概率认知。

## 背景：认知锚点坍缩

对齐后的 Transformer Agent 会表现出一类高度趋同的退化（有同行评审背书，见 `认知运行时改造-知识底座.md`）：

- 用户一质疑就投降；局部高显著信息压过全局目标；
- 长上下文里被早期结论支配；反复调用同类工具却不推进；
- 明明"知道"某条规则，却跨轮次不稳定。

**缺的不是更好的 prompt，是模型之外的一个认知运行时。**

## 四个插件（正交）

| 插件 | 职责 | 订阅的接缝 | 对抗 |
|---|---|---|---|
| `dsh-contract` | 把「全局目标」外部化 + 投影进 system prompt | `session/event`（user/message） | 语义/策略锚点 |
| `dsh-convergence` | 检测「连续只读打转」，按 session 独立计数 | `session/event`（tool/call） | 收敛坍缩（doom loop） |
| `dsh-evidence` | 检测「声称完成但改了文件没验证」（终局门禁） | `session/event`（tool/call、assistant/message） | 验证债务 |
| `dsh-intervention` | 唯一注入点：收前三个信号，按优先级注入动态提示 | `cvm/signal`（自定义事件） | 把检测变成行动 |

**正交**：convergence/evidence 只检测、发 `cvm/signal`；intervention 只收信号、注入。四者互不直接 import/调用。

## 安装（零侵入，不碰 DSH 核心）

每个插件是独立 npm 包，挂到任意 DSH profile 的 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "@deepseek-ai/dsh-contract",
        "@deepseek-ai/dsh-convergence",
        "@deepseek-ai/dsh-evidence",
        "@deepseek-ai/dsh-intervention"
      ]
    }
  }
}
```

插件放 profile 自己的 `node_modules`（这是 DSH 解析 profile bundle 的位置）。不重构 `dsh-agent-loop`，只订阅它已经暴露的 Decision 接口（`agent/pre-step`、`agent/turn-stopping`、`session/event`）。

## 验证（诚实版）

**核心结论**：`convergence` 动态干预让 C1 场景（模型被"文件已存在"锚定，只读不修或打转）从基线 **40% 退化降到 10–30%**，有 `grep×6 → edit×6` 的"打转→检测→干预→换方法"完整证据。

**边界（要诚实）**：
- 样本量 5–10 次/组合，10–30% 是区间不是精确值（headless 评测慢 + API 限流）。
- 主动异议、验证债务两个判据未充分验证——不是因为 CVM 失效，是 deepseek 这类强模型在简单对抗上基线就不退化。
- 这是"实验室级"证据，方向对、机制有效，但未到"生产级"稳定。

复现评测：`eval/` 目录（`drive.mjs` 单次、`parallel-eval.mjs` 并行、`cases.json` 场景、`fixtures/` 场景文件）。

## 目录

```
packages/dsh-{contract,convergence,evidence,intervention}/  # 四插件
eval/                                                       # 评测集 + 驱动脚本 + 场景
src/domain/                                                 # 核心领域逻辑 + 单测
*.md                                                        # 知识底座、规划、各阶段文档
```

## License

MIT
