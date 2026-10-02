# dsh-cvm · DSH 认知运行时插件集

> 给 DeepSeek Harness（DSH）加一层**认知运行时**——用确定性规则管理模型的概率行为。
> 四个正交的 Cordis 插件，零侵入、可组合、可演进。

## 一、这是什么 / 不是什么

**是**：给**强模型**加的一层**过程保险**。它盯着三件事——目标有没有丢、有没有在原地打转、声称完成时有没有真的验证过——在该出手时注入提示、必要时强制再走一步。

**不是**：不是"提升模型能力"的插件，也不是 prompt 技巧合集。模型越强，自己就越会验证、越会换方法，**想"补能力"的空间天然很小**。

**适用**：长任务、易被局部信号带偏的场景（改了文件要它真跑起来）、无人看管时要防打转。
**不适用**：一句话问答；或你不想让任何规则打断模型。

## 二、四个插件（正交）

| 插件 | 职责 | 状态 / 接缝 | 对抗 |
|---|---|---|---|
| `dsh-contract` | 首条用户消息 → **任务契约**，投影进 system prompt | `sessionProjections`(`cvmContract`) + `systemPrompt.section` | 语义锚点 |
| `dsh-convergence` | 检测「连续只读打转」（跨工具、按 session 独立计数） | `sessionProjections`(`cvmConvergence`) | 收敛坍缩（doom loop） |
| `dsh-evidence` | 检测「声称完成 + 改了文件 + 没有一次成功验证」 | `sessionProjections`(`cvmEvidence`) | 验证债务 |
| `dsh-intervention` | **唯一注入点**：读前三个的投影 → 注入提示 / 收尾时 `agent.steer` 强制再走一步 | `systemPrompt.section` + `agent/turn-stopping` | 把检测变成行动 |

**正交**：前三个只**写投影状态**，intervention 只**读状态并行动**，互不 import。状态全走官方 `ctx.sessionProjections`（纯函数 apply、可 checkpoint、多会话天然隔离）。

## 三、安装

挂到任意 DSH profile 的 `dsh.profile.bundles`：

```json
{ "dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-headless",
  "@qlheric/dsh-contract",
  "@qlheric/dsh-convergence",
  "@qlheric/dsh-evidence",
  "@qlheric/dsh-intervention"
] } } }
```

或 `dsh plugin --profile <你的profile> add github:qlheric/dsh-cvm`。

不改 `dsh-agent-loop`，只用官方接缝：`sessionProjections`、`systemPrompt.section/variable`、`agent/turn-stopping`。

## 四、配置

所有阈值/关键词/提示文本都在各插件 `Config`（schemastery），可在 `cordis.patch.yml` 覆盖（patch 层跨升级存活）：

```yaml
- id: convergence
  config:
    threshold: 8            # 连续只读 8 次才算打转
    readTools: [read, glob, grep]
- id: intervention
  config:
    steerAtTurnStop: false  # 关掉"收尾强制再走一步"
- id: evidence
  config:
    enabled: false          # 整个终局门禁关掉
```

## 五、实测（诚实版）

**结论先行：结果指标测不出差异；过程指标要看"分布形状"，不看均值。**

### 5.1 结果指标：两组都是满通过

| 场景 | 基线 | 四插件 |
|---|---|---|
| C1 原始（pandas 报错） | 20/20 | 20/20 |
| C1 困难（引号内换行算错，必须运行才能定位） | 20/20 | 20/20 |

**明确可修的任务，deepseek 都不掉** —— 结果上测不出插件价值。

### 5.2 过程指标：插件**削的是长尾，不是均值**

C1 困难版（各 20 次），`maxReadStreak` = 一轮内连续只读工具的最长串（阈值 5 时 convergence 触发）：

| 统计量 | 基线 | 四插件 | 变化 |
|---|---|---|---|
| mean | 6.3 | 5.55 | −12% |
| **median** | **5** | **5** | **不变** |
| **sd** | **2.87** | **1.60** | **−44%** |
| max | **15** | **11** | −27% |
| p90 | 8.4 | 7 | −17% |

**读法**：**中位数完全一样**——只看均值/中位数会得出"没效果"的错误结论。**看标准差与极值**才见真章：基线会出现"打转到 15 次"的极端个案，插件版最好情况也是 11。**convergence 的价值就是拦这种极端打转**。

另一个场景（C6，说完成但没验证）的信号在**验证次数**：基线 2.5 → 插件 3.4（**+36%**）。

⇒ **不同场景看不同过程指标**：防打转看 `maxReadStreak` 的 **sd/极值**；防不验证看 `verifies` 的**均值**。

### 5.3 干预参数实验：**有一个最优窗口，"越聪明/越敏感"都不是答案**

**A. 阈值（各 20 次，`maxReadStreak` 越小越好）**

| 组 | mean | sd | max | steps | 结果 |
|---|---|---|---|---|---|
| 无插件 | 6.30 | 2.87 | 15 | 15.8 | 20/20 |
| T=3（早干预） | 8.45 | 5.56 | 26 | 24.2 | 20/20 |
| **T=5（默认）** | **5.55** | **1.60** | **11** | **15.9** | 20/20 |
| T=8（晚干预） | **12.65** | 5.75 | **33** | **32.5** | 20/20 |

**只有 T=5 优于"不用插件"；T=3 和 T=8 都比不装还差。**

**B. 判据形态（尝试用"工具参数里的文件路径"区分探索/打转）**

| 判据 | mean | max | steps | 结果 |
|---|---|---|---|---|
| any-read T=5（对照） | **5.55** | **11** | **15.9** | 20/20 |
| same-target T=3（只认同一文件） | **13.5** | 41 | 32.0 | 20/20 |
| combo(5/3)（两者取或） | 8.7 | 26 | 25.7 | 20/20 |

**为什么更"聪明"反而更差**：把 `tool/call` 参数落盘后发现，模型是**读一堆各不相同的文件**却就是不推进（`script.py → util.py → README → sample.csv → backup → _verify.py …`）——这是**广度打转**，"同一文件计数"恒为 1，`same-target` 根本没触发；而 `combo` 虽然兜住了，却因 `sameTargetThreshold=3` 触发得**比 T=5 更早**，又掉进"早干预"的坑。

**统一解读（这是核心机制）**：**干预太早会打断模型的正常探索（它反而绕更多圈）；太晚则模型已陷深打转，此时注入"换方法"反而加剧。** 这就是 CVM 说的「**阶段语义**」——同一个指标（连续只读次数）在不同语义下含义相反，**机械按阈值/按"更精确的判据"触发都会害事**。

⇒ `threshold` 与 `mode` 都是**场景敏感参数**，默认值只在这个场景标定过；**换场景必须重标，且任何改动都要重做 A/B**（不能凭直觉认为"更精确 = 更优"）。

### 5.4 边界
- 样本 20 次/组，**方向性证据**，不是精确值（单次方差大 + API 抖动）。
- C2（用户施压时是否改口）在 deepseek 上基线就不退化，**测不出改善空间**。
- 实验室级证据（隔离 `DSH_HOME` + headless），未到生产级。

## 六、已知代价

**这类插件的风险不是"没效果"，是误伤。**

- `dsh-evidence` 早期把 `tool/result.error` 当"工具失败"，在调试场景里**把模型正常的"看报错再改"误判成失败**，退化率反而涨到 **37.5%（比不用插件还差）**。修正为"验证工具**成功**执行才算验证过"后干扰消除。
- `dsh-convergence` 的 `threshold` 过低（T=3）或 `combo` 的 `sameTargetThreshold` 过低，都会因**过早干预**恶化过程（见 5.3）。

⇒ 所以每个插件都可配置、可单独关闭；**调参要按场景标定，不能照搬默认值**。

## 七、评测方法学（我们踩过的坑）

1. **fixtures 必须每轮复位**：评测时 headless 的 cwd 指向 `eval/fixtures`，模型会**直接改场景文件**。我们曾让 `script.py` 被改成"能工作的版本"、还误当原始版提交进 git ⇒ **那之后的所有读数都是假象**。现在 `batch-eval.mjs` 每轮跑前执行 `git checkout -- eval/fixtures`。
2. **A/B 数据要并存**：`batch-eval.mjs --label A|B` 分开落盘，否则互相覆盖。
3. **别只看均值**：强模型的过程指标均值可能完全不动，差异藏在**标准差 / 极值 / p90**。
4. **单测 mock 必须对齐真实事件结构**：`user/message` 的 payload 就是 UserMessage（`{content,source,role,id}`），`assistant/message` 才是嵌套 `{turn,step,message}`。我们曾因 mock 假设错误，让 41 项单测全绿而线上功能恒为 null。

复现：`node eval/batch-eval.mjs C1 20 --label B`（批量，结果落 `eval/results/`）。

## 八、目录

```
packages/dsh-{contract,convergence,evidence,intervention}/  # 四插件
eval/                                                       # 评测集 + 驱动 + 批量脚本 + 场景
src/domain/                                                 # 单测（41 项）
*.md                                                        # 知识底座、调研、数据汇总
```

## License

MIT
