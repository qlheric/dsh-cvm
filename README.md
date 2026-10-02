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

**结果指标测不出差异，过程指标有**。

### C1（需要修好一个脚本）

| 组 | 样本 | 通过 |
|---|---|---|
| 基线 | 20 | **20/20（0% 退化）** |

原始 C1（`import pandas` 报错）与困难版（引号内换行算错行数）**基线都不掉**——deepseek 能一步修好明确问题。**这个场景测不出插件价值**。

### C6（说完成但没验证）—— 有信号

| 组 | 样本 | 通过 | 验证次数(均) | 步数(均) | 用到的工具种类(均) |
|---|---|---|---|---|---|
| 基线 | 20 | 18/20（10% 退化） | **2.5** | 8.8 | 4.7 |
| 四插件 | 20 | 19/20（5% 退化） | **3.4（+36%）** | 10.4 | 5.2 |

**读法**：最终成功率差异（10% vs 5%）只有 1 次、**不显著**；但**验证次数 +36%、工具种类 +11%** —— 插件确实让模型**更倾向于去验证、不那么单调**。**这类插件的价值在"过程"，不在"结果"**。

### 边界
- 样本 20 次/组，是**方向性证据**，不是精确值（单次方差大 + API 抖动）。
- C2（主动异议）在 deepseek 上基线就不退化，**测不出改善空间**。
- 实验室级证据（隔离 `DSH_HOME` + headless），未到生产级。

## 六、已知代价

**这类插件的风险不是"没效果"，是误伤。**

`dsh-evidence` 早期版本把 `tool/result.error` 当"工具失败"，结果在调试场景里**把模型正常的"看报错再改"误判成失败**，C1 退化率反而从 12.5% 涨到 **37.5%（比不用插件还差）**。修正为"验证工具**成功**执行才算验证过"后干扰消除。

⇒ 所以每个插件都可配置、可单独关闭。

## 七、评测方法学（我们踩过的坑，写给复现的人）

1. **fixtures 必须每轮复位**：评测时 headless 的 cwd 指向 `eval/fixtures`，模型会**直接改场景文件**。我们曾让 `script.py` 被改成"能工作的版本"、还误当原始版提交进 git ⇒ **后续所有读数都是假象**（详见 `C1-AB数据汇总.md` 的作废声明）。现在 `batch-eval.mjs` 每轮跑前执行 `git checkout -- eval/fixtures`。
2. **别只测"最终成功"**：强模型在结果指标上很难掉，要看**过程指标**（验证次数、打转长度、工具多样性）。
3. **单测 mock 必须对齐真实事件结构**：`user/message` 的 payload 就是 UserMessage（`{content,source,role,id}`），`assistant/message` 才是嵌套 `{turn,step,message}`。我们曾因 mock 假设错误，让 41 项单测全绿而线上功能恒为 null。

复现：`node eval/drive.mjs --case C6`（单次）、`node eval/batch-eval.mjs C6 20`（批量，结果落 `eval/results/`）。

## 八、目录

```
packages/dsh-{contract,convergence,evidence,intervention}/  # 四插件
eval/                                                       # 评测集 + 驱动 + 批量脚本 + 场景
src/domain/                                                 # 单测（41 项）
*.md                                                        # 知识底座、调研、数据汇总
```

## License

MIT
