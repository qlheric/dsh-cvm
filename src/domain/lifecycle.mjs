// 生命周期状态机（纯函数，可单测）
// 对应：阶段2-接口契约-最小闭环.md 第四节

export const PHASES = [
  'created',
  'analysis',
  'implementation',
  'verification',
  'delivery',
  'terminated',
];

export const TRANSITIONS = {
  created: ['analysis', 'terminated'],
  analysis: ['implementation', 'terminated'],
  implementation: ['verification', 'analysis', 'terminated'],
  verification: ['delivery', 'implementation', 'terminated'],
  delivery: ['terminated'],
  terminated: [],
};

export function canTransition(from, to) {
  if (!PHASES.includes(from) || !PHASES.includes(to)) return false;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`invalid lifecycle transition: ${from} -> ${to}`);
  }
  return to;
}

// 阶段语义：同一指标在不同阶段的解释（供阶段4 convergence 用）
// 例：编辑产出比 <10% 在 implementation 是异常、在 verification 是正常
export function phaseSemantics(phase) {
  return {
    created: '任务建立，契约待定义',
    analysis: '探索与定位，期望只读工具为主',
    implementation: '产出编辑，期望写文件动作',
    verification: '验证已有编辑，期望测试/核验动作，不期望新编辑',
    delivery: '收尾与验收，期望证据齐备',
    terminated: '已终止',
  }[phase];
}
