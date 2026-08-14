# dsh-LAN

DSH Web GUI 的局域网访问插件（带口令的全功能版 + 独立远程界面）。

> 🚀 **配合 [DSH-Launcher](https://github.com/MrMu666/DSH-Launcher) 使用，体验感更好。**

安装后，Web GUI 默认绑定 `0.0.0.0`（所有网卡），并自动放行主机防火墙端口（Windows：Windows Defender 防火墙 Domain + Private；Linux：依次尝试 firewalld / ufw / iptables，无可用防火墙工具时视为无需放行）：

- ✅ **局域网设备先输口令才能看页面**：桌面端浏览器打开 `http://<本机IP>:3080` 会先显示全屏登录门；移动端（手机/平板）请打开 **`http://<本机IP>:3080/dsh-lan/ui`** —— 插件自带的独立远程界面（登录 → 工作区 → 会话列表 → 聊天/历史对话/文件记录/模型切换/新建会话选模式），所有内容与主机实时同步
- ✅ **记住口令（本机）**：登录时勾选「记住口令」，口令保存在该设备浏览器 localStorage，下次打开免输；不勾选则只保存在当前标签页（sessionStorage），关闭即失效
- ✅ 设置页（General）「局域网访问」卡片：开关 + 口令设置/清除 + 状态显示
- ✅ 解锁后全部功能可用：设置、权限预设、凭据、预设管理（官方锁定为仅本机的特权方法，通过 `/lanapi` 口令代理通道重新暴露）
- ✅ **所有浏览器看到完全相同的对话过程**：单一服务进程，会话状态全部在服务端，事件流（`/api/events.mux` WebSocket）向每个连接的浏览器推送相同更新

> 💡 **最简单的安装方式：告诉DSH，安装 dsh-LAN 插件。**

![局域网口令设置](docs/局域网口令设置.png)

<img src="docs/手机端展示.jpg" alt="手机端展示" width="50%">

## ⚠️ 安全说明

- 登录门是**界面级**防护：不知道口令的人看不到页面内容；特权操作（设置/权限/凭据）在**服务端**强制口令校验。
- 非特权 API（会话读写等）在 API 层对局域网仍然开放——登录门主要防止「路过的人随手打开页面」。若需要更强的 API 级封锁，需要在受信网络之外关闭局域网开关。
- 仅限可信网络（家庭/办公室内网）使用。公共网络请关闭开关。

## 远程界面（`/dsh-lan/ui`）功能

| 功能 | 说明 |
|---|---|
| 登录门 | 口令通过前不显示任何内容；主机未设口令时明确提示 |
| 工作区 | 浏览式文件夹选择器（含跨盘符跳转）、新建/切换工作区，会话按工作区过滤 |
| 会话列表 | 与桌面端完全同步（标题/时间/运行状态/模式/工作区），支持删除（归档） |
| 历史对话 | 完整渲染 user/assistant 消息、思考过程（折叠灰字行）、工具调用（折叠） |
| 实时聊天 | 发送消息 + WebSocket 事件流实时渲染（断线自动轮询兜底），思考过程实时流入 |
| 任务清单 | 结构化展示 `todo_write` 产出的任务列表（与桌面端 TodoPanel 对齐） |
| 审批/提问 | 支持 approval 授权与 `ask_user_question` 提问对话框的应答与取消 |
| 对话缓存 | localStorage 增量缓存，再次进入只拉新内容，秒开长会话 |
| 模型切换 | provider/model/思考强度三级选择（session.models/selectModel） |
| 新建会话 | 可选工作模式（agentPreset.list） |
| 主题 | 亮/暗主题切换（记忆在 localStorage） |
| 锁定 | 随时退出登录（清除本机口令） |

## 安装（补丁路径，无需重启，推荐）

### Windows 11

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
# 可选参数：
powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome C:\Users\me\.dsh -Profile web
```

### Linux / macOS

```bash
./install.sh
# 可选参数：
./install.sh --dsh-home "$HOME/.dsh" --profile web
# 也可通过环境变量 DSH_HOME 指定（与 dsh 一致）
```

安装脚本（两个平台等价）会：

- 把插件包复制到 `<DSH_HOME>/profiles/node_modules/dsh-LAN`（Windows 为 `%USERPROFILE%\.dsh\profiles\node_modules\dsh-LAN`）
- 把安装块写入 `<DSH_HOME>/profiles/web/cordis.patch.yml`（绑定 0.0.0.0 + 挂载插件行）
- **DSH 对 profile 补丁是热加载的**：运行中的服务立即生效，无需重启；刷新浏览器即可看到设置页卡片
- **升级插件代码后需重启 `dsh web`**：node 半边（`lib/index.js`）在进程内存中，热加载只重载补丁层；客户端 bundle 刷新浏览器即可拿到新版

### 防火墙说明

- **Windows**：自动维护 Windows Defender 防火墙放行规则（Domain + Private）；未以管理员身份运行时，设置页会提示「防火墙未放行（需管理员权限）」。
- **Linux**：自动检测并按 firewalld → ufw → iptables 的顺序维护放行规则；检测不到受支持的防火墙工具时，状态显示「防火墙未由插件管理」，此时端口通常本就无需放行。若检测到防火墙但无 root 权限，同样会提示需要管理员权限。
- 无论哪个平台，关闭「局域网访问」开关都会把绑定回退到 `127.0.0.1`，这是最根本的安全开关。

### 安装（bundle 路径，可选）

```bash
dsh plugin --profile web add link:<本目录绝对路径>
```

包声明了 `dsh.bundle.patch`，`dsh plugin` 会自动把它加入 bundles 列表。此路径需要重启服务生效。

## 使用

1. 本机打开设置 → General → 「局域网访问」，确认开关已开、防火墙已放行，并**设置口令**（至少 4 位）；
2. 局域网桌面浏览器：打开 `http://<本机IP>:3080` → 登录门输入口令（勾选「记住口令」可免下次输入）；
3. 手机/平板：打开 `http://<本机IP>:3080/dsh-lan/ui` → 登录 → 使用远程界面；
4. 点击「锁定」随时退出；本机修改口令后，其他设备下次操作会被要求重新登录（403 自动回登录门）。

## 卸载

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

Linux / macOS：

```bash
./uninstall.sh
# 可选：./uninstall.sh --dsh-home "$HOME/.dsh" --profile web --port 3080
```

移除补丁块、防火墙规则与包副本；热加载生效，无需重启。

## 多机一致性原理

单一 DSH 服务进程持有全部状态：会话（jsonl 持久化 + 内存投影）、工作区、目标、子代理。所有浏览器只是同一服务的客户端，通过 `/api` RPC 读写同一状态，通过 `/api/events.mux`（WebSocket 下行流）接收相同的服务端事件推送。远程界面与桌面端连接的是同一份状态，任何一端的操作对其他端实时可见。

## 参考

移动端实现思路参考了 [dsh-web-ui 的 dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web-ui)（独立轻量远程界面 + 令牌门），按本插件的口令模型做了重新设计（持久口令 + 本机记住 + `/lanapi` 特权代理）。

## 许可证

[MIT](package.json)（`license: MIT`）
