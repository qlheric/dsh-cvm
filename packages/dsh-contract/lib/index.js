import z from "@deepseek-ai/schemastery";

export const name = 'contract';
export const inject = ['systemPrompt', 'sessionProjections'];

const DEFAULT_MAX_OBJECTIVE_CHARS = 2000;

export const Config = z.object({
  /** prompt 段顺序（越小越靠前）。 */
  sectionOrder: z.natural().default(5000),
  /** 目标文本的最大字符数（超出截断，避免超长首条消息污染前缀）。 */
  maxObjectiveChars: z.natural().min(1).default(DEFAULT_MAX_OBJECTIVE_CHARS),
  /** 契约投影 key。 */
  projectionKey: z.string().default('cvmContract'),
});

function renderContract(contract) {
  return [
    '任务契约（TaskContract）：',
    `目标：${contract.objective}`,
    '范围：（未限定）',
    '约束：（无）',
    '成功标准：让目标真正实现、功能真正可用',
  ].join('\n');
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
 */
export function apply(ctx, config = {}) {
  const maxObjectiveChars = config.maxObjectiveChars ?? DEFAULT_MAX_OBJECTIVE_CHARS;
  const projectionKey = config.projectionKey ?? 'cvmContract';

  ctx.sessionProjections.register({
    key: projectionKey,
    stateVersion: 1,
    init: () => null,
    apply: (state, event) => {
      try {
        if (state !== null) return state; // 契约一旦确定不再改（字节稳定，守前缀缓存）
        if (event?.type !== 'user/message') return state;
        // 只认真正来自用户的输入，排除运行时上下文注入（runtime-context / skill-catalog 等）
        const source = event?.data?.source;
        if (source && source.kind !== 'user') return state;
        let text = extractUserText(event).trim();
        if (text === '') return state;
        if (text.length > maxObjectiveChars) text = `${text.slice(0, maxObjectiveChars)}…`;
        return { objective: text };
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
      return contract ? renderContract(contract) : '';
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
