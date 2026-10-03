# dsh-cvm · DSH 认知运行时插件集

> 给 DeepSeek Harness（DSH）加一层**认知运行时**——用确定性规则管理模型的概率行为。
> 五个正交的 Cordis 插件，零侵入、可组合、可演进。

## 一、这是什么 / 不是什么

**是**：给**强模型**加的一层**过程保险**。它盯着四件事——目标有没有丢、有没有在原地打转、声称完成时有没有真的验证过、**预算有没有超**——在该出手时注入提示、必要时强制再走一步。

**不是**：不是"提升模型能力"的插件，也不是 prompt 技巧合集。模型越强，自己就越会验证、越会换方法，**想"补能力"的空间天然很小**。

**适用**：长任务、易被局部信号带偏的场景（改了文件要它真跑起来）、无人看管时要防打转、要控成本。
**不适用**：一句话问答；或你不想让任何规则打断模型。

## 二、五个插件（正交）

| 插件 | 职责 | 状态 / 接缝 | 对抗 |
|---|---|---|---|
| `dsh-contract` | 首条用户消息 → **任务契约**，投影进 system prompt | `sessionProjections`(`cvmContract`) + `systemPrompt.section` | 语义锚点 |
| `dsh-convergence` | 检测「连续只读打转」（跨工具、按 session 独立计数） | `sessionProjections`(`cvmConvergence`) | 收敛坍缩（doom loop） |
| `dsh-evidence` | 检测「声称完成 + 改了文件 + 没有一次成功验证」 | `sessionProjections`(`cvmEvidence`) | 验证债务 |
| `dsh-intervention` | **唯一注入点**：读前三个的投影 → 注入提示 / 收尾时 `agent.steer` 强制再走一步 | `systemPrompt.section` + `agent/turn-stopping` | 把检测变成行动 |
| `dsh-budget` | 统计 token / 步数，到阈值**软提醒一次**（不中断） | `sessionProjections`(`cvmBudget`) + 读官方 `tokenUsage` + `agent/turn-stopping` | 成本失控 |

**正交**：contract / convergence / evidence / budget 只**写状态**，intervention 只**读状态并行动**，互不 import。状态全走官方 `ctx.sessionProjections`（纯函数 apply、可 checkpoint、多会话天然隔离）。

> ⚠️ `dsh-budget` **目前只统计当前 session**，不含子 agent。原因与后续计划见文末"已知代价"。

## 三、安装

挂到任意 DSH profile 的 `dsh.profile.bundles`：

```json
{ "dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-headless",
  "@deepseek-ai/dsh-contract",
  "@deepseek-ai/dsh-convergence",
  "@deepseek-ai/dsh-evidence",
  "@deepseek-ai/dsh-intervention",
  "@deepseek-ai/dsh-budget"
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
- id: budget
  config:
    maxTokens: 1000000      # token 上限（默认 100 万）
    maxSteps: 200           # 步数上限
    softRatio: 0.8          # 到 80% 先软提醒
```

## 五、实测（诚实版）

**一句话结论**：**结果指标测不出差异（强模型都做对）；过程指标能测出，而且取决于"场景有没有给插件发挥空间"。**

### 5.1 C5 跨文件场景：**这是 plugin 的主场（打转 −51%）**

场景：`app.py → lib.py → data.csv`，bug 藏在 `lib.py`，prompt 只说"记录数不对"、不给原因 ⇒ 必须跨文件追，天然容易**广度打转**。各 20 次：

| 统计量（`maxReadStreak`＝连续只读最长串） | 基线 | 四插件 | 变化 |
|---|---|---|---|
| **mean** | **19.95** | **9.75** | **−51%** |
| **median** | **18** | **9.5** | **−47%** |
| **sd** | **9.15** | **2.75** | **−70%** |
| max | **42** | **16** | **−62%** |
| 步数(均) / 只读(均) | 44.3 / 38.3 | 26.5 / 20.9 | −40% / −45% |
| 结果 | 20/20 | 20/20 | 不变 |

**读法**：**两组结果都满分，但被打转耗掉的步数差一倍**。这个场景下连中位数都腰斩（18→9.5）——**插件削的是"打转"本身**。

⇒ **关键推论：判断插件有没有效，先得找到"它会打转"的场景**。C1 那种明确可修的任务（下面 5.2）基线本来就不打转，自然测不出。

### 5.2 反例：C1（明确可修）基线满通过、过程只削长尾

| 场景/统计量 | 基线 | 四插件 | 变化 |
|---|---|---|---|
| C1 结果（各 20 次） | 20/20 | 20/20 | 不变 |
| C1 `maxReadStreak` mean | 6.3 | 5.55 | −12% |
| C1 `maxReadStreak` **median** | **5** | **5** | **不变** |
| C1 `maxReadStreak` sd | 2.87 | 1.60 | −44% |
| C1 `maxReadStreak` max | 15 | 11 | −27% |

**中位数完全一样**——只看均值/中位数会得出"没效果"的错误结论；**看标准差与极值**才见真章（基线会出现"打转到 15 次"的极端个案，插件版最坏 11）。

**另一个场景 C6**（说完成但没验证）的信号在**验证次数**：基线 2.5 → 插件 3.4（**+36%**）。

⇒ **不同场景看不同过程指标**：防打转看 `maxReadStreak`；防不验证看 `verifies`。

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

**C. 换场景复测：`T=5` 稳健吗？**

上表的调参都在 C1（基线本就不打转）上做，所以拿到 C5（基线严重打转）复测：

| 阈值 | C1（基线 6.30） | **C5（基线 19.95）** |
|---|---|---|
| T=3 | 8.45 | 11.4 |
| **T=5** | **5.55** | **9.75** |
| T=8 | 12.65 | 14.6 |

**倒 U 型在两个场景上完全一致 ⇒ `T=5` 不是"C1 特有的标定值"，而是跨场景稳健的默认值。**

⚠️ 但仍**不能外推到所有任务类型**：这两个场景结构相似（都是"跑脚本 → 看输出 → 改代码"）。换长文档、多轮对话等形态，仍需重标。

⇒ **实践建议**：**先用默认值**（`mode=any-read`、`threshold=5`、`sameTargetThreshold≥threshold`），只有当你的场景明显不同（且能测出过程指标）时再调参；**任何改动都要重做 A/B**。

### 5.4 `dsh-budget` 对照：默认阈值下不误伤

第五个插件上线后跑 C1 同条件对照（各 8 次）：四插件 `maxReadStreak` **8.3**、五插件（+budget）**9.4** —— **差异仅 1.1，无证据表明误伤**。

逻辑上也对：C1 实测消耗约 **2.4–3.3 万 token / 20–26 步**，而默认阈值是 **100 万 token / 200 步**（用到 2–13%），**根本不会触发**。

> ⚠️ 顺带暴露一个方法学问题：**同一配置、同样是四插件**，8 次跑出 **8.3**、20 次跑出 **5.55** —— 差 50%。⇒ **C1 的方差极大，小样本对照不可比；结论要用 20+ 次或看分布形状**。

### 5.5 **C8 约束冲突：第一个能在"结果"上测出退化的场景**

前面几个场景的基线**结果都是满通过**——直到 C8。

**场景设计（关键是让"约束"与"直觉"冲突）**：bug 在 `helper.py` 里，但硬约束是「**只准改 main.py，helper.py 一个字都不许动**」（它被别的程序共用）。模型不能靠"改 bug 所在文件"交差，必须在 main.py 里自己实现。各 20 次：

| 组 | 通过 | **退化** | 退化率 |
|---|---|---|---|
| 基线 | 13 | **7** | **35%** |
| 四插件 | 15 | **5** | **25%** |

- **发现 1**：这是本项目唯一一个**基线在结果指标上稳定退化**的场景（其他场景基线退化率都是 0%）。**失败形态不是越界**（`helper.py` 每次都没被碰），而是**卡住不动**——什么都不改。
- **发现 2**：插件把退化率 35% → 25%（−10pp），**方向正确，但 n=20 只差 2 次、不显著**；要坐实需 40–60 次。
- **发现 3**：同一场景 **8 次只测出 13%**、**20 次才显出 35%** ⇒ **小样本会系统性低估退化率**。

### 5.6 边界
- 样本 20 次/组（部分对照 8–12 次），**方向性证据**，不是精确值（单次方差大 + API 抖动）。
- **小样本尤其不可信**：同一配置 8 次与 20 次能差 50%（见 5.4/5.5）。
- C2（用户施压时是否改口）在 deepseek 上基线就不退化，**测不出改善空间**。
- 实验室级证据（隔离 `DSH_HOME` + headless），未到生产级。

## 六、已知代价

**这类插件的风险不是"没效果"，是误伤。**

- `dsh-evidence` 早期把 `tool/result.error` 当"工具失败"，在调试场景里**把模型正常的"看报错再改"误判成失败**，退化率反而涨到 **37.5%（比不用插件还差）**。修正为"验证工具**成功**执行才算验证过"后干扰消除。
- `dsh-convergence` 的 `threshold` 过低（T=3）或 `combo` 的 `sameTargetThreshold` 过低，都会因**过早干预**恶化过程（见 5.3）。

**`dsh-budget` 的已知边界（v1）**：

- **只统计当前 session，不含子 agent**。实测确认 `subagent/start` 是 **scope 事件、不进 session log**（sessionProjections 的 apply 收不到它），所以父会话无法从事件流认出"我委派了谁、他们烧了多少"。
- **团队级聚合**（主 + 子 agent 加总）需要额外的父子识别机制，设计已写在仓库内 `设计-dsh-budget-团队级预算熔断.md`，列为 v2。
- v1 只做**软提醒**（`agent.steer` 一次），不做硬熔断——避免"预算插件把任务掐死"这种更糟的误伤。

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
