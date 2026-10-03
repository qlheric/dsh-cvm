import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

export const name = 'budget';
export const inject = ['sessionProjections', 'agents'];

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
  /** 是否把**活跃子 agent**的消耗计入团队总量（v2）。 */
  countSubagents: z.boolean().default(true),
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
 * 预算熔断。
 *
 * 数据来源全部是**官方已有投影**，本插件不重复造：
 * - token：`tokenUsage`（`dsh-token-meter` 的 `{ totals, last }`）
 * - 步数：本插件的 `cvmBudget` 投影（数 `tool/call`）
 *
 * 行为：用到 `softRatio` 就通过 `agent/turn-stopping` **软提醒一次**
 * （steer 一条消息，不中断）；不做硬熔断。
 *
 * **v2 的团队聚合**：`subagent/start` / `subagent/end` 是 scope 事件
 * （不进 session log），用 `ctx.on` 捕获后，通过 `ctx.get('agents').get(info.id)`
 * 拿到子 agent，把**当前活跃子 agent** 的 token 计入团队总量。
 *
 * ⚠️ 已知边界（v2 仍是近似）：
 * 1. **已结束的子 agent 不计入**：`child` 上没有 parent 字段（实测 `parent: null`），
 *    无法把已结束子 agent 的消耗可靠归到某个父会话。所以团队总量是个**下界**。
 * 2. 活跃子 agent 集合是**插件级**的；多会话同时派人时会互相看到，单会话无影响。
 */
export function apply(ctx, config = {}) {
  const softSteered = new Set();
  const cfg = {
    maxTokens: config.maxTokens ?? 1_000_000,
    maxSteps: config.maxSteps ?? 200,
    softRatio: config.softRatio ?? 0.8,
    steerOnce: config.steerOnce ?? true,
    enabled: config.enabled ?? true,
    countSubagents: config.countSubagents ?? true,
    projectionKey: config.projectionKey ?? 'cvmBudget',
  };

  /** 活跃子 agent：runId → child agent（v2 团队聚合用）。 */
  const activeChildren = new Map();

  const getAgentService = () => {
    try { return ctx.get?.('agents'); } catch { return undefined; }
  };
  const readTokens = (session) => {
    try { return tokenTotal(ctx.sessionProjections.stateOf(session, 'tokenUsage')?.totals); }
    catch { return 0; }
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

  // ── v2：团队聚合（捕获子 agent 生命周期）──
  ctx.on('subagent/start', (info) => {
    try {
      if (!cfg.countSubagents) return;
      const child = getAgentService()?.get?.(info?.id);
      if (child) activeChildren.set(info?.runId ?? info?.id, child);
    } catch (error) {
      try { ctx.logger?.warn?.('dsh-budget: subagent/start error (fail-open)', error); } catch { /* ignore */ }
    }
  });
  ctx.on('subagent/end', (info) => {
    try {
      activeChildren.delete(info?.runId ?? info?.id);
    } catch { /* ignore */ }
  });

  ctx.on('agent/turn-stopping', async ({ agent }) => {
    try {
      if (!cfg.enabled) return;
      const session = agent?.session;
      if (!session) return;

      const sessionId = session.id ?? String(session);
      const budget = ctx.sessionProjections.stateOf(session, cfg.projectionKey);
      const steps = budget?.steps ?? 0;

      const ownTokens = readTokens(session);
      let childTokens = 0;
      if (cfg.countSubagents) {
        for (const child of activeChildren.values()) {
          // ⚠️ 必须排除自己：turn-stopping 在子 agent 自己的会话里也会触发，
          //    而 activeChildren 是插件级的、里面就有它自己 ⇒ 不排除会重复计算。
          const childSessionId = child?.session?.id;
          if (childSessionId !== undefined && childSessionId === sessionId) continue;
          childTokens += readTokens(child?.session);
        }
      }
      const teamTokens = ownTokens + childTokens;

      const tokenRatio = cfg.maxTokens > 0 ? teamTokens / cfg.maxTokens : 0;
      const stepRatio = cfg.maxSteps > 0 ? steps / cfg.maxSteps : 0;
      const ratio = Math.max(tokenRatio, stepRatio);
      if (ratio < cfg.softRatio) return;

      if (cfg.steerOnce && softSteered.has(sessionId)) return;
      softSteered.add(sessionId);

      const pct = Math.round(ratio * 100);
      const childNote = childTokens > 0 ? `（含子 agent ${childTokens.toLocaleString()}）` : '';
      const detail = tokenRatio >= stepRatio
        ? `token ${teamTokens.toLocaleString()}/${cfg.maxTokens.toLocaleString()}${childNote}`
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
