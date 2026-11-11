# dsh-pet 桌面气泡补丁

针对 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 桌面端（`runtime/electron-helper`）的一组小改动：

1. **气泡裁到 3 行**：碎碎念/对话回复太长时不再无限拉高，右下角给「继续聊 ▸」入口；
2. **对话窗内回显消息**：气泡之后的追问在弹窗里成对显示（你说的话 + 她的回复与配图），不再只能看 10 秒的气泡；
3. **重开对话窗预载历史**：关掉再开、甚至重启 DSH 之后，窗口里仍是最近 20 轮真实对话（历史存在宿主 `memory.json`，不是窗内缓存）；
4. **闲聊 / 长谈两种模式**：闲聊＝点「对话」只弹一个小输入框、发完就收，回复看气泡；长谈＝弹带记录的大窗、长回复自动开窗。窗口形态与自动开窗一起切。

## 解决的问题

桌面桌宠的回复只走气泡（`/state` 的 `say`），气泡本身是瞬态浮层：

1. 长回复把气泡拉到十几行，挡住桌面；
2. 10 秒后气泡消失，根本来不及读完；
3. 关掉就没了，没有办法回看或接着问。

对话弹窗原本只是个输入框：POST `/chat` 的响应里带着正文，但组件丢掉不用，回复统一从 `/state` 走气泡。P1 之后弹窗自己维护消息区，连续追问有上下文可看；P2 打开窗口时再向宿主 `GET /chat?rounds=20` 拉一次最近历史，关窗重开、重启 DSH 都不丢。

本补丁让气泡固定在 3 行（`4.8em`，由 `line-height: 1.6` 推算，随字号自动缩放），溢出时在右下角出现「继续聊 ▸」；点它关闭气泡并打开对话输入框，鼠标悬停时暂停收起计时。长回复的停留时长从固定 10s 改为 `10s ~ 27s`（按字数递增）。

## 改动文件

| 文件 | 改动 |
|---|---|
| `runtime/electron-helper/index.html` | 新增 `.pet-bub-clip`（`max-height:4.8em;overflow:hidden`）与 `.pet-bub-more` 样式 |
| `runtime/electron-helper/sprite/bubble.js` | 碎碎念正文包进 `.pet-bub-clip`；追加「继续聊 ▸」；rAF 内用 `scrollHeight > clientHeight + 1` 判真实溢出；溢出时置 `whisperMore` 输入租约；长谈模式下长回复到点自动开窗（每句只开一次） |
| `runtime/electron-helper/sprite/menu.js` | 右键菜单新增「对话模式：闲聊 / 长谈」，只切模式不弹窗 |
| `runtime/electron-helper/sprite/input.js` | `inputBusy()` 计入 `whisperMore`；`onMouseMove` 的可交互翻转改为 `inBody || whisperMore` |
| `runtime/electron-helper/events.js` | `showWhisper` 的停留时长按字数递增，上限 27s |
| `runtime/electron-helper/shared-core.js` | 对话窗新增 `.dsh-pet-chat-log` 消息区（用户/桌宠成对追加、60 条上限、自动滚底）；`sendChat` 返回 `text`/`image`；配图按 `BASE` 绝对前缀解析（`file://` 页面必需），加载失败自动移除；打开窗口时 `GET /chat?rounds=20` 预载历史，按角色+正文与本地已显示消息去重（P2）；闲聊/长谈模式（localStorage 持久化）决定窗口形态、是否拉历史、发完是否收起（P3） |

> 桌面窗口默认点击穿透，只有被 `syncInputRegions` 登记的矩形才收鼠标。气泡悬在宠物头顶（身体命中区之外），所以按钮要能用，必须同时给 `busy` 旗标和「保持可交互」，否则一离开身体窗口就翻回穿透，`click` 落到下层应用上——这是本补丁里最容易踩的坑。

## 安装

```powershell
# 目标目录（DSH 桌面 profile 下的 dsh-pet）
$pet = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-pet\runtime\electron-helper"
node tools/apply.mjs $pet
```

`apply.mjs` 会依次落地四步：P0（`index.html` / `events.js` / `sprite/bubble.js` / `sprite/input.js` / `sprite/menu.js` 的锚点替换）、P1（`shared-core.js`，读 `patches/0002-chat-log.patch`）、P2（同文件，读 `patches/0003-chat-history.patch`）、P3（`patches/0004-chat-mode.patch`，一次改三个文件），补丁用内置 unified-diff 应用器，不依赖 git。重复执行会自动跳过已打过的落点，`--revert` 恢复最早那份 `.bak`。

也可以手动把仓库里 `dsh-pet/runtime/electron-helper/` 下的五个文件覆盖过去。

改完需要重启桌面 helper：

```powershell
# 端口每次重启都会变，先看当前端口（DSH 日志里的 dsh-pet-<port>）
curl.exe -X POST "http://127.0.0.1:<port>/dsh-pet-<port>/pet-display" `
  -H "content-type: application/json" -d '{"id":"main","display":"desktop"}'
```

或直接重启 DSH。

## 回滚

```powershell
node tools/apply.mjs $pet --revert     # 恢复最早一份备份（即补丁前原文件）
```

`apply.mjs` 每次改动前都会生成 `*.bak-<ISO时间戳>`，也可以手动还原。

**注意**：`node_modules` 里的文件会被 `pnpm install` / 插件升级覆盖，升级后需要重新应用（或直接改用打了补丁的 fork）。

## 重新对齐上游

`patches/` 下是两组补丁，基于 npm `dsh-pet@0.4.7` 与上游 `main@2026-11-11` 生成：

```bash
# 在 dsh-pet/runtime/electron-helper 目录里执行（两个补丁的路径前缀一致，都剥 4 层）
git apply -p4 <仓库>/patches/0001-whisper-overflow.patch   # P0：气泡 3 行 + 继续聊
git apply -p4 <仓库>/patches/0002-chat-log.patch           # P1：对话窗消息区
git apply -p4 <仓库>/patches/0003-chat-history.patch       # P2：重开预载历史
git apply -p4 <仓库>/patches/0004-chat-mode.patch          # P3：闲聊/长谈模式（三个文件）
```

上游若改动了同一段代码，用 `git apply --3way` 或重新按上表手工落点。

## 验证

- 让桌宠说一段长文本：气泡 3 行 + 右下「继续聊 ▸」；
- 鼠标悬停按钮，气泡不消失；
- 点击按钮：气泡关闭，对话输入框弹出并获得焦点；
- 短回复（一两行）：不出现按钮；
- 从气泡点进对话窗，继续追问：消息区里同时有你发的那句和她的回复，配图正常显示、不撑破窗宽；
- 关窗再开、甚至重启 DSH：消息区里仍是最近 20 轮对话（含配图），刚发的那轮不会重复；
- 历史变长后窗口不被顶出工作区，输入框仍可正常输入；
- 闲聊模式：点「对话」只有输入框、没有记录区，发完窗口自己收起，回复出现在气泡；
- 长谈模式：点「对话」是带记录的大窗；一段长回复后窗口自动弹出；重启 DSH 后模式仍记着。

## 许可

补丁本身随上游 [MIT](https://github.com/PC2005-cloud/dsh-pet/blob/main/LICENSE) 发布；文件内容版权归上游作者。

## 已验证基线

| 基线 | 来源 | 验证方法 | 结果 |
|---|---|---|---|
| npm 0.4.7（用户实际在跑的） | 安装目录 `node_modules/dsh-pet/runtime/electron-helper` | 取补丁前的原始文件 → `node tools/apply.mjs` | 6 个文件与已打补丁的现场**逐字节一致**；再跑一次全部跳过；`--revert` 回到原始基线 |
| upstream main (`3a65719`) | `PC2005-cloud/dsh-pet` | `git show upstream/main:<file>` 导出 → `apply.mjs` | 与仓库 HEAD 文件**逐字节一致** |

注意 `index.html` 在两套基线之间有上游漂移：upstream main 的 `#root` 已是 `position:absolute;inset:0`，npm 0.4.7 还是 `position:relative;width/height:100%`。`apply.mjs` 用锚点插入 CSS，两套都能命中；**不要**把某一版的 `index.html` 直接覆盖到另一版上。

回滚：`node tools/apply.mjs <dir> --revert`，按 `<file>.bak-*` 里**最早**的一份恢复（连续打多个补丁时，最早那份才是补丁前的原文件）。
