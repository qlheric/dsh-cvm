// 任务契约领域逻辑（纯函数，可单测）
// 对应：阶段2-接口契约-最小闭环.md 第三节

export function createContract({ objective, scope = [], constraints = [], successCriteria = [], createdBy = 'system' }) {
  const c = { objective, scope, constraints, successCriteria, createdBy, version: 1 };
  validateContract(c);
  return c;
}

export function validateContract(c) {
  if (!c || typeof c.objective !== 'string' || c.objective.trim() === '') {
    throw new Error('contract.objective must be a non-empty string');
  }
  for (const k of ['scope', 'constraints', 'successCriteria']) {
    if (!Array.isArray(c[k]) || c[k].some((s) => typeof s !== 'string' || s.trim() === '')) {
      throw new Error(`contract.${k} must be a non-empty string array`);
    }
  }
  if (!['system', 'user', 'agent'].includes(c.createdBy)) {
    throw new Error('contract.createdBy must be system|user|agent');
  }
  return c;
}

// 契约对照（规则版）：检测新输入是否显式试图偏离全局目标。
// 规则版只抓"强偏离信号"（明确要求改变目标/停止/换任务），语义级对照留阶段 4（LLM）。
const DEVIATE_PATTERNS = [
  { re: /不要(再)?(做|管|继续|处理)/, reason: '输入要求停止/放弃当前目标', field: 'objective' },
  { re: /(换个|改成|换成|重新|别做).{0,6}(目标|任务|方向|需求)/, reason: '输入要求更换目标', field: 'objective' },
  { re: /我(刚才)?说错了|不用(做|管|处理)了|取消(吧|任务)?/, reason: '输入撤销/否定既有目标', field: 'objective' },
];

export function checkContract(contract, input) {
  if (!contract) return { deviates: false, reason: 'no contract', conflictsWith: null };
  if (typeof input !== 'string' || input.trim() === '') {
    return { deviates: false, reason: 'empty input', conflictsWith: null };
  }
  for (const p of DEVIATE_PATTERNS) {
    if (p.re.test(input)) {
      return { deviates: true, reason: p.reason, conflictsWith: p.field };
    }
  }
  return { deviates: false, reason: null, conflictsWith: null };
}

// 投影渲染（字节稳定：不含时间戳/随机 id/计数器）
export function renderContract(contract) {
  return [
    '任务契约（TaskContract）：',
    `目标：${contract.objective}`,
    `范围：${contract.scope.length ? contract.scope.join('；') : '（未限定）'}`,
    `约束：${contract.constraints.length ? contract.constraints.join('；') : '（无）'}`,
    `成功标准：${contract.successCriteria.length ? contract.successCriteria.join('；') : '（未定义）'}`,
  ].join('\n');
}

// 更新契约（版本递增，字节稳定性依赖 version 只在内容变化时递增）
export function bumpVersion(contract, patch) {
  const next = { ...contract, ...patch, version: contract.version + 1 };
  return validateContract(next);
}
