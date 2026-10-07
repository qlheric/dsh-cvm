// 成本汇总：读 C5-A/B.jsonl，对比「单任务成本」（totalTokens + 墙钟时间）分布
// 用法：node eval/cost-summary.mjs [caseId]  （默认 C5）
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(__dirname, 'results');
const caseId = process.argv[2] ?? 'C5';

// 混合单价（元/百万 token），倒推自老大 DeepSeek API 账单：206 亿 token ≈ ¥3054 ⇒ ¥0.148/百万。
// 这是"输入+输出+cache"混合口径，仅作粗略换算，非精确计费。
const CNY_PER_MTOK = 0.148;

function load(label) {
  const f = join(RESULTS, `${caseId}-${label}.jsonl`);
  if (!existsSync(f)) return null;
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function stats(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const sum = a.reduce((s, x) => s + x, 0);
  const mean = sum / a.length;
  const median = a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  return { n: a.length, mean, median, p90: q(0.9), max: a[a.length - 1], min: a[0], sum };
}

const fmtTok = (v) => Math.round(v).toLocaleString('en-US');
const fmtMin = (v) => (v / 60000).toFixed(1) + 'min';
const fmtYuan = (v) => '¥' + (v).toFixed(2);

function block(label, rows) {
  if (!rows) { console.log(`\n== ${label} ==\n  （无数据）`); return null; }
  const pass = rows.filter((r) => r.pass).length;
  const tok = stats(rows.map((r) => r.metrics?.totalTokens));
  const cost = stats(rows.map((r) => r.metrics?.costTokens));
  const crr = stats(rows.map((r) => r.metrics?.cacheReadRatio));
  const ms = stats(rows.map((r) => r.metrics?.wallMs));
  const streak = stats(rows.map((r) => r.metrics?.maxReadStreak));
  console.log(`\n== ${label} (n=${rows.length}, 通过 ${pass}/${rows.length}) ==`);
  console.log(`  totalTokens(简单) mean=${fmtTok(tok.mean)} median=${fmtTok(tok.median)} p90=${fmtTok(tok.p90)}`);
  console.log(`  costTokens(加权)  mean=${fmtTok(cost.mean)} median=${fmtTok(cost.median)} p90=${fmtTok(cost.p90)}`);
  console.log(`  cacheReadRatio    mean=${(crr.mean * 100).toFixed(1)}% median=${(crr.median * 100).toFixed(1)}%`);
  console.log(`  wallMs            mean=${fmtMin(ms.mean)} median=${fmtMin(ms.median)} max=${fmtMin(ms.max)}`);
  console.log(`  maxReadStreak     mean=${streak.mean.toFixed(1)} median=${streak.median} p90=${streak.p90} max=${streak.max}`);
  return { tok, cost, crr, ms, streak, pass, n: rows.length };
}

const A = load('A');
const B = load('B');
const sA = block('A 基线（无插件）', A);
const sB = block('B 四插件', B);

if (sA && sB) {
  const delta = (a, b) => (a && b && a !== 0 ? (((b - a) / a) * 100).toFixed(1) + '%' : 'n/a');
  console.log('\n== 降幅（B 相对 A，负 = 降） ==');
  console.log(`  totalTokens(简单) mean ${delta(sA.tok.mean, sB.tok.mean)}  median ${delta(sA.tok.median, sB.tok.median)}  p90 ${delta(sA.tok.p90, sB.tok.p90)}`);
  console.log(`  costTokens(加权)  mean ${delta(sA.cost.mean, sB.cost.mean)}  median ${delta(sA.cost.median, sB.cost.median)}`);
  console.log(`  cacheReadRatio    A ${(sA.crr.mean * 100).toFixed(1)}% → B ${(sB.crr.mean * 100).toFixed(1)}%  (${delta(sA.crr.mean, sB.crr.mean)})`);
  console.log(`  wallMs            mean ${delta(sA.ms.mean, sB.ms.mean)}  median ${delta(sA.ms.median, sB.ms.median)}`);
  console.log(`  maxReadStreak     mean ${delta(sA.streak.mean, sB.streak.mean)}  median ${delta(sA.streak.median, sB.streak.median)}`);

  // 归因判断：缓存命中率是否显著下降
  const crrRel = sB.crr.mean / (sA.crr.mean || 1);
  console.log('\n== 归因 ==');
  if (crrRel < 0.85) {
    console.log(`  → 缓存命中率下降 >15%（${(sA.crr.mean * 100).toFixed(1)}% → ${(sB.crr.mean * 100).toFixed(1)}%）⇒ 缓存失效是成本上升主因`);
  } else {
    console.log(`  → 缓存命中率变化不大（${(sA.crr.mean * 100).toFixed(1)}% → ${(sB.crr.mean * 100).toFixed(1)}%）⇒ 成本上升是「轨迹变长」，不是缓存失效`);
  }
}
