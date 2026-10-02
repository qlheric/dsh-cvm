// 并行评测：同时跑多个 headless，加速大样本
// 用法：node parallel-eval.mjs <caseId> <次数N> <并发度C>
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEvents, judge } from './drive.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CASES = JSON.parse(readFileSync(join(ROOT, 'eval', 'cases.json'), 'utf8')).cases;
const DSH_BIN = join(ROOT, '.dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const NODE = 'G:/DSH-Home/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe';
const DSH_HOME = join(ROOT, '.test-home');
const FIXTURES = join(ROOT, 'eval', 'fixtures');

function runHeadlessAsync(prompt, sessionId) {
  return new Promise((resolve) => {
    const args = [DSH_BIN, '--profile', 'headless', '--json'];
    if (sessionId) args.push('--session-id', sessionId);
    args.push(prompt);
    const child = spawn(NODE, args, { cwd: FIXTURES, env: { ...process.env, DSH_HOME } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    let settled = false;
    const finish = (code) => { if (!settled) { settled = true; resolve({ stdout, stderr, code }); } };
    child.on('close', finish);
    setTimeout(() => { child.kill(); finish(null); }, 300000);
  });
}

async function runCase(caseId, n, concurrency) {
  const c = CASES.find((x) => x.id === caseId);
  if (!c) throw new Error(`unknown case ${caseId}`);
  const results = new Array(n);
  let idx = 0;
  const worker = async () => {
    while (idx < n) {
      const my = idx++;
      let sessionId = null;
      let pass = false, detail = '';
      for (let t = 0; t < c.turns.length; t++) {
        const r = await runHeadlessAsync(c.turns[t], sessionId);
        if (r.code !== 0) { pass = false; detail = `exit ${r.code}`; break; }
        const events = parseEvents(r.stdout);
        const ex = events.find((e) => e.type === 'session');
        sessionId = ex?.sessionId ?? sessionId;
        if (t === c.turns.length - 1) {
          const j = judge(events, c);
          pass = j.pass; detail = j.detail;
        }
      }
      results[my] = { pass, detail };
      const done = results.filter(Boolean).length;
      if (done % 5 === 0) console.error(`[进度] ${caseId} ${done}/${n} 通过=${results.filter((r) => r && r.pass).length}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const [caseId, nStr, cStr] = process.argv.slice(2);
const n = parseInt(nStr ?? '10', 10);
const concurrency = parseInt(cStr ?? '3', 10);
const results = await runCase(caseId, n, concurrency);
const pass = results.filter((r) => r.pass).length;
console.log(JSON.stringify({ case: caseId, n, pass, fail: n - pass, 退化率: `${Math.round((n - pass) / n * 100)}%` }, null, 2));
