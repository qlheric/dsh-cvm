import z from "@deepseek-ai/schemastery";

export const name = 'evidence';

const DEFAULT_WRITE_TOOLS = ['edit', 'write', 'str_replace_editor'];
const DEFAULT_VERIFY_TOOLS = ['bash', 'pwsh'];
const DEFAULT_DONE_PATTERN = '完成|搞定|已修复|已修改|已改好|修好了|done|finished|fixed';

export const Config = z.object({
  /** 视为"改动了文件"的工具名。 */
  writeTools: z.array(z.string()).default([...DEFAULT_WRITE_TOOLS]),
  /** 视为"执行了验证"的工具名。 */
  verifyTools: z.array(z.string()).default([...DEFAULT_VERIFY_TOOLS]),
  /** 匹配"声称完成"的正则源码（大小写不敏感）。 */
  donePattern: z.string().default(DEFAULT_DONE_PATTERN),
  /** 开关整个终局门禁。 */
  enabled: z.boolean().default(true),
});

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
  if (config.enabled === false) return;

  const writeTools = new Set(config.writeTools ?? DEFAULT_WRITE_TOOLS);
  const verifyTools = new Set(config.verifyTools ?? DEFAULT_VERIFY_TOOLS);
  let donePattern;
  try {
    donePattern = new RegExp(config.donePattern ?? DEFAULT_DONE_PATTERN, 'i');
  } catch {
    donePattern = new RegExp(DEFAULT_DONE_PATTERN, 'i');
  }

  const bySession = new Map(); // sessionId -> { wroteFile, verified, claimedDone }
  let active = false;

  ctx.on('session/event', (session, event) => {
    try {
      const sid = session?.id;
      if (!sid) return;
      let state = bySession.get(sid);
      if (!state) {
        state = { wroteFile: false, verified: false, claimedDone: false };
        bySession.set(sid, state);
      }

      if (event?.type === 'tool/call') {
        const tool = event.data?.name;
        if (writeTools.has(tool)) state.wroteFile = true;
        if (verifyTools.has(tool)) state.verified = true;
      } else if (event?.type === 'assistant/message') {
        if (!hasToolCall(event) && donePattern.test(extractText(event))) state.claimedDone = true;
      }

      const next = [...bySession.values()].some((s) => s.claimedDone && s.wroteFile && !s.verified);
      if (next !== active) {
        active = next;
        ctx.emit('cvm/signal', { kind: 'evidence', active });
      }
    } catch (error) {
      // fail-open：检测器异常绝不阻塞 agent
      try { ctx.logger?.warn?.('dsh-evidence: detector error (fail-open)', error); } catch { /* ignore */ }
    }
  });
}
