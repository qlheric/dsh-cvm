// 插件单测基座：mock sessionProjections + systemPrompt（不跑慢 headless）
export function mockCtx() {
  const units = new Map();      // key -> { init, apply }
  const cells = new Map();      // sessionId -> { key: state }
  const variables = {};
  const sections = [];
  const warnings = [];

  const sessionProjections = {
    register(def) { units.set(def.key, def); },
    stateOf(session, key) {
      const unit = units.get(key);
      if (!unit) return undefined;
      const sid = session?.id ?? session;
      let cell = cells.get(sid);
      if (!cell) { cell = {}; cells.set(sid, cell); }
      if (!(key in cell)) cell[key] = unit.init();
      return cell[key];
    },
    /** 测试驱动：把一个事件喂给所有已注册 unit（模拟 eager drive）。 */
    feed(session, event) {
      const sid = session?.id ?? session;
      for (const [key, unit] of units) {
        const prev = this.stateOf(session, key);
        const next = unit.apply(prev, event);
        if (next !== prev) {
          let cell = cells.get(sid);
          if (!cell) { cell = {}; cells.set(sid, cell); }
          cell[key] = next;
        }
      }
    },
    keys() { return [...units.keys()]; },
  };

  return {
    sessionProjections,
    systemPrompt: {
      variable(name, provider) { variables[name] = provider; },
      section(opts) { sections.push(opts); },
    },
    logger: { warn(...args) { warnings.push(args); } },
    variables, sections, warnings,
  };
}

export const agentFor = (id) => ({ session: { id } });
