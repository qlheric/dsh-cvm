// 覆盖账校验器（纯函数 + 跨平台安全读文件）
//
// 设计依据：设计-覆盖账-确定性覆盖单元.md
// ⚠️ 跨平台铁律：不得使用 fs.constants.O_NOFOLLOW / O_NONBLOCK
//    —— 这两个常量在 Windows 上是 undefined（Node v24 实测），
//    用了会让本机全挂、而 Linux CI 却能过。这里只用 statSync().isFile() + 大小上限。
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const STATUSES = Object.freeze([
  'planned',
  'not_applicable',
  'out_of_scope',
  'deferred',
  'in_progress',
  'blocked',
  'covered',
  'candidate',
]);

export const PRIOR_STATUSES = Object.freeze([
  'new',
  'prior_confirmed_same_source',
  'prior_confirmed_changed_source',
  'prior_needs_validation',
  'prior_deferred',
  'prior_blocked',
  'prior_out_of_scope',
  'prior_covered_same_source',
  'prior_covered_changed_source',
  'prior_rejected_claim_changed',
  'none',
]);

export const EVIDENCE_STATES = Object.freeze(['confirmed', 'needs_validation', 'rejected']);

/** 账本文件大小上限（防止误把巨型文件读进来）。 */
export const MAX_LEDGER_BYTES = 5 * 1024 * 1024;

const REQUIRED_UNIT_FIELDS = Object.freeze([
  'coverage_id',
  'surface',
  'boundary',
  'subsystem',
  'attack_class',
  'status',
  'prior_status',
]);

/** 需要规范 owner 的状态（agent_id 必须是非空字符串）。 */
const OWNER_STATES = new Set(['in_progress', 'blocked', 'covered', 'candidate']);
/** 必须有非空 unresolved 原因的状态。 */
const REASON_STATES = new Set(['not_applicable', 'out_of_scope', 'deferred']);
/** 必须同时有 reviewed_paths 与 local_checks 的状态。 */
const PROOF_STATES = new Set(['blocked', 'covered', 'candidate']);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * 校验 `coverage_id` 的编码形态：
 * - 用 `::` 分 4 段（允许 5 段，第 5 段是 lifecycle）；
 * - 每段只允许 RFC 3986 unreserved（A-Za-z0-9-._~）与 `%HH`（大写十六进制）。
 */
export function isValidCoverageId(id) {
  if (!isNonEmptyString(id)) return false;
  const parts = id.split('::');
  if (parts.length !== 4 && parts.length !== 5) return false;
  for (const part of parts) {
    if (part === '') return false;
    // 只允许 unreserved 字符与百分号编码
    if (!/^(?:[A-Za-z0-9\-._~]|%[0-9A-F]{2})+$/.test(part)) return false;
  }
  return true;
}

/** 纯函数：校验一份账本对象，返回 { ok, errors }。 */
export function validateLedger(ledger) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return { ok: false, errors: ['账本必须是对象'] };
  }

  if (!Number.isInteger(ledger.version)) push('version 必须是整数');
  // 红线：账本必须确定性生成，不许写成 llm / 其它
  if (ledger.generated_by !== 'deterministic') {
    push(`generated_by 必须是 "deterministic"（实际 ${JSON.stringify(ledger.generated_by)}）`);
  }
  if (!Array.isArray(ledger.units)) {
    return { ok: errors.length === 0, errors: [...errors, 'units 必须是数组'] };
  }

  const seen = new Set();
  let prevId = null;

  ledger.units.forEach((unit, idx) => {
    const where = `units[${idx}]`;
    if (unit === null || typeof unit !== 'object' || Array.isArray(unit)) {
      push(`${where} 必须是对象`);
      return;
    }

    // 1) 必填字段
    for (const field of REQUIRED_UNIT_FIELDS) {
      if (!(field in unit)) push(`${where} 缺少必填字段 ${field}`);
    }

    // 2) coverage_id 形态
    const id = unit.coverage_id;
    if (id !== undefined && !isValidCoverageId(id)) {
      push(`${where} coverage_id 形态非法（应为 4~5 段、:: 分隔、RFC 3986 编码）: ${JSON.stringify(id)}`);
    }

    // 3) 唯一性
    if (isNonEmptyString(id)) {
      if (seen.has(id)) push(`${where} coverage_id 重复: ${id}`);
      seen.add(id);
    }

    // 4) 排序（码点升序）
    if (isNonEmptyString(id)) {
      if (prevId !== null && id < prevId) {
        push(`${where} units 未按 coverage_id 升序排序: ${id} 出现在 ${prevId} 之后`);
      }
      prevId = id;
    }

    // 5) status 合法性
    const status = unit.status;
    if (status !== undefined && !STATUSES.includes(status)) {
      push(`${where} status 非法: ${JSON.stringify(status)}`);
    }

    // 6) prior_status 合法性
    const prior = unit.prior_status;
    if (prior !== undefined && !PRIOR_STATUSES.includes(prior)) {
      push(`${where} prior_status 非法: ${JSON.stringify(prior)}`);
    }

    // 7) evidence_state（可选，但给了就必须合法）
    if (unit.evidence_state !== undefined && !EVIDENCE_STATES.includes(unit.evidence_state)) {
      push(`${where} evidence_state 非法: ${JSON.stringify(unit.evidence_state)}`);
    }

    // 8) 状态与字段匹配
    const hasPaths = Array.isArray(unit.reviewed_paths) && unit.reviewed_paths.length > 0;
    const hasChecks = Array.isArray(unit.local_checks) && unit.local_checks.length > 0;
    const hasFingerprints = Array.isArray(unit.result_fingerprints) && unit.result_fingerprints.length > 0;
    const hasUnresolved = Array.isArray(unit.unresolved) && unit.unresolved.length > 0;

    if (Array.isArray(unit.reviewed_paths) && !isStringArray(unit.reviewed_paths)) {
      push(`${where} reviewed_paths 必须是非空字符串数组`);
    }
    if (Array.isArray(unit.local_checks) && !isStringArray(unit.local_checks)) {
      push(`${where} local_checks 必须是非空字符串数组`);
    }
    if (Array.isArray(unit.unresolved) && !isStringArray(unit.unresolved)) {
      push(`${where} unresolved 必须是非空字符串数组`);
    }

    if (status === 'planned') {
      if (unit.agent_id !== null && unit.agent_id !== undefined) push(`${where} planned 态 agent_id 必须为 null`);
      if (hasPaths || hasChecks || hasFingerprints) push(`${where} planned 态不应带证据（reviewed_paths/local_checks/result_fingerprints）`);
    }

    if (REASON_STATES.has(status)) {
      if (!hasUnresolved) push(`${where} ${status} 态必须给非空 unresolved 原因`);
      if (hasPaths || hasChecks || hasFingerprints) push(`${where} ${status} 态不应带证据`);
      if (unit.agent_id !== null && unit.agent_id !== undefined) push(`${where} ${status} 态 agent_id 必须为 null`);
    }

    if (OWNER_STATES.has(status)) {
      if (!isNonEmptyString(unit.agent_id)) push(`${where} ${status} 态必须有非空 agent_id（规范 owner）`);
    }

    if (PROOF_STATES.has(status)) {
      if (!hasPaths) push(`${where} ${status} 态必须有非空 reviewed_paths`);
      if (!hasChecks) push(`${where} ${status} 态必须有非空 local_checks`);
    }

    if (status === 'candidate' && !hasFingerprints) {
      push(`${where} candidate 态必须有非空 result_fingerprints`);
    }

    if (status === 'blocked' && !hasUnresolved) {
      push(`${where} blocked 态必须有非空 unresolved 阻塞原因`);
    }

    // 9) attempts 必须是数组（追加式归档）
    if (unit.attempts !== undefined && !Array.isArray(unit.attempts)) {
      push(`${where} attempts 必须是数组`);
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * 跨平台安全读 + 解析 + 校验。
 * @returns {{ ok: boolean, ledger?: object, errors: string[] }}
 */
export function readAndValidateLedger(filePath) {
  const errors = [];
  let stat;
  try {
    stat = statSync(filePath);
  } catch (error) {
    return { ok: false, errors: [`无法访问文件: ${error?.code ?? error}`] };
  }
  if (!stat.isFile()) return { ok: false, errors: ['目标不是普通文件（拒绝读取）'] };
  if (stat.size > MAX_LEDGER_BYTES) {
    return { ok: false, errors: [`文件过大（${stat.size} > ${MAX_LEDGER_BYTES} 字节），拒绝读取`] };
  }

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    return { ok: false, errors: [`读取失败: ${error?.code ?? error}`] };
  }

  let ledger;
  try {
    ledger = JSON.parse(raw);
  } catch (error) {
    return { ok: false, errors: [`JSON 解析失败: ${error.message}`] };
  }

  const result = validateLedger(ledger);
  return { ok: result.ok, ledger, errors: [...errors, ...result.errors] };
}

// ── CLI 入口：node src/domain/ledger-validator.mjs <账本文件> ──
// 退出码：0=合法；1=账本非法；2=用法/环境错误
// 说明：CLI 只做"校验"，不改账本、不联网、不写文件。
const USAGE = `用法: node src/domain/ledger-validator.mjs <ledger.json>

退出码:
  0  账本合法
  1  账本非法（会打印全部错误）
  2  用法错误 / 文件不可读`;

async function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error(USAGE);
    process.exit(2);
  }
  const result = readAndValidateLedger(file);
  if (result.ok) {
    const n = result.ledger?.units?.length ?? 0;
    console.log(`✓ 账本合法：${file}（${n} 个覆盖单元）`);
    process.exit(0);
  }
  console.error(`✗ 账本非法：${file}`);
  for (const err of result.errors) console.error(`  - ${err}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`✗ 校验器异常: ${error?.message ?? error}`);
    process.exit(2);
  });
}

/** 跨平台路径归一（Windows 盘符大小写差异会让直接字符串比较失败）。 */
function resolvePath(p) {
  try { return realpathSync(p); } catch { return p; }
}

