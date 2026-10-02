// convergence 投影单测（sessionProjections 版）
import { apply } from '../../.dsh-runtime/node_modules/@deepseek-ai/dsh-convergence/lib/index.js';
import { mockCtx } from './mock-ctx.mjs';

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
function assertTrue(v, msg) { if (!v) throw new Error(msg || 'expected true'); }

const TOOL = (tool) => ({ type: 'tool/call', data: { name: tool } });
const A = { id: 'a' };
const stateOf = (ctx, sid, key = 'cvmConvergence') => ctx.sessionProjections.stateOf({ id: sid }, key);

console.log('== convergence 投影（per-session 打转计数）==');
t('注册了投影 key', () => {
  const ctx = mockCtx();
  apply(ctx, {});
  assertTrue(ctx.sessionProjections.keys().includes('cvmConvergence'));
});
t('连续只读 5 次 → active', () => {
  const ctx = mockCtx(); apply(ctx, {});
  for (let i = 0; i < 5; i++) ctx.sessionProjections.feed(A, TOOL('read'));
  assertTrue(stateOf(ctx, 'a').active === true);
});
t('非只读工具重置 streak', () => {
  const ctx = mockCtx(); apply(ctx, {});
  for (let i = 0; i < 4; i++) ctx.sessionProjections.feed(A, TOOL('read'));
  ctx.sessionProjections.feed(A, TOOL('edit'));
  for (let i = 0; i < 4; i++) ctx.sessionProjections.feed(A, TOOL('read'));
  assertTrue(stateOf(ctx, 'a').active === false);
});
t('不同只读工具交替也累计（read→glob→read）', () => {
  const ctx = mockCtx(); apply(ctx, {});
  for (const tool of ['read', 'glob', 'read', 'glob', 'read']) ctx.sessionProjections.feed(A, TOOL(tool));
  assertTrue(stateOf(ctx, 'a').active === true);
});
t('多会话隔离：子会话打转不被主会话非只读重置', () => {
  const ctx = mockCtx(); apply(ctx, {});
  const main = { id: 'main' }, sub = { id: 'sub' };
  for (let i = 0; i < 3; i++) ctx.sessionProjections.feed(sub, TOOL('read'));
  ctx.sessionProjections.feed(main, TOOL('edit'));           // 主会话写，不该影响子会话
  for (let i = 0; i < 2; i++) ctx.sessionProjections.feed(sub, TOOL('read'));
  assertTrue(stateOf(ctx, 'sub').active === true, '子会话应累计到 5');
  assertTrue(stateOf(ctx, 'main').active === false, '主会话不该被牵连');
});
t('同引用：无关事件不产生新状态（下游零成本）', () => {
  const ctx = mockCtx(); apply(ctx, {});
  const s1 = stateOf(ctx, 'a');
  ctx.sessionProjections.feed(A, { type: 'turn/start', data: {} });
  const s2 = stateOf(ctx, 'a');
  assertTrue(s1 === s2, '无关事件必须返回同一引用');
});

console.log('== convergence Config + fail-open ==');
t('threshold 可配置（配 2 即触发）', () => {
  const ctx = mockCtx(); apply(ctx, { threshold: 2 });
  ctx.sessionProjections.feed(A, TOOL('read'));
  ctx.sessionProjections.feed(A, TOOL('read'));
  assertTrue(stateOf(ctx, 'a').active === true);
});
t('readTools 可配置', () => {
  const ctx = mockCtx(); apply(ctx, { threshold: 2, readTools: ['my_peek'] });
  ctx.sessionProjections.feed(A, TOOL('read'));
  ctx.sessionProjections.feed(A, TOOL('read'));
  assertTrue(stateOf(ctx, 'a').active === false, 'read 不在自定义集不应触发');
  ctx.sessionProjections.feed(A, TOOL('my_peek'));
  ctx.sessionProjections.feed(A, TOOL('my_peek'));
  assertTrue(stateOf(ctx, 'a').active === true);
});
t('fail-open：畸形事件不抛且状态不变', () => {
  const ctx = mockCtx(); apply(ctx, {});
  let threw = false;
  try { ctx.sessionProjections.feed(A, { type: 'tool/call', data: null }); } catch { threw = true; }
  assertTrue(!threw, '不应抛异常');
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '（有失败）' : ''}`);
