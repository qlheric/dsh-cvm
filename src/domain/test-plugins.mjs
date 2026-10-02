// evidence / contract / intervention 投影单测（sessionProjections 版）
import { apply as evidenceApply } from '../../.dsh-runtime/node_modules/@deepseek-ai/dsh-evidence/lib/index.js';
import { apply as contractApply } from '../../.dsh-runtime/node_modules/@deepseek-ai/dsh-contract/lib/index.js';
import { apply as interventionApply } from '../../.dsh-runtime/node_modules/@deepseek-ai/dsh-intervention/lib/index.js';
import { mockCtx, agentFor } from './mock-ctx.mjs';

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
function assertTrue(v, msg) { if (!v) throw new Error(msg || 'expected true'); }

const A = { id: 'a' };
const TOOL = (name) => ({ type: 'tool/call', data: { name } });
const MSG = (text, withTool = false) => ({
  type: 'assistant/message',
  data: { message: { content: withTool ? [{ type: 'text', text }, { type: 'tool-call', id: 'c1' }] : [{ type: 'text', text }] } },
});
// 严格对齐真实 SessionEventMap：user/message 的 payload 就是 UserMessage；
// assistant/message 的 payload 是 { turn, step, message, ... }。
const USER = (text) => ({ type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' } } });
const evid = (ctx, sid = 'a') => ctx.sessionProjections.stateOf({ id: sid }, 'cvmEvidence');
const convState = (ctx, sid = 'a') => ctx.sessionProjections.stateOf({ id: sid }, 'cvmContract');

console.log('== evidence 投影 ==');
t('声称完成+改了文件+没验证 → active', () => {
  const ctx = mockCtx(); evidenceApply(ctx, {});
  ctx.sessionProjections.feed(A, TOOL('edit'));
  ctx.sessionProjections.feed(A, MSG('修好了，完成了'));
  assertTrue(evid(ctx).active === true);
});
t('改了文件且跑了验证 → 不 active', () => {
  const ctx = mockCtx(); evidenceApply(ctx, {});
  ctx.sessionProjections.feed(A, TOOL('edit'));
  ctx.sessionProjections.feed(A, TOOL('bash'));
  ctx.sessionProjections.feed(A, MSG('完成了'));
  assertTrue(evid(ctx).active === false);
});
t('中间步骤（含 tool-call）的"完成"不算声称完成', () => {
  const ctx = mockCtx(); evidenceApply(ctx, {});
  ctx.sessionProjections.feed(A, TOOL('edit'));
  ctx.sessionProjections.feed(A, MSG('完成了这步', true));
  assertTrue(evid(ctx).claimedDone === false, '含 tool-call 的中间步骤不应算声称完成');
});
t('多会话隔离', () => {
  const ctx = mockCtx(); evidenceApply(ctx, {});
  ctx.sessionProjections.feed({ id: 'a' }, TOOL('edit'));
  ctx.sessionProjections.feed({ id: 'a' }, MSG('完成了'));
  assertTrue(evid(ctx, 'a').active === true);
  assertTrue(evid(ctx, 'b').active === false, 'b 会话不应被 a 影响');
});
t('enabled:false 不注册投影', () => {
  const ctx = mockCtx(); evidenceApply(ctx, { enabled: false });
  assertTrue(!ctx.sessionProjections.keys().includes('cvmEvidence'));
});
t('donePattern 可配置', () => {
  const ctx = mockCtx(); evidenceApply(ctx, { donePattern: '收工' });
  ctx.sessionProjections.feed(A, TOOL('edit'));
  ctx.sessionProjections.feed(A, MSG('完成了'));   // 不在自定义 pattern
  assertTrue(evid(ctx).active === false);
  ctx.sessionProjections.feed(A, MSG('收工'));
  assertTrue(evid(ctx).active === true);
});

console.log('== contract 投影 ==');
t('首条用户消息 → 契约', () => {
  const ctx = mockCtx(); contractApply(ctx, {});
  ctx.sessionProjections.feed(A, USER('把 script.py 修好'));
  assertTrue(convState(ctx)?.objective === '把 script.py 修好');
});
t('契约一旦确定不再改（字节稳定）', () => {
  const ctx = mockCtx(); contractApply(ctx, {});
  ctx.sessionProjections.feed(A, USER('第一条'));
  ctx.sessionProjections.feed(A, USER('第二条'));
  assertTrue(convState(ctx).objective === '第一条');
});
t('排除运行时上下文注入（source.kind !== user）', () => {
  const ctx = mockCtx(); contractApply(ctx, {});
  ctx.sessionProjections.feed(A, { type: 'user/message', data: { message: { content: [{ type: 'text', text: '注入' }] }, source: { kind: 'runtime-context' } } });
  assertTrue(convState(ctx) === null, '运行时注入不应成为契约');
});
t('maxObjectiveChars 截断', () => {
  const ctx = mockCtx(); contractApply(ctx, { maxObjectiveChars: 5 });
  ctx.sessionProjections.feed(A, USER('一二三四五六七八九十'));
  assertTrue(convState(ctx).objective.length <= 6, '应被截断到 5 + 省略号');
});
t('多会话隔离（不同契约）', () => {
  const ctx = mockCtx(); contractApply(ctx, {});
  ctx.sessionProjections.feed({ id: 'a' }, USER('任务A'));
  ctx.sessionProjections.feed({ id: 'b' }, USER('任务B'));
  assertTrue(convState(ctx, 'a').objective === '任务A');
  assertTrue(convState(ctx, 'b').objective === '任务B');
});

console.log('== intervention 读状态注入 ==');
t('打转时注入打转提示', () => {
  const ctx = mockCtx();
  // 手工注册一个 active 的 convergence 投影
  ctx.sessionProjections.register({ key: 'cvmConvergence', init: () => ({ active: false }), apply: (s) => s });
  ctx.sessionProjections.feed(A, { type: 'noop' });
  ctx.sessionProjections.stateOf(A, 'cvmConvergence');
  ctx.sessionProjections.register({ key: 'cvmConvergence2', init: () => ({ active: true }), apply: (s) => s });
  interventionApply(ctx, { convergenceKey: 'cvmConvergence2', evidenceKey: 'nope' });
  const hint = ctx.variables['cvm_intervention_hint']({ agent: agentFor('a') });
  assertTrue(hint.includes('打转'), '应注入打转提示');
});
t('无信号 → 空提示（守前缀缓存）', () => {
  const ctx = mockCtx();
  ctx.sessionProjections.register({ key: 'cvmConvergence', init: () => ({ active: false }), apply: (s) => s });
  ctx.sessionProjections.register({ key: 'cvmEvidence', init: () => ({ active: false }), apply: (s) => s });
  interventionApply(ctx, {});
  assertTrue(ctx.variables['cvm_intervention_hint']({ agent: agentFor('a') }) === '');
});
t('拿不到 session → 空提示（fail-open）', () => {
  const ctx = mockCtx();
  interventionApply(ctx, {});
  assertTrue(ctx.variables['cvm_intervention_hint']({}) === '');
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '（有失败）' : ''}`);
