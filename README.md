# dsh-cvm · DSH 认知运行时插件集

> 给 DeepSeek Harness（DSH）加一层**认知运行时**——用确定性监督对抗 LLM 的"认知锚点坍缩"。
> 四个正交的 Cordis 插件，零侵入、可组合、可演进。

## 定位（先说清楚，别误解）

**这不是"提升模型能力"的插件，是"给强模型加一层保险"的插件。**

模型越强，自己就越会验证、越会换方法——所以想"补能力"的空间天然很小。真正还在的缺口是：**强模型偶尔会被局部信号锚定，做出一段低于它自身水平的轨迹**（盯着"文件已存在"反复读、声称完成却没验证）。dsh-cvm 只针对这个缺口，代价是**可能误伤**（见下文"已知代价"）。

**适用**：长任务、易锚定场景（改了文件要它真跑起来）、需要在无人看管时防打转。
**不适用**：一句话问答；或你觉得模型本来就做得很好、不想让它被任何规则打断。

## 背景：认知锚点坍缩

对齐后的 Transformer Agent 会表现出一类高度趋同的退化（有同行评审背书，见 `认知运行时改造-知识底座.md`）：用户一质疑就投降；局部高显著信息压过全局目标；长上下文里被早期结论支配；反复调用同类工具却不推进。

## 四个插件（正交）

| 插件 | 职责 | 状态/接缝 | 对抗 |
|---|---|---|---|
| `dsh-contract` | 把首条用户消息落成**任务契约**，投影进 system prompt | `sessionProjections`（`cvmContract`）+ `systemPrompt.section` | 语义锚点 |
| `dsh-convergence` | 检测「连续只读打转」（跨工具、按 session 独立计数） | `sessionProjections`（`cvmConvergence`） | 收敛坍缩（doom loop） |
| `dsh-evidence` | 检测「声称完成 + 改了文件 + 没有一次成功验证」 | `sessionProjections`（`cvmEvidence`） | 验证债务 |
| `dsh-intervention` | **唯一注入点**：读前三个的投影状态 → 注入提示 / 收尾时强制再走一步 | `systemPrompt.section` + `agent/turn-stopping`（`agent.steer`） | 把检测变成行动 |

**正交**：contract/convergence/evidence 只**写投影状态**，intervention 只**读状态并行动**——互不直接 import/调用。状态全走官方 `ctx.sessionProjections`（纯函数 apply、可 checkpoint、多会话天然隔离）。

## 安装（零侵入，不碰 DSH 核心）

每个插件是独立 npm 包，挂到任意 DSH profile 的 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "@qlheric/dsh-contract",
        "@qlheric/dsh-convergence",
        "@qlheric/dsh-evidence",
        "@qlheric/dsh-intervention"
      ]
    }
  }
}
```

或直接：`dsh plugin --profile <你的profile> add github:qlheric/dsh-cvm`（装 `packages/` 下的四个包）。

不改 `dsh-agent-loop`，只用官方暴露的接缝：`sessionProjections`、`systemPrompt.section/variable`、`agent/turn-stopping`。

## 验证（诚实版，数据都在）

**C1 场景**（模型被"文件已存在"锚定，需要真把功能改好）——各 8 次：

| 组 | 退化率 |
|---|---|
| 基线（无插件） | 25% |
| 三插件（contract+convergence+intervention） | **12.5%** |
| 四插件（+evidence v3） | **12.5%** |
| 四插件（+evidence **v1**） | 37.5% ← 见下方"已知代价" |

**C6 场景**（说完成但没验证）——各 8 次：基线 **87.5%** / 四插件 **100%**（差异仅 1 次，不显著——**因为强模型自己就会验证**）。

**边界**：
- 样本 8 次/组，是**方向性证据**，不是精确值；厂商 API 抖动 + 单次方差大。
- 主动异议（C2）在 deepseek 上基线就不退化，**测不出改善空间**。
- 这是"实验室级"证据（隔离 `DSH_HOME`、headless 评测），未到"生产级"。

## 已知代价（用它之前请读）

`dsh-evidence` v1 曾把 `tool/result.error` 当"工具失败"，结果在调试场景里**把模型正常的"看报错再改"误判成失败**，C1 退化率反而从 12.5% 涨到 **37.5%（比不用插件还差）**。修正后的 v3 改为"验证工具**成功**执行才算验证过"，干扰消除。

**教训**：这类插件的风险不是"没效果"，是**误伤**。所以每个插件都可配置、可单独关闭，`evidence` 更提供了 `enabled: false` 开关。

## 配置

所有阈值/关键词/提示文本都在各插件的 `Config`（schemastery），可在 `cordis.patch.yml` 里覆盖，patch 层跨升级存活。例：

```yaml
- id: convergence
  config:
    threshold: 8          # 连续只读 8 次才算打转
    readTools: [read, glob, grep]
- id: intervention
  config:
    steerAtTurnStop: false # 关掉"收尾强制再走一步"
```

## 目录

```
packages/dsh-{contract,convergence,evidence,intervention}/  # 四插件
eval/                                                       # 评测集 + 驱动脚本 + 场景
src/domain/                                                 # 单测（41 项）
*.md                                                        # 知识底座、调研、阶段文档
```

## License

MIT
