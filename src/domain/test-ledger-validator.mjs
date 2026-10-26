// 覆盖账校验器自测（极简 t() 风格，照抄 test-budget.mjs 的房规；不引 node:test）
//
// 交付要求：必须含**阴性对照**——坏账必须被抓住，不许"永远绿"。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  validateLedger,
  isValidCoverageId,
  readAndValidateLedger,
  STATUSES,
  PRIOR_STATUSES,
} from './ledger-validator.mjs';

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n     ${e.message}`); process.exitCode = 1; }
}
function assertTrue(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
function assertEqual(a, b, msg = '') { if (a !== b) throw new Error(`${msg} 期望 ${b}，实际 ${a}`); }

/** 造一个合法单元。 */
function unit(over = {}) {
  return {
    coverage_id: 'file%20read::workspace::dsh-cvm::traversal',
    surface: 'file read',
    boundary: 'workspace',
    subsystem: 'dsh-cvm',
    attack_class: 'traversal',
    status: 'covered',
    agent_id: 'agent-1',
    reviewed_paths: ['src/domain/ledger-validator.mjs'],
    local_checks: ['node src/domain/test-ledger-validator.mjs'],
    result_fingerprints: [],
    unresolved: [],
    prior_status: 'new',
    attempts: [],
    ...over,
  };
}
/** 造一份合法账本。 */
function ledger(units = [unit()]) {
  return { version: 1, generated_by: 'deterministic', units };
}

console.log('== 正例 ==');
t('合法账通过', () => {
  const r = validateLedger(ledger());
  assertTrue(r.ok, `应通过，实际报错: ${r.errors.join(' | ')}`);
});
t('planned 态（无 owner / 无证据）通过', () => {
  const u = unit({
    coverage_id: 'a::b::c::d',
    status: 'planned',
    agent_id: null,
    reviewed_paths: [],
    local_checks: [],
    result_fingerprints: [],
    unresolved: [],
  });
  const r = validateLedger(ledger([u]));
  assertTrue(r.ok, r.errors.join(' | '));
});
t('multiple units 按 id 升序通过', () => {
  const r = validateLedger(ledger([
    unit({ coverage_id: 'a::b::c::d' }),
    unit({ coverage_id: 'b::b::c::d' }),
  ]));
  assertTrue(r.ok, r.errors.join(' | '));
});

console.log('== 反例（阴性对照：坏账必须被抓住）==');
t('缺必填字段 → 报错', () => {
  const u = unit();
  delete u.status;
  const r = validateLedger(ledger([u]));
  assertTrue(!r.ok, '缺 status 必须被拒');
  assertTrue(r.errors.some((e) => e.includes('缺少必填字段 status')), r.errors.join(' | '));
});
t('covered 却无 reviewed_paths → 报错', () => {
  const r = validateLedger(ledger([unit({ reviewed_paths: [] })]));
  assertTrue(!r.ok, 'covered 无 reviewed_paths 必须被拒');
  assertTrue(r.errors.some((e) => e.includes('covered 态必须有非空 reviewed_paths')), r.errors.join(' | '));
});
t('covered 却无 local_checks → 报错', () => {
  const r = validateLedger(ledger([unit({ local_checks: [] })]));
  assertTrue(!r.ok, 'covered 无 local_checks 必须被拒');
});
t('coverage_id 重复 → 报错', () => {
  const r = validateLedger(ledger([unit(), unit()]));
  assertTrue(!r.ok, '重复 id 必须被拒');
  assertTrue(r.errors.some((e) => e.includes('coverage_id 重复')), r.errors.join(' | '));
});
t('prior_status 非法值 → 报错', () => {
  const r = validateLedger(ledger([unit({ prior_status: 'prior_made_up' })]));
  assertTrue(!r.ok, '非法 prior_status 必须被拒');
  assertTrue(r.errors.some((e) => e.includes('prior_status 非法')), r.errors.join(' | '));
});
t('未按 coverage_id 排序 → 报错', () => {
  const r = validateLedger(ledger([
    unit({ coverage_id: 'b::b::c::d' }),
    unit({ coverage_id: 'a::b::c::d' }),
  ]));
  assertTrue(!r.ok, '乱序必须被拒');
  assertTrue(r.errors.some((e) => e.includes('未按 coverage_id 升序排序')), r.errors.join(' | '));
});
t('status 非法值 → 报错', () => {
  const r = validateLedger(ledger([unit({ status: 'done' })]));
  assertTrue(!r.ok, '非法 status 必须被拒');
});
t('generated_by 不是 deterministic → 报错（红线：账本不许提示词生成）', () => {
  const bad = { version: 1, generated_by: 'llm', units: [unit()] };
  const r = validateLedger(bad);
  assertTrue(!r.ok, 'generated_by=llm 必须被拒');
  assertTrue(r.errors.some((e) => e.includes('deterministic')), r.errors.join(' | '));
});
t('coverage_id 编码非法（小写 %hh / 含空格）→ 报错', () => {
  assertTrue(!isValidCoverageId('file read::workspace::dsh-cvm::traversal'), '含空格应非法');
  assertTrue(!isValidCoverageId('a%ff::b::c::d'), '小写十六进制应非法');
  assertTrue(!isValidCoverageId('a::b::c'), '少于 4 段应非法');
  assertTrue(isValidCoverageId('src%2Fdomain%2Fa.mjs::workspace::dsh-cvm::traversal'), '合法编码应通过');
});
t('blocked 无 unresolved → 报错', () => {
  const r = validateLedger(ledger([unit({ status: 'blocked', unresolved: [] })]));
  assertTrue(!r.ok, 'blocked 缺阻塞原因必须被拒');
});
t('candidate 无 result_fingerprints → 报错', () => {
  const r = validateLedger(ledger([unit({ status: 'candidate', result_fingerprints: [] })]));
  assertTrue(!r.ok, 'candidate 缺指纹必须被拒');
});
t('deferred 无原因 → 报错', () => {
  const r = validateLedger(ledger([unit({
    status: 'deferred',
    agent_id: null,
    reviewed_paths: [],
    local_checks: [],
    unresolved: [],
  })]));
  assertTrue(!r.ok, 'deferred 缺原因必须被拒');
});

console.log('== 枚举完整性 ==');
t('STATUSES 是 8 态', () => assertEqual(STATUSES.length, 8));
t('PRIOR_STATUSES 是 11 态', () => assertEqual(PRIOR_STATUSES.length, 11));

console.log('== 读文件（跨平台安全读）==');
t('合法文件 → ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ledger-'));
  try {
    const p = join(dir, 'ledger.json');
    writeFileSync(p, JSON.stringify(ledger(), null, 2), 'utf8');
    const r = readAndValidateLedger(p);
    assertTrue(r.ok, `应通过，实际: ${r.errors.join(' | ')}`);
    assertTrue(r.ledger?.units?.length === 1, '应解析出 1 个单元');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
t('坏 JSON → 报错（不抛异常）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ledger-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json', 'utf8');
    const r = readAndValidateLedger(p);
    assertTrue(!r.ok, '坏 JSON 必须被拒');
    assertTrue(r.errors.some((e) => e.includes('JSON 解析失败')), r.errors.join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
t('不存在的文件 → 报错（不抛异常）', () => {
  const r = readAndValidateLedger(join(tmpdir(), 'dsh-ledger-does-not-exist-xyz.json'));
  assertTrue(!r.ok, '不存在文件必须被拒');
});
t('目录路径 → 报错（isFile 检查）', () => {
  const r = readAndValidateLedger(tmpdir());
  assertTrue(!r.ok, '目录必须被拒');
  assertTrue(r.errors.some((e) => e.includes('不是普通文件')), r.errors.join(' | '));
});

console.log('== CLI（node ledger-validator.mjs <file>）==');
const CLI_PATH = fileURLToPath(new URL('./ledger-validator.mjs', import.meta.url));
const runCli = (args) => spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8' });

t('CLI: 无参数 → exit 2（打印用法）', () => {
  const r = runCli([]);
  assertEqual(r.status, 2);
  assertTrue((r.stderr ?? '').includes('用法'), '应打印用法');
});
t('CLI: 合法账本 → exit 0 + ✓', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ledger-cli-'));
  try {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify(ledger(), null, 2), 'utf8');
    const r = runCli([p]);
    assertEqual(r.status, 0, `应 exit 0，实际 stderr=${r.stderr}`);
    assertTrue((r.stdout ?? '').includes('✓'), '应打印 ✓');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
t('CLI: 坏账本 → exit 1 + 具体错误（阴性对照）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ledger-cli-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, JSON.stringify(ledger([unit({ reviewed_paths: [] })]), null, 2), 'utf8');
    const r = runCli([p]);
    assertEqual(r.status, 1, '坏账本必须 exit 1');
    assertTrue((r.stderr ?? '').includes('reviewed_paths'), `应报具体错误，实际: ${r.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
t('CLI: 不存在的文件 → exit 1', () => {
  const r = runCli([join(tmpdir(), 'dsh-ledger-nope-xyz.json')]);
  assertEqual(r.status, 1);
});

console.log(`\n通过 ${passed} 项${failed ? `（失败 ${failed}）` : ''}`);