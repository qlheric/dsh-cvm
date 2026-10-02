// evidence + intervention 插件的纯逻辑单测（mock ctx）
import { apply as evidenceApply } from '../../.dsh-runtime/node_modules/@deepseek-ai/dsh-evidence/lib/index.js';
import { apply as interventionApply } from '../../.dsh-runtime/node_modules/@deepseek-ai/dsh-intervention/lib/index.js';

function mockCtx() {
  const handlers = {};
  const signals = [];
  const variables = {};
  const sections = [];
  const sp = {
    variable(name, fn) { variables[name] = fn; },
    section(opts) { sections.push(opts); },
  };
  return {
    on(event, handler) { handlers[event] = handler; },
    emit(event, payload) { signals.push(payload); },
    systemPrompt: sp,
    handlers, signals, variables, sections,
  };
}

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
function assertTrue(v, msg) { if (!v) throw new Error(msg || 'expected true'); }

console.log('== evidence ==');
t('声称完成+改了文件+没验证 → 触发终局门禁', () => {
  const ctx = mockCtx();
  evidenceApply(ctx, {});
  const h = ctx.handlers['session/event'];
  h({ id: 'a' }, { type: 'tool/call', data: { name: 'edit' } });            // wroteFile
  h({ id: 'a' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '修好了，完成了' }] } } }); // claimedDone（无 tool-call）
  assertTrue(ctx.signals.at(-1)?.active === true, '应触发 evidence active=true');
});
t('改了文件且跑了验证 → 不触发', () => {
  const ctx = mockCtx();
  evidenceApply(ctx, {});
  const h = ctx.handlers['session/event'];
  h({ id: 'a' }, { type: 'tool/call', data: { name: 'edit' } });
  h({ id: 'a' }, { type: 'tool/call', data: { name: 'bash' } });             // verified
  h({ id: 'a' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '完成了' }] } } });
  assertTrue(ctx.signals.length === 0 || ctx.signals.at(-1)?.active !== true, '验证过则不应触发');
});
t('中间步骤（含 tool-call）的"完成"不算声称完成', () => {
  const ctx = mockCtx();
  evidenceApply(ctx, {});
  const h = ctx.handlers['session/event'];
  h({ id: 'a' }, { type: 'tool/call', data: { name: 'edit' } });
  h({ id: 'a' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '完成了这步' }, { type: 'tool-call', id: 'c1' }] } } }); // 含 tool-call = 中间步骤
  assertTrue(ctx.signals.length === 0, '中间步骤不应触发终局门禁');
});

console.log('== intervention ==');
t('convergence 信号 → 注入打转提示', () => {
  const ctx = mockCtx();
  interventionApply(ctx, {});
  ctx.handlers['cvm/signal']({ kind: 'convergence', active: true });
  const hint = ctx.variables['cvm_intervention_hint']();
  assertTrue(hint.includes('打转'), '应注入打转提示');
});
t('convergence 优先于 evidence', () => {
  const ctx = mockCtx();
  interventionApply(ctx, {});
  ctx.handlers['cvm/signal']({ kind: 'convergence', active: true });
  ctx.handlers['cvm/signal']({ kind: 'evidence', active: true });
  const hint = ctx.variables['cvm_intervention_hint']();
  assertTrue(hint.includes('打转'), 'convergence 优先');
});
t('无信号 → 空提示（守缓存）', () => {
  const ctx = mockCtx();
  interventionApply(ctx, {});
  assertTrue(ctx.variables['cvm_intervention_hint']() === '', '无信号应为空');
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '（有失败）' : ''}`);
