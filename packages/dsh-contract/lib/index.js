import z from "@deepseek-ai/schemastery";

export const name = 'contract';
export const inject = ['systemPrompt', 'sessionProjections'];

const DEFAULT_MAX_OBJECTIVE_CHARS = 2000;
const DEFAULT_MAX_CONSTRAINTS = 4;

/** 约束信号词：命中这些词的句子会被提取为"约束"。 */
const DEFAULT_CONSTRAINT_PATTERN = '只准|只能|只可|仅可|仅限|只需|不要|不许|不准|不得|禁止|严禁|必须|务必|一定|硬约束|不可|别改|不能改|保持不动';

export const Config = z.object({
  /** prompt 段顺序（越小越靠前）。 */
  sectionOrder: z.natural().default(5000),
  /** 目标文本的最大字符数（超出截断，避免超长首条消息污染前缀）。 */
  maxObjectiveChars: z.natural().min(1).default(DEFAULT_MAX_OBJECTIVE_CHARS),
  /** 最多提取几条约束。 */
  maxConstraints: z.natural().default(DEFAULT_MAX_CONSTRAINTS),
  /** 约束识别用的正则（字符串形式，便于配置覆盖）。 */
  constraintPattern: z.string().default(DEFAULT_CONSTRAINT_PATTERN),
  /** 契约投影 key。 */
  projectionKey: z.string().default('cvmContract'),
});

/** 从首条用户消息里挑出"约束句"（含约束信号词的句子，按原话保留）。 */
export function extractConstraints(text, pattern, max) {
  if (!text) return [];
  let re;
  try { re = new RegExp(pattern); } catch { return []; }
  const sentences = text
    .split(/[。；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const hits = [];
  for (const s of sentences) {
    if (re.test(s) && !hits.includes(s)) hits.push(s);
    if (hits.length >= max) break;
  }
  return hits;
}

function renderContract(contract, maxConstraints) {
  const lines = [
    '任务契约（TaskContract）：',
    `目标：${contract.objective}`,
  ];
  const constraints = (contract.constraints ?? []).slice(0, maxConstraints);
  if (constraints.length > 0) {
    lines.push('约束（用户原话，必须遵守）：');
    for (const c of constraints) lines.push(`- ${c}`);
  }
  lines.push('成功标准：让目标真正实现、功能真正可用。');
  // ⚠️ 只在"约束与直觉冲突"时才有意义的行为准则（避免模型在约束下卡住不动）
  lines.push('若某条约束让"最直接的解法"走不通：不要放弃，也不要违反约束——改在允许的范围内换一条路把目标做成，并在最后说明你是怎么绕开的。');
  return lines.join('\n');
}

function extractUserText(event) {
  // user/message 的事件 payload 就是 UserMessage 本身（content/source/role/id）
  const msg = event?.data;
  if (msg?.content && Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  if (typeof msg?.content === 'string') return msg.content;
  return '';
}

/**
 * 把首条用户消息落成 per-session 的契约投影（状态），再由 systemPrompt 段渲染。
 * 状态走官方 sessionProjections ⇒ 多会话隔离、可 checkpoint。
 * provider 的 context.agent 由 assembleContextFor 提供，因此渲染天然 per-agent。
 *
 * ⚠️ 契约一经确定不再变化（守前缀缓存字节稳定）；渲染文本只由契约状态决定。
 */
export function apply(ctx, config = {}) {
  const maxObjectiveChars = config.maxObjectiveChars ?? DEFAULT_MAX_OBJECTIVE_CHARS;
  const maxConstraints = config.maxConstraints ?? DEFAULT_MAX_CONSTRAINTS;
  const constraintPattern = config.constraintPattern ?? DEFAULT_CONSTRAINT_PATTERN;
  const projectionKey = config.projectionKey ?? 'cvmContract';

  ctx.sessionProjections.register({
    key: projectionKey,
    stateVersion: 2,
    init: () => null,
    apply: (state, event) => {
      try {
        if (state !== null) return state; // 契约一旦确定不再改（字节稳定，守前缀缓存）
        if (event?.type !== 'user/message') return state;
        // 只认真正来自用户的输入，排除运行时上下文注入（runtime-context / skill-catalog 等）
        const source = event?.data?.source;
        if (source && source.kind !== 'user') return state;
        const full = extractUserText(event).trim();
        if (full === '') return state;
        let text = full;
        if (text.length > maxObjectiveChars) text = `${text.slice(0, maxObjectiveChars)}…`;
        const constraints = extractConstraints(full, constraintPattern, maxConstraints);
        return { objective: text, constraints };
      } catch (error) {
        // fail-open：契约提取失败不影响会话
        try { ctx.logger?.warn?.('dsh-contract: projection error (fail-open)', error); } catch { /* ignore */ }
        return state;
      }
    },
  });

  ctx.systemPrompt.variable('cvm_contract', (context) => {
    try {
      const session = context?.agent?.session;
      if (!session) return '';
      const contract = ctx.sessionProjections.stateOf(session, projectionKey);
      return contract ? renderContract(contract, maxConstraints) : '';
    } catch {
      return '';
    }
  });
  ctx.systemPrompt.section({
    name: 'cvm:contract',
    order: config.sectionOrder ?? 5000,
    text: '{{cvm_contract}}',
  });
}
