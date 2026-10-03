import z from "@deepseek-ai/schemastery";

export const name = 'convergence';
export const inject = ['sessionProjections'];


const DEFAULT_READ_TOOLS = ['read', 'glob', 'grep', 'ls', 'list'];
const DEFAULT_THRESHOLD = 5;
const DEFAULT_SAME_TARGET_THRESHOLD = 3;
const DEFAULT_TARGET_KEYS = ['file_path', 'path', 'file', 'pattern', 'glob', 'query'];

export const Config = z.object({
  /** 视为"只读"的工具名（连续调用会被计入打转计数）。 */
  readTools: z.array(z.string()).default([...DEFAULT_READ_TOOLS]),
  /** 连续只读多少次判定为"没有推进"（广度打转的兜底判据）。 */
  threshold: z.natural().min(1).default(DEFAULT_THRESHOLD),
  /**
   * any-read    : 只看"连续只读次数"（默认，抓"没有推进"；实测在 C1 场景最优）
   * same-target : 只看"连续读同一个目标"（抓"反复看同一处"，对广度打转会完全漏判）
   * combo       : 两者取或（同目标提前触发 + 连续只读兜底）；实测默认参数下会因"太早"而变差
   *
   * ⚠️ 实测结论（C1-hard，各 20 次，maxReadStreak 越小越好）：
   *   any-read T=5 → 5.55（最优）｜T=3 → 8.45｜T=8 → 12.65
   *   same-target T=3 → 13.5（广度打转抓不到）｜combo(5/3) → 8.7（sameTarget=3 太早）
   *   ⇒ **只要比 T=5 更早触发，就会变差**。默认保持 any-read/T=5。
   */
  mode: z.union([z.const('any-read'), z.const('same-target'), z.const('combo')]).default('any-read'),
  /** combo 模式：同一目标连续读几次即触发（提前预警深度打转）。 */
  sameTargetThreshold: z.natural().min(1).default(DEFAULT_SAME_TARGET_THRESHOLD),
  /** 从工具参数里提取"目标"的字段名（按序取第一个命中的）。 */
  targetKeys: z.array(z.string()).default([...DEFAULT_TARGET_KEYS]),
  /** 投影 key（intervention 按此读取）。 */
  projectionKey: z.string().default('cvmConvergence'),
});

/** 从工具参数（JSON 字符串或对象）里提取"读的是什么目标"。 */
function extractTarget(rawArgs, targetKeys) {
  if (rawArgs === undefined || rawArgs === null) return null;
  let args = rawArgs;
  if (typeof rawArgs === 'string') {
    try { args = JSON.parse(rawArgs); } catch { return null; }
  }
  if (args === null || typeof args !== 'object') return null;
  for (const key of targetKeys) {
    const v = args[key];
    if (typeof v === 'string' && v !== '') return `${key}:${v}`;
  }
  return null;
}

/**
 * 检测"打转"（doom loop）。打转分两种，判据不同：
 *
 * - **深度打转**：反复看同一处（`read a → read a → read a`）⇒ 看"同一目标"计数。
 * - **广度打转**：一直在读、但读的全是各不相同的东西、就是不推进
 *   （`read a → read b → read c → …`）⇒ 只能看"连续只读且无写/执行"的计数。
 *
 * `combo` 模式两者取或：同目标提前触发（默认 3 次），连续只读兜底（默认 5 次）。
 * 这是"指标 → 阶段语义"的落地——同一个"连续只读"指标，
 * 在"是否换了目标"这一语义下含义不同，机械按单一阈值触发会漏判或误伤。
 */
export function apply(ctx, config = {}) {
  const readTools = new Set(config.readTools ?? DEFAULT_READ_TOOLS);
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const mode = config.mode ?? 'combo';
  const sameTargetThreshold = config.sameTargetThreshold ?? DEFAULT_SAME_TARGET_THRESHOLD;
  const targetKeys = config.targetKeys ?? DEFAULT_TARGET_KEYS;

  ctx.sessionProjections.register({
    key: config.projectionKey ?? 'cvmConvergence',
    stateVersion: 3,
    init: () => ({ streak: 0, target: null, sameTarget: 0, active: false }),
    apply: (state, event) => {
      try {
        if (event?.type !== 'tool/call') return state;
        const tool = event.data?.name;
        if (!tool) return state;

        if (!readTools.has(tool)) {
          // 出现写/执行/其他工具 ⇒ 在推进，重置
          if (state.streak === 0 && state.active === false) return state;
          return { streak: 0, target: null, sameTarget: 0, active: false };
        }

        const target = extractTarget(event.data?.arguments, targetKeys);
        const sameTarget = target !== null && target === state.target ? state.sameTarget + 1 : 1;
        const streak = state.streak + 1;

        let active;
        if (mode === 'same-target') active = sameTarget >= threshold;
        else if (mode === 'any-read') active = streak >= threshold;
        else active = sameTarget >= sameTargetThreshold || streak >= threshold;

        if (streak === state.streak && sameTarget === state.sameTarget && active === state.active) return state;
        return { streak, target, sameTarget, active };
      } catch (error) {
        // fail-open：投影异常不得影响会话
        try { ctx.logger?.warn?.('dsh-convergence: projection error (fail-open)', error); } catch { /* ignore */ }
        return state;
      }
    },
  });
}
