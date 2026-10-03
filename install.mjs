#!/usr/bin/env node
/**
 * dsh-cvm 一键安装 / 自检
 *
 * 安全默认：**不带 --apply 时只做 dry-run**（打印将要执行的命令，不碰任何东西）。
 *
 * 用法：
 *   node install.mjs                                   # dry-run（默认 profile）
 *   node install.mjs --profile web --home G:\DSH-Home  # dry-run 指定 profile/home
 *   node install.mjs --apply --profile web             # 真装
 *   node install.mjs --check --profile web             # 只自检（读 dump-config）
 *   node install.mjs --dsh "C:\path\to\dsh.cmd"        # 指定 dsh 可执行（默认用 PATH 里的 dsh）
 *
 * 为什么默认 dry-run：DSH 的 profile 里有**生产环境**（web/desktop 等）。
 * 装插件会改 profile 的 package.json 与 node_modules，属于"需要本人确认"的动作。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const REPO = 'github:qlheric/dsh-cvm';
const PACKAGES = [
  'dsh-contract',
  'dsh-convergence',
  'dsh-evidence',
  'dsh-intervention',
  'dsh-budget',
];

// ── 参数 ──
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const APPLY = flag('apply');
const CHECK = flag('check');
const PROFILE = opt('profile', null);
const HOME = opt('home', process.env.DSH_HOME || join(homedir(), '.dsh'));
const DSH_RAW = opt('dsh', process.env.DSH_BIN || 'dsh');
// 允许 "node C:\path\bin.js" 这种「命令 + 前置参数」形式
const [DSH, ...DSH_PRE] = DSH_RAW.split(/\s+/).filter(Boolean);

const specs = PACKAGES.map((p) => `${REPO}#path:packages/${p}`);

// ── 环境探测 ──
function listProfiles(home) {
  const dir = join(home, 'profiles');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch { return []; }
}

function run(cmd, args) {
  return spawnSync(cmd, args, {
    env: { ...process.env, DSH_HOME: HOME },
    encoding: 'utf8',
    // 只在需要解析 .cmd/.bat（Windows 的 dsh 包装）时用 shell；node 直接跑 bin.js 不需要，
    // 用 shell:true 会触发 DEP0190（参数不转义）警告。
    shell: process.platform === 'win32' && !/\.(js|mjs|cjs)$/i.test(cmd),
  });
}

function banner(text) { console.log(`\n=== ${text} ===`); }

banner('dsh-cvm 安装器');
console.log(`  DSH_HOME : ${HOME}`);
console.log(`  dsh 命令 : ${DSH}`);
console.log(`  profile  : ${PROFILE ?? '(未指定 —— dry-run 用 <你的profile>)'}`);
console.log(`  模式     : ${APPLY ? 'APPLY（会真的改 profile）' : CHECK ? 'CHECK（只读自检）' : 'DRY-RUN（不改任何东西）'}`);

const profiles = listProfiles(HOME);
if (profiles.length > 0) {
  console.log(`  现有 profile：${profiles.join(', ')}`);
  if (/DSH-Home/i.test(HOME)) {
    console.log('  ⚠️ 注意：这个 home 看起来是**生产**目录，装插件前请确认你确实要动它。');
  }
}

// ── 装 ──
banner('安装命令（5 个包，一条命令装齐）');
const addArgs = ['plugin', '--profile', PROFILE ?? '<你的profile>', 'add', ...specs];
console.log(`  ${DSH_RAW} ${addArgs.map((a) => (a.includes('#') ? `"${a}"` : a)).join(' ')}`);
console.log('\n  ⚠️ 不要用 `add github:qlheric/dsh-cvm`（不带 #path:）——本仓库根是 private');
console.log('     workspace 包，那样只会装到根包，dsh 会警告 declares no dsh.bundle，');
console.log('     5 个插件一个都不会生效。');

if (APPLY) {
  if (!PROFILE) {
    console.error('\n✗ --apply 必须同时给 --profile <名字>');
    process.exit(2);
  }
  banner('开始安装');
  const r = run(DSH, [...DSH_PRE, ...addArgs]);
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  if (r.status !== 0) {
    console.error(`\n✗ 安装失败（exit ${r.status}）。若报 "command not found"，用 --dsh <dsh可执行路径> 指定。`);
    process.exit(r.status ?? 1);
  }
  console.log('\n✓ 安装命令执行完毕，继续自检…');
}

// ── 自检 ──
if (APPLY || CHECK) {
  const p = PROFILE;
  if (!p) {
    console.error('\n✗ 自检需要 --profile <名字>');
    process.exit(2);
  }
  banner('自检：dump-config 里是否出现 5 个插件层');
  const r = run(DSH, [...DSH_PRE, '--profile', p, '--dump-config']);
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (r.status !== 0) {
    console.error(`✗ dump-config 失败（exit ${r.status}）`);
    console.error(text.slice(0, 800));
    process.exit(r.status ?? 1);
  }
  let ok = 0;
  for (const name of PACKAGES) {
    const hit = text.includes(`@qlheric/${name}`) || text.includes(`@deepseek-ai/${name}`);
    console.log(`  ${hit ? '✓' : '✗'} @qlheric/${name}${hit ? '' : '  ← 没作为 profile 层加载'}`);
    if (hit) ok += 1;
  }
  console.log(`\n${ok === PACKAGES.length ? '✓ 全部 5 个插件已作为 profile 层加载' : `✗ 只有 ${ok}/5 个生效`}`);
  if (ok !== PACKAGES.length) process.exit(1);
}

if (!APPLY && !CHECK) {
  banner('下一步');
  console.log('  确认无误后，加 --apply 真装：');
  console.log(`    node install.mjs --apply --profile <你的profile>${/DSH-Home/i.test(HOME) ? ` --home "${HOME}"` : ''}`);
  console.log('  装完可以随时只做自检：');
  console.log(`    node install.mjs --check --profile <你的profile>`);
}
