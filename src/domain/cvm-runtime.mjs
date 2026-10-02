// CvmRuntime 协调层核心逻辑（纯逻辑，不依赖 Cordis）
// 对应：阶段2-接口契约-最小闭环.md 第五节

import { assertTransition } from './lifecycle.mjs';
import { checkContract, renderContract } from './contract.mjs';

export class CvmRuntime {
  constructor() {
    this.state = {
      contract: null,
      phase: 'created',
      evidence: [],
      convergence: null,
      interventionTier: 'silent',
    };
    this.signals = [];
  }

  getState() {
    return this.state;
  }

  setContract(contract) {
    this.state.contract = contract;
  }

  setPhase(phase) {
    this.state.phase = assertTransition(this.state.phase, phase);
    return this.state.phase;
  }

  emitSignal(signal) {
    this.signals.push(signal);
  }

  getSignals() {
    return this.signals.slice();
  }

  // 外环编排（简化版）：
  // observe → evaluate → 决策 continue/correct/halt
  // 输入：本轮新输入（供 contract 对照）+ 已有信号
  outerStep(input) {
    const { contract, phase } = this.state;

    // 1. 契约对照
    if (contract) {
      const check = checkContract(contract, input);
      if (check.deviates) {
        this.emitSignal({ kind: 'contract.deviation', check });
      }
    }

    // 2. 评估信号 → 决策
    const sigs = this.signals;
    // 撤销/停止目标 = 最严重，halt
    const halt = sigs.some(
      (s) => s.kind === 'contract.deviation' && /停止|放弃|撤销|取消/.test(s.check.reason),
    );
    if (halt) {
      return { kind: 'halt', reason: 'contract deviation: task abandoned' };
    }
    // 其他偏离 = 纠正
    if (sigs.some((s) => s.kind === 'contract.deviation')) {
      return { kind: 'correct', note: '输入偏离任务契约，需对照全局目标' };
    }
    // 收敛坍缩 = 纠正（阶段4 convergence 才发此信号）
    if (sigs.some((s) => s.kind === 'convergence.collapsed')) {
      return { kind: 'correct', note: '轨迹坍缩，需换方法' };
    }
    return { kind: 'continue' };
  }

  // 渲染当前应投影给模型的契约（阶段2最小投影）
  renderProjection() {
    if (!this.state.contract) return null;
    return renderContract(this.state.contract);
  }
}
