import z from "@deepseek-ai/schemastery";

export const name = 'convergence';
export const Config = z.object({});

const READ_TOOLS = new Set(['read', 'glob', 'grep', 'ls', 'list']);
const THRESHOLD = 5;

// 只检测打转，发信号。按 session 独立计数（补 subagent 盲区：子会话打转不会被主会话的非只读工具重置）。
export function apply(ctx, config = {}) {
  const streaks = new Map(); // sessionId -> 连续只读计数
  let active = false;

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'tool/call') return;
    const tool = event.data?.name;
    const sid = session?.id;
    if (!tool || !sid) return;

    let streak = streaks.get(sid) ?? 0;
    streak = READ_TOOLS.has(tool) ? streak + 1 : 0;
    streaks.set(sid, streak);

    // 任一 session 打转即发信号
    const next = [...streaks.values()].some((s) => s >= THRESHOLD);
    if (next !== active) {
      active = next;
      ctx.emit('cvm/signal', { kind: 'convergence', active });
    }
  });
}
