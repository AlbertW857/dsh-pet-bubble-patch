#!/usr/bin/env node
// 在已安装的 dsh-pet 上应用/回滚「气泡 3 行 + 继续聊」补丁。
// 用法：node tools/apply.mjs <electron-helper 目录> [--revert]
import fs from 'node:fs';
import path from 'node:path';

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
const FILES = ['index.html', 'events.js', 'sprite/bubble.js', 'sprite/input.js'];

if (revert) {
  for (const rel of FILES) {
    const p = path.join(dir, rel);
    const own = fs.readdirSync(path.dirname(p)).filter((f) => f.startsWith(path.basename(p) + '.bak-')).sort();
    if (!own.length) {
      console.log('跳过（没有备份）:', rel);
      continue;
    }
    fs.copyFileSync(path.join(path.dirname(p), own[own.length - 1]), p);
    console.log('已恢复:', rel, '<-', own[own.length - 1]);
  }
  console.log('回滚完成，重启桌面 helper 生效。');
  process.exit(0);
}

const READ = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const whole = FILES.map(READ).join('\n');
if (whole.includes('pet-bub-more')) {
  console.log('看起来已经打过补丁（找到 pet-bub-more），跳过。要重来请先 --revert。');
  process.exit(0);
}

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
    [OLD_BUBBLE, CLIP_BLOCK],
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
  for (const [a, b] of pairs) {
    const c = s.split(a).length - 1;
    if (c !== 1) {
      console.error(`落点不唯一（${rel}，命中 ${c} 次）：`, a.split('\n')[0].slice(0, 60));
      console.error('上游可能改过这段代码，请按 README 的「重新对齐上游」手工处理。');
      process.exit(1);
    }
    s = s.split(a).join(b);
  }
  fs.copyFileSync(p, p + '.bak-' + stamp);
  fs.writeFileSync(p, s);
  console.log('已改:', rel, '(备份 .bak-' + stamp + ')');
}
console.log('完成，重启桌面 helper 生效。');
