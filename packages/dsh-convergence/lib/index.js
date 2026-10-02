import z from "@deepseek-ai/schemastery";

export const name = 'convergence';
export const inject = ['sessionProjections'];

const DEFAULT_READ_TOOLS = ['read', 'glob', 'grep', 'ls', 'list'];
const DEFAULT_THRESHOLD = 5;

export const Config = z.object({
  /** 视为"只读"的工具名（连续调用会被计入打转计数）。 */
  readTools: z.array(z.string()).default([...DEFAULT_READ_TOOLS]),
  /** 连续只读多少次判定为打转。 */
  threshold: z.natural().min(1).default(DEFAULT_THRESHOLD),
  /** 投影 key（intervention 按此读取）。 */
  projectionKey: z.string().default('cvmConvergence'),
});

/**
 * 只检测打转，落成 per-session 投影状态（官方 sessionProjections 机制）。
 * 纯计算、无副作用、可 checkpoint；多会话天然隔离。
 */
export function apply(ctx, config = {}) {
  const readTools = new Set(config.readTools ?? DEFAULT_READ_TOOLS);
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;

  ctx.sessionProjections.register({
    key: config.projectionKey ?? 'cvmConvergence',
    stateVersion: 1,
    init: () => ({ streak: 0, active: false }),
    apply: (state, event) => {
      try {
        if (event?.type !== 'tool/call') return state;
        const tool = event.data?.name;
        if (!tool) return state;
        const streak = readTools.has(tool) ? state.streak + 1 : 0;
        const active = streak >= threshold;
        if (streak === state.streak && active === state.active) return state; // 同引用 = 下游零成本
        return { streak, active };
      } catch (error) {
        // fail-open：投影异常不得影响会话
        try { ctx.logger?.warn?.('dsh-convergence: projection error (fail-open)', error); } catch { /* ignore */ }
        return state;
      }
    },
  });
}
