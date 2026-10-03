import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

export const name = 'intervention';
export const inject = ['systemPrompt', 'sessionProjections'];

const DEFAULT_CONVERGENCE_HINT =
  '⚠️ 运行时检测：你已经连续多次只读操作却没有推进，可能陷入了原地打转。请换一种方法——例如直接执行/运行看真实输出、换一个假设、或从另一个入口文件切入。注意：目标是让任务真正完成，而不是继续收集信息。';
const DEFAULT_EVIDENCE_HINT =
  '⚠️ 运行时检测：你已声称完成，但修改了文件后从未成功验证过。请先运行脚本/测试确认改动真的生效，再交付；否则应视为未完成。';

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
  /** 是否启用终局门禁 steer（轮次收尾时强制再走一步）。 */
  steerAtTurnStop: z.boolean().default(true),
});

/**
 * 唯一注入点：
 * 1) prompt 段（systemPrompt.variable）——每步渲染，无信号时为空，守前缀缓存；
 * 2) 终局门禁（agent/turn-stopping）——轮次本可关闭且有信号时 steer 一次，
 *    强制 agent 再走一步（官方机制：listener 反对就 steer，机器重读 inbox）。
 * provider 的 context.agent 由 assembleContextFor 提供，因此渲染天然 per-agent。
 */
export function apply(ctx, config = {}) {
  const hints = {
    convergence: config.convergenceHint ?? DEFAULT_CONVERGENCE_HINT,
    evidence: config.evidenceHint ?? DEFAULT_EVIDENCE_HINT,
  };
  const convergenceKey = config.convergenceKey ?? 'cvmConvergence';
  const evidenceKey = config.evidenceKey ?? 'cvmEvidence';

  const hintFor = (session) => {
    try {
      if (!session) return '';
      if (ctx.sessionProjections.stateOf(session, convergenceKey)?.active) return hints.convergence;
      if (ctx.sessionProjections.stateOf(session, evidenceKey)?.active) return hints.evidence;
      return '';
    } catch (error) {
      try { ctx.logger?.warn?.('dsh-intervention: state read error (fail-open)', error); } catch { /* ignore */ }
      return '';
    }
  };

  ctx.systemPrompt.variable('cvm_intervention_hint', (context) => hintFor(context?.agent?.session));
  ctx.systemPrompt.section({
    name: 'cvm:intervention',
    order: config.sectionOrder ?? 5001,
    text: '{{cvm_intervention_hint}}',
  });

  if (config.steerAtTurnStop !== false) {
    const steered = new Set(); // sessionId：每个会话至多 steer 一次，防无限续轮
    ctx.on('agent/turn-stopping', async ({ agent }) => {
      try {
        const session = agent?.session;
        const sid = session?.id;
        if (!sid || steered.has(sid)) return;
        const hint = hintFor(session);
        if (!hint) return;
        steered.add(sid);
        agent.steer(createUserMessage({
          content: [{ type: 'text', text: hint }],
          source: { kind: 'dsh-intervention' },
        }));
      } catch (error) {
        // fail-open：门禁异常绝不阻塞轮次关闭
        try { ctx.logger?.warn?.('dsh-intervention: turn-stopping error (fail-open)', error); } catch { /* ignore */ }
      }
    });
  }
}
