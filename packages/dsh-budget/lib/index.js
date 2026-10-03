import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

export const name = 'budget';
export const inject = ['sessionProjections'];

export const Config = z.object({
  /** token 预算上限（input+output+cache，按会话累计）。 */
  maxTokens: z.natural().default(1_000_000),
  /** 工具调用步数上限。 */
  maxSteps: z.natural().default(200),
  /** 用到这个比例就先软提醒（0..1）。 */
  softRatio: z.number().min(0).max(1).default(0.8),
  /** 软提醒每个会话至多一次。 */
  steerOnce: z.boolean().default(true),
  /** 总开关。 */
  enabled: z.boolean().default(true),
  /** 投影 key（本插件自己维护的步数统计）。 */
  projectionKey: z.string().default('cvmBudget'),
});

/** 把 token-meter 的 buckets 折成一个总数。 */
function tokenTotal(totals) {
  if (!totals) return 0;
  return (totals.uncachedInputTokens ?? 0)
    + (totals.outputTokens ?? 0)
    + (totals.cacheReadTokens ?? 0)
    + (totals.cacheWriteTokens ?? 0);
}

/**
 * 预算熔断（第一版：**按会话**）。
 *
 * 数据来源全部是**官方已有投影**，本插件不重复造：
 * - token：`tokenUsage`（`dsh-token-meter` 提供的 `{ totals, last }`）
 * - 步数：本插件的 `cvmBudget` 投影（数 `tool/call`）
 *
 * 行为：用到 `softRatio` 就通过 `agent/turn-stopping` **软提醒一次**
 * （steer 一条消息，不中断）；硬熔断留给后续版本与显式配置。
 *
 * ⚠️ 已知边界：**本版只统计当前 session**。子 agent 的消耗不在内
 * ——`subagent/start` 是 scope 事件、不进 session log，父会话无法直接
 * 从事件流认出"我委派了谁"（详见 `设计-dsh-budget-团队级预算熔断.md`）。
 */
export function apply(ctx, config = {}) {
  const softSteered = new Set();
  // Config 默认值兜底：schemastery 只在 DSH 加载时填充默认值，直接调 apply 时不会
  const cfg = {
    maxTokens: config.maxTokens ?? 1_000_000,
    maxSteps: config.maxSteps ?? 200,
    softRatio: config.softRatio ?? 0.8,
    steerOnce: config.steerOnce ?? true,
    enabled: config.enabled ?? true,
    projectionKey: config.projectionKey ?? 'cvmBudget',
  };

  ctx.sessionProjections.register({
    key: cfg.projectionKey,
    stateVersion: 1,
    init: () => ({ steps: 0, subagentCalls: 0 }),
    apply: (state, event) => {
      try {
        if (event?.type !== 'tool/call') return state;
        const tool = event.data?.name;
        if (!tool) return state;
        const isSubagent = tool === 'subagent' || String(tool).startsWith('subagent');
        return {
          steps: state.steps + 1,
          subagentCalls: state.subagentCalls + (isSubagent ? 1 : 0),
        };
      } catch {
        return state; // fail-open
      }
    },
  });

  ctx.on('agent/turn-stopping', async ({ agent }) => {
    try {
      if (!cfg.enabled) return;
      const session = agent?.session;
      if (!session) return;

      const sessionId = session.id ?? String(session);
      const usage = ctx.sessionProjections.stateOf(session, 'tokenUsage');
      const budget = ctx.sessionProjections.stateOf(session, cfg.projectionKey);
      const tokens = tokenTotal(usage?.totals);
      const steps = budget?.steps ?? 0;

      const tokenRatio = cfg.maxTokens > 0 ? tokens / cfg.maxTokens : 0;
      const stepRatio = cfg.maxSteps > 0 ? steps / cfg.maxSteps : 0;
      const ratio = Math.max(tokenRatio, stepRatio);
      if (ratio < cfg.softRatio) return;

      if (cfg.steerOnce && softSteered.has(sessionId)) return;
      softSteered.add(sessionId);

      const pct = Math.round(ratio * 100);
      const detail = tokenRatio >= stepRatio
        ? `token ${tokens.toLocaleString()}/${cfg.maxTokens.toLocaleString()}`
        : `步数 ${steps}/${cfg.maxSteps}`;
      agent.steer(createUserMessage({
        content: [{
          type: 'text',
          text: `[预算提醒] 本次会话已用约 ${pct}%（${detail}）。请收窄范围、少做无效探索；接近完成就直接收尾给出结论。`,
        }],
        source: { kind: 'dsh-budget' },
      }));
    } catch (error) {
      // fail-open：预算提醒异常绝不影响会话
      try { ctx.logger?.warn?.('dsh-budget: turn-stopping error (fail-open)', error); } catch { /* ignore */ }
    }
  });
}
