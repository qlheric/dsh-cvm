// dsh-budget 单测：预算统计 + 软提醒（不跑慢 headless）
import { mockCtx } from './mock-ctx.mjs';
import { apply, Config } from '../../packages/dsh-budget/lib/index.js';

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n     ${e.message}`); process.exitCode = 1; }
}
function assertTrue(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
function assertEqual(a, b, msg = '') { if (a !== b) throw new Error(`${msg} 期望 ${b}，实际 ${a}`); }

const MAIN = { id: 'main' };
const TOOL = (name) => ({ type: 'tool/call', data: { name, arguments: '{}' } });
/** 造一个带 steer 的 mock agent（mock-ctx 的 agentFor 不含 steer）。 */
function makeAgent(id, steered) {
  return { session: { id }, steer: (msg) => steered.push(msg) };
}

/** 预置 DSH 自带的 tokenUsage 投影（单测里用假数据驱动）。 */
function withTokenUsage(ctx, tokens) {
  ctx.sessionProjections.register({
    key: 'tokenUsage',
    init: () => ({ totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, last: null }),
    apply: (state, event) => {
      if (event?.type !== 'setUsage') return state;
      return { ...state, totals: event.data.totals };
    },
  });
}

console.log('== dsh-budget 投影（步数 / 子 agent 调用）==');
t('注册了投影 key cvmBudget', () => {
  const ctx = mockCtx(); apply(ctx, {});
  assertTrue(ctx.sessionProjections.keys().includes('cvmBudget'));
});
t('tool/call 累加步数', () => {
  const ctx = mockCtx(); apply(ctx, {});
  ctx.sessionProjections.feed(MAIN, TOOL('read'));
  ctx.sessionProjections.feed(MAIN, TOOL('edit'));
  assertEqual(ctx.sessionProjections.stateOf(MAIN, 'cvmBudget').steps, 2);
});
t('识别 subagent 调用', () => {
  const ctx = mockCtx(); apply(ctx, {});
  ctx.sessionProjections.feed(MAIN, TOOL('subagent'));
  ctx.sessionProjections.feed(MAIN, TOOL('read'));
  const b = ctx.sessionProjections.stateOf(MAIN, 'cvmBudget');
  assertEqual(b.steps, 2); assertEqual(b.subagentCalls, 1);
});
t('非 tool/call 事件不改状态（同引用）', () => {
  const ctx = mockCtx(); apply(ctx, {});
  const before = ctx.sessionProjections.stateOf(MAIN, 'cvmBudget');
  ctx.sessionProjections.feed(MAIN, { type: 'user/message', data: {} });
  assertTrue(ctx.sessionProjections.stateOf(MAIN, 'cvmBudget') === before);
});

console.log('== 软提醒 ==');
t('用量低于阈值：不打扰', async () => {
  const ctx = mockCtx(); withTokenUsage(ctx, 0);
  apply(ctx, { maxTokens: 1000, maxSteps: 100, softRatio: 0.8 });
  const steered = [];
  ctx.sessionProjections.feed(MAIN, { type: 'setUsage', data: { totals: { uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  ctx.handlers['agent/turn-stopping']({ agent: makeAgent('main', steered) });
  assertEqual(steered.length, 0);
});
t('token 超阈值：提醒一次', async () => {
  const ctx = mockCtx(); withTokenUsage(ctx, 0);
  apply(ctx, { maxTokens: 1000, maxSteps: 100, softRatio: 0.8 });
  ctx.sessionProjections.feed(MAIN, { type: 'setUsage', data: { totals: { uncachedInputTokens: 900, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  const steered = [];
  const agent = makeAgent('main', steered);
  ctx.handlers['agent/turn-stopping']({ agent });
  assertEqual(steered.length, 1, '应提醒');
  assertTrue(steered[0].content[0].text.includes('预算提醒'), '内容应含提醒');
  assertEqual(steered[0].source.kind, 'dsh-budget');
});
t('再触发不重复提醒（steerOnce）', async () => {
  const ctx = mockCtx(); withTokenUsage(ctx, 0);
  apply(ctx, { maxTokens: 1000, maxSteps: 100, softRatio: 0.8 });
  ctx.sessionProjections.feed(MAIN, { type: 'setUsage', data: { totals: { uncachedInputTokens: 950, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  const steered = [];
  const agent = makeAgent('main', steered);
  ctx.handlers['agent/turn-stopping']({ agent });
  ctx.handlers['agent/turn-stopping']({ agent });
  assertEqual(steered.length, 1, '只应提醒一次');
});
t('步数超阈值也能触发', async () => {
  const ctx = mockCtx(); withTokenUsage(ctx, 0);
  apply(ctx, { maxTokens: 1000000, maxSteps: 2, softRatio: 1.0 });
  ctx.sessionProjections.feed(MAIN, TOOL('read'));
  ctx.sessionProjections.feed(MAIN, TOOL('read'));
  const steered = [];
  ctx.handlers['agent/turn-stopping']({ agent: makeAgent('main', steered) });
  assertEqual(steered.length, 1);
  assertTrue(steered[0].content[0].text.includes('步数'), '应报步数口径');
});
t('enabled=false：完全不动作', async () => {
  const ctx = mockCtx(); withTokenUsage(ctx, 0);
  apply(ctx, { enabled: false, maxTokens: 1, softRatio: 0 });
  ctx.sessionProjections.feed(MAIN, { type: 'setUsage', data: { totals: { uncachedInputTokens: 999, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  const steered = [];
  ctx.handlers['agent/turn-stopping']({ agent: makeAgent('main', steered) });
  assertEqual(steered.length, 0);
});
t('fail-open：畸形 agent 不抛异常', async () => {
  const ctx = mockCtx(); apply(ctx, {});
  let threw = false;
  try { ctx.handlers['agent/turn-stopping']({ agent: null }); } catch { threw = true; }
  assertTrue(!threw, '不应抛异常');
});
t('Config 默认值齐备', () => {
  assertEqual(Config({}).maxTokens, 1_000_000);
  assertEqual(Config({}).maxSteps, 200);
  assertEqual(Config({}).softRatio, 0.8);
  assertEqual(Config({}).enabled, true);
});

console.log(`\n通过 ${passed} 项${failed ? `（失败 ${failed}）` : ''}`);
