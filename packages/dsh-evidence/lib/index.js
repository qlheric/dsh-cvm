import z from "@deepseek-ai/schemastery";

export const name = 'evidence';
export const Config = z.object({});

const WRITE_TOOLS = new Set(['edit', 'write', 'str_replace_editor']);
const DONE_PATTERN = /完成|搞定|已修复|已修改|已改好|修好了|done|finished|fixed/i;

function extractText(event) {
  const content = event?.data?.message?.content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  }
  if (typeof content === 'string') return content;
  return '';
}

// 该 assistant 消息是否还在调用工具（中间步骤，未收尾）
function hasToolCall(event) {
  const content = event?.data?.message?.content;
  if (Array.isArray(content)) {
    return content.some((b) => b && b.type === 'tool-call');
  }
  return false;
}

// 只检测验证债务，发信号。claimedDone 只在"最终回答（不含工具调用）"时判定，避免中途误触发。
export function apply(ctx, config = {}) {
  let wroteFile = false;
  let verified = false;
  let claimedDone = false;
  let active = false;

  ctx.on('session/event', (session, event) => {
    if (event?.type === 'tool/call') {
      const tool = event.data?.name;
      if (WRITE_TOOLS.has(tool)) wroteFile = true;
      if (tool === 'bash' || tool === 'pwsh') verified = true;
    } else if (event?.type === 'assistant/message') {
      if (!hasToolCall(event) && DONE_PATTERN.test(extractText(event))) claimedDone = true;
    }

    const next = claimedDone && wroteFile && !verified;
    if (next !== active) {
      active = next;
      ctx.emit('cvm/signal', { kind: 'evidence', active });
    }
  });
}
