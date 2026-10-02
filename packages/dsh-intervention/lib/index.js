import z from "@deepseek-ai/schemastery";

export const name = 'intervention';
export const inject = ['systemPrompt', 'sessionProjections'];

const DEFAULT_CONVERGENCE_HINT =
  '⚠️ 运行时检测：你已经连续多次只读操作却无进展，可能陷入了原地打转。请立即换一种方法：直接运行脚本查看真实报错输出，然后修改代码。注意：真实目标是让功能正常工作（本环境装不了第三方包，请改用标准库）。';
const DEFAULT_EVIDENCE_HINT =
  '⚠️ 运行时终局门禁：你已声称完成，但修改了文件后从未运行任何验证。请先运行脚本/测试确认修改真的生效，再交付，否则视为未完成。';

export const Config = z.object({
  /** 打转时的注入文本。 */
  convergenceHint: z.string().default(DEFAULT_CONVERGENCE_HINT),
  /** 验证债务时的注入文本。 */
  evidenceHint: z.string().default(DEFAULT_EVIDENCE_HINT),
  /** prompt 段顺序（越小越靠前）。 */
  sectionOrder: z.natural().default(5001),
  /** 读取打转状态的投影 key。 */
  convergenceKey: z.string().default('cvmConvergence'),
  /** 读取验证债务状态的投影 key。 */
  evidenceKey: z.string().default('cvmEvidence'),
});

/**
 * 唯一注入点：直接从 per-session 投影读状态，按优先级合并成提示。
 * 不需要自定义事件——读状态即可（官方 sessionProjections 机制）。
 * provider 的 context.agent 由 assembleContextFor 提供，因此天然 per-agent。
 */
export function apply(ctx, config = {}) {
  const hints = {
    convergence: config.convergenceHint ?? DEFAULT_CONVERGENCE_HINT,
    evidence: config.evidenceHint ?? DEFAULT_EVIDENCE_HINT,
  };
  const convergenceKey = config.convergenceKey ?? 'cvmConvergence';
  const evidenceKey = config.evidenceKey ?? 'cvmEvidence';

  ctx.systemPrompt.variable('cvm_intervention_hint', (context) => {
    try {
      const session = context?.agent?.session;
      if (!session) return '';
      if (ctx.sessionProjections.stateOf(session, convergenceKey)?.active) return hints.convergence;
      if (ctx.sessionProjections.stateOf(session, evidenceKey)?.active) return hints.evidence;
      return '';
    } catch (error) {
      // fail-open：读状态失败就不注入，绝不中断 prompt 组装
      try { ctx.logger?.warn?.('dsh-intervention: state read error (fail-open)', error); } catch { /* ignore */ }
      return '';
    }
  });
  ctx.systemPrompt.section({
    name: 'cvm:intervention',
    order: config.sectionOrder ?? 5001,
    text: '{{cvm_intervention_hint}}',
  });
}
