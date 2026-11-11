#!/usr/bin/env node
// 在已安装的 dsh-pet 上应用/回滚「气泡 3 行 + 继续聊」补丁。
// 用法：node tools/apply.mjs <electron-helper 目录> [--revert]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const dir = process.argv[2];
const revert = process.argv.includes('--revert');
if (!dir) {
  console.error('用法: node tools/apply.mjs <dsh-pet/runtime/electron-helper> [--revert]');
  process.exit(2);
}
if (!fs.existsSync(path.join(dir, 'index.html'))) {
  console.error('目标目录里没有 index.html，确认路径是不是 runtime/electron-helper');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const FILES = ['index.html', 'events.js', 'sprite/bubble.js', 'sprite/input.js', 'sprite/menu.js'];

if (revert) {
  for (const rel of [...FILES, 'shared-core.js']) {
    const p = path.join(dir, rel);
    const own = fs
      .readdirSync(path.dirname(p))
      .filter((f) => f.startsWith(path.basename(p) + '.bak'))
      .map((f) => ({ f, t: fs.statSync(path.join(path.dirname(p), f)).mtimeMs }))
      .sort((a, b) => a.t - b.t); // 最早的那份才是原始文件
    if (!own.length) {
      console.log('跳过（没有备份）:', rel);
      continue;
    }
    fs.copyFileSync(path.join(path.dirname(p), own[0].f), p);
    console.log('已恢复:', rel, '<-', own[0].f);
  }
  console.log('回滚完成，重启桌面 helper 生效。');
  process.exit(0);
}

const READ = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

const CLIP_BLOCK = `      if (whisperImg) this.bubble.appendChild(whisperImg);
      // 正文裁到 3 行；溢出的部分由「继续聊 ▸」兜底（点它开对话弹窗）。
      const clip = document.createElement('div');
      clip.className = 'pet-bub-clip';
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.whisperView[0]?.text ?? '';
      clip.appendChild(line);
      this.bubble.appendChild(clip);
      const more = document.createElement('span');
      more.className = 'pet-bub-more';
      more.textContent = '继续聊 ▸';
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        this.applyWhisperHold({ kind: 'hide' });
        this.showChatFromMenu();
      });
      // 鼠标停在按钮上时挂起收起计划：气泡 10s 就消失的话根本来不及点
      more.addEventListener('mouseenter', () => this.applyWhisperHold({ durationMs: 0, kind: 'hold', seq: 'more' }));
      more.addEventListener('mouseleave', () => this.applyWhisperHold({ durationMs: 8000, kind: 'show' }));
      this.bubble.appendChild(more);
      // 量真实溢出：rAF 内读 scrollHeight 才值这一帧的布局；display 必须写内联，
      // 否则下一次 renderBubble 重设 className/子节点时类名方案会被抹掉。
      requestAnimationFrame(() => {
        if (!this.bubble.contains(clip)) return;
        const over = clip.scrollHeight > clip.clientHeight + 1;
        more.style.display = over ? 'block' : 'none';
        if (over) {
          // 整泡参与命中区：主进程按 .pet-bubble.is-clickable 的矩形放行鼠标（见 syncInputBusy）。
          // whisperMore 是输入租约：光登记矩形不够——光标在身体外时 onMouseMove 会把窗口翻回穿透，
          // 气泡悬在头上，永远等不到 click。与余额气泡同一套 busy + rects 机制。
          this.whisperMore = true;
          this.bubble.classList.add('is-clickable');
          this.syncInputBusy();
          this.setInteractive(true);
        }
      });`;

const OLD_BUBBLE = `      if (whisperImg) this.bubble.appendChild(whisperImg);
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.whisperView[0]?.text ?? '';
      this.bubble.appendChild(line);`;

const CSS_OLD = `      .pet-bubble.is-whisper {
        font-size: calc(var(--f) * 0.7473);
        min-width: calc(var(--f) * 2.1978);
        max-width: min(calc(var(--f) * 10.989), 100%);
      }`;
const CSS_NEW = `${CSS_OLD}

      /* 碎碎念正文裁到 3 行：4.8em = 3 × line-height 1.6，随字号自动换算（与浏览器端同一口径） */
      .pet-bubble .pet-bub-clip {
        max-height: 4.8em;
        overflow: hidden;
      }

      /* 溢出时出现的「继续聊 ▸」：只在自己身上开命中，气泡本体默认仍不挡下层应用 */
      .pet-bubble .pet-bub-more {
        display: none;
        margin-top: calc(var(--f) * 0.2);
        font-size: calc(var(--f) * 0.75);
        color: rgba(43, 43, 43, 0.62);
        text-align: right;
        pointer-events: auto;
        cursor: pointer;
      }

      .pet-bubble .pet-bub-more:hover {
        color: #2b2b2b;
      }`;

const EDITS = {
  'index.html': [[CSS_OLD, CSS_NEW]],
  'events.js': [[
    `  this.applyWhisperHold({ durationMs: duration ?? BUBBLE_DURATION_MS, kind: 'show' });`,
    `  // 长回复给足阅读时间：10s 起，按字数递增，上限 27s（与浏览器端同一公式）
  this.applyWhisperHold({
    durationMs: duration ?? Math.max(BUBBLE_DURATION_MS, Math.min(27e3, text.length * 90)),
    kind: 'show',
  });`,
  ]],
  'sprite/bubble.js': [
    ['    this.bubbleSlot = slot;', `    this.bubbleSlot = slot;
    // 上一轮可能留了「继续聊」的输入租约：先撤销，溢出判定通过后再立（见 rAF）。
    this.whisperMore = false;`],
    [OLD_BUBBLE, CLIP_BLOCK, 'pet-bub-clip'],
  ],
  'sprite/input.js': [
    ['      this.balanceClickable() ||\n      this.workClickable()',
     '      this.balanceClickable() ||\n      this.workClickable() ||\n      !!this.whisperMore'],
    ['    this.setInteractive(inBody);',
     '    // whisperMore：气泡上的「继续聊」悬在身体外，按 inBody 翻转的话点不到，交给 busy + 矩形裁定。\n    this.setInteractive(inBody || !!this.whisperMore);'],
  ],
};

for (const [rel, pairs] of Object.entries(EDITS)) {
  const p = path.join(dir, rel);
  let s = fs.readFileSync(p, 'utf8');
  let touched = 0;
  for (const [a, b, mark] of pairs) {
    // 0004 会在气泡块里再插几行，`b` 可能不再是原文；第三项给一个稳定的「已打过」标记
    if (s.includes(mark ?? b)) continue;
    const c = s.split(a).length - 1;
    if (c !== 1) {
      console.error(`落点不唯一（${rel}，命中 ${c} 次）：`, a.split('\n')[0].slice(0, 60));
      console.error('上游可能改过这段代码，请按 README 的「重新对齐上游」手工处理。');
      process.exit(1);
    }
    s = s.split(a).join(b);
    touched++;
  }
  if (!touched) {
    console.log('跳过（已打过）:', rel);
    continue;
  }
  fs.copyFileSync(p, p + '.bak-' + stamp);
  fs.writeFileSync(p, s);
  console.log('已改:', rel, '(备份 .bak-' + stamp + ')');
}
/** 迷你 unified-diff 应用器：只处理单文件补丁（git diff 输出），逐 hunk 校验上下文。 */
function applyUnifiedPatch(text, patchText) {
  const lines = text.split('\n');
  const body = patchText.slice(patchText.indexOf('diff --git'));
  const hunks = [];
  let cur = null;
  for (const line of body.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) { cur = { oldStart: Number(m[1]), lines: [] }; hunks.push(cur); continue; }
    if (!cur) continue;
    if (line === '' || line.startsWith('\\')) continue;
    const c = line[0];
    if (c === ' ' || c === '+' || c === '-') cur.lines.push(line);
    else break; // 单文件补丁：遇到 diff --git / 尾部统计就结束
  }
  if (!hunks.length) throw new Error('补丁里没有 hunk');
  const same = (at, want) => want.every((w, i) => lines[at + i] === w);
  const out = [];
  let idx = 0;
  for (const h of hunks) {
    const oldLines = h.lines.filter((l) => l[0] !== '+').map((l) => l.slice(1));
    const newLines = h.lines.filter((l) => l[0] !== '-').map((l) => l.slice(1));
    let at = h.oldStart - 1; // hunk 的行号始终是原文件坐标
    if (!same(at, oldLines)) {
      let found = -1;
      for (let i = Math.max(0, at - 40); i <= Math.min(lines.length, at + 40); i++) {
        if (same(i, oldLines)) { found = i; break; }
      }
      if (found < 0) throw new Error('hunk 落点找不到（旧起点 ' + h.oldStart + '）');
      at = found;
    }
    out.push(...lines.slice(idx, at), ...newLines);
    idx = at + oldLines.length;
  }
  out.push(...lines.slice(idx));
  return out.join('\n');
}

const scPath = path.join(dir, 'shared-core.js');
if (fs.existsSync(scPath)) {
  const sc = fs.readFileSync(scPath, 'utf8');
  if (sc.includes('dsh-pet-chat-log')) {
    console.log('跳过 0002：shared-core.js 已有聊天窗消息区。');
  } else {
    const pf = path.join(ROOT, 'patches', '0002-chat-log.patch');
    const patched = applyUnifiedPatch(sc, fs.readFileSync(pf, 'utf8'));
    fs.copyFileSync(scPath, scPath + '.bak-' + stamp);
    fs.writeFileSync(scPath, patched);
    console.log('已应用 0002：聊天窗消息区（备份 shared-core.js.bak-' + stamp + '）。');
  }
}

// 0003：聊天窗重开时预载最近 20 轮历史（同文件，故在其后单独一段，先重读）
if (fs.existsSync(scPath)) {
  if (fs.readFileSync(scPath, 'utf8').includes('const setHistory = (list)')) {
    console.log('跳过 0003：shared-core.js 已有历史预载。');
  } else {
    const sc3 = fs.readFileSync(scPath, 'utf8');
    const pf3 = path.join(ROOT, 'patches', '0003-chat-history.patch');
    const patched3 = applyUnifiedPatch(sc3, fs.readFileSync(pf3, 'utf8'));
    const bak3 = scPath + '.bak-' + stamp;
    if (!fs.existsSync(bak3)) fs.copyFileSync(scPath, bak3); // 同一轮已备份过就别覆盖（回滚取最早一份）
    fs.writeFileSync(scPath, patched3);
    console.log('已应用 0003：历史预载（备份 shared-core.js.bak-' + stamp + '）。');
  }
}

// 0004：闲聊/长谈两种对话模式（多文件补丁：shared-core.js + sprite/bubble.js + sprite/menu.js）
{
  const pf4 = path.join(ROOT, 'patches', '0004-chat-mode.patch');
  const MARK = {
    'shared-core.js': 'function getChatMode',
    'sprite/bubble.js': 'getChatMode(this.pet.id)',
    'sprite/menu.js': "action: 'chat-mode'",
  };
  if (fs.existsSync(pf4)) {
    for (const seg of fs.readFileSync(pf4, 'utf8').split(/^diff --git /m).slice(1)) {
      const body = 'diff --git ' + seg;
      const m = /^diff --git a\/(.+?) b\/(.+?)\s*$/m.exec(body);
      if (!m) continue;
      const full = m[2];
      const at = full.indexOf('electron-helper/');
      const rel = at >= 0 ? full.slice(at + 'electron-helper/'.length) : full;
      const p = path.join(dir, rel);
      if (!fs.existsSync(p)) { console.log('跳过 0004：找不到 ' + rel); continue; }
      const cur = fs.readFileSync(p, 'utf8');
      if (MARK[rel] && cur.includes(MARK[rel])) { console.log('跳过 0004：' + rel + ' 已有模式开关。'); continue; }
      const patched = applyUnifiedPatch(cur, body);
      const bak = p + '.bak-' + stamp;
      if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
      fs.writeFileSync(p, patched);
      console.log('已应用 0004：' + rel);
    }
  }
}

console.log('完成，重启桌面 helper 生效。');
