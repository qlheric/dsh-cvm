// convergence 按 session 区分 streak 的纯逻辑单测（不跑慢 headless）
import { apply } from '../../.dsh-runtime/node_modules/@deepseek-ai/dsh-convergence/lib/index.js';

function mockCtx() {
  const handlers = {};
  const signals = [];
  return {
    on(event, handler) { handlers[event] = handler; },
    emit(event, payload) { signals.push(payload); },
    handlers, signals,
  };
}

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const READ = (sid, tool) => ({ type: 'tool/call', data: { name: tool } });
const lastActive = (ctx) => ctx.signals[ctx.signals.length - 1];

console.log('== convergence 按 session 区分 streak ==');
t('单 session 连续只读 5 次触发', () => {
  const ctx = mockCtx();
  apply(ctx, {});
  const h = ctx.handlers['session/event'];
  for (let i = 0; i < 5; i++) h({ id: 'a' }, READ('a', 'read'));
  assertTrue(lastActive(ctx)?.active === true);
});
t('非只读工具重置 streak', () => {
  const ctx = mockCtx();
  apply(ctx, {});
  const h = ctx.handlers['session/event'];
  for (let i = 0; i < 4; i++) h({ id: 'a' }, READ('a', 'read'));
  h({ id: 'a' }, READ('a', 'edit')); // 非只读重置
  for (let i = 0; i < 4; i++) h({ id: 'a' }, READ('a', 'read'));
  assertTrue(ctx.signals.length === 0); // 被 edit 分成 4+4，没到 5，未触发
});
t('不同只读工具交替也累计（read→glob→read）', () => {
  const ctx = mockCtx();
  apply(ctx, {});
  const h = ctx.handlers['session/event'];
  const seq = ['read', 'glob', 'read', 'glob', 'read'];
  for (const tool of seq) h({ id: 'a' }, READ('a', tool));
  assertTrue(lastActive(ctx)?.active === true); // 5 次只读（交替）触发
});
t('子会话打转不被主会话非只读重置（补盲区）', () => {
  const ctx = mockCtx();
  apply(ctx, {});
  const h = ctx.handlers['session/event'];
  // 子会话连续只读
  for (let i = 0; i < 3; i++) h({ id: 'sub' }, READ('sub', 'read'));
  // 主会话写文件（不应重置子会话 streak）
  h({ id: 'main' }, READ('main', 'edit'));
  for (let i = 0; i < 2; i++) h({ id: 'sub' }, READ('sub', 'read'));
  assertTrue(lastActive(ctx)?.active === true); // 子会话累计到 5，触发
});

function assertTrue(v) { if (!v) throw new Error('expected true, got ' + v); }
console.log(`\n通过 ${passed} 项${process.exitCode ? '（有失败）' : ''}`);
