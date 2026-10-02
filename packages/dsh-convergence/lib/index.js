import z from "@deepseek-ai/schemastery";

export const name = 'convergence';

const DEFAULT_READ_TOOLS = ['read', 'glob', 'grep', 'ls', 'list'];
const DEFAULT_THRESHOLD = 5;

export const Config = z.object({
  /** 视为"只读"的工具名（连续调用会被计入打转计数）。 */
  readTools: z.array(z.string()).default([...DEFAULT_READ_TOOLS]),
  /** 连续只读多少次判定为打转。 */
  threshold: z.natural().min(1).default(DEFAULT_THRESHOLD),
});

// 只检测打转，发信号。按 session 独立计数（补 subagent 盲区：子会话打转不会被主会话的非只读工具重置）。
export function apply(ctx, config = {}) {
  const readTools = new Set(config.readTools ?? DEFAULT_READ_TOOLS);
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const streaks = new Map(); // sessionId -> 连续只读计数
  let active = false;

  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type !== 'tool/call') return;
      const tool = event.data?.name;
      const sid = session?.id;
      if (!tool || !sid) return;

      let streak = streaks.get(sid) ?? 0;
      streak = readTools.has(tool) ? streak + 1 : 0;
      streaks.set(sid, streak);

      // 任一 session 打转即发信号
      const next = [...streaks.values()].some((s) => s >= threshold);
      if (next !== active) {
        active = next;
        ctx.emit('cvm/signal', { kind: 'convergence', active });
      }
    } catch (error) {
      // fail-open：检测器异常绝不阻塞 agent
      try { ctx.logger?.warn?.('dsh-convergence: detector error (fail-open)', error); } catch { /* ignore */ }
    }
  });
}
