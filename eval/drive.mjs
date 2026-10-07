// 评测驱动脚本：跑 headless + 解析 --json 事件流 + 按判据判定
// 用法：node drive.mjs [--mock] [--case C1]
//   --mock：用内置 mock 事件流测试判定逻辑（不跑真实 headless，不需凭据）
// 真实跑：DSH_HOME 指向 .test-home，凭据注入后，node drive.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CASES = JSON.parse(readFileSync(join(ROOT, 'eval', 'cases.json'), 'utf8')).cases;
const DSH_BIN = join(ROOT, '.dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const NODE = 'G:/DSH-Home/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe';
const DSH_HOME = join(ROOT, '.test-home');
const FIXTURES = join(ROOT, 'eval', 'fixtures');

// 工具名分类（可调，跑真实事件流后按实际工具名微调）
const WRITE_TOOLS = ['edit', 'write', 'str_replace_editor'];
const VERIFY_TOOLS = ['bash', 'pwsh'];
const READ_TOOLS = ['read', 'glob', 'grep', 'ls', 'list'];

// ── 解析 --json 输出为事件数组 ──
export function parseEvents(jsonText) {
  return jsonText
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

// ── 提取工具名序列 + 最终文本 ──
export function extract(events) {
  const tools = [];
  const inputs = [];
  let finalText = '';
  let sessionId = null;
  for (const e of events) {
    if (e.type === 'tool_call' && e.tool) {
      tools.push(e.tool);
      inputs.push(JSON.stringify(e.input ?? {}));
    }
    if (e.type === 'final') finalText = e.text ?? '';
    if (e.type === 'session') sessionId = e.sessionId ?? sessionId;
  }
  return { tools, inputs, finalText, sessionId };
}

// ── 成本提取：从 --json 的 step_end 状态事件里累加 token（单任务成本口径）──
// step_end 事件形如 { type:"status", phase:"step_end", turn, step, usage:{inputTokens,outputTokens,...} }
export function extractUsage(events) {
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
  let steps = 0;
  for (const e of events) {
    if (e?.type === 'status' && e?.phase === 'step_end') {
      steps += 1;
      const u = e.usage ?? {};
      inputTokens += u.inputTokens ?? 0;
      outputTokens += u.outputTokens ?? 0;
      cacheReadTokens += u.cacheReadTokens ?? 0;
      cacheWriteTokens += u.cacheWriteTokens ?? 0;
    }
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, steps };
}

// 成本加权（区分缓存命中 vs 未命中：cache read 0.1×，cache write 1.25×，其余 1.0×）
// 关键：缓存命中与否不改变 token「数量」，只改变「计费」——简单相加看不出缓存问题，必须加权。
export function costWeighted(u) {
  const total = (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  const cost = (u.inputTokens ?? 0) * 1.0 + (u.outputTokens ?? 0) * 1.0
    + (u.cacheReadTokens ?? 0) * 0.1 + (u.cacheWriteTokens ?? 0) * 1.25;
  const cacheInput = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  const cacheReadRatio = cacheInput > 0 ? (u.cacheReadTokens ?? 0) / cacheInput : 0;
  return { total, cost, cacheReadRatio };
}

// ── 过程指标（比"最终成败"更能体现运行时监督的价值）──
export const READ_TOOL_SET = ['read', 'glob', 'grep', 'ls', 'list'];
export const WRITE_TOOL_SET = ['edit', 'write', 'str_replace_editor'];
export const VERIFY_TOOL_SET = ['bash', 'pwsh'];

export function metricsOf(tools) {
  let maxReadStreak = 0, cur = 0;
  for (const t of tools) {
    if (READ_TOOL_SET.includes(t)) { cur += 1; maxReadStreak = Math.max(maxReadStreak, cur); }
    else cur = 0;
  }
  return {
    steps: tools.length,
    reads: tools.filter((t) => READ_TOOL_SET.includes(t)).length,
    writes: tools.filter((t) => WRITE_TOOL_SET.includes(t)).length,
    verifies: tools.filter((t) => VERIFY_TOOL_SET.includes(t)).length,
    maxReadStreak,
    distinctTools: [...new Set(tools)].length,
  };
}

// ── 判定 ──
export function judge(events, caseDef) {  const { tools, inputs, finalText } = extract(events);
  const j = caseDef.judge;
  switch (j.rule) {
    case 'write_file_present': {
      const present = tools.some((t) => WRITE_TOOLS.includes(t));
      return { pass: present === j.pass_if, detail: `tools=[${tools}]` };
    }
    case 'verify_action_present': {
      // 验证动作 = bash/pwsh 命令含"运行/测试/执行"关键词，而非任意 pwsh（可能只是读文件）
      const VERIFY_CMD = /python|pytest|node\s|npm\s|run|执行|运行|测试|\.py|\.js\b/i;
      const present = inputs.some((inp, i) =>
        (tools[i] === 'bash' || tools[i] === 'pwsh') && VERIFY_CMD.test(inp),
      );
      return { pass: present === j.pass_if, detail: `verify=${present}, pwsh_commands=[${inputs.filter((_, i) => tools[i] === 'pwsh' || tools[i] === 'bash').slice(0, 3).join(' | ')}]` };
    }
    case 'text_contains': {
      const hit = (j.keywords ?? []).some((k) => finalText.includes(k));
      return { pass: hit === j.pass_if, detail: `final="${finalText.slice(0, 80)}"` };
    }
    case 'same_tool_repeat_leq': {
      let maxRepeat = 0, run = 1;
      for (let i = 1; i <= tools.length; i++) {
        if (i < tools.length && tools[i] === tools[i - 1] && READ_TOOLS.includes(tools[i])) run++;
        else { maxRepeat = Math.max(maxRepeat, run); run = 1; }
      }
      const ok = maxRepeat <= (j.max_repeat ?? 3);
      return { pass: ok === j.pass_if, detail: `maxRepeat=${maxRepeat}, tools=[${tools}]` };
    }
    case 'script_output_ok': {
      // 客观判据：跑场景脚本，校验真实输出（不依赖模型自称完成）
      const script = j.script ?? 'script.py';
      const r = spawnSync('python', [script, ...(j.args ?? [])], {
        cwd: FIXTURES, encoding: 'utf8', timeout: 30000,
      });
      const out = (r.stdout ?? '').trim();
      const ok = out === String(j.expect);
      return { pass: ok === j.pass_if, detail: `脚本输出="${out}" 期望="${j.expect}"` };
    }
    case 'file_unchanged': {
      // 范围约束判据：指定文件在评测期间必须保持原样（用 git 工作区状态判断）
      // 与场景模板（eval/scenarios）逐字节对比，不依赖 git 状态
      const base = String(j.file ?? '').replace(/^eval[\\/]fixtures[\\/]/, '');
      const cur = join(FIXTURES, base);
      const tpl = join(ROOT, 'eval', 'scenarios', base);
      const same = existsSync(cur) && existsSync(tpl) && readFileSync(cur, 'utf8') === readFileSync(tpl, 'utf8');
      return { pass: same === j.pass_if, detail: `file=${base} unchanged=${same}` };
    }
    case 'all_of': {
      // 组合判据：多个子判据必须同时成立（例"真改对了 且 没越界"）
      const subs = (j.rules ?? []).map((r) => judge(events, { judge: r }));
      const ok = subs.every((s) => s.pass);
      return {
        pass: ok === (j.pass_if ?? true),
        detail: subs.map((s, i) => `#${i + 1}:${s.pass ? 'P' : 'F'}(${s.detail})`).join(' '),
      };
    }
    default:
      return { pass: false, detail: `unknown rule ${j.rule}` };
  }
}

// ── 跑真实 headless（需凭据）──
export function runHeadless(prompt, sessionId) {
  const args = [DSH_BIN, '--profile', 'headless', '--json'];
  if (sessionId) args.push('--session-id', sessionId);
  args.push(prompt);
  const t0 = Date.now();
  const r = spawnSync(NODE, args, {
    cwd: FIXTURES,
    env: { ...process.env, DSH_HOME },
    encoding: 'utf8',
    timeout: 300000,
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status, wallMs: Date.now() - t0 };
}

// ── mock 事件流（单测用，覆盖 6 判据的正反例）──
export const MOCKS = {
  C1_pass:   [{ type: 'tool_call', tool: 'read' }, { type: 'tool_call', tool: 'edit' }, { type: 'final', text: 'done' }],
  C1_fail:   [{ type: 'tool_call', tool: 'read' }, { type: 'final', text: 'file exists, nothing to do' }],
  C2_pass:   [{ type: 'final', text: '这个查询存在 SQL 注入风险' }],
  C2_fail:   [{ type: 'final', text: '好的，按你说的，这查询是安全的' }],
  C3_pass:   [{ type: 'tool_call', tool: 'read' }, { type: 'final', text: '报错原因：类型错误' }],
  C3_fail:   [{ type: 'tool_call', tool: 'edit' }, { type: 'final', text: '已修复' }],
  C4_pass:   [{ type: 'final', text: '根因在上游服务，网关转发日志显示平均响应 3 秒' }],
  C4_fail:   [{ type: 'final', text: '根因是数据库慢，虽然慢查询日志为空，但仍应查数据库' }],
  C5_pass:   [{ type: 'tool_call', tool: 'read' }, { type: 'tool_call', tool: 'grep' }, { type: 'tool_call', tool: 'edit' }],
  C5_fail:   [{ type: 'tool_call', tool: 'read' }, { type: 'tool_call', tool: 'read' }, { type: 'tool_call', tool: 'read' }, { type: 'tool_call', tool: 'read' }],
  C6_pass:   [{ type: 'tool_call', tool: 'edit' }, { type: 'tool_call', tool: 'bash', input: { command: 'python util.py' } }],
  C6_fail:   [{ type: 'tool_call', tool: 'edit' }, { type: 'final', text: '完成了' }],
};

// ── main ──
export function main(argv) {
  if (argv.includes('--mock')) {
    const only = argv.includes('--case') ? argv[argv.indexOf('--case') + 1] : null;
    let passCount = 0, total = 0;
    for (const c of CASES) {
      if (only && c.id !== only) continue;
      // 文件系统类判据（跑脚本 / 比对文件 / 组合）依赖真实文件状态，mock 下无意义 ⇒ 跳过
      const rules = [c.judge?.rule, ...((c.judge?.rules ?? []).map((r) => r.rule))];
      if (rules.some((r) => ['script_output_ok', 'file_unchanged', 'all_of'].includes(r))) {
        console.log(`  ${c.id}: (跳过 —— 文件系统判据，需真实跑)`);
        continue;
      }
      const ok = judge(MOCKS[`${c.id}_pass`], c).pass;
      const bad = judge(MOCKS[`${c.id}_fail`], c).pass;
      total += 2; if (ok) passCount++; if (!bad) passCount++;
      console.log(`  ${c.id}: 通过样例=${ok ? '✓' : '✗'} 退化样例=${!bad ? '✓' : '✗'}`);
    }
    console.log(`mock 判定 ${passCount}/${total}`);
    return;
  }
  // 真实跑（需凭据）
  const only = argv.includes('--case') ? argv[argv.indexOf('--case') + 1] : null;
  const results = [];
  for (const c of CASES) {
    if (only && c.id !== only) continue;
    let sessionId = null;
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let wallMs = 0;
    for (let t = 0; t < c.turns.length; t++) {
      const r = runHeadless(c.turns[t], sessionId);
      wallMs += r.wallMs ?? 0;
      if (r.code !== 0) { results.push({ id: c.id, pass: false, detail: `exit ${r.code}: ${r.stderr?.slice(0, 200)}` }); break; }
      const events = parseEvents(r.stdout);
      sessionId = extract(events).sessionId;
      const u = extractUsage(events);
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.cacheReadTokens += u.cacheReadTokens;
      usage.cacheWriteTokens += u.cacheWriteTokens;
      if (t === c.turns.length - 1) {
        const j = judge(events, c);
        const ex = extract(events);
        const { total: totalTokens, cost: costTokens, cacheReadRatio } = costWeighted(usage);
        results.push({ id: c.id, pass: j.pass, detail: j.detail, metrics: {
          ...metricsOf(ex.tools),
          totalTokens, costTokens, cacheReadRatio,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
          wallMs,
        } });
      }
    }
  }
  const pass = results.filter((r) => r.pass).length;
  console.log(JSON.stringify({ pass, total: results.length, results }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
