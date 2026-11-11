#!/usr/bin/env node
/**
 * 宿主补丁（P4）：让 POST /chat 接受 rounds（0–200，覆盖配置里的 chatMemoryRounds）。
 *
 * 打的是 dsh-pet 的**构建产物** `lib/index.js`（上游仓库不提交它，无法用 git patch），
 * 所以这里用锚点替换：幂等、失败即抛、改前备份 `.bak-host-<时间戳>`。
 *
 *   node tools/apply-host.mjs                 # 打补丁（默认 profile 安装目录）
 *   node tools/apply-host.mjs <dsh-pet 目录>  # 指定安装目录
 *   node tools/apply-host.mjs --revert        # 回滚到最早的备份
 *
 * 宿主代码由 DSH 进程加载，打完必须重启 DSH 才生效（桌面 helper 重启无效）。
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-pet',
);
const argv = process.argv.slice(2);
const revert = argv.includes('--revert');
const dir = argv.find((a) => !a.startsWith('--')) ?? DEFAULT_DIR;
const target = path.join(dir, 'lib', 'index.js');

const PAIRS = [
  [
    `	const admitted = await admitImage(deps, parsed.attachment);
	if (!admitted.ok) return admitted.res;
	return okResult(await deps.chatWithPet(petId, text, admitted.ref));`,
    `	const admitted = await admitImage(deps, parsed.attachment);
	if (!admitted.ok) return admitted.res;
	// 可选上下文轮数：桌面端长谈模式会带 rounds: 10，覆盖配置里的 chatMemoryRounds
	const roundsOverride = parsed.rounds;
	if (roundsOverride !== void 0 && (!Number.isInteger(roundsOverride) || roundsOverride < 0 || roundsOverride > 200))
		return failResult("bad-request", "rounds 必须是 0–200 的整数");
	return okResult(await deps.chatWithPet(petId, text, admitted.ref, roundsOverride));`,
    'admitted.ref, roundsOverride',
  ],
  [
    `	const chatWithPet = async (petId, text, image) => withMemoryLock(async () => {`,
    `	const chatWithPet = async (petId, text, image, roundsOverride) => withMemoryLock(async () => {`,
    'async (petId, text, image, roundsOverride)',
  ],
  [
    `		const rounds = memoryRounds(found.conf);
		const pool = found.conf.chatImageEnabled === true`,
    `		const rounds = roundsOverride ?? memoryRounds(found.conf);
		const pool = found.conf.chatImageEnabled === true`,
    'roundsOverride ?? memoryRounds(found.conf)',
  ],
];

if (!fs.existsSync(target)) {
  console.error('找不到 ' + target + '，先安装 dsh-pet 或用参数指定目录。');
  process.exit(2);
}

if (revert) {
  const bak = fs.readdirSync(path.dirname(target))
    .filter((f) => f.startsWith('index.js.bak-host-'))
    .sort()[0];
  if (!bak) { console.error('没有 .bak-host-* 备份可回滚。'); process.exit(2); }
  fs.copyFileSync(path.join(path.dirname(target), bak), target);
  console.log('已回滚：lib/index.js <- ' + bak + '（重启 DSH 生效）');
  process.exit(0);
}

const raw = fs.readFileSync(target, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let s = raw.replace(/\r\n/g, '\n');
let touched = 0;
for (const [a, b, mark] of PAIRS) {
  if (s.includes(mark)) { console.log('跳过（已打过）：' + mark); continue; }
  const hits = s.split(a).length - 1;
  if (hits !== 1) { console.error('落点不唯一（命中 ' + hits + ' 次），宿主版本可能不同：\n' + a.slice(0, 80)); process.exit(3); }
  s = s.replace(a, b);
  touched++;
}
if (touched === 0) { console.log('无需改动。'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(target, target + '.bak-host-' + stamp);
fs.writeFileSync(target, eol === '\r\n' ? s.replace(/\n/g, '\r\n') : s, 'utf8');
console.log('已应用 ' + touched + ' 处（备份 index.js.bak-host-' + stamp + '）。重启 DSH 生效。');
