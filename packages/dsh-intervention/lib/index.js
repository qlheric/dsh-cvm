import z from "@deepseek-ai/schemastery";

export const name = 'intervention';
export const inject = ['systemPrompt'];

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
});

// 唯一注入点：收 convergence/evidence 的信号，按优先级合并注入提示。
export function apply(ctx, config = {}) {
  const hints = {
    convergence: config.convergenceHint ?? DEFAULT_CONVERGENCE_HINT,
    evidence: config.evidenceHint ?? DEFAULT_EVIDENCE_HINT,
  };
  const state = { convergence: false, evidence: false };

  ctx.on('cvm/signal', (sig) => {
    try {
      if (sig && typeof sig.active === 'boolean' && sig.kind in state) {
        state[sig.kind] = sig.active;
      }
    } catch (error) {
      try { ctx.logger?.warn?.('dsh-intervention: signal handler error (fail-open)', error); } catch { /* ignore */ }
    }
  });

  ctx.systemPrompt.variable('cvm_intervention_hint', () => {
    try {
      if (state.convergence) return hints.convergence;
      if (state.evidence) return hints.evidence;
      return '';
    } catch {
      // fail-open：解析失败就不要注入，绝不中断 prompt 组装
      return '';
    }
  });
  ctx.systemPrompt.section({
    name: 'cvm:intervention',
    order: config.sectionOrder ?? 5001,
    text: '{{cvm_intervention_hint}}',
  });
}
