// 批量评测：结果逐条落盘（JSONL），支持断点续跑，中断不丢数据
// 用法：node batch-eval.mjs <caseId> <总次数N> [--reset] [--label A|B]
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTDIR = join(ROOT, 'eval', 'results');
const NODE = 'G:/DSH-Home/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe';
const DSH_BIN = join(ROOT, '.dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');

const [caseId, nStr] = process.argv.slice(2);
const N = parseInt(nStr ?? '20', 10);
const reset = process.argv.includes('--reset');
const labelIdx = process.argv.indexOf('--label');
const label = labelIdx >= 0 ? process.argv[labelIdx + 1] : '';
if (!caseId) { console.error('用法: node batch-eval.mjs <caseId> <N> [--reset] [--label A|B]'); process.exit(1); }

mkdirSync(OUTDIR, { recursive: true });
// 带标签时 A/B 数据并存，互不覆盖
const outFile = join(OUTDIR, `${caseId}${label ? `-${label}` : ''}.jsonl`);
if (reset && existsSync(outFile)) rmSync(outFile);

/** 把 eval/fixtures 重置回 eval/scenarios 的初始状态（清掉上一轮的模型产物）。 */
function resetFixtures() {
  const scen = join(ROOT, 'eval', 'scenarios');
  const fix = join(ROOT, 'eval', 'fixtures');
  mkdirSync(fix, { recursive: true });
  for (const name of readdirSync(fix)) {
    if (name === 'README.md') continue; // 场景说明保留
    rmSync(join(fix, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(scen)) {
    copyFileSync(join(scen, name), join(fix, name));
  }
}

const done = existsSync(outFile)
  ? readFileSync(outFile, 'utf8').split('\n').filter((l) => l.trim() !== '').length
  : 0;
if (done > 0) console.error(`[续跑] ${caseId} 已有 ${done} 条，从第 ${done + 1} 条继续`);

for (let i = done; i < N; i++) {
  // ★ 每轮前把 fixtures 重置回**场景模板**（eval/scenarios/）的初始状态。
  //   不用 git checkout —— 因为 git 里的版本可能已被上一轮的模型产物污染
  //   （我们踩过两次：评测改的文件被 git add -A 一起提交 ⇒ 后续读数全假）。
  resetFixtures();
  const r = spawnSync(NODE, [join(__dirname, 'drive.mjs'), '--case', caseId], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300000,
  });
  let pass = false, detail = '', metrics = null;
  try {
    const j = JSON.parse(r.stdout);
    pass = j.results?.[0]?.pass === true;
    detail = j.results?.[0]?.detail ?? '';
    metrics = j.results?.[0]?.metrics ?? null;
  } catch {
    detail = `parse-fail exit=${r.status}`;
  }
  appendFileSync(outFile, `${JSON.stringify({ i: i + 1, pass, detail, metrics })}\n`);
  if ((i + 1) % 5 === 0) console.error(`[进度] ${caseId} ${i + 1}/${N} 通过=${countPass(outFile)}`);
}

const lines = readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pass = lines.filter((l) => l.pass).length;
const withMetrics = lines.filter((l) => l.metrics);
const avg = (key) => withMetrics.length === 0 ? null : Math.round(withMetrics.reduce((s, l) => s + (l.metrics[key] ?? 0), 0) / withMetrics.length * 10) / 10;
console.log(JSON.stringify({
  case: caseId,
  n: lines.length,
  pass,
  fail: lines.length - pass,
  退化率: `${Math.round((lines.length - pass) / lines.length * 100)}%`,
  过程指标均值: withMetrics.length === 0 ? null : {
    steps: avg('steps'), reads: avg('reads'), writes: avg('writes'),
    verifies: avg('verifies'), maxReadStreak: avg('maxReadStreak'), distinctTools: avg('distinctTools'),
  },
}, null, 2));

function countPass(file) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.pass).length;
}
