# AGENTS.md — dsh-LAN 维护指南

给后续修改本项目的 AI/开发者：先读完本文件再动代码。这里记录的是**踩过的坑、必须遵守的契约、以及验证方法**，不是项目介绍（介绍见 `README.md`）。

---

## 1. 项目定位与文件地图

dsh-LAN 是 DeepSeek Harness（DSH）Web GUI 的局域网访问插件，双半边结构：

```
lib/index.js      node 半边（host 平面）：0.0.0.0 绑定、防火墙规则、/lanapi 口令代理、/dsh-lan/status|configure|unlock
lib/client.js     浏览器半边：登录门、移动端触控适配、设置页「局域网访问」卡片、侧栏锁定按钮、工作区目录选择器（影子）
lib/landing.html  门后落地页
cordis.patch.yml  bundle 安装路径用的补丁（bind host + 插件行）
install.ps1 / install.sh       补丁路径安装：拷包 + 写 profile 补丁块
uninstall.ps1 / uninstall.sh   反向操作
README.md / README.en.md       面向用户；**不放更新记录**
```

- `package.json` 的 `dsh.client.platform = "web"`、`dsh.client.inject` 决定客户端半边被谁加载、按什么顺序加载；`type: module`。
- `lib/client.js` 的形态是 DSH 客户端模块约定：整体包在 `window.__ModuleLoader__.load({ id, factory: (require) => { ... exports.apply / exports.inject } })` 里。**不要**改成 ESM、也不要引入打包器产物。

---

## 2. 两条安装路径（选一条，绝不混用）

| 路径 | 命令 | 落地位置 | 生效方式 |
|---|---|---|---|
| 补丁路径（默认，本项目当前就是这么装的） | `install.ps1` / `install.sh` | `<DSH_HOME>/profiles/node_modules/dsh-LAN` + 往 `profiles/web/cordis.patch.yml` 写安装块 | profile 补丁热加载；client 半边刷新浏览器即生效 |
| bundle 路径 | `dsh plugin --profile web add link:<本目录>` | 依赖包管理 | 需重启 `dsh web` |

**两条路径同时使用会冲突**（重复的 `webserver` override 与重复的 `dsh-lan` 行）。本机当前用的是补丁路径，安装块已在 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`，**不要再跑 install 脚本**，直接同步文件即可。

### 本机更新流程（改完代码）

```powershell
$src='D:\DeepSeek\dsh-LAN'; $dst='C:\Users\MyBook\.dsh\profiles\node_modules\dsh-LAN'
Copy-Item "$src\lib\client.js" "$dst\lib\client.js" -Force
Copy-Item "$src\package.json"  "$dst\package.json"  -Force
# 逐个 Get-FileHash 比对，确认 parity
```

- **只改 `lib/client.js`（浏览器半边）→ 不需要重启 `dsh web`**：服务端对 bundle 是**启动时读一次并缓存**（`client-modules.initialBundleSnapshot`），只有 `client-hmr` 每 500ms 的 stat 轮询发现 `lib/client.js` 变化后调 `rebuilt(id)` 才会重读并重算 rev。所以改完要等一下，**用 `/plugins/events`（SSE）里图帧的 `"id":"dsh-LAN","rev":…` 核对**服务端真正在广告的 rev；HTML 里的 `rev` 是启动时定型的，可能是旧值，别只信它。确认后在**新标签页/刷新**里验证（bundle 响应是 `immutable` 长缓存，旧文档内的 URL 不会自己换新字节）。
- **改了 `lib/index.js`（node 半边）→ 必须重启 `dsh web`**：node 半边在进程内存里，热加载只重载补丁层。**注意：本机 `dsh web` 进程承载着当前会话，不要随手杀它**（会掐断自己），先和用户确认。
- `package.json` 里 `dsh.client.inject` 的改动属于启动时组装的 manifest 元数据，下次启动 `dsh web` 才反映到 HTML 的 `inject` 列表；不影响运行时行为（运行时等待哪些服务由 `lib/client.js` 的 `exports.inject` 决定）。
- 版本号：**改任何行为都顺手升 `package.json.version`**（本项目按 1.x.y 走）。

---

## 3. 客户端半边必须知道的运行时事实（0.1.5-rc.1 实测）

### 3.1 服务名 ≠ 包名

`exports.inject` 里写的是**服务名**，不是包名。写包名会让 fiber 永远 pending，整个客户端半边静默不加载。HTML manifest 里的 `inject: [...]` 才是包名列表（由 `dsh.client.inject` 生成）。

当前 `exports.inject`：

```js
["slots", "locale", "connection", "workspaces", "uiWorkspace", "layout", "settingsScope"]
```

- `settingsScope` 在当前版本无人 `provide`；保留它意味着 fiber 会等这个服务。**不要**因为「看起来没人提供」就删掉，删之前先确认 `lanHostMode()` 调用链是否还依赖它。
- 新增服务依赖时**同时**改两处：`exports.inject`（服务名，运行时真正等待）与 `package.json` 的 `dsh.client.inject`（包名，保证加载序）。

### 3.2 目录能力在 `uiWorkspace`，不在 `workspaces`

这是本项目的**头号历史 bug**，务必记住：

| 服务名 | 提供者 | 能力 |
|---|---|---|
| `uiWorkspace` | `@deepseek-ai/dsh-client-ui-workspace`（`super(ctx,"uiWorkspace")`） | `listDirectory(path?, signal?)` / `createDirectory(path,name)` / `pickDirectory()` / 会话与工作区导航 |
| `workspaces` | `@deepseek-ai/dsh-api-workspace-controller`（`super(ctx,"workspaces")`） | 只有 `create / rename / delete / insertBefore / archiveSession / insertSessionBefore` |
| `slots` | `@deepseek-ai/dsh-client-ui-renderer` 的 SlotRegistry | 插槽注册/查询/订阅 |
| `connection` | `@deepseek-ai/dsh-client-connection` | `connection.api.postJson(...)`、`connection/reset` 事件 |

官方 `dsh-client-ui-directory-picker-browse` 注入的就是 `uiWorkspace`。**任何目录枚举/新建目录调用都必须走 `uiWorkspace`**，`workspaces` 只能作为旧版回退。

### 3.3 插槽（slot）机制要点

- `single` 类插槽**同一 priority 只能有一个注册**，第二个注册会 **throw** 并让那个插件的 apply 失败；不同 priority 可共存，`priority` **升序取第一个未退位者渲染（lowest renders）**。
- 本插件用 `priority: -1000` + `registrant: "dsh-LAN"` 影子覆盖官方选择器（官方在 0），覆盖两个洞：`conversation.hero.workspace.directoryFlow` 与 `sidebar.workspaces.directoryFlow`。**v71 起本机 loopback 也覆盖**。
- entry 的注入面**按 entry 身份缓存**：同一次注册内 `props.listDirectory` / `props.t` 引用稳定，`useEffect` 依赖数组不会因父组件重渲染而抖动。真正的抖动来源只有「entry 被销毁重建」。
- 渲染期抛异常 → 错误边界 `reportEntryError(..., { abdicate: true })` → **该 entry 从 cell 退位**（不再渲染）→ 若看护守卫只看「弹窗在不在 DOM 里」，它会把 entry 重新注册 → 崩溃循环 ⇒ 用户看到「界面不断刷新」。**这是 1.3.1 修复的机制，写新代码时不要再制造同样形态。**
- `document.querySelector(".dshLanP_overlay") !== null` 只能证明「上一帧渲染成功」，不能证明「本次渲染不会崩」。看护必须另有崩溃退避（见 `pickerHealth` 与 `PICKER_SEAT_STABLE_MS`）。

### 3.4 `lib/client.js` 的结构性约束

- 所有 `props.listDirectory(...)` 调用**必须**走 `callListDirectory()`：它把「方法不存在」这类同步 TypeError 转成 rejected promise，避免在 render 阶段（children 是急切构造的）炸掉整个 slot entry。加新调用点时照抄。
- 移动端适配是**纯 DOM/CSS 注入**（`mobileAdapt`），只依赖官方 class 名的哈希后缀（`[class$="_frame"]` 这类选择器）。官方换 hash 前缀不影响它，但**改语义名会**；改动前先确认官方对应包的 class 名。
- `installLanFetchReroute()` 包了全局 `window.fetch`，`wrapApi()` 包了 `connection.api.postJson`；两者都有 `__dshLanWrapped` / `lanFetchWrapped` 幂等标记。新增网络调用不要绕过 `isLoopback()` 判断（本机必须走原生路径）。

---

## 4. 修改后的验证方法（必做）

不要只靠读代码。用无头 Chrome + CDP 打真实 GUI（只读：打开弹窗 → 观察 → Esc 取消，**绝不点「打开」按钮**，那会真的创建工作区）：

1. 起无头浏览器：`chrome.exe --headless=new --remote-debugging-port=9222 --user-data-dir=<临时目录> about:blank`，用 `http://127.0.0.1:9222/json/new?<url>` + Node 内置 `WebSocket`（Node ≥22）走 CDP。
2. 必查项：
   - `Runtime.enable` 收 `Runtime.consoleAPICalled` / `exceptionThrown` → **控制台错误必须为 0**；
   - 每 50ms 采样 `.dshLanP_overlay`，统计**挂载次数**：稳定应为 1（修复前是每秒 1 次）；
   - 采样弹窗内容：`.dshLanP_entry` 条目数、`.dshLanP_crumb` 面包屑数、盘符 `<select>` 选项（Windows 上应含 `C:\|D:\|…`）、`.dshLanP_err` 必须为空；
   - 点一个条目下钻，面包屑应 +1 级；
   - Esc 取消 → 再点「添加工作区」→ 应能再次正常打开，且仍只挂载 1 次；
   - `Network.enable` 观察 `POST /api/directoryPicker/list` 正常返回（LAN 设备上会经 `/lanapi` 代理）。
3. 收尾：停掉无头 Chrome 进程、删临时 profile 与探针脚本，别留在工作区里。

**禁止**：为了让弹窗「看起来正常」而让探针点击「打开」按钮（会落盘创建真实工作区）；在用户的真实浏览器里做写操作。

---

## 5. 常见反模式（出现即回退）

- 用 `ctx.workspaces.listDirectory` / `ctx.workspaces.createDirectory`（1.3.1 的根因）。
- 把 `exports.inject` 写成包名。
- 在 `single` 插槽的同一 priority 上注册第二个 entry。
- 没有退避的座位看护（裸跑 `setInterval(seatIfNeeded, 1000)`）。
- 直接 `props.listDirectory(...)` 而不加 `callListDirectory()` 兜底。
- 手动跑 `install.ps1` / `uninstall.ps1` 做日常更新（会重复写补丁块 / 动防火墙）。
- 在 README 里堆更新记录或维护须知（约定：README 只作为用户文档；变更与踩坑写进本文件第 7 节或 commit）。

---

## 5.1 发布（tag 与 GitHub Release）

`.github/workflows/release.yml` 负责「push `v*` tag → 自动建 GitHub Release」，notes 由 tag 区间内的 conventional commit 前缀分节生成（Features/Fixes/Docs/…，与 v1.3.0 的格式一致），用仓库内置 `GITHUB_TOKEN`，不需要 PAT。

- **硬约束**：GitHub 只把 tag 事件派发给「**已存在于默认分支**」的工作流文件。因此该文件落到 `main` 之前推的 tag 永远不会触发——这正是 `v1.0.0` / `v1.2.0` / `v1.3.1` 只有 tag、没有 release 的原因。
- 补历史的 tag：Actions → release → Run workflow，填 tag 名（`workflow_dispatch` 路径）。
- **SSH 密钥只做 git 传输**；Release 对象是 REST API 资源，SSH 创建不了，别在这上面绕。本机也没装 `gh`，没有 PAT/env token。
- 本机 22 端口被封，`~/.ssh/config` 里用 `Host github.com → HostName ssh.github.com / Port 443` 映射；直接连 `git@github.com:443` 会因 443 是 HTTPS 端口而在 `kex_exchange_identification` 被拒。

---

## 6. 与 dsh-app 的边界：口令页只认「顶层文档」

**这是第二个踩过的坑。它不是本插件代码的缺陷，但每次排查都会撞上，必须记住。**

### 6.1 机制（本机 0.1.5-rc.1 实测）

- 局域网模式下，**没有凭据的非 loopback 客户端**请求 `GET /` → **302 `/dsh-lan/`**（`lib/index.js:495-510`）；要真正拿到 SPA，请求必须带上 **DSH 自己的会话 cookie**（即 `hasLanCookie(req)` 那条分支）。
- 那个 DSH 会话 cookie 是 **`HttpOnly; SameSite=Strict`**，由一次**隐藏 fetch 的重定向链**种下（`/dsh-lan/mint` 302 → token URL → `/`；见 `lib/index.js:743-751`，`lib/landing.html:53-64` 有注释说明必须跟随跳转）。
- 因此：**只要承载页面的环境把 GUI 当作「跨站第三方内容」，这个 cookie 就会被现代 WebView / 浏览器的跟踪防护丢弃或分区**，链路永远走不完。
- 后果被 `lib/landing.html:86-96` 的**静默续登**放大：落地页只要在 storage 里看到 `dsh-lan-key`，就立刻 `postUnlock` → `mint` → `window.location.href = "/"`；当 cookie 落不下去时 `/` 又 302 回落地页，落地页又静默续登 → **无限重定向**，用户看到「口令页不断闪烁、无法输入」。

### 6.2 判定口径与责任划分

| 现象 | 结论 |
|---|---|
| 移动端/桌面浏览器正常，**dsh-app（Tauri + iframe）闪烁** | **环境问题（dsh-app 侧）**：同一份插件、同一个服务端，差异只在承载上下文——iframe 里 GUI 是跨站第三方，登录 Cookie 落不下去。 |
| 顶层浏览器直接开 `http://<IP>:3080` | 正常：顶层文档 = 第一方，`SameSite=Strict` 无障碍。 |
| 地址填 `127.0.0.1` / `localhost` | **根本不走口令链路**：客户端 `isLoopback()` 为真，服务端 `isLocalRequest()` 也全放行（无口令、无 token）。此时任何异常都与口令页无关，别往这条线查。 |

- **本插件侧该改的（若将来再动）**：`lib/landing.html` 的静默续登不该「有 key 就跳」，应在跳转前确认「这次访问真能进主界面」；连续失败即停止自动跳转，停在表单并提示「凭据无法在本浏览器保存」。这样环境问题最多是「每次都要输口令」，而不是「页面无法操作」。
- **dsh-app 侧解法（已在其仓库实施）**：不要用 iframe 承载 GUI，改为**每个地址一个独立顶层窗口**（Tauri `WebviewWindow`），顶层文档 = 第一方，口令只需输入一次。

### 6.3 复现 / 排查手法（只读，勿在用户实例上做写操作）

- 无头 Chrome + CDP：父页面从 `http://localhost:3099`（与目标不同 host）内嵌 `http://<LAN-IP>:3080`，即构造出「跨站 iframe」形态；用 `Target.attachToTarget` 挂到 iframe 的 target 上执行表达式，逐秒采样其 `location.href`、是否存在 `input[type=password]`、`document.cookie`。
- **不要**为了「跑通」而猜或试口令：错误口令下 `POST /dsh-lan/mint` 只会 403（足够确认链路形态）；`dsh-lan-key` 也无法用 JS 伪造成功路径（校验在服务端）。
- 收尾：停掉无头 Chrome、删临时 profile 与探针脚本。

---

## 7. 历史修复（防回归）

### 1.3.8 — 移动端「标准模式」等头部动作改为靠左紧跟「轨迹」，间距=官方 tabs gap

- 现象：移动端标题栏下「对话 / 轨迹」那一行里，「标准模式」被推到最右、**超出屏幕边缘**。
- 机制：v67 起把标题行里的 `_headerActions`（agent-preset 模式名 + 后台任务徽标）搬进 `_tabs` 当子项，但给的规则是 `margin-left:auto` —— 那是明确的「贴右边缘」指令，于是超出屏幕。
- 修复（v84）：
  - **去掉 `margin-left:auto`**。`_headerActions` 现在是 `_tabs` 这个 flex 容器的子项，而官方 `.wSkVaW_tabs{gap:36px}` 的 36px **正是 对话/轨迹 之间的间距**，所以它自然紧随「轨迹」且间距天然一致 —— 不需要自己塞一个左边距（塞 36px 也能对，但会与未来官方 gap 变更脱钩）。
  - `gap:6px → gap:36px`：让「标准模式」与「子代理」徽标之间的间距也等于 对话/轨迹 的间距（需求里的"一致"）。
  - 补 `min-width:0`，让过长的预设名走省略号而不是把整行撑出屏幕。
  - `_tabs` 的 `margin-right:-58px` 一并撤销：那是 v67 为了让「贴右边缘」的动作正好压在边缘而加的（官方 header 右内边距 28px），**改为靠左锚定后它只会造成溢出**。现改回 0，保留官方 28px 内边距。
- 实测（在页面里按官方真实类名/结构搭出 header，390/360/320 三宽度）：
  - `gap(对话,轨迹) = 36px`，`gap(轨迹,标准模式) = 36px` —— **完全一致**；
  - `overflowRight` 全为负值或 0（不再超出屏幕）；`_tabs` 计算值 `gap:36px / padding-left:8px / margin-right:0`；控制台 0 错误。
- 备注：无头新会话停在工作区选择页，拿不到真实会话头部（DSH 不提供会话深链），所以这是按官方真实类名与结构做的定向断言。

### 1.3.7 — 三点「更多操作」（下载 session 日志）改为按「非本机」隐藏

- 用户反馈：1.3.6 之后移动端**仍能看到**右上角那个三点按钮，点开是「下载 session 日志」。
- 它是 `@deepseek-ai/dsh-session-log-export` 的 `SessionLogDownloadHeaderAction`：`Menu` 的 anchor 是 `nL4_yW_moreButton`（`aria-haspopup="menu"`、`aria-label` 取自 `header.more`「更多操作」、图标 `IconEllipsisOutline16`）。源码第 274 行确认它注册进 `conversation.session.header.utilities` —— **正是 `_headerUtilities` 内部**。
- 所以 1.3.6 之前那条 `[class$="_headerUtilities"]{display:none}` 本来就能藏它（该规则自 v47–v62 的 `819ecdd` 起一直在，且实测确认已随 bundle 下发）。用户仍能看到 ⇒ **实机当时没进入移动端适配状态**：`isMobilePortrait()` 要求竖屏 + 粗指针 + 宽 <1100，横屏/平板/更宽视口都不生效。
- 修复：把这条也做进「非本机」样式表（`dsh-LAN/nonlocal-header.css`），**不再依赖移动端适配状态**：
  - `body.dsh-lan-nonlocal [class$="_headerUtilities"] [class$="_moreButton"]`（主判据，实测全局只匹配这 1 个元素）；
  - 再加一条按**角色**兜底的 `... [class$="_trigger"]:has(svg):where([aria-haspopup="menu"])`，防模块哈希前缀变化。
  - 理由：局域网浏览器把 session 日志下到「错误的机器磁盘」上本来就没意义。
- 实测（构造官方真实类名与结构）：非本机下移动 390 **与桌面 1280** 均 `display:none`，启动器同时隐藏，无关控件不受影响，控制台 0 错误。
- 教训：**"父容器被 display:none" 不等于"子元素一定看不见"要分开断言**；更要紧的是——依赖 `mobileAdapt` 的规则只在那一整套状态成立时生效，凡是"移动端看不到 X"的需求，先确认实机是否真的进入了该状态，必要时改挂到与视口无关的判定上。

### 1.3.6 — 非本机隐藏主机应用启动器；移动端隐藏 session 日志；底部统计居中

- **需求 1（非本机隐藏右上角「文件资源管理器 / VS Code / Git Bash」下拉框）**：
  - 那个下拉框是 `@deepseek-ai/dsh-client-ui-open-in-app`，类名 `CAgGvG_split`，注册在**与 session 日志同一个插槽** `conversation.session.header.utilities`（即 `_headerUtilities` 容器）。
  - 判定来源：`/dsh-lan/status` 的 `loopback` 字段（服务端 `isLoopback(req)`，按 **Host 头**算，正好等价于「这个页面是不是从 127.0.0.1 打开的」）。`syncNonLocalPosture()` 拿到后给 `<body>` 加 `dsh-lan-nonlocal`。
  - **坑（本次踩到）**：这条规则**不能**放进 `mobileAdapt` 的 CSS —— 那段样式表只在竖屏手机模式下注入（`isMobilePortrait()` 为真），而需求恰恰是桌面局域网场景。实测 1280px 下 `mobile-adapt.css` 根本不存在（`tagPresent:false`），规则写了也永远不生效。改为在 `markNonLocalPosture()` 里注入独立样式表 `dsh-LAN/nonlocal-header.css`。
  - 选择器用 `body.dsh-lan-nonlocal [class$="_headerUtilities"] [class$="_split"]`：官方是 `.CAgGvG_split{display:inline-flex}`，靠多一个 `body.` 类提高特异性压过它（在 `mobileAdapt` 之后注入、但顺序不可靠，别只靠顺序）。
- **需求 2（移动端隐藏 session 日志下载）**：本来就已满足——`web shell` 的 `_headerUtilities{display:none}` 规则在竖屏下隐藏整个 utilities 簇，实测该容器宽为 0，里面的 session 日志按钮（`nL4_yW_moreButton`）一并消失。**桌面端不受影响，仍保留**。
- **需求 3（移动端底部「N 轮 M 步」居中）**：官方 `StatsPills` 的根类 `bOPqQW_root` 本来就是 `justify-content:center`（flex 行），是我们在 v56 把它覆盖成 `text-align:left` 才变左对齐。v82 改回 `text-align:center`。实测移动端计算值 `text-align:center`、`justify-content:center`、字号 10px、内边距 0，且内容盒居中；桌面端不受影响（仍是官方 13px / 32px 内边距）。
- **类名方向提醒（重要）**：官方插件 bundle 的 CSS Module 类名是**哈希在前**（`CAgGvG_split`、`nL4_yW_moreButton`、`uV2eYG_headerUtilities`），所以 `[class$="_split"]` 这类后缀选择器能匹配；而 **web shell 自己**的 Vite 构建是 `_split_17p4l_17`（哈希在后），**后缀选择器匹配不到它**。写探针时要用官方 bundle 的类名，否则会测到 shell 自己的同名元素而得出错误结论（本次先踩了一次）。

### 1.3.5 — 移动端 composer：模型按钮与上下文圆环之间留出真实间隙

- 现象：1.3.4 后模型名仍然「过长」，与上下文圆环挤在一起。
- 关键纠正：**最左的障碍物是上下文圆环，不是发送键**。圆环是官方 28px 的 `ContextMeter`（`JObwrW_root`），绝对定位 `right:52px; translateY(-50%)`，因此它在发送键**左侧 12px**（360px 下：圆环左缘 280、发送键左缘 292）。1.3.4 按发送键对齐（预约 140px），结果模型按钮反而压过圆环 —— 这就是用户看到的「过长」。
- 另一坑：模型触发器的右缘还含图标与箭头（约 30px），所以「`gapModelToRing`」这种按触发器右缘算的间隙会高估真实视觉间隙。**必须量「箭头右缘 → 圆环左缘」**。
- 修复（v81）：预约值由 140px 改为 `calc(100cqw - 175px)`。标定实测（箭头→圆环）：160px → 0（即用户报的重叠）、172px → 12、**175px → 15**、185px → 25。
- 取舍：圆环间隙与完整模型名在手机宽度下**不可兼得**（实测任何能给圆环正间隙的预约值都会截断真实模型名）。按用户要求以圆环间隙优先，390px 下模型名显示约 107/137px（"DeepSeek V4.1 Flash (C…"）。
- 复现注意：无头会话里 `ContextMeter` 常因没有上下文占用数据而**不渲染**（`[class$="_root"]:has([class$="_track"])` 取不到）。可注入一个同规格探针元素（28px、`absolute right:52px`、`box-sizing:border-box`）来量间隙——但注意后注入的 `<style>` 若与外层规则同特异性会被外层覆盖，别用它去「改」样式，只用它**看**几何。

### 1.3.4 — 移动端 composer：长模型名不再压住上下文圆环/发送按钮

- 现象：模型名较长时，模型按钮（及底部圆环、发送键）互相重叠。
- 成因链：v79 为了「同排」把行改成 `flex-wrap:nowrap` + `justify-content:flex-start` 后，行内**不再换行**；官方原布局靠换行给模型那行腾出整行宽度，同排后模型按钮只能与发送键争同一行空间，于是被推到发送键底下（实测 360px：模型右缘 326、发送左缘 292，重叠 34px）。`_trailing` 上的 `overflow:hidden` 只能裁内容，裁不掉容器自身压过去的框。
- 修复（v80）：给模型触发器加硬上限 `max-width:calc(100cqw - 140px)`。
  - 必须用 **`cqw` 而不是百分比**：`_row` 是 `container-type:inline-size`，此处百分比 `max-width` 实测**完全不生效**（360px 下容器仍是 239px、照旧压住发送键），`cqw` 才是可靠句柄。
  - **140px 是扫描出来的**，不是猜的。390px 下到发送键的间隙：160px→34（裁真实名字 137→122）、150px→24（也裁）、**140px→19 真实 / 14 长名（真实名不裁）**、130px→4、120px→−6（重叠）。窄屏（360/320）下长名字必然省略——这是取舍，发送键优先。
- 实测：390/360/320 三宽度下长名与真实名均**不再重叠**（间隙稳定 14px）；390px 下真实模型名完全不裁；控制台 0 错误。

### 1.3.3 — 移动端 composer：权限/模型按钮与附件按钮同排（原为上下两行）

- 现象：竖屏手机上权限按钮与模型选择按钮上下两行，模型那行被推到右侧。
- 官方原始布局（`@deepseek-ai/dsh-client-ui-conversation` 的 `InputBar.module.css`）：`.uV2eYG_row{flex-wrap:wrap;justify-content:space-between}`、`.uV2eYG_trailing{flex:none;gap:12px;margin-left:auto}` —— 本来就是「一行放不下的流式换行」，**官方不是固定两行**。
- 根因（全部在本插件 v52 的移动端 CSS）：`_trailing{flex-basis:100%}` 强制它独占一行造成「堆叠」；它还被 `padding-left:38px` 缩进；`_row` 保持官方 `space-between`，而发送按钮已被绝对定位移出流，行内只剩 `_tools`/`_trailing` 两项，空间全被推到两者之间 → 模型按钮贴右侧。
- 修复（v79）：`_trailing` 去掉 `flex-basis`/左侧 38px 缩进（行 `column-gap:10px` 自然让它对齐到权限按钮的 38px 处）、`margin-left:0` 抵消官方 `margin-left:auto`、`min-width:0`+`overflow:hidden` 让长标签省略；`_row` 改 `justify-content:flex-start` + `flex-wrap:nowrap`（实测 320px 会换行，故用 nowrap 保证单行）；模型触发器与权限触发器统一 12px/24px。
- 实测（390/360/320 三种竖屏）：附件 x=24、权限 x=62、模型 x=116，三者垂直居中同排，模型标签不截断（137px 标签）、不压发送按钮（右缘 303 < 320 处发送左缘），控制台 0 错误。
- 教训：**bundle 改了不等于浏览器拿到了**。服务端缓存 bundle，需等 `client-hmr` stat 轮询重哈希；期间用 `/plugins/events` 的图帧核对 rev，且在**新文档**里验证——否则会拿着旧 CSS 的几何得出错误结论（本次就先踩了一次）。

### 1.3.1 — 「新工作区目录选择界面不断刷新，无法选目录」

- 现象：点「添加工作区」后弹窗每秒闪一次、内容为空、无法选择。
- 根因：`pickerInjected` 从 `ctx.workspaces` 取目录能力 → `TypeError: ctx.workspaces.listDirectory is not a function` → slot entry 被错误边界判退位 → 看护每秒重新注册 → 每秒重挂载。
- 修复：改为注入 `uiWorkspace`（保留 `workspaces` 旧版回退）；`exports.inject` 与 `dsh.client.inject` 双补声明；`callListDirectory()` 兜底；看护加崩溃退避（5s 内掉座 → 1s/2s/4s… 上限 60s，`connection/reset` 重置）。
- 实测：修复前 6 秒内挂载 6 次、控制台反复报错；修复后挂载 1 次、61 条目 + 3 盘符、可下钻、Esc 后可重开、控制台 0 错误。
