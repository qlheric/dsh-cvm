import z from "@deepseek-ai/schemastery";

export const name = 'contract';
export const inject = ['systemPrompt'];
export const Config = z.object({});

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
  let contract = null;

  ctx.on('session/event', (session, event) => {
    if (contract !== null) return;
    if (event?.type !== 'user/message') return;
    const text = extractUserText(event).trim();
    if (text === '') return;
    contract = { objective: text, scope: [], constraints: [], successCriteria: [] };
  });

  ctx.systemPrompt.variable('cvm_contract', () => (contract ? renderContract(contract) : ''));
  ctx.systemPrompt.section({ name: 'cvm:contract', order: 5000, text: '{{cvm_contract}}' });
}
