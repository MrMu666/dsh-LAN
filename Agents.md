# dsh-LAN 插件修改要点

> 记录 2026-08-14 为修复「web 界面打不开」所做改动。已同步到安装副本
> `~/.dsh/profiles/node_modules/dsh-LAN`，并在此源码目录落地。

## 背景

dsh web 启动后页面白屏，浏览器显示：

```
HARNESS
Failed to load plugins
web boot: 1 entry did not activate dsh-LAN: pending
(waiting for services: ... )
```

根因：插件客户端 fiber 一直 PENDING，启动扫描判定整个 boot 失败，fail-loud 白屏。

## 修改 1 — client inject 用服务名（根因修复）

**文件**：`lib/client.js`（`const inject`）与 `package.json`（`dsh.client.inject`）

Cordis `inject` 声明的是**服务名**（即 `ctx.get()` 能取到的名字），不是 npm 包名。
web 客户端提供的服务是短名：`slots`（槽位注册/渲染）、`locale`、`connection`。
旧写法用的是包名（`@deepseek-ai/dsh-client-connection` 等），没有任何地方按包名
provide 服务，fiber 永远等不到 → pending → 整个 boot 失败。

```diff
- const inject = [
-   "@deepseek-ai/dsh-client-connection",
-   "@deepseek-ai/dsh-client-locale",
-   "@deepseek-ai/dsh-client-runtime",
-   "@deepseek-ai/dsh-client-ui-settings",
-   "@deepseek-ai/dsh-client-ui-slots",
-   "@deepseek-ai/dsh-client-ui-primitives"
- ];
+ const inject = ["slots", "locale", "connection"];
```

对照参考：`dsh-client-ui-settings-general`（同类注册 settings 分区）的模块导出
inject 正是 `["slots", "locale", "connection"]`。web 端 38 个内置插件全部用短服务名。

## 修改 2 — store 补 getSnapshot（LAN 卡片不渲染）

**文件**：`lib/client.js`（`createLanStore`）

修复 1 后 boot 正常，但设置页「局域网访问」卡片仍不显示。原因：slots 渲染器的
选择器 hook（`dsh-client-web-react` 的 `bindSnapshotSelector`）读取的是
`source.getSnapshot()`，而插件的 store 只提供了 `get()`，渲染时抛错被槽位错误
边界捕获（console 打 `slot entry crashed`），卡片被丢弃。

```diff
  return {
    get: () => snapshot,
+   // the slots renderer's selector hook reads getSnapshot(), not get()
+   getSnapshot: () => snapshot,
    set: (patch) => { ... },
    subscribe: (fn) => { ... }
  };
```

## 验证

- 启动日志：`[dsh-LAN] activated (profile=web, bind=0.0.0.0:3080)`
- boot manifest 39 个 entry 全部激活，`dsh-LAN` inject = `["slots","locale","connection"]`
- web UI 正常渲染；设置 → 通用 显示 LAN 卡片（绑定、防火墙、局域网地址、口令管理）
- 服务端 `/dsh-lan/status`、`/dsh-lan/unlock` 正常

## 提醒

- 修改 install.ps1 之外的 `dsh.client.inject` 时，记得 `lib/client.js` 与 `package.json`
  两处同步改，二者都来自同一份 inject 声明。
- manifest 里的 `inject` 字段只是元数据（模块系统仅校验类型、用于预取排序），
  真正参与 cordis 服务等待的是客户端模块导出的 `inject`。

---

# v2 修改记录（2026-08-14）：登录门 + 独立远程界面

> 目标：① 局域网设备必须输口令才能看到页面；② 修复移动端"看不到历史对话/
> 文件记录"（桌面 SPA 在手机上不可用）；③ 本机记住口令。思路参考
> dsh-remote-web-ui：独立轻量远程界面 + 门禁，不复用桌面 UI。

## 修改 1 — node half 增加远程界面路由（`lib/index.js`）

- `lib/remote-ui.html`：独立移动端优先 SPA（登录门 → 会话列表 → 聊天），
  纯原生 JS，无构建步骤。
- node half 注册 exact 路由 `GET /dsh-lan/ui` 直接读文件返回（`REMOTE_UI_PATH`
  经 `import.meta.url` 解析）。注册顺序在 `disposers` 数组中，与其他路由并列。
- 远程界面通过官方 `/api/*` 走非特权方法（session.list/history/prompt/
  models/selectModel/create、agentPreset.list），特权操作经 `/lanapi` 带
  `x-dsh-lan-key`。事件流走官方 `/api/events.mux` WebSocket（自动订阅全部会话，
  客户端按 sessionId 过滤），断线回退 2.5s 轮询 session.history。

## 修改 2 — 桌面端登录门（`lib/client.js`）

- `mountGate()`/`initGate()`/`verifyKey()`：非回环客户端 boot 即挂全屏遮罩
  （z-index 2147483000），口令通过才移除；右上角"锁定"浮钮可随时重锁。
- 口令失效（/lanapi 403）自动清 key 并重新挂门。
- `setStoredKey(key, remember)`：勾选"记住"存 localStorage，否则 sessionStorage
  （仅当前标签页）。`storedKey()` 两级读取。

## 修改 3 — 远程界面流式渲染优化（`lib/remote-ui.html`）

- 事件聚合：assistant/chunk 按 blockType 分流 text/reasoning（reasoning 折叠
  `<details>`）；tool/call+tool/result 合并为可折叠行。
- 流式输出增量更新：text-delta/block-end 只更新尾部气泡 DOM（`updateTail()`），
  其余事件才全量重建，避免手机上逐块重建卡顿。
- `send()` 不再本地预插用户消息（事件流会回放），避免重复气泡。
- 文件记录：正则从工具参数/结果中提取带扩展名的路径，去重后集中展示。
- 新建会话可选 agentPreset（`agentPreset.list` → `session.create {agentPreset}`）。

## 部署注意

- **升级 node half（lib/index.js）必须重启 dsh web**：进程内存中的旧模块不会被
  patch 热加载替换；客户端 bundle（lib/client.js）刷新浏览器即可（rev 可能不
  变，必要时强制刷新）。
- 测试实例（--port 3099）不要叠 `--patch` 插件的 cordis.patch.yml：profile 补丁
  已含 install block，再叠会 "duplicate loader entry id: dsh-lan"。
- 远程 UI 的 /dsh-lan/ui 在旧模块下会落到 SPA fallback（200 但内容是桌面 index），
  判断是否生效要看返回的 `<!doctype html>` 是否含 "DSH 远程"。

---

# v3 修改记录（2026-08-14）：crypto.randomUUID polyfill + 工作区

> 修复：① 局域网 http:// 是非安全上下文，浏览器没有 crypto.randomUUID，而 DSH 的
> RPC 发号器（AbstractApiClient.mintRpcId）依赖它——局域网设备所有 RPC（历史、
> 会话、设置）全抛 "crypto.randomUUID is not a function"，这是"看不到历史记录"
> 的真正总根因；② 工作区：本机用系统对话框（host.pickDirectory，仅回环+特权），
> 远程设备要用浏览式选择器（host.listDirectory，非特权）——dsh-remote-web-ui 的思路。

## 修改 1 — polyfill（`lib/client.js` 顶部 + `lib/remote-ui.html` 顶部）

- module factory 一开始就检查 `window.crypto.randomUUID`，缺失则用
  `crypto.getRandomValues` 实现 RFC4122 v4 并回填——必须在 DSH 自身 mintRpcId
  首次调用前生效（客户端模块在 boot 早期加载，满足）。
- 远程界面 rpcId() 改为直接调 `window.crypto.randomUUID()`（有 polyfill 兜底）。

## 修改 2 — 远程界面工作区（`lib/remote-ui.html`）

- 视图流改为：登录 → **工作区** → 会话（按工作区过滤）→ 聊天。
- 工作区列表：`workspace.list`（items: workspaceId/path/title/sessionIds）。
- 添加工作区：底部弹出文件夹浏览器 sheet——`host.listDirectory`（crumb 面包屑 +
  目录列表 + 隐藏项淡化）、`host.createDirectory` 新建子文件夹、
  `workspace.create {path}` 采纳当前目录为工作区。全部走非特权 API，局域网可用。
- 会话列表按 `workspace.sessionIds` 过滤；新建会话带 `workspaceId`（+可选 preset）。

## 部署注意（v3）

- v3 只改 `client.js` 与 `remote-ui.html`（均按请求从磁盘读取）：**无需重启**，
  浏览器强制刷新即可。node half（index.js）未变。
- 桌面端局域网新建工作区仍会走原生对话框（仅回环）——移动端请用远程界面的
  文件夹浏览器；桌面端局域网要新建工作区可暂时在本机操作或用 /dsh-lan/ui。

---

# v4 修改记录（2026-08-14）：竖屏移动端自动切换

> 桌面 SPA 在竖屏手机上仍拥挤。参考 dsh-remote-web-ui 的"独立移动界面"思路：
> 不做脆弱的桌面 CSS 魔改，而是检测到竖屏触屏设备时自动切到移动界面。

## 修改 1 — 自动切换（`lib/client.js` factory 顶部 IIFE）

- `autoMobileRedirect()`：全部满足才跳转——
  ① `matchMedia("(orientation: portrait)")`（竖屏）；
  ② `matchMedia("(pointer: coarse)")`（触屏，排除桌面窄窗口）；
  ③ `innerWidth < 1100`；
  ④ 非回环 hostname（本机保留桌面 UI）；
  ⑤ 无 `sessionStorage["dsh-lan-force-desktop"]` 标记；
  ⑥ pathname 是 `/` 或 `/index.html`（SPA 根）。
  满足则 `location.replace("/dsh-lan/ui")`；并监听 `orientationchange`
  再判定（旋转成竖屏立即切走）。
- 在 factory 顶部执行（早于 cordis 装配），boot 早期即跳转。

## 修改 2 — 移动界面出口（`lib/remote-ui.html` 登录页）

- 登录页新增"使用桌面版界面"链接：写 `sessionStorage["dsh-lan-force-desktop"]="1"`
  后 `location.replace("/")`——本标签页内跳过自动切换，用户可坚持用桌面版。

## 部署注意（v4）

- 同 v3：只改 `client.js` 与 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v5 修改记录（2026-08-14）：前端美化（按钮/Markdown/亮暗主题）

> 远程界面三处优化：按钮文字截断、Markdown 渲染、亮/暗主题切换。

## 修改 1 — 按钮与布局（`lib/remote-ui.html` CSS）

- 按钮统一 `white-space:nowrap;overflow:visible;flex:none`，去掉 `header button`
  的固定 `min-width:64px`（改 `min-height:36px;padding:8px 11px`），header 压缩
  间距，标题 `min-width:0` + ellipsis——窄屏不再截字/溢出。
- `.sheet .actions button{flex:1;text-align:center}`（弹层操作按钮均分）。
- `.card .m`、`.crumb`、`.tool summary .tn` 加 ellipsis；`.msg` 加
  `overflow-wrap:anywhere`。

## 修改 2 — Markdown 渲染（`lib/remote-ui.html`）

- `escHtml()` 先转义再 `inlineMd()` 行内处理：`` `code` ``、**粗体**、*斜体*、
  ~~删除~~、`[链接](https://…)`（新窗口打开）。
- `renderMarkdown(text)` 块级：``` ``` 围栏代码块（`<pre class="mdc">`，
  textContent 写入防注入）、`#`~`####` 标题（mdh1-4）、`-`/`*`/`数字.` 列表
  （mdli）、`>` 引用（mdq）、普通行（mdl）。全部走转义后 innerHTML，无 XSS。
- 助手气泡 `div.appendChild(renderMarkdown(e.text))`；用户气泡保持纯文本；
  流式增量更新 `updateTail()` 同步改为重渲染 markdown。

## 修改 3 — 亮/暗主题（`lib/remote-ui.html`）

- `:root` 全部配色收敛为 CSS 变量；`:root.light{...}` 亮色变量组。
- `<head>` 内联脚本在首帧前读 `localStorage["dsh-lan-theme"]` 设置
  `document.documentElement.classList`（防闪白）。
- `☀️/🌙` 圆钮三处：登录页（绝对定位右上角）、工作区页、聊天页头部；
  `toggleTheme()` 切换并持久化 localStorage。
- 按钮图标表示当前模式将切换到的主题（暗→☀️ 表示可切亮）。

## 部署注意（v5）

- 同 v3/v4：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v6 修改记录（2026-08-14）：四个 UI 问题修复

> 用户实测反馈：① 工具行看不到名称后面的字；② 文件夹选择器无法切换盘符、
> 名称只显示上半截；③ 模型选择下拉文字为空；④ 主题按钮挡住旁边按钮。

## 修复 1 — 工具行显示参数预览（`lib/remote-ui.html`）

- `.tool summary` 去掉 `display:flex`（移动端 `<details>/<summary>` 兼容性），
  改为 inline 流式：`<span.tn>名称</span> + <span.tp>预览</span> + 失败徽标`。
- `toolPreview(e)`：从 args JSON / result 提取一行预览（去引号花括号、压缩空白、
  截 60 字符），无内容时显示"点击查看详情"。名称不再被截断。

## 修复 2 — 文件夹选择器（`lib/remote-ui.html`）

- **盘符/路径切换**：新增路径输入框 + 「跳转」按钮（Enter 也可），输入
  `D:\` 或完整路径即可跨盘符（宿主侧 listDirectory 直接按 path 列目录）。
- **名称显示不全**：`.wsentry` 去掉 `white-space:nowrap;overflow:hidden`（旧版
  在某些安卓浏览器上把文字裁成半截），改为 `display:block;line-height:1.45;
  word-break:break-all` 允许换行完整显示；📁 图标改到 CSS `::before`
  （避免 emoji 内联导致的行盒裁切）。

## 修复 3 — 模型选择字段名（`lib/remote-ui.html`）

- 真实 schema：分组 `{id,name,models}`、模型 `{id,name,reasoning:{efforts,defaultEffort}}`、
  current `{provider,model,reasoningEffort}`。
- 旧代码用 `g.provider`（undefined → 下拉全空）与 `model.reasoningEfforts`（不存在）。
  修正为 `g.id/g.name`、`model.reasoning.efforts`、默认选 `current.reasoningEffort ||
  model.reasoning.defaultEffort`；provider 不存在于分组时回退第一组。

## 修复 4 — 主题按钮遮挡（`lib/remote-ui.html`）

- `.theme-btn` 去掉全局 `position:absolute`（头部流式排列不再压住旁边按钮），
  改为仅 `#login .theme-btn{position:absolute;top:14px;right:14px}`（登录页悬浮）。

## 部署注意（v6）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v7 修改记录（2026-08-14）：消息回显/思考动画/模型层级/底部信息栏

> 用户需求：① 发送后自己的消息要立即可见；② 思考过程用呼吸动画表示工作中；
> ③ 模型选择用不同层级按钮（提供商→模型）；④ 模型/缓存命中率/已用 token 显示
> 在输入框下方，右上角按钮改为"模式"切换工作模式。

## 修改 1 — 乐观发送 + 流回显去重（`lib/remote-ui.html`）

- `send()` 恢复乐观插入：本地立即 push `{kind:"user", text, optimistic:true}`
  并渲染（v3 去掉乐观插入导致自己的消息只能等流回放，手机上感觉"发不出去"）。
- `pushEvent(user/text)` 去重：若尾部是 `optimistic` 且文本相同 → 仅标记
  `optimistic=false` 采纳，不重复插入。

## 修改 2 — 思考过程呼吸动画（`lib/remote-ui.html`）

- `pushEvent` 追踪 `reasonLive`：reasoning 块开始/text-delta 置 true，
  block-end / tool/call / assistant/text 置 false。
- `renderTimeline` 保留 reason 元素引用（reasonEl/reasonBodyEl）；
  `updateTail` 流式更新思考文本并切换 `.reason.live` 类。
- CSS：`@keyframes dshBreath`（1.6s 透明度呼吸）+ 边框变强调色 +
  summary 前加"● "呼吸圆点。

## 修改 3 — 模型选择层级按钮（`lib/remote-ui.html`）

- 弹层重构：**提供商 = 圆片按钮**（chips，横向换行）→ **模型 = 大行列表**
  （mrow：名称 + 描述 + 当前高亮）→ **思考强度 = 圆片**（有才显示）。
- 选择逻辑用状态变量 `mProvider/mModel/mEffort`，点击即重渲染；
  默认强度 = 当前会话的 `reasoningEffort` 或模型 `reasoning.defaultEffort`。

## 修改 4 — 底部信息栏 + 模式切换（`lib/remote-ui.html`）

- 输入框下方新增 `#statbar`：左 = 模型圆片按钮（`#sb-model`，点击打开模型弹层，
  显示当前模型名），右 = `缓存 X% · 已用 Xk`（`#sb-stats`，来自
  session.list 的 tokenUsage：命中率=cacheRead/(cacheRead+uncachedInput)，
  已用=uncachedInput+output+cacheWrite）。进入会话立即刷新 + 每 12s 轮询，
  发送/切模型后即时刷新。
- 聊天头部右按钮"模型"→"**模式**"：新弹层 `#mode-sheet` 列出
  `agentPreset.list`（mrow 列表 + 当前高亮），点击调 `agentPreset.select
  {sessionId, agentPreset}`（非特权，局域网可用）切换工作模式。

## 部署注意（v7）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v8 修改记录（2026-08-14）：状态栏默认显示模型名+思考强度

> 用户反馈：左下角模型按钮进入会话后要点开才显示模型，应默认直接显示
> 当前模型名和思考强度。

## 修改（`lib/remote-ui.html`）

- 新增 `modelLabelFrom(data)`：从 session.models 计算显示名，格式
  `模型名 · 思考强度`（强度取 current.reasoningEffort，缺省回退模型
  reasoning.defaultEffort；无强度则只显示模型名）。
- 新增 `loadModelLabel()`：进会话时自动拉取 session.models 并写入
  `#sb-model`——`openChat()` 里 `void loadModelLabel()`（与历史/状态栏并行，
  不阻塞进入）。
- `openModelsSheet`/`saveModel` 复用同一格式化：切换模型/强度后状态栏
  立即显示新值（saveModel 用 `value.selected.reasoningEffort || mEffort`）。

## 部署注意（v8）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v9 修改记录（2026-08-14）：发送按钮居中/思考动画强化/两行状态栏

> 用户反馈：① 发送按钮应与输入框垂直中心对齐；② 思考呼吸动画仍不显示；
> ③ 模型按钮高度不变，右侧改两行小字：`缓存 xx% · xx tok/s` + `输入 xxM · 输出 xxM`。

## 修改 1 — 发送按钮垂直居中（`lib/remote-ui.html` CSS）

- `#composer button` 由 `align-self:flex-end` 改为 `align-self:center`。

## 修改 2 — 思考动画强化（`lib/remote-ui.html`）

- **根因排查**：旧增量更新在"新一轮开始"时引用失效——`updateTail()` 拿到的
  tailEl/reasonEl/tailEv 指向上一轮已结束的块，新块文字/动画不落地。
  新增引用守卫：`updateTail` 开头若 `tailEv !== events[events.length-1]`
  （引用已过期）→ 直接全量重渲染，保证动画与文本落地。
- 呼吸动画增强：`dshBreath` 呼吸幅度加深（opacity .4）+ `summary::before`
  改"●"脉冲圆点（`dshPulse` 0.8s 缩放+淡入淡出）。
- 新增全局**"思考中…"指示器**：`working` 状态（assistant/chunk 置 true；
  assistant/text、tool/call、tool/result、user/text 置 false；block-end 延迟
  1.2s 后置 false，避免块间闪烁）。renderTimeline 末尾追加
  `<div id="working-ind" class="working">● 思考中…</div>`，圆点脉冲动画。
  `setWorking()` 直接切换元素可见性（无需重渲染）。

## 修改 3 — 状态栏两行布局（`lib/remote-ui.html`）

- `#sb-stats` 改为 flex-column 右对齐两行：`#sb-line1` =
  `缓存 xx% · xx tok/s`（tok/s = sessionStats.decodeTokens/(decodeMs/1000)），
  `#sb-line2` = `输入 xxM · 输出 xxM`（输入=uncachedInput+cacheRead+
  cacheWrite，输出=outputTokens，自适应 M/k 缩写）。
- 模型按钮 `min-height:28px` 不变、`align-self:center` 与两行文字垂直居中。
- 进会话时清空两行；12s 轮询 + 发送后即时刷新。

## 部署注意（v9）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v10 修改记录（2026-08-14）：对话加载动画/输入框自适应/思考指示器误显

> 用户反馈：① 进入对话要有加载动画（不是空白页）；② 输入框默认与发送按钮
> 同高、输入时自动增高最多 5 行；③ "思考中"动画不思考时仍显示。

## 修改 1 — 对话加载动画（`lib/remote-ui.html`）

- openChat 清空消息区后先插入 `.loading`（`spinner` 旋转圈 + "正在加载对话…"），
  `session.history` 返回后 `ingestHistory` → `renderTimeline` 自动清掉；失败路径
  先移除 loader 再报错。CSS：`dshSpin` 旋转动画 + 26px 圆环。

## 修改 2 — 输入框自适应（`lib/remote-ui.html`）

- `#composer textarea`：`height/min-height:38px`（与发送按钮同高）、
  `max-height:120px`（约 5 行）、`overflow-y:auto`、`rows="1"`。
- `autoresize(el)`：input 事件触发（先 auto 再取 `min(scrollHeight,120)`）；
  发送后与进会话时重置。按钮 `align-self:center` 保持随高度增长垂直居中。

## 修改 3 — "思考中"误显示修复（`lib/remote-ui.html`）

- **根因**：打开对话时历史回放（ingestHistory）也走 `setWorking(true)`——
  历史里任何 chunk 都会点亮指示器，且不思考时永不熄灭。
- **修复**：`pushEvent(ev, live)` 加 live 参数——只有实时事件才驱动
  `setWorking`；历史回放 `live=false`。
- `ingestHistory(list, liveFromSeq)`：openChat 不带参数（全静默）；
  轮询传 `seenSeq`（只有 seq 更大的新事件 live）；WS 帧
  `applyLiveEvent` 直接 `pushEvent(ev, true)`。
- 结论：打开一个已结束的会话不会出现"思考中"；会话真的在跑时（WS/轮询
  新事件）指示器照常点亮。

## 部署注意（v10）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v11 修改记录（2026-08-14）：用户消息事件类型/思考文本块类型/指示器时序

> 通过 dump 真实历史数据（40030 条事件）定位三个根因：
> ① 用户消息事件类型是 `user/message`（data.content[]），代码只认
> `user/text` → 历史自己的消息从不显示；② 思考文本是 `reasoning-delta`
> 块（21110 条），代码只认 `text-delta` → 思考内容从未渲染、呼吸动画
> 无从谈起；③ 块类型含 `finish`/`turn/end`，指示器时序应该用它们。
> ④ 用户要求回车=换行、仅按钮发送。

## 修复 1 — 用户消息渲染（`lib/remote-ui.html`）

- `userMessageText(d)`：从 `data.content[]` 提取 type=text 的文本拼接。
- `pushEvent` 新增 `user/message` 分支：文本含 `<system-reminder>` 的
  内部转向消息跳过（不污染聊天）；对尾部 optimistic 条目做同文本去重。
- 历史回放（打开会话）也能渲染自己的历史消息了。

## 修复 2 — 思考内容实时显示 + 指示器时序（`lib/remote-ui.html`）

- `assistant/chunk` 新增 `reasoning-delta` 分支：文本追加到最后一个
  open 助手事件的 reasoning，置 reasonLive=true → 思考块实时填充、
  呼吸动画真正生效。
- 指示器时序重写（基于真实生命周期）：
  - `send()` 立即 `setWorking(true)`（思考阶段即亮，不再等首个输出）；
  - `turn/start` → true；任意 `assistant/chunk` → true；
  - `turn/end` → false（回合完成）；
  - chunk `finish` → 1.2s 延迟 false（步流结束，等待下一步）；
  - 移除 tool/call、tool/result、block-end 的置 false（回合仍在进行）。

## 修复 3 — 回车=换行（`lib/remote-ui.html`）

- 删除 keydown Enter→send 监听；发送仅通过「发送」按钮。
  （textarea rows=1 + autoresize 保证回车换行后自动增高。）

## 部署注意（v11）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v12/v13 修改记录（2026-08-14）：WS 信封解析（真根因）+ 停止按钮 + 实时性

> 用户反馈：① 还是没有思考中状态、消息不够实时；② 发送按钮在工作时应变
> 停止符号，点击强制停止（与桌面端一致）。
>
> **真根因（v13）**：WS 线上帧是 `{type:"server-request", rpcId, method,
> payload}` 信封，内部 payload 才是 `session/event`。旧代码
> `applyLiveEvent(JSON.parse(msg))` 直接检查 `frame.type === "session/event"`
> ——永远匹配不上，**WebSocket 从未处理过任何实时事件**（之前所有"实时"
> 都是 1s 轮询的假象；anim 测试同样误读信封导致误判）。

## 修复 1 — WS 信封解析（`lib/remote-ui.html`，v13 核心）

- `ws.onmessage`：解析 `server-request` 信封，取 `wire.payload`，仅当
  `payload.type === "session/event"` 时交给 `applyLiveEvent(payload)`。
- 端到端实测（新建会话 + 发送 + WS 监听）：`subscribed 1 / user/message 2 /
  reasoning-delta 16 / text-delta 2 / turn/start·end·finish 各 1` —— 实时流
  PASS。手机从此真正流式接收：思考文本实时流入 + 呼吸动画 + 消息逐字出现。

## 修复 2 — 思考中指示器无条件即时显示（`lib/remote-ui.html`，v12）

- `setWorking(v)`：元素不存在时**即时创建**（不再依赖渲染时序）；
- 发送按钮 ⇄ 停止按钮联动：`working` 时显示 `⏹ 停止`（红色），点击调
  `session.cancel {sessionId}`（schema 确认 `{sessionId}` → `{accepted}`）停止
  回合，与桌面端行为一致；空闲时恢复"发送"。

## 修复 3 — 实时性优化（`lib/remote-ui.html`，v12）

- `applyLiveEvent` 渲染路由：text-delta / reasoning-delta / block-end →
  增量 `updateTail`；block-start → 全量；**tool-call-delta / usage / finish
  不触发渲染**（历史中分别有 15609 / 41 / 41 条，逐块全量重渲染是手机卡顿
  主因）。
- `updateTail` 新增 reasonEv 引用（纯思考回合也可增量更新）。
- WS 自动重连（2s 间隔，离开会话停止）+ 首次连接提示只显示一次。
- 轮询兜底 2500ms → 1000ms。

## 部署注意（v12/v13）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。
- 测试会话已通过 `workspace.archiveSession` 清理。

---

# v14 修改记录（2026-08-14）：思考指示去重/极简停止图标/工具执行防闪烁

> 用户反馈：① "思考过程"块与"思考中…"药丸重复；② 停止按钮去掉"停止"
> 二字只要极简 icon；③ pwsh 执行停顿半秒时停止按钮短暂变回发送。

## 修复 1 — 思考指示去重（`lib/remote-ui.html`）

- `reasoningLive()`：尾部助手事件 `reasonLive === true` 即"思考块正在呼吸"。
- `setWorking` 与 renderTimeline 的指示器显示条件统一为
  `working && !reasoningLive()`——**思考块呼吸时隐藏"思考中…"药丸**（呼吸块
  本身就是工作指示）；思考结束（block-end 重新 `setWorking(working)` 评估）
  且回合仍在进行（如跑工具/输出文本）时药丸再出现。

## 修复 2 — 极简停止图标（`lib/remote-ui.html`）

- 工作时按钮内容改为内联 SVG 白色实心圆角方块（14×14，fill=currentColor），
  红色背景，无文字；空闲恢复"发送"。

## 修复 3 — 工具执行期间停止按钮防闪烁（`lib/remote-ui.html`）

- 根因：`finish` 块设置 1.2s 延迟熄灭，工具（如 pwsh）执行期间无新 chunk，
  计时器到期误置 working=false → 按钮短暂变回"发送"。
- 修复：`tool/call` 与 `tool/result` 分支 `if (live) setWorking(true)`——
  工具事件到达立即重新点亮并**取消挂起的熄灭计时器**；回合真正结束由
  `turn/end` 熄灭。工具执行再久按钮都保持停止态。

## 部署注意（v14）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v15 修改记录（2026-08-14）：思考过程改一行灰字（桌面端风格）

> 用户要求：思考过程用**一行灰字实时显示**（类似桌面端），点击该行可展开/
> 折叠，默认折叠；去掉"思考中…"药丸（灰字行本身就是工作指示）。

## 修改（`lib/remote-ui.html`）

- 思考块重做：`details.reason` 的 summary 改为**单行灰字**
  （`white-space:nowrap;overflow:hidden;text-overflow:ellipsis`，无系统箭头），
  内容实时流式更新（`reasonSumEl` 引用同步刷新）；点击默认行为展开/折叠
  （默认折叠），展开显示完整文本（`.rbody`）。
- 思考中指示：summary 前的小圆点（`.dot`）在工作时变强调色 + 脉冲动画
  （`dshPulse`）——即"正在思考"的暗示，无额外药丸。
- 删除"思考中…"药丸（working-ind）及其 CSS（`.working`/`.wdot`）、
  `reasoningLive()` 判定与 block-end 的冗余重评估；`working` 状态仅驱动
  发送/停止按钮切换。
- 移除不再使用的 `dshBreath` 整块呼吸动画（保留 `dshPulse` 圆点脉冲）。

## 部署注意（v15）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v16 修改记录（2026-08-14）：消息区上翻不被拉回 + 回到底部按钮

> 用户反馈：流式输出时往上翻旧消息会被强制拉回底部；应允许上翻，上翻时
> 消息区下方显示向下箭头，点击回到最新。

## 修改（`lib/remote-ui.html`）

- **钉底状态** `pinned`：滚动容器距离底部 <40px 视为"钉在底部"（默认 true）。
  `#msgs` 的 scroll 事件监听更新 `setPinned(near)`。
- `renderTimeline` / `updateTail` 的自动滚底改为 `if (pinned)` 条件执行——
  上翻后不再被流式更新强行拉回。
- **悬浮"↓"按钮**：`#msgs` 外包 `.msgs-wrap`（relative），按钮绝对定位
  右下角（40px 圆钮，阴影），上翻时显示，点击 `scrollTop=scrollHeight` 并
  恢复 pinned。
- `openChat` 重置 `setPinned(true)`。

## 部署注意（v16）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v17 修改记录（2026-08-14）：蓝点脉冲增强 + 灰字显示最新文字

> 用户反馈：① 蓝点呼吸不够快、不明显；② 思考灰字要显示最新文字，不能不变。

## 修改 1 — 蓝点脉冲增强（`lib/remote-ui.html` CSS）

- `dshPulse` 提速：0.8s → **0.5s**；幅度加深：opacity .3→**.2**、scale .75→**.45**。
- 圆点 6px → 7px，live 时加**光晕** `box-shadow:0 0 8px var(--accent)`。

## 修改 2 — 灰字显示最新文字（`lib/remote-ui.html`）

- **根因**：单行灰字用 CSS 省略号截断**开头**，而思考流的新文字都在**末尾**，
  头部内容长期不变 → 视觉上"灰字不变"。
- **修复**：`reasonLineText()` —— 超过 120 字符时**截头留尾**
  （`"…" + text.slice(-119)`），单行灰字始终显示**最新**的思考文字；
  renderTimeline 初始渲染与 updateTail 实时更新共用该函数。

## 部署注意（v17）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v18 修改记录（2026-08-14）：思考中灰字行不可展开

> 用户要求：思考过程为"思考中"状态时，灰字行不可点击展开，只能是折叠状态；
> 思考结束后才允许展开/折叠。

## 修改（`lib/remote-ui.html`）

- renderTimeline 创建 reasoning `<details>` 时给 summary 挂 click 监听：
  若 `det.classList.contains("live")` → `ev.preventDefault()` 阻断原生 toggle，
  并强制 `det.open = false` 保持折叠。
- CSS：`.reason.live summary{cursor:default}`（思考中显示不可点击光标）。
- 思考结束（block-end → live 类移除）后恢复可点击。

## 部署注意（v18）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v19 修改记录（2026-08-14）：移动端审批/提问对话框（approval / ask_user_question）

> 用户反馈：移动端无法处理"让用户选择的对话框"——agent 请求工具执行审批
> （approval）或调用 ask_user_question 提问时，远程界面没有任何可交互 UI，
> 回合会一直卡住。

## 协议调研（dsh-host-apiproxy）

- mux WS 帧里有两类**可应答** server-request（信封 `{type:"server-request",
  rpcId, method, payload}`，payload 即帧）：
  - `approval/requested`：`{sessionId, approvalId, toolName, callId?, reason?}`
  - `question/requested`：`{sessionId, questions:[{id, question, detail?,
    header?, options?:[{label, description?}], multiSelect?, intent?}]}`
- 应答统一走 **POST /api/respond**，body 为 client-response 信封
  `{type:"client-response", rpcId, result}`，**rpcId 回显**请求帧的 rpcId；
  返回 `{accepted:true}` 或 `{accepted:false, reason:"not-pending"|"bad-response"}`。
- **approval 应答**：`result:{ok:true, value:{sessionId, approvalId,
  outcome:"allowed-once"|"rejected"}}`（cancelled/unavailable 是宿主侧结果，
  客户端只能给这两个）。
- **question 应答**：`result:{ok:true, value:{sessionId, answer:{answers:[
  {id, selected:[label…], custom?}]}}}`；answers 必须与 questions **一一对应
  （长度相等、id 相同、顺序一致）**；单选不可同时带 custom；selected 必须在
  选项 label 集合内（允许空数组=跳过）。
- **question 取消**：`result:{ok:false, error:{code:"cancelled", message,
  details:{}}}`——注意 `rpcErrorSchema` 要求 **details 必填**（漏掉 → 整包被
  clientResponseSchema 拒为 bad-response），这是取消路径踩过的坑。
- 结算帧：`approval/resolved {sessionId, approvalId, outcome}` 与
  `question/resolved {sessionId, questionRpcId, outcome:"answered"|"cancelled"}`
  （纯 push，撤销对话框）。
- mux 重连会**原样重放**仍未决的 requested 帧（rpcId 不变）——按 rpcId 去重。

## 修改（`lib/remote-ui.html`）

- **WS 路由扩展**：ws.onmessage 除 `session/event` 外，新增
  `approval/requested | question/requested | approval/resolved |
  question/resolved` → `onMuxInteraction(frame, wire.rpcId)`。
- **pendingDialogs Map**（rpcId → entry，去重重放）：approval 存 payload；
  question 另存 `sel`（questionId→Set(label)）与 `custom`（questionId→文本）。
- **对话框 UI**：`#pending-dlg` 全屏居中弹层（z-index 80，盖过 sheet 层），
  仅显示**当前会话**的最新未决交互（`showDialogIfCurrent`，按 sessionId 过滤；
  离开会话视图自动隐藏，openChat 时重新弹出）。
  - approval：标题「需要授权」+ 工具名徽标；正文 reason（缺省"智能体请求执行
    该工具"）；按 callId 在时间线里找配对 tool 事件显示参数预览；
    按钮 **拒绝 / 允许一次**（与桌面端一致）。
  - question：标题「请回答」+ 徽标（plan-review intent →「计划审批」）；
    逐题渲染 header/问题/detail（等宽滚动块）；有 options 时单选/多选按钮
    （✓ 选中态，点已选项可取消），无 options 时自由文本 textarea；
    按钮 **取消 / 提交**（提交前无强制校验，空选择=跳过，服务端允许）。
  - 应答后按钮禁用并显示「已提交，等待处理…」；收到 resolved 帧撤销；
    8s 兜底自动撤销（防 WS 断线后残留）。
  - 取消走 `error.code:"cancelled"`（含 `details:{}`），收到即撤。
- **integration**：`show()` 离开 chat 视图时 hidePendingDlg；`openChat()`
  末尾 showDialogIfCurrent()（覆盖重连重放/跨会话积压）。

## 验证（真实端到端）

- `F:\temps\dsh测试\_t_question.js`：建会话 → 连 mux → prompt 要求模型调用
  ask_user_question → 收到 question/requested（rpcId）→ 先挂 resolved 监听再
  POST /api/respond 应答 → `{accepted:true}` + `question/resolved(answered)`；
  第二问走取消 → `{accepted:true}` + `question/resolved(cancelled)` → 归档会话。
  **全部 PASS**。注意：resolved 帧在 respond 处理器内同步广播，监听器必须先挂
  再应答，否则有竞态（测试脚本踩过）。
- approval 路径与桌面端 `PendingApproval.answer` 载荷逐字一致，schema 校验
  （approvalResponsePayloadSchema）已核对；本环境审批被禁用无法实测。
- 已同步安装副本，服务端 /dsh-lan/ui 返回 70175 字节含全部新标记。

## 部署注意（v19）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v20 修改记录（2026-08-14）：对话缓存 + 增量加载（只拉新内容）

> 用户要求：移动端应有缓存功能，重新进入对话时只需从最后的时间点加载更新
> 的内容，而不是全量重拉（实测单个会话可达 46 万条事件，全量拉取在手机上
> 很慢）。

## 协议调研（dsh-host-apiproxy）

- `session.history` **没有 forward "since" 参数**——只有 `beforeSeq`/`maxMessages`
  **从尾部向前翻页**（默认 50 条消息/页，`hasMore` 表示还有更旧的内容；
  页边界对齐 append-origin 消息组，不会切在消息中间；tail 页额外携带 in-flight
  partial）。增量加载只能靠"tail 页 + beforeSeq 向前桥接"实现。

## 修改（`lib/remote-ui.html`）

- **localStorage 缓存**：`dsh-lan-cache:<sessionId>` = `{v:1, updatedAt,
  seenSeq, events}`（存紧凑时间线数组，不是原始事件，体积小可直接渲染）。
  单会话上限 900KB（超出从头部裁 20%/轮，保留最新内容——旧头缺失无所谓，
  增量同步会补）；配额超限时先删其他会话的缓存再重试一次。
- **缓存优先打开**（openChat）：有缓存 → 立即渲染 + 顶部 `#sync-hint` 显示
  "已载入本地缓存（时间），正在同步新内容…" → `syncHistory()` 只拉增量 →
  同步完成提示消失；无缓存 → 保留原 loading 动画 + 一次性全量拉取
  （`maxMessages:100000`，服务端无上限），随后写入缓存。
- **`syncHistory()` 增量桥接**：tail 页（40 条消息/页）→ 收集 seq > 缓存点
  的事件 → 若页首 seq 仍大于缓存点则用 `beforeSeq=页首 seq` 继续向前翻页，
  直到某页覆盖到缓存点或 `hasMore=false`；上限 30 页。返回是否桥接完整
  （只有桥接完整才覆盖缓存，避免缓存倒退）。
- **页序陷阱（重要）**：翻页是"新页在前、页内升序"，**不能把收集结果整体
  反转**（会把页内顺序也颠倒）——必须**按页倒序应用、页内保持升序**。
  这个坑被 46 万事件会话的实测抓出来过（step/start 与 step/end 顺序颠倒）。
- **pushEvent seq 去重守卫**：`ev.seq <= seenSeq` 直接跳过——历史重放、
  跨页重叠、WS 帧重投都安全；顺带修掉了轮询兜底全量重放会重复渲染的潜在
  bug（seenSeq 记账统一收进 pushEvent）。
- **落盘时机**：离开会话（closeWs）/切换会话（openChat 顶部）/同步完成/
  发送回退路径；WS 断线轮询改为每 1s 一次 `syncHistory(quiet, liveFrom)`，
  仅在有新事件（cacheDirty）时才写缓存。"锁定"按钮会清空全部缓存（隐私）。
- **send() 回退**（无 WS 时）：全量重拉改为增量 `syncHistory`。

## 验证（真实服务端）

- `F:\temps\dsh测试\_t_cache.js`：7875 事件会话，从中间 seq 桥接 → 收集数
  与全量参考完全一致、1 页桥接、tail-target 边界（0 收集）PASS。
- `_t_cache4.js`（镜像 UI 算法的逐页应用）：**46~48 万事件**会话，从半程
  seq 桥接 → 8 页、顺序（按页倒序后全局升序）、数量（maxSeq-target 精确）、
  区间（[target+1, maxSeq]）、无重复全部 PASS。
- 已同步安装副本；服务端 /dsh-lan/ui 返回 76631 字节含全部 v20 标记。

## 部署注意（v20）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。
- 首次打开某会话仍会全量加载一次（用于建立缓存）；之后打开即秒开 + 增量。

---

# v21 修改记录（2026-08-14）：历史拉取/渲染/缓存全部加上限（修复打开会话卡死+网速狂飙）

> 用户反馈：移动端打开会话后无内容显示、网速狂飙。根因：v20 的无缓存首屏
> 用 `maxMessages:100000` 一次全拉（用户主会话实测 46~51 万事件、单页 40 条
> 消息就含 3.8~4.3 万事件 ≈ 8MB JSON，全拉可达 90MB+），增量桥接页上限 30
> 页（120 万事件）在缓存过期时同样失控；且 `saveCache` 的循环裁剪（每轮
> 20% + 重新 stringify）在几十万条目上是 O(n²)，会卡死主线程。

## 修改（`lib/remote-ui.html`）

- **全局上限常量**：`SYNC_MAX_PAGES 30→12`、新增 `SYNC_EVENT_CAP=60000`
  （事件数软上限，最多超出一页 ≈ 4 万）、`MAX_COMPACT=4000`（紧凑时间线
  条目上限，超出 shift 头部）、`MAX_RENDER=1500`（单次渲染条目上限）、
  `CACHE_MAX_ENTRIES=2000`（缓存条目上限）、`FETCH_TIMEOUT=20000`。
- **fetchFullHistory（10 万消息全拉）删除**，改为 `fetchWindow(sessionId,
  maxPages, eventCap)`：从 tail 向后翻页，页数/事件数双上限，带 20s 超时
  （`apiWithTimeout`，AbortController 实现）。无缓存首屏只拉 **1 页
  （40 条消息）** 立即渲染；`hasMore` 为真时时间线顶部出现
  **「加载更早消息」按钮**（`loadOlder`：再拉一页，`aggregateInto` 页内
  聚合后 `unshift` 插头部，不经过 seq 守卫；页边界对齐消息组保证不重叠）。
- **pushEvent 拆分出 `aggregateInto(ev, arr, live)`**：主时间线、历史回放、
  loadOlder 头部插入共用同一聚合逻辑。新增 `oldestSeq` 追踪（compact 条目
  最小 seq），`trimCompact()` 限制条目数。
- **renderTimeline 渲染上限**：只渲染尾部 1500 条目，被裁的部分显示
  「更早的 N 条消息未显示」提示。
- **saveCache 重写**：先截到 2000 条目再 stringify（消除 O(n²) 循环裁剪），
  超 900KB 只再半切一次；缓存新增 `oldestSeq` 字段。
- **loadCache 要求 `oldestSeq` 存在**：v20 旧缓存（无该字段）直接失效重建，
  防止「加载更早」在无法定位边界时重复插入 tail 内容。
- 增量桥接（syncHistory）同样走 `apiWithTimeout` + 12 页/6 万事件上限，
  超限时应用已有内容但返回未桥接（不覆盖缓存）。

## 验证（真实服务端，46~51 万事件活跃会话）

- `F:\temps\dsh测试\_t_window.js`：tail 1 页 38763 事件 178ms；loadOlder 页
  42910 事件与 page1 **零重叠**；封顶遍历 2 页 81673 事件（软上限 ≤ cap+单页
  最大页）页间连续（max+1=下一页 min）。**PASS**。
- 已同步安装副本；服务端 /dsh-lan/ui 返回 82860 字节，含全部 v21 标记且无
  遗留全量加载代码。

## 行为变化（用户可见）

- 无缓存首屏：只显示最近 40 条消息窗口 + 顶部「加载更早消息」按钮（可反复
  点击逐页回溯）；不再一次性下载整个会话。
- 会话真正很长时顶部会显示「更早的 N 条消息未显示」。
- 手机端最坏情况：一次增量拉取 ≤ ~10 万事件（≈20MB），正常情况 1 页
  （≈8MB）或 0。

## 部署注意（v21）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。
- 旧 v20 缓存会在下次打开时自动失效重建（无需手动清理）。

---

# v22 修改记录（2026-08-14）：无缓存首屏空白修复（ingestHistory 数据结构错配）+ 去状态栏横线

> 用户反馈：① 打开会话后内容不显示，必须点一下"加载更早消息"按钮才显示；
> ② 取消消息发送框和模型按钮之间的横线。

## 修复 1 — 无缓存首屏空白（根因）

- **根因**：v21 的 `fetchWindow` 返回的是**裸事件数组**（已剥掉 `{event}`
  包装），而 `ingestHistory` 仍按 v20 的语义处理 **`{event}` 包装数组**
  （`const ev = entry && entry.event;`）→ 所有事件 `if (!ev) continue`
  被跳过 → `events` 为空 → renderTimeline 只渲染出"加载更早消息"按钮，
  没有消息内容。点按钮后 `loadOlder` 直接用 `aggregateInto(裸事件)` 处理，
  内容才出现——与用户描述完全吻合。
- **修复**：`ingestHistory` 改为直接遍历**裸事件**（唯一调用点 openChat
  无缓存路径传的就是裸事件数组），与 `pushEvent`/`aggregateInto` 语义一致。
- 验证（真实服务端 tail 页 26756 事件）：v21 语义应用 0 个（全跳过），
  v22 语义应用 26756 个。**PASS**。

## 修复 2 — 状态栏横线

- `#statbar` 去掉 `border-top:1px solid var(--line)`（发送框与模型按钮之间
  的分隔线）。

## 验证

- 已同步安装副本；服务端 /dsh-lan/ui 返回 82862 字节，含修复后标记且无
  旧 statbar 边框样式。

## 部署注意（v22）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v23 修改记录（2026-08-14）：缩小发送框与状态栏之间的垂直空白

> 用户要求：缩小消息发送框、发送按钮与下方内容（状态栏/模型按钮）的垂直空白。

## 修改（`lib/remote-ui.html` CSS）

- `#composer` padding：`10px 12px` → `6px 12px`（上下各减 4px）。
- `#statbar` padding：`6px 12px calc(6px + env(safe-area-inset-bottom))` →
  `4px 12px calc(4px + env(safe-area-inset-bottom))`（上减 2px，底部安全区
  同步收窄）。
- 发送框与模型按钮之间的垂直空白从 ~16px 缩到 ~10px。

## 验证

- 已同步安装副本；服务端 /dsh-lan/ui 返回 82861 字节，两个 padding 样式
  均已生效。

## 部署注意（v23）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v24 修改记录（2026-08-14）：修复 WS 实时事件被 seq 守卫全部吞掉（实时流/思考过程失效）

> 用户反馈：v21 之后实时内容有问题，也看不到思考过程（无逐字流、无思考
> 灰字、无呼吸动画）。

## 根因（v20 引入的回归）

- v13 时代 `applyLiveEvent` 在调 `pushEvent` **之前**先 `seenSeq = ev.seq`
  （当时 pushEvent 不管理 seenSeq，这是必需的）。
- v20 把 seenSeq 记账收进 pushEvent 并新增去重守卫
  `if (ev.seq <= seenSeq) return;`——但 `applyLiveEvent` 的提前更新没删：
  守卫看到的变成 `ev.seq <= ev.seq`（相等）→ **每个 WS 实时事件都被丢弃**。
  历史/轮询路径（ingestHistory/syncHistory）没有提前更新，所以只有实时流坏。
- 症状与根因吻合：打开会话正常（历史可用），发消息后无任何实时输出。

## 修复（`lib/remote-ui.html`）

- `applyLiveEvent` 删除 `if (ev.seq !== undefined) seenSeq = ev.seq;`——
  seenSeq 记账统一由 `pushEvent` 负责（保留第一道 `seq <= seenSeq` 防御检查
  防重投，但不再提前 bump）。加了注释说明为什么不能提前更新。

## 验证（真实端到端，`F:\temps\dsh测试\_t_live.js`）

- 建会话 → mux → prompt（要求展示思考+回复）→ 对同一组 WS 帧分别跑
  v21 语义（提前 bump）与 v24 语义（pushEvent 管账）：
  - v21：聚合条目 **0**、reasoning 空（全部被守卫吞掉）——bug 复现；
  - v24：聚合条目 **3**、reasoning 尾部文本实时流入——修复生效。
  - 注意：两个语义必须用**独立聚合实例**，共享 seenSeq 会互相污染
    （测试脚本第一次踩过）。测试会话已归档。
- 已同步安装副本；服务端 /dsh-lan/ui 返回 83101 字节含修复标记。

## 部署注意（v24）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v25 修改记录（2026-08-14）：移动端任务清单（todos projection，桌面端 TodoPanel 对齐）

> 用户问：移动端能否正确显示桌面端的"任务清单"。答案：此前不能——移动端
> 只把 `todo_write` 当普通工具调用显示一行 JSON 参数，没有结构化面板。

## 调研（桌面端数据链）

- 工具 `todo_write`（dsh-tool-todo）→ `exec.agent.session.append("todo/write",
  {todos})` → **`todos` projection**（key="todos"）：`null` 或
  `[{content: string, status: pending|in_progress|completed}]`；
  **`turn/start` 时清空**（任务清单是"当前回合"的任务）。
- 桌面端 TodoPanel（dsh-client-ui-conversation）读 `useProjection("todos")`：
  折叠面板（默认折叠），标题「任务清单」+ 进度统计（N 完成 · N 进行中 ·
  N 待办），展开后每项用状态字形（✓ 完成 / 转圈 进行中 / 虚线圆 待办）。
- 数据到客户端两条路：
  1. history tail 页的 `projections` 块：`{asOfSeq, values:{todos}}`；
  2. `session/projection` 帧（`{sessionId, key:"todos", value, seq}`）实时推，
     higher-seq-wins（asOfSeq 与帧 seq 同空间可比）。

## 修改（`lib/remote-ui.html`）

- **数据接入**：
  - `fetchWindow` 返回 tail 页的 `projections` 块；无缓存首屏应用之。
  - `syncHistory` 首页（tail 页）提取 `projections` → `applyProjections`。
  - ws.onmessage 新增 `session/projection` 分支：当前会话且 `key==="todos"` →
    `applyTodos(frame.value, frame.seq)`。
- **状态**：`todos`（null 或列表）、`todosSeq`（高者胜）、`todoOpen`（默认折叠，
  与桌面端一致）。
- **UI**：`#todo-panel` 放在消息区上方（sync-hint 之后），折叠显示一行
  「▸/▾ 任务清单 · N 完成 · N 进行中 · N 待办」，展开列出每项字形 + 内容；
  无清单（null/空）时隐藏。openChat 时重置。
- 字形：completed ✓（绿色）/ in_progress ◔（蓝色）/ pending ○（灰）。

## 验证（真实端到端，`F:\temps\dsh测试\_t_todo.js`）

- 建会话 → mux → prompt 让模型调 todo_write（3 个不同状态任务）：
  - 收到 1 个 `session/projection` 帧（key=todos，seq 98），value 为 3 任务列表；
  - history tail 页 `projections.asOfSeq=139`、`values.todos` 为同一列表。
  - **PASS**（session/projection 实时推 + history 块两条路都通）。
- 已同步安装副本；服务端 /dsh-lan/ui 返回 87921 字节含全部标记。

## 部署注意（v25）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。
- 任务清单只在回合进行中（本回合写过 todo_write）显示，turn/start 清空。

---

# v26 修改记录（2026-08-14）：任务清单状态字形改 CSS 圆环 + 文案对齐桌面端

> 用户反馈"任务清单依然无法正确显示"，排查后确认：数据链本身正常（真实
> agent 跑 todo_write，session/projection 帧 + history 块都推了 todos）；
> 真正的问题是用户测试场景里 agent 只是**用文本回复清单、没调 todo_write**，
> 所以没有 todos 投影 → 面板不显示（这是正确行为，桌面端也一样）。
> 顺带修掉一个潜在显示隐患：状态字形用了少见 Unicode（◔/○），手机字体缺失
> 会显示乱码。

## 修改（`lib/remote-ui.html`）

- **状态字形**：`◔`（in_progress）/`○`（pending）→ **CSS 圆环**
  （`.todo-ring`），不依赖字体：
  - completed：✓（绿色，加粗）；
  - in_progress：蓝色圆环 + `dshSpin` 旋转动画；
  - pending：灰色虚线圆环。
- **文案对齐桌面端**：进度统计 `完成/进行中/待办` → `已完成/进行中/待处理`。

## 结论（使用说明）

- 任务清单 = `todo_write` 工具的产物。只有 agent **调用 todo_write 工具**
  （而非用文字回答清单）时，移动端才显示结构化「任务清单」面板；
  这与桌面端 TodoPanel 完全一致。
- 演示会话（`_dlg-demo` 工作区，`_t_todo_demo.js` 创建）：4 项任务
  （1 完成 + 1 进行中 + 2 待处理），移动端打开可见。

## 验证

- 已同步安装副本；服务端 /dsh-lan/ui 返回 88367 字节，`.todo-ring` 样式、
  `已完成` 文案在位，且无 `◔` 残留。

## 部署注意（v26）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v27 修改记录（2026-08-14）：思考展开保持 + 缓存零下载 + 消息复制按钮

> 用户三个需求：① 聊天中点击历史思考过程，展开后立即被折叠（流式更新重渲染
> 丢失 details open 状态）；② 历史长会话缓存到最新后仍下载数 MB（增量同步无条件
> 拉 40 条消息的 tail 页 ≈ 8MB）；③ 自己发送的消息左侧加复制按钮。

## 修复 1 — 思考块展开状态跨重渲染保持（`lib/remote-ui.html`）

- `renderTimeline` 开头保存当前 DOM 里 `.reason[open]` 的事件引用
  （`det._reasonEv`，创建 details 时挂上）到 `expanded` Set；重建时若
  `expanded.has(e) && !e.reasonLive` → `det.open = true`。
- 流式更新（block-start/非 chunk 事件等）触发全量重渲染时，用户展开的
  历史思考块不再被强制折叠。

## 修复 2 — 缓存最新时零下载 + 增量小页（`lib/remote-ui.html`）

- **零下载**：缓存 hit 后不再无条件 `syncHistory`，而是先 `openWs()`，
  等 mux 的 `session/subscribed` 帧（携带会话当前 lastSeq）。若
  `lastSeq <= seenSeq`（缓存已最新）→ 直接结束，**0 历史下载**；否则才
  增量同步。3 秒超时兜底（WS 迟迟不给 subscribed 时主动同步）。
- **增量小页**：新增 `DELTA_PAGE_MESSAGES = 8`，`syncHistory` 用它替代
  `SYNC_PAGE_MESSAGES(40)`——增量通常很小，40 条消息一页可含 ~4 万事件
  （~8MB）且大部分已缓存；8 条消息显著减少"落后很少"时的下载量。
- 竞态保护：`syncHistory`/订阅回调在应用结果与 `saveCache` 前检查
  `current.sessionId === 目标会话`，防止切换会话后旧事件污染新会话。
- 验证（`_t_sub.js`）：subscribed lastSeq == history maxSeq（778==778）；
  小页（8 消息）增量落后 2 轮时 1 页桥接、fresh=378 事件。**PASS**。

## 修复 3 — 用户消息复制按钮（`lib/remote-ui.html`）

- 用户气泡外包 `.msg-row.user-row`，左侧 `.copy-btn`（⧉），点击复制到剪贴板
  后按钮短暂变 ✓。
- `copyText`/`fallbackCopy`：LAN 是 http://（非安全上下文），异步 Clipboard
  API 常不可用，主走 `document.execCommand("copy")`（textarea + select），
  优先尝试 `navigator.clipboard.writeText` 失败再回退。

## 验证

- 已同步安装副本；服务端 /dsh-lan/ui 返回 93163 字节，含全部 v27 标记。

## 部署注意（v27）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v28 修改记录（2026-08-14）：桥接超限丢最旧 + 停止按钮闪烁修复

> 用户两个问题：① 桥接超上限时（缓存太久、桌面端新增很多消息）应自动丢弃
> 最旧消息，而不是完全不加载；② 对话中点击停止按钮，它先变"发送"、松手又变
> 回"停止"。

## 修复 1 — 桥接超上限自动丢弃最旧（`lib/remote-ui.html`）

- **背景**：缓存很旧 + 桌面端新增大量消息时，增量桥接（tail 向前翻页）在页数
  或事件数上限处停住，缓存尾与最新消息之间留下 gap。原 v27 方案是"不应用、
  保留缓存"——用户看不到任何新消息。
- **新方案**：桥接超上限（`SYNC_EVENT_CAP` / `SYNC_MAX_PAGES`）时
  `applyCollected(true)`（dropOld）——**清空旧缓存时间线，只保留已收集的
  最新连续段**，`olderMore=true`（更早内容含 gap 通过"加载更早消息"按钮
  按需补回）。`oldestSeq` 随第一个应用事件更新为最新段起点。
- **不丢数据**：gap 段通过 `loadOlder`（beforeSeq=oldestSeq）可完整补回。
- 上限放宽：`SYNC_MAX_PAGES 12→40`（40×8=320 条消息）、`SYNC_EVENT_CAP
  60000→200000`。
- 验证（`_t_gap.js`，46 万事件会话落后 50 万事件）：dropOld 触发，应用最新段
  201800 事件、seq [429921, 631720] 连续、以 maxSeq 结尾；load-older 页
  maxSeq=429920 正好补上 gap。**PASS**。

## 修复 2 — 停止按钮闪烁（`lib/remote-ui.html`）

- **根因**：`stopTurn` 立即 `setWorking(false)`（按钮变"发送"），但
  `session.cancel` 在途期间，WS 仍在推 cancel 前 in-flight 的事件
  （assistant/chunk、tool/call）→ 这些事件 `setWorking(true)` 把按钮变回
  "停止"，松手时视觉上"又变回停止"。
- **修复**：新增 `stopping` 标志——`setWorking(v)` 里 `if (v && stopping)
  return;` 抑制停止期间的重置 true；`stopTurn` 置 stopping、cancel 失败时恢复
  （stopping=false + setWorking(true)）；`turn/end` 清 stopping；`send()` 与
  `openChat` 重置 stopping。

## 验证

- 已同步安装副本；服务端 /dsh-lan/ui 返回 94155 字节，含 v28 标记。

## 部署注意（v28）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v29 修改记录（2026-08-14）：会话列表删除按钮 + 停止后思考蓝点仍闪修复

> 用户需求：① 对话列表每条最右加删除按钮，删除前弹框确认；② bug：思考过程
> 中点击停止，蓝色呼吸标志仍继续闪。

## 修复 1 — 会话删除按钮 + 确认框（`lib/remote-ui.html`）

- `renderSessions` 每条 `.card` 最右加 `.del-btn`（✕），`stopPropagation` 后弹
  `#confirm-dlg`（复用 `.dlg` 居中弹层）确认；确认调
  `workspace.archiveSession {sessionId}`（归档=删除，非特权、LAN 可用），同时
  清该会话的 localStorage 缓存，随后 `enterSessions()` 刷新。
- **关键**：实测 `archiveSession` 后 **`session.list` 仍包含该会话**（归档只从
  `workspace.list` 的 `archivedSessionIds` 区分，且 workspace 记账槽保留）——所以
  `enterSessions`/`enterWorkspaces` 增加 `archivedIds` 集合，列表渲染前过滤掉
  归档会话，否则删除后条目不会消失。

## 修复 2 — 停止后思考蓝点仍闪（`lib/remote-ui.html`）

- **根因**：`turn/end`（stop/cancel 打断思考）只 `setWorking(false)`，没清最后
  assistant 事件的 `reasonLive`/`open`/`live`——`.reason.live` 类仍在，蓝点
  `dshPulse` 动画继续。
- **修复**：`aggregateInto` 的 `turn/end` 分支清尾部 assistant 的
  `reasonLive=false / open=false / live=false`；随后 `applyLiveEvent` 走全量
  `renderTimeline`，蓝点随之熄灭。

## 验证

- `_t_del.js`：archiveSession 后 session.list 仍含该会话（证实需 UI 过滤）、
  archivedSessionIds 含之。
- 已同步安装副本；服务端 /dsh-lan/ui 返回 96881 字节，含 v29 标记。

## 部署注意（v29）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v30 修改记录（2026-08-14）：聊天页两行头部 + 权限选择按钮 + 返回箭头/主题按钮

> 用户需求：① 返回按钮改向左箭头；② 标题区改两行（上行标题，下行左=模式按钮、
> 右=权限选择按钮如 Full access）；③ 主题按钮挪最右并缩小。

## 修改 1 — 聊天页 header 两行布局（`lib/remote-ui.html`）

- `#chat` header 加 `chat-head` class（column 布局，其他页 header 不受影响）：
  - 第一行 `.head-top`：`←` 返回箭头 + `#chat-title` + `☀️` 主题按钮（最右）。
  - 第二行 `.head-sub`：`#mode-btn`（模式）+ `#perm-btn`（权限），均分横排。
- `.theme-btn` 全局缩小 38px→30px、字号 16→14。

## 修改 2 — 权限（访问模式）选择按钮（`lib/remote-ui.html`）

- **数据源**：`permissions` projection（`{options:[{value,name,description}],
  currentValue}`），经 history 尾页 `projections.values.permissions` + WS
  `session/projection` 帧（key=`permissions`）读取；`applyPermissions` 高者胜。
- **显示名**：投影 `name` 字段是**机器名**（read-only/workspace-write/
  danger-full-access），`permDisplayName()` 转 Title Case，`danger-full-access`
  特判 "Full access"。
- **切换**：`/permission <value>` 是 **Typert service remote**，不是
  `session.prompt`——正确 wire 是 **POST /api/commands/execute**，body
  `{type:"client-request", rpcId, method:"commands/execute",
  payload:{args:{agentId, line}}}`（`args` 单字段包装是必填，否则报
  "Remote payload must contain exactly one plain-object args field"）。
- `#perm-sheet` 弹层列选项（过滤 `custom`）；切到 `danger-full-access` 前用
  通用 `showConfirm`（复用 `#confirm-dlg`）二次确认；其余直接切换。

## 验证（真实端到端，`_t_perm.js` / `_t_perm2.js`）

- 本 host permissions 投影存在：read-only / workspace-write / danger-full-access。
- `session.prompt` 发 `/permission` **无效**（prompt 不识别 slash，直接 followup）。
- `POST /api/commands/execute`（args 包装）→ 返回 commandId + "preset
  danger-full-access"，currentValue 从 workspace-write → danger-full-access。
  **PASS**。
- 已同步安装副本；服务端 /dsh-lan/ui 返回 102692 字节，含 v30 标记。

## 部署注意（v30）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v31 修改记录（2026-08-14）：模式/权限按钮缩小并对齐标题

> 用户需求：缩小「模式」「权限」两个按钮——① 按钮高度与标题文字高度一致；
> ② 两个按钮 + 中间空格的宽度与标题宽度一致；③ 扩大圆角比例。

## 修改（`lib/remote-ui.html` CSS）

- `#back-btn` 固定宽 30px、去 padding、文字居中（与 30px 主题按钮对称）。
- `header.chat-head .head-sub`：`margin:0 38px`（左右各留 30px 按钮 + 8px gap），
  使按钮行左右边界与第一行标题区（flex:1 中间块）对齐——两按钮+间隙总宽 =
  标题区宽度。
- `.head-sub button`：`height:20px`（≈标题 14px 文字行高）、`padding:0 10px`、
  `font-size:12px`、`line-height:20px`、`border-radius:10px`（胶囊形，圆角
  比例 50%）。

## 验证

- 已同步安装副本；服务端 /dsh-lan/ui 返回 102891 字节，含 v31 标记。

## 部署注意（v31）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v32 修改记录（2026-08-14）：权限按钮显示当前状态 + 头部布局重做（Material 返回箭头）

> 用户需求：① 权限按钮功能错误——要恢复功能，且不再显示"权限"字样，改为
> 显示当前权限状态（如 "Full access"）；② 模式按钮（标准/创造等）宽度缩到
> 仅四个汉字宽；③ 缩小标题与下方两按钮的垂直间隔；④ 返回/主题按钮在垂直
> 方向对齐"标题 + 按钮"两行的中心；⑤ 返回按钮用 Google Material 返回箭头，
> 去掉边框与背景。

## 修复 1 — 权限按钮显示当前状态（`lib/remote-ui.html`）

- **根因**：权限投影之前只在两条路接入——history 尾页 `projections` 块（无缓存
  首屏 / 增量同步）与 WS `session/projection` 帧（仅权限**变化**时实时推）。
  在 v27 的"缓存已最新 → 零下载"路径里，`syncHistory` 被跳过，history 尾页
  的 projections 不会被读取；WS 订阅又不主动回放当前投影 → `permCurrent` 恒空
  → 按钮一直显示占位"权限"，点击弹层也报"无法读取权限选项"。
- **修复**：实测 `session.list` 的每个会话 `projections.values` 里**直接携带
  `permissions`**（`{options, currentValue}` + `projections.asOfSeq`）。于是：
  - `openChat` 重置后，若 `session.projections.values.permissions` 存在，直接
    `applyPermissions(…, session.projections.asOfSeq)`——进会话即显示当前状态
    （"Full access" / "Workspace write" / "Read only"），覆盖零下载缓存路径。
  - `refreshStatBar`（12s 轮询 session.list）顺带 `applyPermissions`——WS 断线
    时也能兜底刷新。
- 按钮显示名仍走 `permLabel`/`permDisplayName`（`danger-full-access` → "Full
  access"）。

## 修改 2 — 头部两行布局重做（`lib/remote-ui.html`）

- 结构从 `head-top`/`head-sub`（返回+标题+主题在首行，两按钮在次行）改为
  **行内三段式**：`#back-btn` + `.head-mid`（column：`#chat-title` 在上、
  `.head-sub` 在下）+ `#chat-theme`。
- `header.chat-head`：`flex-direction:row;align-items:center`——返回/主题按钮
  （30px）自动**垂直居中于两行**（需求④）。
- `.head-mid`：`flex:1;gap:3px`（标题与按钮行垂直间隔 5px→**3px**，需求③）。
- `.head-sub #mode-btn`：`flex:none;width:60px;padding:0`（≈ 四个汉字宽，
  需求②）；`.head-sub #perm-btn`：`flex:1`（填满剩余，容纳 "Full access"）。
- 按钮行不再用 `margin:0 38px` 对齐，改为 `.head-mid` flex:1 自然撑满标题区。

## 修改 3 — Material 返回箭头（`lib/remote-ui.html`）

- `#back-btn` 内容由文字 "←" 改为内联 SVG（Material `arrow_back` 图标 path
  `M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z`，`stroke`
  用 currentColor，随主题变色）。
- CSS：`background:none;border:none`（去边框/背景，需求⑤），`display:flex`
  居中，`:active{opacity:.55}` 提供按压反馈。

## 验证

- 内联脚本 `node --check` PASS。
- 服务端 `/dsh-lan/ui` 返回 104187 字节，含 `head-mid`/`gap:3px`/`#back-btn svg`/
  Material path/`#mode-btn{…width:60px`/`#perm-btn{flex:1`/openChat 与 statbar
  两处 `applyPermissions` 标记，且旧 `head-top`、`margin:0 38px` 已清除。
- 实测 `session.list` 的 `projections.values` 含 `permissions`
  （options read-only/workspace-write/danger-full-access + currentValue）。

## 部署注意（v32）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v33 修改记录（2026-08-14）：口令变更即时锁定 + 命令选择框 + 发送/返回图标 + 工作区呼吸标志

> 用户八项需求：① 对话工作时禁用模式/权限/模型按钮；② 主机清除或改变口令时
> 服务端立即停止对无正确口令的前端服务、通知前端重新输入/无口令、并清除前端
> 缓存；③ 发送按钮不要"发送"二字，改用 Material 发送符号（向右）；④ 发送/停止
> 按钮改圆角正方形并适当缩小、输入框高度不变；⑤ 输入框左侧加无背景加号按钮，
> 点击展开命令选择框（类比桌面端 +）；⑥ 缩小权限按钮宽度（仅比 "Workspace Write"
> 多两个大写字母），与模式按钮成组居中；⑦ 返回按钮改 "<" 形状；⑧ 工作区页要有
> 与对话页相同的"正在工作"呼吸标志。

## 修改 1 — 口令变更即时锁定（`lib/index.js` + `lib/remote-ui.html`）

- **服务端**（`lib/index.js`，需重启 dsh web）：state 新增 `passwordVersion` 计数，
  `bumpPasswordVersion()` 在设置/清除口令时自增；`buildStatus` 返回
  `passwordVersion`。`/lanapi` 本就每次校验口令（改口令后旧 key 立即 403）。
- **客户端**（`remote-ui.html`）：`startStatusPoll()` 每 3s 拉 `/dsh-lan/status`，
  `applyStatus()` 对比 `passwordSet`/`passwordVersion` 变化：
  - 口令被清除（set→false）：`lockOut()` = clearKey + closeWs + clearCaches +
    showLogin + 禁用登录框，提示"主机未设置访问口令"；
  - 口令被更改（version 变、仍 set）：同上锁出并提示"口令已更改，请重新输入"；
  - 口令从无到有（false→true）：重新启用登录框。
- 兼容旧服务端：旧 status 无 `passwordVersion` → 恒 0，仅 `passwordSet` 变化仍能
  触发"清除口令"锁出；"改口令"检测需重启服务端后生效。

## 修改 2 — 发送/停止按钮 + 加号命令框（`lib/remote-ui.html`）

- 发送按钮去文字，改 Material `send` 纸飞机 SVG（`M2.01 21L23 12…`）；工作时换
  Material 圆角方块 stop SVG。按钮 38×38 圆角正方形（`border-radius:11px`），
  `#composer` 改 `align-items:center`；输入框仍 38px 高。`setWorking` 里用
  `SEND_ICON`/`STOP_ICON` 常量切换。
- **加号按钮** `#cmd-btn`（34×34，`background:none;border:none`，SVG 加号）放在
  输入框左侧，点击 `openCmdSheet()`：经 `listCommands()`（POST `/api/commands/list`，
  `payload:{args:{agentId}}`）拉取命令目录，渲染 `#cmd-sheet`（`/compact` `/export`
  `/feedback <text>` `/goal [<objective>|…]` `/permission <preset>` `/plan [off|message]`），
  点选 → `insertCommand()` 把 `/命令 ` 写入输入框并聚焦。
- `send()` 检测开头 `/` → 走 `execCommand()`（Typert `commands/execute`），不再
  `session.prompt`（prompt 会把斜杠命令当普通消息发给模型）。

## 修改 3 — 对话工作时禁用模式/权限/模型（`lib/remote-ui.html`）

- `setWorking(v)` 末尾对 `mode-btn`/`perm-btn`/`sb-model` 设 `disabled=v`——回合
  进行中这三处不可点，回合结束自动恢复。

## 修改 4 — 头部与权限按钮宽度（`lib/remote-ui.html`）

- 返回按钮 SVG 改 `<` 形状（`M15 6l-6 6 6 6`，stroke chevron）。
- `.head-sub` 加 `justify-content:center`；`#perm-btn` 由 `flex:1` 改
  `flex:none;padding:0 8px`（auto 宽度，约比文字多两个大写字母）；与 `#mode-btn`
  （固定 60px）成组居中。

## 修改 5 — 工作区呼吸标志（`lib/remote-ui.html`）

- `enterWorkspaces` 额外拉 `session.list` 收集 running 会话 id；
  `renderWorkspaces(runningIds)` 给含 running 会话的工作区加 `.dot` + `.card.running`。
- `.card.running .dot` 加 `animation:dshDotPulse 1.6s`（新增 keyframe，透明度呼吸）——
  对话列表与工作区列表共用同一规则，一起"呼吸"。

## 验证

- `node --check` 对 `lib/index.js` 与远程界面内联脚本均 PASS。
- 服务端 `/dsh-lan/ui` 返回 110266 字节，含全部 v33 标记（cmd-btn/cmd-sheet/send
  图标/chevron/`justify-content:center`/`#perm-btn{flex:none`/dshDotPulse/
  applyStatus/startStatusPoll/listCommands/斜杠路由/anyRunning），旧 `>发送<` 已清除。
- `commands/list`（`args:{agentId}`）实测返回 6 个命令（compact/export/feedback/
  goal/permission/plan）。
- 运行中服务端 `/dsh-lan/status` 尚无 `passwordVersion`（旧模块），需重启后生效。

## 部署注意（v33）

- **改了 `lib/index.js`（node half）→ 必须重启 dsh web**（进程内存中的旧模块不热
  替换）；`remote-ui.html` 已按请求从磁盘读取，浏览器强制刷新即可。
- 重启后：清除口令即刻锁出所有已登录前端；改口令需靠 `passwordVersion` 变化
  检测（3s 轮询内生效）。

---

# v34 修改记录（2026-08-14）：对话界面左侧对齐微调

> 用户需求：加号按钮左移、其左边缘与下方模型按钮左边缘对齐；输入框左边缘也
> 左移；并减少输入框与加号之间的空白。

## 修改（`lib/remote-ui.html` CSS）

- `#composer`：`padding:6px 12px` → `6px 8px`（加号与整行左移 4px）、
  `gap:8px` → `4px`（加号↔输入框、输入框↔发送按钮间隙各减 4px）。
- `#statbar`：`padding:4px 12px …` → `4px 8px …`（模型按钮左边缘同步左移到 8px，
  与加号左边缘对齐）。
- 效果：加号左边缘与下方模型按钮左边缘同处 8px；输入框左边缘由 54px → 46px
  （随 padding+gap 同步左移）。

## 验证

- 服务端 `/dsh-lan/ui` 返回 110264 字节，含 `gap:4px;padding:6px 8px` 与
  `padding:4px 8px calc(4px + env(safe-area-inset-bottom))` 标记。

## 部署注意（v34）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v35 修改记录（2026-08-14）：桌面版锁定按钮旁加"回移动版"按钮（竖屏设备）

> 用户需求：桌面版界面里，锁定按钮旁边，若检测到当前是竖屏（触屏）设备，
> 加一个"回移动版"按钮，让通过"使用桌面版界面"退回到桌面 SPA 的手机能一键
> 切回移动界面。

## 修改（`lib/client.js`）

- 新增 `isPortraitTouch()`：竖屏 + `pointer:coarse` + `innerWidth < 1100`
  （复用 `autoMobileRedirect` 的硬件判定，去掉 hostname/opt-out 两项检查）。
- `showLockPill()` 重构：锁定按钮不再直接 append 到 body，改为放进
  `#dshLanPills` 容器（`position:fixed;right:14px;bottom:14px;display:flex;
  gap:8px`）；若 `isPortraitTouch()` 为真，容器里先放 `#dshLanMobile`
  「📱 回移动版」按钮，再放 `#dshLanLock`「🔒 锁定」按钮。
- 「回移动版」点击：`sessionStorage.removeItem("dsh-lan-force-desktop")` 后
  `location.replace("/dsh-lan/ui")`（清掉 opt-out 标记，直接切到移动界面）。
- 新增 `removeLockPills()` 统一移除容器；403 失效路径与锁定按钮点击路径都改
  用它（原 `lockPill` 单按钮变量改为 `lockPills` 容器变量）。
- GATE_CSS：`#dshLanLock` 的 fixed 定位样式改为 `#dshLanPills` 容器 + 通用
  `#dshLanPills button` 药丸样式（两按钮同款）。

## 验证

- `node --check` 对 `lib/client.js` PASS。
- 无残留旧 `lockPill`（单数）引用；`lockPills` 容器变量贯穿。

## 部署注意（v35）

- 只改 `lib/client.js`（客户端 bundle）→ **无需重启 dsh web**，浏览器强制刷新
  即可（rev 可能不变，必要时 Ctrl+F5）。

---

# v36 修改记录（2026-08-14）：文件夹选择器加盘符下拉（C盘/D盘…）

> 用户需求：新建工作区的文件夹选择器，要有一个**盘符下拉选择**，可以直接选
> C盘、D盘或其他存在的盘，不用再手输 `D:\` 跳转。

## 调研（宿主侧）

- `host.listDirectory` **没有"列举所有盘符"的 API**（只有按 path 列目录；官方
  browse 选择器同样没有盘符枚举，Windows 上只是根 crumb 可跳当前盘）。
- 可行做法：**逐盘探测**——对 `A:`~`Z:` 各发一次
  `host.listDirectory({path:"X:\\"})`，存在的盘返回 `path=X:\`，不存在的盘报
  `directory-unreadable`；全部并行 + 8s 超时（`apiWithTimeout`），实测本机
  C/D/E/F/G 命中、其余全错，无副作用。
- 判 Windows 宿主：首次列目录的 `path` 匹配 `/^[A-Za-z]:[\\/]/`；POSIX 宿主
  没有盘符概念 → 隐藏该行。

## 修改（`lib/remote-ui.html`）

- **HTML**：`#ws-sheet` 标题下新增一行
  `<div class="row" id="ws-drive-row"><label>盘符</label><select id="ws-drive">
  <option value="">检测盘符中…</option></select></div>`（复用 `.sheet .row` 样式）。
- **状态**：`wsDriveRoots`（探测到的盘根数组）、`wsCurrentRoot`（当前浏览目录的
  盘根，取 `crumbs[0].path`）、`wsSheetSeq`（打开序号，关闭/重开后作废迟到结果）。
- **openWsSheet**：重置下拉为"检测盘符中…"，首次列目录成功后异步
  `probeDrives(value, seq)`。
- **probeDrives**：非 Windows 宿主直接隐藏 `#ws-drive-row`；否则并行探测 26 个
  盘符（`Promise.allSettled`），只收集成功的 `path`，完成后 `renderDriveSelect()`。
- **renderDriveSelect**：重建 option（显示名去尾反斜杠，如 `C:`，value 为 `C:\`）；
  选中项 = `wsCurrentRoot`（当前所在盘），不在列表则回退第一项；全失败显示
  "未检测到磁盘"。
- **applyDirListing**：每次列目录后同步 `wsCurrentRoot`（crumbs[0]），按路径风格
  显隐盘符行，并调 `renderDriveSelect()`——点面包屑/输路径跨盘后下拉自动跟随。
- **事件**：`#ws-drive` change → `browseDir(选中盘根)`，即选即跳。

## 验证（真实服务端）

- 本机 26 盘探测：C/D/E/F/G 返回 `path=X:\`（17/8/3/8/4 条目），其余
  `directory-unreadable`；home 列目录 `crumbs[0].path === "C:\"` 与探测值同格式，
  下拉选中态可正确匹配。
- 内联脚本 `node --check` PASS（两段 script 均通过）。
- 已同步安装副本；服务端 /dsh-lan/ui 返回 116489 字节，含 `ws-drive` 标记。

## 部署注意（v36）

- 同前：只改 `remote-ui.html`，**无需重启**，浏览器强制刷新即可。

---

# v37 修改记录（2026-08-14）：桌面端工作区选择器加盘符下拉（shadow 官方对话框）

> 用户需求：桌面 Web SPA 新建工作区时也要有**盘符下拉**（v36 只改了移动端
> /dsh-lan/ui）。

## 根因（已核实）

- dsh-LAN 绑定 `0.0.0.0:3080` → 官方目录选择器后端解析器
  （`dsh-host-directory-picker-auto/resolve`）在 `bindHost !== "127.0.0.1"` 时
  强制 `browse` 后端——**本机桌面也用 in-app 浏览对话框**（官方
  `DirectoryBrowser`：面包屑 + 路径编辑，无盘符枚举），Windows 原生对话框
  （自带盘符栏）永远不会出现。
- 官方 DirectoryBrowser 组件不导出、宿主 `host.listDirectory` 无列举盘符 API
  （只能逐盘探测，v36 已验证）。

## 方案：shadow 两个 directoryFlow 槽位（`lib/client.js`）

- **槽位机制**（源码核实）：`conversation.hero.workspace.directoryFlow` 与
  `sidebar.workspaces.directoryFlow` 是 `single` 槽（ui-workspace 声明），
  渲染取 `entriesOfSlot[0]`（按 priority 升序，**最低优先级胜出**）；
  同优先级二次注册会 **throw**（"already has a registration at priority N"）。
- **关键坑（实测）**：boot 清单插件（官方 picker 与 dsh-LAN 都是
  `__ModuleLoader__.load` 静态 entry）**不走 runner 的自动优先级**
  （`allocatePriority` 只作用于按需加载的 dynamic packages）——大家都默认
  priority 0。headless 实测：dsh-LAN 若先注册（0）→ 官方 picker apply 直接
  抛错 → loader entry failed → **整个 boot 失败**。因此必须**显式
  `priority: -1000`**：官方在 0 注册无冲突、正常 apply，而我们因最低优先级
  胜出。
- **注册时机不赌 boot 顺序**：`ctx.effect` 内 1s 轮询 watcher——用
  `ctx.slots.entriesOfSlot(hole)[0].registrant === "dsh-LAN"` 检查是否仍胜出
  （`entriesOfSlot` 排除 abdicated 条目）；座位丢失/崩溃（abdicate）时先
  dispose 旧座位再重建；**对话框打开期间暂停轮询**（避免重注册导致组件
  remount、导航状态丢失）。
- **自研 `LanDirectoryFlow` 对话框**（React，与移动端 ws-sheet 同款逻辑）：
  盘符下拉（Windows 才显示，A:~Z: 并行探测、单次 8s 超时、当前盘自动同步）、
  面包屑、目录条目（hidden 淡化、truncated 提示）、路径输入+跳转、新建文件夹、
  取消/打开（busy 时「正在创建…」）、Esc 取消、错误内联展示。
- **注入面**走 `ctx.workspaces.listDirectory/createDirectory`（与官方 occupant
  完全一致的 face）；`inject` 列表加 `"workspaces"` 服务
  （`lib/client.js` 与 `package.json` **两处同步**，AGENTS.md 提醒）。
- 新增 locale 命名空间 `dsh-lan-picker`（zh/en）+ 插件样式标签
  `dsh-LAN/picker.css`（`--dsw-alias-*` 变量适配亮暗主题）。

## 验证（headless Edge CDP 端到端，全新 profile）

- `node --check` PASS；安装副本已同步（client.js 41504 字节 / package.json 823）。
- 桌面 SPA boot 正常、**console 零错误**（官方 picker apply 未被破坏）。
- 侧边栏「添加工作区」打开的是**我们的对话框**（标题「选择工作区目录」），
  官方 DirectoryBrowser 不再出现。
- 盘符下拉列出 `C:=C:\  D:=D:\  E:=E:\  F:=F:\  G:=G:\`（与 v36 探测一致）；
  选中 `D:` 即跳转 `D:\`（路径输入框同步为 `D:\`）；「取消」正常关闭。
- 两个槽位共用同一注册循环（hero 与 sidebar），机制相同。

## 补充（同 v37，用户要求浅色界面）

- 用户要求：桌面端盘符选择对话框**固定浅色背景 + 深色字体**（不跟随应用
  暗色主题）。`PICKER_CSS` 弃用 `--dsw-alias-*` 变量（暗色模式下会渲染成
  深色卡片），改为**硬编码浅色**：卡片 `#ffffff`、文字 `#1c2128`、输入/下拉
  `#ffffff` 底 + `#cfd5dd` 边框、普通按钮 `#f1f3f6`、主按钮 `#4c8dff` 白字、
  面包屑 `#2f6fed`、隐藏项淡化 `#98a0ab`；卡片加 `color-scheme:light`
  （原生 select 弹出列表也强制浅色）+ `input::placeholder` 灰色。
- headless 实测 computed style：卡片 `rgb(255,255,255)`、标题 `rgb(28,33,40)`
  （深色）、select/按钮同款浅底深字、盘符选项 C:/D:/E:/F:/G: 正常。
  **PASS**。

## 部署注意（v37）

- 只改 `lib/client.js` + `package.json`（客户端 bundle）→ **无需重启 dsh web**，
  浏览器强制刷新即可（rev 可能不变，必要时 Ctrl+F5）。
