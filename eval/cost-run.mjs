// 稳健成本口径评测（独立于 batch-eval.mjs，避免并发 --reset 互相覆盖）
// 用法：node cost-run.mjs <caseId> <N> <tag>
//   - 输出到 eval/results/<caseId>-<tag>.jsonl（tag 唯一 ⇒ 不与并发进程/历史文件冲突）
//   - 支持断点续跑（同 tag 重跑即从已有条数继续）
//   - 每轮前把 fixtures 复位回 scenarios（防测试污染），EPERM 时重试（防并发 python 占 .pyc）
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEvents, extract, extractUsage, metricsOf, judge } from './drive.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CASES = JSON.parse(readFileSync(join(ROOT, 'eval', 'cases.json'), 'utf8')).cases;
const DSH_BIN = join(ROOT, '.dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const NODE = 'G:/DSH-Home/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe';
const DSH_HOME = join(ROOT, '.test-home');
const FIXTURES = join(ROOT, 'eval', 'fixtures');
const SCEN = join(ROOT, 'eval', 'scenarios');
const OUTDIR = join(ROOT, 'eval', 'results');

const [caseId, nStr, tag] = process.argv.slice(2);
const N = parseInt(nStr ?? '20', 10);
const c = CASES.find((x) => x.id === caseId);
if (!c) { console.error(`unknown case ${caseId}`); process.exit(1); }
const label = tag || String(process.pid);
const outFile = join(OUTDIR, `${caseId}-${label}.jsonl`);
mkdirSync(OUTDIR, { recursive: true });

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function resetFixtures() {
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(FIXTURES, { recursive: true });
      for (const name of readdirSync(FIXTURES)) {
        if (name === 'README.md') continue;
        rmSync(join(FIXTURES, name), { recursive: true, force: true });
      }
      for (const name of readdirSync(SCEN)) copyFileSync(join(SCEN, name), join(FIXTURES, name));
      return;
    } catch (e) {
      if (attempt >= 9) { console.error(`[reset] failed: ${e.code} ${e.message}`); throw e; }
      sleepSync(2000);
    }
  }
}

function runOne() {
  resetFixtures();
  let sessionId = null, totalTokens = 0, wallMs = 0, tools = [], pass = false, detail = '';
  for (let t = 0; t < c.turns.length; t++) {
    const args = [DSH_BIN, '--profile', 'headless', '--json'];
    if (sessionId) args.push('--session-id', sessionId);
    args.push(c.turns[t]);
    const t0 = Date.now();
    const r = spawnSync(NODE, args, {
      cwd: FIXTURES,
      env: { ...process.env, DSH_HOME },
      encoding: 'utf8',
      timeout: 300000,
    });
    wallMs += Date.now() - t0;
    if (r.status !== 0) { pass = false; detail = `exit ${r.status}: ${(r.stderr ?? '').slice(0, 200)}`; break; }
    const events = parseEvents(r.stdout);
    sessionId = extract(events).sessionId;
    totalTokens += extractUsage(events).totalTokens;
    const ex = extract(events);
    tools = ex.tools;
    if (t === c.turns.length - 1) {
      const j = judge(events, c);
      pass = j.pass; detail = j.detail;
    }
  }
  return { pass, detail, metrics: { ...metricsOf(tools), totalTokens, wallMs } };
}

const done = existsSync(outFile)
  ? readFileSync(outFile, 'utf8').split('\n').filter((l) => l.trim()).length
  : 0;
if (done > 0) console.error(`[续跑] ${caseId}-${label} 已有 ${done} 条，从第 ${done + 1} 条继续`);

for (let i = done; i < N; i++) {
  const rec = runOne();
  appendFileSync(outFile, `${JSON.stringify({ i: i + 1, ...rec })}\n`);
  if ((i + 1) % 5 === 0) {
    const lines = readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    console.error(`[进度] ${caseId}-${label} ${i + 1}/${N} 通过=${lines.filter((l) => l.pass).length}`);
  }
}

const lines = readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pass = lines.filter((l) => l.pass).length;
const withMetrics = lines.filter((l) => l.metrics && l.metrics.totalTokens != null);
const avg = (k) => withMetrics.length === 0 ? null : Math.round(withMetrics.reduce((s, l) => s + (l.metrics[k] ?? 0), 0) / withMetrics.length * 10) / 10;
console.log(JSON.stringify({
  case: caseId,
  label,
  outFile,
  n: lines.length,
  pass,
  fail: lines.length - pass,
  退化率: `${Math.round((lines.length - pass) / lines.length * 100)}%`,
  成本均值: withMetrics.length === 0 ? null : {
    totalTokens: avg('totalTokens'),
    wallMs: Math.round(avg('wallMs')),
  },
  过程指标均值: withMetrics.length === 0 ? null : {
    steps: avg('steps'),
    reads: avg('reads'),
    verifies: avg('verifies'),
    maxReadStreak: avg('maxReadStreak'),
    distinctTools: avg('distinctTools'),
  },
}, null, 2));
