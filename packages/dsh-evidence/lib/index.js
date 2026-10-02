import z from "@deepseek-ai/schemastery";

export const name = 'evidence';
export const inject = ['sessionProjections'];

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
  /** 投影 key（intervention 按此读取）。 */
  projectionKey: z.string().default('cvmEvidence'),
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

/**
 * 检测验证债务：改了文件 + 声称完成 + **没有一次成功的验证**。
 *
 * 关键语义（教训换来的）：`verified` 指"验证工具**成功**执行"（`tool/result` 无 `error`），
 * 不是"跑过验证工具"。调试场景里工具报错是**信息**（模型正要看报错），
 * 若把它当失败会给门禁制造假阳性，反而把好好的修复打断。
 *
 * active = claimedDone && wroteFile && !verified
 */
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

  ctx.sessionProjections.register({
    key: config.projectionKey ?? 'cvmEvidence',
    stateVersion: 3,
    init: () => ({ lastTool: null, wroteFile: false, verified: false, claimedDone: false, active: false }),
    apply: (state, event) => {
      try {
        let next = state;
        if (event?.type === 'tool/call') {
          const tool = event.data?.name ?? null;
          const wroteFile = state.wroteFile || (tool !== null && writeTools.has(tool));
          if (tool !== state.lastTool || wroteFile !== state.wroteFile) {
            next = { ...state, lastTool: tool, wroteFile };
          }
        } else if (event?.type === 'tool/result') {
          // verified 只在"验证工具成功执行（无 error）"时置真
          if (!state.verified && state.lastTool && verifyTools.has(state.lastTool) && !event.data?.error) {
            next = { ...state, verified: true };
          }
        } else if (event?.type === 'assistant/message') {
          if (!state.claimedDone && !hasToolCall(event) && donePattern.test(extractText(event))) {
            next = { ...state, claimedDone: true };
          }
        }
        const active = next.claimedDone && next.wroteFile && !next.verified;
        if (active === next.active) return next;
        return { ...next, active };
      } catch (error) {
        // fail-open：投影异常不得影响会话
        try { ctx.logger?.warn?.('dsh-evidence: projection error (fail-open)', error); } catch { /* ignore */ }
        return state;
      }
    },
  });
}
