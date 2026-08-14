# dsh-LAN

dsh-LAN — a plugin that brings the DSH Web GUI to your local network (password-protected full-featured edition + a standalone remote UI).

Once installed, the Web GUI binds to `0.0.0.0` (all network interfaces) by default and automatically adds a Windows Firewall allow rule (Domain + Private):

- ✅ **LAN devices must enter a password before seeing any page**: Desktop browsers opening `http://<host-ip>:3080` get a full-screen login gate first; mobile devices (phones/tablets) should open **`http://<host-ip>:3080/dsh-lan/ui`** — the plugin's standalone remote UI (login → workspaces → session list → chat/history/file records/model switching/new session with mode), all synced with the host in real time
- ✅ **Remember password (per device)**: Checking "Remember password" at login stores the password in that browser's localStorage, so the next visit skips it; otherwise it is kept only in the current tab (sessionStorage) and expires when the tab closes
- ✅ "LAN access" card in Settings → General: toggle + password set/clear + status display
- ✅ Once unlocked, all features are available: settings, permission presets, credentials, preset management (privileged methods that the official client pins to localhost are re-exposed through the password-protected `/lanapi` proxy channel)
- ✅ **Every browser sees the exact same conversation**: a single service process holds all session state server-side, and the event stream (`/api/events.mux` WebSocket) pushes identical updates to every connected browser

> 💡 **The simplest way to install: tell DSH to install the dsh-LAN plugin.**

![LAN password settings](docs/局域网口令设置.png)

<img src="docs/手机端展示.jpg" alt="Mobile UI" width="50%">

## ⚠️ Security notes

- The login gate is **UI-level** protection: people without the password cannot see page content; privileged operations (settings/permissions/credentials) are enforced **server-side** by password checks.
- Non-privileged APIs (session read/write, etc.) remain open to the LAN at the API layer — the gate mainly stops casual passers-by from opening the page. For stronger API-level lockdown, turn the LAN switch off outside trusted networks.
- Use only on trusted networks (home/office intranet). Turn the switch off on public networks.

## Remote UI (`/dsh-lan/ui`) features

| Feature | Description |
|---|---|
| Login gate | Nothing is rendered before the password is verified; a clear hint appears when the host has no password set |
| Workspaces | In-browser folder picker (with cross-drive jump), create/switch workspaces, sessions filtered by workspace |
| Session list | Fully synced with the desktop UI (title/time/running state/mode/workspace), with delete (archive) support |
| History | Full rendering of user/assistant messages, reasoning (collapsible gray line), tool calls (collapsible) |
| Live chat | Send messages + real-time WebSocket event streaming (polling fallback on disconnect), reasoning streams in live |
| Todo list | Structured panel for `todo_write` output (aligned with the desktop TodoPanel) |
| Approval / questions | Answer and cancel dialogs for tool approval and `ask_user_question` prompts |
| Conversation cache | Incremental localStorage cache — reopening a session only fetches new content; long sessions open instantly |
| Model switching | Three-level selection: provider / model / reasoning effort (session.models/selectModel) |
| New session | Optional working mode (agentPreset.list) |
| Theme | Light/dark theme toggle (remembered in localStorage) |
| Lock | Log out at any time (clears the locally stored password) |

## Installation (patch path, no restart required — recommended)

> ⚠️ The current installation method works on **Windows 11 only** (it relies on PowerShell scripts and `netsh advfirewall` firewall commands).

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

- The plugin package is copied to `%USERPROFILE%\.dsh\profiles\node_modules\dsh-LAN`
- The install block is written to `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` (bind 0.0.0.0 + plugin mount line)
- **DSH hot-reloads profile patches**: the running service picks it up immediately, no restart needed; just refresh the browser to see the settings card
- **Restart `dsh web` after upgrading plugin code**: the node half (`lib/index.js`) lives in process memory and hot reload only reloads the patch layer; the client bundle is picked up by refreshing the browser

### Installation (bundle path, optional)

```bash
dsh plugin --profile web add link:<absolute-path-to-this-directory>
```

The package declares `dsh.bundle.patch`, so `dsh plugin` automatically adds it to the bundles list. This path requires a service restart to take effect.

## Usage

1. On the host, open Settings → General → "LAN access", make sure the toggle is on, the firewall is allowed, and **set a password** (at least 4 characters);
2. LAN desktop browser: open `http://<host-ip>:3080` → enter the password at the login gate (check "Remember password" to skip it next time);
3. Phone/tablet: open `http://<host-ip>:3080/dsh-lan/ui` → log in → use the remote UI;
4. Click "Lock" to log out at any time; after the host changes the password, other devices are asked to log in again on their next action (403 returns to the login gate automatically).

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

Removes the patch block, firewall rules, and the package copy; takes effect via hot reload, no restart needed.

## How multi-device consistency works

A single DSH service process holds all state: sessions (jsonl persistence + in-memory projections), workspaces, targets, and subagents. Every browser is just a client of the same service: it reads/writes the same state through `/api` RPC and receives the same server-side event pushes over `/api/events.mux` (WebSocket downlink). The remote UI and the desktop UI connect to the same state, so any action on either end is visible in real time on all other ends.

## Credits

The mobile implementation is inspired by [dsh-remote-web-ui from dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) (standalone lightweight remote UI + token gate), redesigned around this plugin's password model (persistent password + per-device remember + `/lanapi` privileged proxy) .

## License

[MIT](package.json) (`license: MIT`)
