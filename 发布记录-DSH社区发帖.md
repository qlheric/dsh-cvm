# 发布记录：DSH 官方社区发帖

- **平台**：GitHub Discussions · `deepseek-ai/deepseek-harness`（242,627 stars）
- **类别**：`Show Your Plugins!`（不是竞品用的 `Ideas` —— 这个类别更对口）
- **帖子**：#8748 <https://github.com/deepseek-ai/deepseek-harness/discussions/8748>
- **标题**：dsh-cvm: five small guards for the moments a strong model drifts below its own ability
- **署名**：qlheric
- **发布时间**：2026-10-03
- **正文长度**：3102 字符
- **同步动作**：仓库 description 也从旧的"四个插件"术语版，改为
  "4 cognitive guards + 1 cost guard. No core changes - official seams only."

## 正文（存档）
# dsh-cvm: five small guards for the moments a strong model drifts below its own ability

**Repo:** https://github.com/qlheric/dsh-cvm

## What this is

Five orthogonal Cordis plugins for DSH. They don't make the model smarter — the model is already good. They target the moments where a strong model slips into a state *below* its own ability.

I've been A/B-ing these against DeepSeek in an isolated `DSH_HOME` for a while. The honest headline: **outcome metrics barely move; process metrics do — and only in scenarios that actually give the guard room to work.**

## Symptoms it targets

| What you see | Plugin | What it does |
|---|---|---|
| User states a hard constraint in turn 1; by turn 6 it edits the file it was told not to touch | `dsh-contract` | pins the first user message as a task contract into the system prompt — constraints kept **verbatim** |
| Keeps reading files, never advances — 40+ steps in one turn, nothing changed | `dsh-convergence` | counts consecutive read-only calls; nudges "you're looping, change approach" |
| Says "done" without ever running anything | `dsh-evidence` | detects claim-done + files-changed + no successful verification |
| Token spend creeps up unnoticed | `dsh-budget` | one soft nudge past a threshold (never hard-aborts) |

The first three only *detect*; **`dsh-intervention` is the single injection point** that turns state into action (`agent.steer` at turn-stop). No core changes — only `sessionProjections`, `systemPrompt.section/variable`, `agent/turn-stopping`.

## What I actually measured

**Where it works** — C5, a cross-file debugging task where the baseline genuinely loops (20 runs per arm):

| `maxReadStreak` (longest consecutive read-only run) | baseline | with plugins | change |
|---|---|---|---|
| mean | 19.95 | 9.75 | **−51%** |
| median | 18 | 9.5 | −47% |
| sd | 9.15 | 2.75 | −70% |
| steps | 44.3 | 26.5 | −40% |
| outcome | 20/20 | 20/20 | unchanged |

Both arms solved the task. The difference is **how much looping it cost**.

**Where it does nothing** — C1 (a clearly fixable bug): baseline 20/20, process median unchanged. No room to improve.

**And a retraction** — I once reported "the new contract cuts the C8 failure rate from 35% to 15%". That was 20 samples. At 40 samples it collapsed: baseline 25% vs 28%. **Retracted in the README.** For a 10pp difference you'd need ~250 runs/group for p<0.05. The lesson is kept in the repo: *don't conclude when the confidence interval is wider than the effect.*

## Install (one command)

```bash
node install.mjs --apply --profile <your-profile>   # dry-run by default; self-checks afterwards
```

(Don't use `add github:qlheric/dsh-cvm` without `#path:` — the repo root is a private workspace package, so you'd install the root only and nothing would load. We hit that ourselves.)

## Known cost — these can hurt

An early `dsh-evidence` treated `tool/result.error` as "tool failed" and broke a normal debug loop (failure rate went **up** to 37.5%). And `convergence.threshold` set too low (3) is worse than no plugin at all. Every guard is configurable and individually disableable.

Feedback very welcome — **especially a scenario where a guard misfires.**
