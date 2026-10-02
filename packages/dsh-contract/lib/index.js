import z from "@deepseek-ai/schemastery";

export const name = 'contract';
export const inject = ['systemPrompt'];

const DEFAULT_MAX_OBJECTIVE_CHARS = 2000;

export const Config = z.object({
  /** prompt 段顺序（越小越靠前）。 */
  sectionOrder: z.natural().default(5000),
  /** 目标文本的最大字符数（超出截断，避免超长首条消息污染前缀）。 */
  maxObjectiveChars: z.natural().min(1).default(DEFAULT_MAX_OBJECTIVE_CHARS),
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
  const msg = event?.data?.message;
  if (msg?.content && Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  if (typeof msg?.content === 'string') return msg.content;
  return '';
}

export function apply(ctx, config = {}) {
  const maxObjectiveChars = config.maxObjectiveChars ?? DEFAULT_MAX_OBJECTIVE_CHARS;
  let contract = null;

  ctx.on('session/event', (session, event) => {
    try {
      if (contract !== null) return;
      if (event?.type !== 'user/message') return;
      // 只认真正来自用户的输入，排除运行时上下文注入
      const source = event?.data?.source;
      if (source && source.kind !== 'user') return;
      let text = extractUserText(event).trim();
      if (text === '') return;
      if (text.length > maxObjectiveChars) text = `${text.slice(0, maxObjectiveChars)}…`;
      contract = { objective: text, scope: [], constraints: [], successCriteria: [] };
    } catch (error) {
      // fail-open：契约提取失败不影响 agent
      try { ctx.logger?.warn?.('dsh-contract: contract extraction error (fail-open)', error); } catch { /* ignore */ }
    }
  });

  ctx.systemPrompt.variable('cvm_contract', () => {
    try {
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
