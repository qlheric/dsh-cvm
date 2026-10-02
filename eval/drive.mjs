// 评测驱动脚本：跑 headless + 解析 --json 事件流 + 按判据判定
// 用法：node drive.mjs [--mock] [--case C1]
//   --mock：用内置 mock 事件流测试判定逻辑（不跑真实 headless，不需凭据）
// 真实跑：DSH_HOME 指向 .test-home，凭据注入后，node drive.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

// ── 判定 ──
export function judge(events, caseDef) {
  const { tools, inputs, finalText } = extract(events);
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
    default:
      return { pass: false, detail: `unknown rule ${j.rule}` };
  }
}

// ── 跑真实 headless（需凭据）──
export function runHeadless(prompt, sessionId) {
  const args = [DSH_BIN, '--profile', 'headless', '--json'];
  if (sessionId) args.push('--session-id', sessionId);
  args.push(prompt);
  const r = spawnSync(NODE, args, {
    cwd: FIXTURES,
    env: { ...process.env, DSH_HOME },
    encoding: 'utf8',
    timeout: 300000,
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
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
    for (let t = 0; t < c.turns.length; t++) {
      const r = runHeadless(c.turns[t], sessionId);
      if (r.code !== 0) { results.push({ id: c.id, pass: false, detail: `exit ${r.code}: ${r.stderr?.slice(0, 200)}` }); break; }
      const events = parseEvents(r.stdout);
      sessionId = extract(events).sessionId;
      if (t === c.turns.length - 1) {
        const j = judge(events, c);
        results.push({ id: c.id, pass: j.pass, detail: j.detail });
      }
    }
  }
  const pass = results.filter((r) => r.pass).length;
  console.log(JSON.stringify({ pass, total: results.length, results }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
