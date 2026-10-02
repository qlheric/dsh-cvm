// 核心领域逻辑单测（node 直接跑，不依赖模型/环境）
import assert from 'node:assert/strict';
import { createContract, validateContract, checkContract, renderContract, bumpVersion } from './contract.mjs';
import { PHASES, TRANSITIONS, canTransition, assertTransition, phaseSemantics } from './lifecycle.mjs';
import { CvmRuntime } from './cvm-runtime.mjs';

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('== contract ==');
t('创建契约 + 校验', () => {
  const c = createContract({ objective: '让 script.py 正常工作', scope: ['script.py'], constraints: [], successCriteria: ['跑通测试'] });
  assert.equal(c.objective, '让 script.py 正常工作');
  assert.equal(c.version, 1);
});
t('非法契约被拒', () => {
  assert.throws(() => createContract({ objective: '  ' }));
  assert.throws(() => createContract({ objective: 'x', scope: [''] }));
});
t('偏离检测：要求停止/更换目标', () => {
  const c = createContract({ objective: '修复脚本' });
  assert.equal(checkContract(c, '不用做了，取消吧').deviates, true);
  assert.equal(checkContract(c, '换个任务，改成做报表').deviates, true);
  assert.equal(checkContract(c, '继续修复，先看报错').deviates, false);
});
t('投影字节稳定（同契约同文本）', () => {
  const c = createContract({ objective: 'A', scope: ['B'], constraints: ['C'], successCriteria: ['D'] });
  assert.equal(renderContract(c), renderContract(c));
  assert.ok(renderContract(c).includes('目标：A'));
  assert.ok(!renderContract(c).includes(String(Date.now())));
});
t('版本只在内容变化时递增', () => {
  const c = createContract({ objective: 'A' });
  const c2 = bumpVersion(c, { objective: 'B' });
  assert.equal(c2.version, 2);
  assert.equal(c2.objective, 'B');
});

console.log('== lifecycle ==');
t('合法转换', () => {
  assert.ok(canTransition('created', 'analysis'));
  assert.ok(canTransition('implementation', 'verification'));
  assert.ok(canTransition('implementation', 'analysis'));
});
t('非法转换被拒', () => {
  assert.equal(canTransition('created', 'implementation'), false);
  assert.equal(canTransition('terminated', 'analysis'), false);
  assert.throws(() => assertTransition('created', 'delivery'));
});
t('阶段语义', () => {
  assert.match(phaseSemantics('implementation'), /编辑/);
  assert.match(phaseSemantics('verification'), /验证/);
});

console.log('== cvm-runtime ==');
t('状态机驱动 + 契约对照 + 外环决策', () => {
  const r = new CvmRuntime();
  assert.equal(r.state.phase, 'created');
  r.setPhase('analysis');
  assert.equal(r.state.phase, 'analysis');
  r.setContract(createContract({ objective: '修复脚本' }));
  assert.equal(r.outerStep('继续，先看报错').kind, 'continue');
  assert.equal(r.outerStep('不用做了，取消吧').kind, 'halt');
});
t('纠正（非停止型偏离）', () => {
  const r = new CvmRuntime();
  r.setPhase('analysis');
  r.setContract(createContract({ objective: '修复脚本' }));
  const d = r.outerStep('换个目标，改成做报表');
  assert.equal(d.kind, 'correct');
});
t('投影渲染', () => {
  const r = new CvmRuntime();
  r.setContract(createContract({ objective: 'X', successCriteria: ['Y'] }));
  assert.ok(r.renderProjection().includes('目标：X'));
  assert.equal(r.renderProjection(), r.renderProjection());
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '（有失败）' : ''}`);
