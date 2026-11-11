# dsh-pet 桌面气泡补丁

针对 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 桌面端（`runtime/electron-helper`）的一组小改动：**碎碎念/对话回复太长时，气泡不再无限拉高，而是裁到 3 行并给出「继续聊 ▸」入口**。

## 解决的问题

桌面桌宠的回复只走气泡（`/state` 的 `say`），气泡本身是瞬态浮层：

1. 长回复把气泡拉到十几行，挡住桌面；
2. 10 秒后气泡消失，根本来不及读完；
3. 关掉就没了，没有办法回看或接着问。

本补丁让气泡固定在 3 行（`4.8em`，由 `line-height: 1.6` 推算，随字号自动缩放），溢出时在右下角出现「继续聊 ▸」；点它关闭气泡并打开对话输入框，鼠标悬停时暂停收起计时。长回复的停留时长从固定 10s 改为 `10s ~ 27s`（按字数递增）。

## 改动文件

| 文件 | 改动 |
|---|---|
| `runtime/electron-helper/index.html` | 新增 `.pet-bub-clip`（`max-height:4.8em;overflow:hidden`）与 `.pet-bub-more` 样式 |
| `runtime/electron-helper/sprite/bubble.js` | 碎碎念正文包进 `.pet-bub-clip`；追加「继续聊 ▸」；rAF 内用 `scrollHeight > clientHeight + 1` 判真实溢出；溢出时置 `whisperMore` 输入租约 |
| `runtime/electron-helper/sprite/input.js` | `inputBusy()` 计入 `whisperMore`；`onMouseMove` 的可交互翻转改为 `inBody || whisperMore` |
| `runtime/electron-helper/events.js` | `showWhisper` 的停留时长按字数递增，上限 27s |

> 桌面窗口默认点击穿透，只有被 `syncInputRegions` 登记的矩形才收鼠标。气泡悬在宠物头顶（身体命中区之外），所以按钮要能用，必须同时给 `busy` 旗标和「保持可交互」，否则一离开身体窗口就翻回穿透，`click` 落到下层应用上——这是本补丁里最容易踩的坑。

## 安装

```powershell
# 目标目录（DSH 桌面 profile 下的 dsh-pet）
$pet = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-pet\runtime\electron-helper"
node tools/apply.mjs $pet
```

也可以手动把仓库里 `dsh-pet/runtime/electron-helper/` 下的四个文件覆盖过去。

改完需要重启桌面 helper：

```powershell
# 端口每次重启都会变，先看当前端口（DSH 日志里的 dsh-pet-<port>）
curl.exe -X POST "http://127.0.0.1:<port>/dsh-pet-<port>/pet-display" `
  -H "content-type: application/json" -d '{"id":"main","display":"desktop"}'
```

或直接重启 DSH。

## 回滚

```powershell
node tools/apply.mjs $pet --revert     # 恢复最近一次备份
```

`apply.mjs` 每次改动前都会生成 `*.bak-<ISO时间戳>`，也可以手动还原。

**注意**：`node_modules` 里的文件会被 `pnpm install` / 插件升级覆盖，升级后需要重新应用（或直接改用打了补丁的 fork）。

## 重新对齐上游

`patches/` 下是基于 `main@2026-11-11` 生成的 patch：

```bash
git apply -p1 patches/0001-feat-desktop-3.patch
```

上游若改动了同一段代码，用 `git apply --3way` 或重新按上表手工落点。

## 验证

- 让桌宠说一段长文本：气泡 3 行 + 右下「继续聊 ▸」；
- 鼠标悬停按钮，气泡不消失；
- 点击按钮：气泡关闭，对话输入框弹出并获得焦点；
- 短回复（一两行）：不出现按钮。

## 许可

补丁本身随上游 [MIT](https://github.com/PC2005-cloud/dsh-pet/blob/main/LICENSE) 发布；文件内容版权归上游作者。

## 已验证基线

| 基线 | 来源 | 验证方法 | 结果 |
|---|---|---|---|
| npm 0.4.7（用户实际在跑的） | 安装目录 `node_modules/dsh-pet/runtime/electron-helper` | 取补丁前的原始文件 → `node tools/apply.mjs` | 4 个文件与已打补丁的现场**逐字节一致** |
| upstream main (`3a65719`) | `PC2005-cloud/dsh-pet` | `git show upstream/main:<file>` 导出 → `apply.mjs` | 与仓库 HEAD 文件**逐字节一致** |

注意 `index.html` 在两套基线之间有上游漂移：upstream main 的 `#root` 已是 `position:absolute;inset:0`，npm 0.4.7 还是 `position:relative;width/height:100%`。`apply.mjs` 用锚点插入 CSS，两套都能命中；**不要**把某一版的 `index.html` 直接覆盖到另一版上。

回滚：`node tools/apply.mjs <dir> --revert`，按 `<file>.bak-*` 里最新的一份恢复。
