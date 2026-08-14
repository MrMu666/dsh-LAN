window.__ModuleLoader__.load({
	id: "dsh-LAN",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// Non-secure contexts (LAN over http://) lack crypto.randomUUID, which
		// the harness RPC id minter depends on — without this every RPC
		// (history, workspaces, settings…) throws "crypto.randomUUID is not a
		// function" on LAN devices. Polyfill a CSPRNG-backed RFC4122 v4.
		if (typeof window.crypto !== "undefined" && typeof window.crypto.randomUUID !== "function") {
			window.crypto.randomUUID = function randomUUID() {
				const bytes = new Uint8Array(16);
				window.crypto.getRandomValues(bytes);
				bytes[6] = (bytes[6] & 15) | 64;
				bytes[8] = (bytes[8] & 63) | 128;
				const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
				return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
			};
		}
		// ── portrait-mobile: send touch devices to the mobile UI ─────────────
		// The desktop SPA is too crowded on a portrait phone. dsh-remote-web-ui
		// solves this with a separate mobile surface; mirror that: when a touch
		// device in portrait orientation opens the desktop UI, switch it to the
		// plugin's mobile interface (/dsh-lan/ui). Landscape, desktop, and
		// loopback stay on the desktop UI; a one-tab opt-out exists on the
		// mobile login screen.
		(function autoMobileRedirect() {
			function isMobilePortrait() {
				if (!window.matchMedia("(orientation: portrait)").matches) return false;
				if (!window.matchMedia("(pointer: coarse)").matches) return false;
				if (window.innerWidth >= 1100) return false;
				const host = window.location.hostname;
				if (host === "127.0.0.1" || host === "localhost" || host === "::1") return false;
				if (window.sessionStorage.getItem("dsh-lan-force-desktop") === "1") return false;
				return true;
			}
			function redirectNow() {
				if (!isMobilePortrait()) return;
				if (window.location.pathname !== "/" && window.location.pathname !== "/index.html") return;
				window.location.replace("/dsh-lan/ui");
			}
			redirectNow();
			window.addEventListener("orientationchange", redirectNow);
		})();
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		// ── constants ─────────────────────────────────────────────────────────
		const KEY_STORAGE = "dsh-lan-key";
		const PRIVILEGED = new Set([
			"settings.describe",
			"settings.openDocument",
			"settings.update",
			"settings.replace",
			"settings.mutate",
			"credentials.describe",
			"credentials.set",
			"credentials.unset",
			"llm.discoverModels",
			"agentPreset.read",
			"agentPreset.copy",
			"agentPreset.openDocument",
			"agentPreset.remove"
		]);

		function isLoopback() {
			const host = window.location.hostname;
			return host === "127.0.0.1" || host === "localhost" || host === "::1";
		}
		// Portrait touch device (the same hardware test autoMobileRedirect uses,
		// minus the hostname/opt-out checks) — used to show a "back to mobile"
		// button next to the lock pill when such a device is on the desktop UI.
		function isPortraitTouch() {
			if (!window.matchMedia("(orientation: portrait)").matches) return false;
			if (!window.matchMedia("(pointer: coarse)").matches) return false;
			if (window.innerWidth >= 1100) return false;
			return true;
		}

		function storedKey() {
			return window.localStorage.getItem(KEY_STORAGE) ?? window.sessionStorage.getItem(KEY_STORAGE) ?? "";
		}

		function setStoredKey(key, remember) {
			window.localStorage.removeItem(KEY_STORAGE);
			window.sessionStorage.removeItem(KEY_STORAGE);
			if (remember) window.localStorage.setItem(KEY_STORAGE, key);
			else window.sessionStorage.setItem(KEY_STORAGE, key);
		}

		function clearStoredKey() {
			window.localStorage.removeItem(KEY_STORAGE);
			window.sessionStorage.removeItem(KEY_STORAGE);
		}

		// ── stylesheet ────────────────────────────────────────────────────────
		const css = ".dshLan_row{flex-direction:column;gap:10px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;display:flex}.dshLan_head{align-items:center;gap:8px;display:flex}.dshLan_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}.dshLan_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}.dshLan_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}.dshLan_toggle{appearance:none;flex:none;width:44px;height:24px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);cursor:pointer;position:relative;transition:background .15s}.dshLan_toggle:disabled{cursor:default;opacity:.5}.dshLan_toggle::after{content:\"\";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left .15s,background .15s}.dshLan_toggle[aria-checked=\"true\"]{background:var(--dsw-alias-brand-primary)}.dshLan_toggle[aria-checked=\"true\"]::after{left:22px;background:#fff}.dshLan_status{flex-direction:column;gap:2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:flex}.dshLan_urls{font-family:var(--dsw-font-family-mono,monospace);word-break:break-all}.dshLan_row2{align-items:center;gap:8px;display:flex;flex-wrap:wrap}.dshLan_input{flex:1;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0 10px;outline:none;max-width:280px;min-width:160px}.dshLan_btn{height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0 14px;cursor:pointer}.dshLan_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshLan_btn:disabled{cursor:default;opacity:.5}.dshLan_badge{align-self:flex-start;border-radius:999px;background:var(--dsw-alias-success-bg,rgba(46,160,67,.15));color:var(--dsw-alias-success-fg,#2ea043);font-size:12px;line-height:18px;padding:2px 10px}.dshLan_err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}";
		const tagId = "dsh-LAN/LanRow.module.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-LAN";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const c = {
			row: "dshLan_row",
			head: "dshLan_head",
			rowText: "dshLan_rowText",
			title: "dshLan_title",
			desc: "dshLan_desc",
			toggle: "dshLan_toggle",
			status: "dshLan_status",
			urls: "dshLan_urls",
			row2: "dshLan_row2",
			input: "dshLan_input",
			btn: "dshLan_btn",
			badge: "dshLan_badge",
			err: "dshLan_err"
		};

		// ── tiny external store ──────────────────────────────────────────────
		function createLanStore() {
			let snapshot = { phase: "loading", data: null, unlocked: storedKey() !== "", error: null };
			const listeners = new Set();
			return {
				get: () => snapshot,
				// the slots renderer's selector hook reads getSnapshot(), not get()
				getSnapshot: () => snapshot,
				set: (patch) => {
					snapshot = { ...snapshot, ...patch };
					for (const fn of listeners) fn();
				},
				subscribe: (fn) => {
					listeners.add(fn);
					return () => listeners.delete(fn);
				}
			};
		}
		const store = createLanStore();
		const useLan = (select) => react.useSyncExternalStore(store.subscribe, () => select(store.get()));

		// ── controller ───────────────────────────────────────────────────────
		async function fetchStatus() {
			try {
				const response = await window.fetch("/dsh-lan/status", { cache: "no-store" });
				if (!response.ok) throw new Error("HTTP " + response.status);
				const data = await response.json();
				store.set({ phase: "ready", data, error: null });
				return data;
			} catch (error) {
				store.set({ phase: "error", data: null, error: String(error?.message ?? error) });
				return null;
			}
		}

		async function configure(body) {
			store.set({ phase: "saving" });
			try {
				const response = await window.fetch("/dsh-lan/configure", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
				const data = await response.json().catch(() => null);
				if (!response.ok) throw new Error(data?.error ?? "HTTP " + response.status);
				store.set({ phase: "ready", data, error: null });
				// the patch watcher rebinds shortly after the file write
				window.setTimeout(() => { void fetchStatus(); }, 1500);
				return data;
			} catch (error) {
				store.set({ phase: "error", error: String(error?.message ?? error) });
				throw error;
			}
		}

		async function setPassword(password) {
			return configure({ password });
		}

		async function clearPassword() {
			return configure({ password: null });
		}

		async function unlock(password) {
			try {
				const response = await window.fetch("/dsh-lan/unlock", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ password })
				});
				const data = await response.json();
				if (response.ok && data.ok === true) {
					window.localStorage.setItem(KEY_STORAGE, password);
					store.set({ unlocked: true });
					return true;
				}
				store.set({ unlocked: false });
				return false;
			} catch {
				return false;
			}
		}

		// ── settings card ────────────────────────────────────────────────────
		function LanRow({ useLan, t }) {
			const state = useLan((snapshot) => snapshot);
			const [passwordInput, setPasswordInput] = react.useState("");
			const [unlockInput, setUnlockInput] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [unlockFailed, setUnlockFailed] = react.useState(false);
			react.useEffect(() => {
				void fetchStatus();
				const timer = window.setInterval(() => { void fetchStatus(); }, 5000);
				return () => window.clearInterval(timer);
			}, []);
			const data = state.data;
			const enabled = data?.enabled === true;
			const local = isLoopback();
			const loading = state.phase === "loading";
			const toggle = react.createElement("button", {
				type: "button",
				role: "switch",
				"aria-checked": enabled,
				className: c.toggle,
				disabled: busy || loading || data === null,
				title: enabled ? t("toggle.off") : t("toggle.on"),
				onClick: () => {
					setBusy(true);
					configure({ enabled: !enabled }).catch(() => {}).finally(() => setBusy(false));
				}
			});
			const statusLines = [];
			if (state.phase === "error" && state.error !== null) {
				statusLines.push(react.createElement("div", { className: c.err, children: t("error") + " " + state.error }));
			}
			if (data !== null) {
				statusLines.push(react.createElement("div", { children: t("status.bind") + " " + data.bindHost + ":" + data.port + " \u00b7 " + t(data.firewallOk ? "firewall.ok" : "firewall.bad") + " \u00b7 " + t(data.passwordSet ? "password.set" : "password.unset") }));
				if (enabled && data.lanUrls.length > 0) {
					statusLines.push(react.createElement("div", { className: c.urls, children: t("status.urls") + " " + data.lanUrls.join("   ") }));
				} else if (!enabled) {
					statusLines.push(react.createElement("div", { children: t("status.off") }));
				}
			}
			const passwordSection = react.createElement("div", { className: c.row2, children: [
				react.createElement("input", {
					className: c.input,
					type: "password",
					placeholder: t("password.placeholder"),
					value: passwordInput,
					onChange: (event) => setPasswordInput(event.target.value)
				}),
				react.createElement("button", {
					className: c.btn,
					disabled: busy,
					onClick: async () => {
						setBusy(true);
						try {
							await setPassword(passwordInput);
							setPasswordInput("");
						} catch {}
						finally {
							setBusy(false);
						}
					},
					children: t("password.save")
				}),
				data?.passwordSet ? react.createElement("button", {
					className: c.btn,
					disabled: busy,
					onClick: async () => {
						setBusy(true);
						try { await clearPassword(); } catch {}
						finally { setBusy(false); }
					},
					children: t("password.clear")
				}) : null
			] });
			const unlockSection = state.unlocked
				? react.createElement("div", { className: c.badge, children: t("unlock.unlocked") })
				: react.createElement("div", { className: c.row2, children: [
					react.createElement("input", {
						className: c.input,
						type: "password",
						placeholder: t("unlock.placeholder"),
						value: unlockInput,
						onChange: (event) => setUnlockInput(event.target.value)
					}),
					react.createElement("button", {
						className: c.btn,
						disabled: busy,
						onClick: async () => {
							const ok = await unlock(unlockInput);
							setUnlockFailed(!ok);
							if (ok) setUnlockInput("");
						},
						children: t("unlock.btn")
					}),
					unlockFailed ? react.createElement("span", { className: c.err, children: t("unlock.failed") }) : null
				] });
			return react.createElement("div", { className: c.row, children: [
				react.createElement("div", { className: c.head, children: [
					react.createElement("div", { className: c.rowText, children: [
						react.createElement("div", { className: c.title, children: t("title") }),
						react.createElement("div", { className: c.desc, children: t("description") })
					] }),
					local ? toggle : null
				] }),
				react.createElement("div", { className: c.status, children: statusLines }),
				local ? passwordSection : unlockSection
			] });
		}

		// ── privileged-call rerouting ────────────────────────────────────────
		function wrapApi(connection) {
			const api = connection?.api;
			if (api === void 0 || api.__dshLanWrapped === true) return;
			api.__dshLanWrapped = true;
			const original = api.postJson.bind(api);
			api.postJson = function (path, body, signal, timeoutPolicy = "default") {
				const method = typeof path === "string" && path.startsWith("/api/") ? path.slice(5) : "";
				if (method === "" || isLoopback() || !PRIVILEGED.has(method)) {
					return original(path, body, signal, timeoutPolicy);
				}
				const requestSignal = timeoutPolicy === "default"
					? signal === void 0
						? AbortSignal.timeout(this.timeoutMs)
						: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal])
					: signal;
				const key = storedKey();
				return window.fetch(new URL("/lanapi/" + method, window.location.origin), {
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(key === "" ? {} : { "x-dsh-lan-key": key })
					},
					body: JSON.stringify(body),
					signal: requestSignal
				}).then((response) => {
					if (response.status === 403) {
						clearStoredKey();
						store.set({ unlocked: false });
						if (!isLoopback()) {
							removeLockPills();
							mountGate();
						}
					}
					if (!response.ok) throw new Error("transport failure for " + path + ": HTTP " + response.status);
					return response;
				});
			};
		}

		// ── login gate overlay (non-loopback desktop) ────────────────────────
		const GATE_CSS = "#dshLanGate{position:fixed;inset:0;z-index:2147483000;background:rgba(10,12,16,.96);display:flex;align-items:center;justify-content:center;padding:24px}#dshLanGate .card{width:100%;max-width:380px;background:#171a21;border:1px solid #2a2f3a;border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:12px;color:#e6e9ef;font:14px/1.55 -apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}#dshLanGate .t{font-size:20px;font-weight:700;text-align:center}#dshLanGate .s{color:#9aa3b2;font-size:13px;text-align:center;margin-top:-6px}#dshLanGate input[type=password]{font:inherit;color:inherit;background:#0f1117;border:1px solid #2a2f3a;border-radius:10px;padding:11px 12px;outline:none}#dshLanGate input[type=password]:focus{border-color:#4c8dff}#dshLanGate label{display:flex;align-items:center;gap:8px;color:#9aa3b2;font-size:13px}#dshLanGate button{font:inherit;border:none;border-radius:10px;padding:11px;background:#4c8dff;color:#fff;font-weight:600;cursor:pointer}#dshLanGate button:disabled{opacity:.5;cursor:default}#dshLanGate .err{color:#e5534b;font-size:13px;min-height:16px;text-align:center}#dshLanPills{position:fixed;right:14px;bottom:14px;z-index:2147483000;display:flex;gap:8px;align-items:center}#dshLanPills button{font:13px -apple-system,'Segoe UI','PingFang SC',sans-serif;border-radius:999px;border:1px solid #2a2f3a;background:#171a21;color:#9aa3b2;padding:7px 14px;cursor:pointer}";
		function ensureGateStyle() {
			const id = "dsh-LAN/gate.css";
			if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-LAN";
			tag.dataset.pluginCss = id;
			tag.textContent = GATE_CSS;
			document.head.appendChild(tag);
		}
		let gateRoot = null;
		let lockPills = null;   // container holding the "回移动版" + "锁定" buttons
		async function verifyKey(key) {
			if (key === "") return false;
			try {
				const response = await window.fetch("/dsh-lan/unlock", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ password: key })
				});
				const data = await response.json();
				return response.ok && data.ok === true;
			} catch {
				return false;
			}
		}
		function removeGate() {
			if (gateRoot !== null) { gateRoot.remove(); gateRoot = null; }
		}
		function removeLockPills() {
			if (lockPills !== null) { lockPills.remove(); lockPills = null; }
		}
		function showLockPill() {
			if (lockPills !== null) return;
			lockPills = document.createElement("div");
			lockPills.id = "dshLanPills";
			// a portrait touch device reached the desktop UI via the one-tab
			// opt-out — offer a way back to the mobile UI next to the lock button
			if (isPortraitTouch()) {
				const mobile = document.createElement("button");
				mobile.id = "dshLanMobile";
				mobile.textContent = "📱 回移动版";
				mobile.addEventListener("click", () => {
					try { window.sessionStorage.removeItem("dsh-lan-force-desktop"); } catch (e) {}
					window.location.replace("/dsh-lan/ui");
				});
				lockPills.appendChild(mobile);
			}
			const lock = document.createElement("button");
			lock.id = "dshLanLock";
			lock.textContent = "🔒 锁定";
			lock.addEventListener("click", () => {
				clearStoredKey();
				store.set({ unlocked: false });
				removeLockPills();
				mountGate();
			});
			lockPills.appendChild(lock);
			document.body.appendChild(lockPills);
		}
		function mountGate() {
			if (isLoopback() || gateRoot !== null) return;
			ensureGateStyle();
			gateRoot = document.createElement("div");
			gateRoot.id = "dshLanGate";
			gateRoot.innerHTML = '<div class="card"><div class="t">DSH 远程访问</div><div class="s">输入访问口令后才能查看和使用本页面</div><input type="password" placeholder="访问口令" autocomplete="current-password"><label><input type="checkbox"> 记住口令（仅保存在本机浏览器）</label><button>进入</button><div class="err"></div></div>';
			const input = gateRoot.querySelector("input[type=password]");
			const remember = gateRoot.querySelector("input[type=checkbox]");
			const button = gateRoot.querySelector("button");
			const err = gateRoot.querySelector(".err");
			const attempt = async () => {
				button.disabled = true;
				err.textContent = "";
				const ok = await verifyKey(input.value);
				if (ok) {
					setStoredKey(input.value, remember.checked);
					store.set({ unlocked: true });
					removeGate();
					showLockPill();
				} else {
					err.textContent = "口令错误";
					button.disabled = false;
					input.select();
				}
			};
			button.addEventListener("click", attempt);
			input.addEventListener("keydown", (event) => { if (event.key === "Enter") attempt(); });
			document.body.appendChild(gateRoot);
			void window.fetch("/dsh-lan/status").then((r) => r.json()).then((data) => {
				if (data && data.passwordSet !== true) {
					err.textContent = "主机尚未设置访问口令，请先在本机设置页配置";
					input.disabled = true;
					button.disabled = true;
				}
			}).catch(() => {});
			input.focus();
		}
		async function initGate() {
			if (isLoopback()) return;
			const key = storedKey();
			if (await verifyKey(key)) {
				store.set({ unlocked: true });
				showLockPill();
				return;
			}
			clearStoredKey();
			store.set({ unlocked: false });
			mountGate();
		}

		// ── desktop workspace-folder picker (shadows the official dialog) ─────
		// dsh-LAN binds 0.0.0.0, so the directory-picker resolver
		// (bindHost !== "127.0.0.1" → `browse` backend) serves the in-app
		// DirectoryBrowser even on the host machine — crumbs + path editing,
		// no drive enumeration. We shadow both directoryFlow holes (single
		// slots; the runner assigns strictly decreasing priorities, lowest
		// renders) with our own dialog that adds a drive dropdown, matching
		// the mobile UI (v36).
		const h = (type, props, ...children) => react.createElement(type, props, ...children);
		const PICKER_CSS = ".dshLanP_overlay{position:fixed;inset:0;z-index:10000;background:rgba(15,18,24,.45);display:flex;align-items:center;justify-content:center;padding:20px;font:13px/1.5 -apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}.dshLanP_card{width:100%;max-width:680px;max-height:min(560px,100dvh - 40px);background:#ffffff;border:1px solid #d9dee6;border-radius:12px;display:flex;flex-direction:column;gap:10px;padding:16px;overflow:hidden;box-shadow:0 12px 40px rgba(15,18,24,.28);color-scheme:light}.dshLanP_title{font-size:15px;font-weight:600;color:#1c2128;margin:0}.dshLanP_row{display:flex;gap:8px;align-items:center}.dshLanP_row label{flex:none;color:#5b6472}.dshLanP_row select,.dshLanP_row input{flex:1;min-width:0;height:32px;border-radius:8px;border:1px solid #cfd5dd;background:#ffffff;color:#1c2128;font:inherit;font-size:13px;padding:0 10px;outline:none}.dshLanP_row select:focus,.dshLanP_row input:focus{border-color:#4c8dff}.dshLanP_row input::placeholder{color:#98a0ab}.dshLanP_row button{flex:none;height:32px;border-radius:8px;border:1px solid #cfd5dd;background:#f1f3f6;color:#1c2128;font:inherit;font-size:13px;padding:0 14px;cursor:pointer}.dshLanP_row button:disabled{opacity:.5;cursor:default}.dshLanP_row button:hover:not(:disabled){background:#e6e9ee}.dshLanP_crumbs{display:flex;flex-wrap:wrap;gap:2px;align-items:center;min-height:22px}.dshLanP_crumb{padding:2px 8px;border:none;background:none;color:#2f6fed;font:inherit;font-size:12.5px;cursor:pointer;border-radius:6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshLanP_crumb:hover{background:#eef1f6}.dshLanP_entries{flex:1;min-height:160px;max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;border:1px solid #cfd5dd;border-radius:8px;padding:6px;background:#ffffff}.dshLanP_entry{padding:7px 10px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:8px;color:#1c2128;word-break:break-all}.dshLanP_entry:hover{background:#f0f2f5}.dshLanP_entry::before{content:\"📁\";font-size:12px;flex:none}.dshLanP_entry.hidden{color:#98a0ab}.dshLanP_entry.hidden::before{content:\"·\"}.dshLanP_err{color:#d93026;font-size:12.5px;min-height:16px}.dshLanP_note{color:#8a919c;font-size:12px}.dshLanP_actions{display:flex;justify-content:flex-end;gap:8px}.dshLanP_actions button{height:32px;border-radius:8px;border:1px solid #cfd5dd;background:#f1f3f6;color:#1c2128;font:inherit;font-size:13px;padding:0 16px;cursor:pointer}.dshLanP_actions button:hover:not(:disabled){background:#e6e9ee}.dshLanP_actions button.primary{background:#4c8dff;border-color:#4c8dff;color:#ffffff;font-weight:600}.dshLanP_actions button:disabled{opacity:.5;cursor:default}";
		function ensurePickerStyle() {
			const id = "dsh-LAN/picker.css";
			if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-LAN";
			tag.dataset.pluginCss = id;
			tag.textContent = PICKER_CSS;
			document.head.appendChild(tag);
		}
		const LAN_PICKER_NS = "dsh-lan-picker";
		function isWindowsStylePath(p) {
			return typeof p === "string" && /^[A-Za-z]:[\\/]/.test(p);
		}
		function pickerRootOf(value) {
			return value && value.crumbs && value.crumbs.length ? value.crumbs[0].path : "";
		}
		async function pickerProbe(listDirectory, root, ms) {
			const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
			const timer = ctl ? window.setTimeout(() => ctl.abort(), ms) : null;
			try {
				return await listDirectory(root, ctl ? ctl.signal : void 0);
			} finally {
				if (timer !== null) window.clearTimeout(timer);
			}
		}
		// Windows: probe A:–Z: and report existing drive roots. POSIX hosts have
		// no drive letters — the caller hides the drive row instead.
		async function probePickerDrives(listDirectory, listing, token, onDone) {
			const sample = (listing && (listing.path || listing.home)) || "";
			if (!isWindowsStylePath(sample)) {
				onDone({ visible: false, drives: [] });
				return;
			}
			const letters = [];
			for (let i = 0; i < 26; i++) letters.push(String.fromCharCode(65 + i));
			const settled = await Promise.allSettled(letters.map((L) => pickerProbe(listDirectory, L + ":\\", 8000)));
			if (token.stale) return;
			const found = [];
			for (const s of settled) {
				if (s.status === "fulfilled" && s.value && s.value.path) found.push(s.value.path);
			}
			onDone({ visible: true, drives: found });
		}
		/**
		* Desktop folder-picker occupant for the workspace directoryFlow holes.
		* Props contract mirrors the official BrowseDirectoryFlow: owner side
		* {open, busy, onPicked, onCancel, onError} + inject face
		* {listDirectory(path, signal), createDirectory(path, name), t(key)}.
		*/
		function LanDirectoryFlow(props) {
			const [listing, setListing] = react.useState(null);
			const [phase, setPhase] = react.useState("idle"); // idle|loading|ready|error
			const [error, setError] = react.useState("");
			const [pathInput, setPathInput] = react.useState("");
			const [newName, setNewName] = react.useState("");
			const [drives, setDrives] = react.useState(null); // null probing / [] none / roots
			const [driveVisible, setDriveVisible] = react.useState(false);
			const [currentRoot, setCurrentRoot] = react.useState("");
			const seqRef = react.useRef(0); // drops stale listing responses
			const probeToken = react.useRef({ stale: false });

			const list = react.useCallback((path) => {
				const seq = ++seqRef.current;
				setPhase("loading");
				setError("");
				props.listDirectory(path).then((value) => {
					if (seq !== seqRef.current) return;
					setListing(value);
					setCurrentRoot(pickerRootOf(value));
					setPathInput(value.path || "");
					setPhase("ready");
				}).catch((e) => {
					if (seq !== seqRef.current) return;
					setPhase("error");
					setError(props.t("errList") + " " + ((e && e.message) || String(e)));
				});
			}, [props.listDirectory, props.t]);

			react.useEffect(() => {
				if (!props.open) return;
				const seq = ++seqRef.current;
				probeToken.current.stale = true;
				probeToken.current = { stale: false };
				const token = probeToken.current;
				setPhase("loading");
				setError("");
				setDrives(null);
				props.listDirectory().then((value) => {
					if (seq !== seqRef.current) return;
					setListing(value);
					setCurrentRoot(pickerRootOf(value));
					setPathInput(value.path || "");
					setPhase("ready");
					const win = isWindowsStylePath(value.path) || isWindowsStylePath(value.home);
					setDriveVisible(win);
					if (win) {
						void probePickerDrives(props.listDirectory, value, token, (out) => {
							if (token.stale) return;
							setDriveVisible(out.visible);
							setDrives(out.drives);
						});
					}
				}).catch((e) => {
					if (seq !== seqRef.current) return;
					setPhase("error");
					setError(props.t("errList") + " " + ((e && e.message) || String(e)));
				});
			}, [props.open, props.listDirectory, props.t]);

			react.useEffect(() => {
				if (!props.open) return;
				const onKey = (event) => { if (event.key === "Escape") props.onCancel(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [props.open, props.onCancel]);

			if (!props.open) return null;

			const t = props.t;
			const busy = props.busy === true;
			const ready = phase === "ready";
			const gotoPath = () => {
				const p = pathInput.trim();
				if (p) list(p);
			};
			const mkdir = () => {
				const name = newName.trim();
				if (!name || !listing) return;
				const parent = listing.path;
				setPhase("loading");
				setError("");
				props.createDirectory(parent, name).then(() => {
					setNewName("");
					list(parent);
				}).catch((e) => {
					setPhase("ready");
					setError(t("errCreate") + " " + ((e && e.message) || String(e)));
				});
			};
			const driveOptions = [];
			if (drives === null) driveOptions.push(h("option", { key: "probe", value: "" }, t("probing")));
			else if (drives.length === 0) driveOptions.push(h("option", { key: "none", value: "" }, t("noDrives")));
			else {
				for (let i = 0; i < drives.length; i++) {
					const root = drives[i];
					driveOptions.push(h("option", { key: root, value: root }, root.replace(/\\$/, "")));
				}
			}
			const crumbs = [];
			for (const crumb of (listing ? listing.crumbs : []) || []) {
				crumbs.push(h("button", {
					key: crumb.path,
					type: "button",
					className: "dshLanP_crumb",
					onClick: () => list(crumb.path),
					children: crumb.path === (listing && listing.home) ? t("home") : crumb.name
				}));
			}
			const rows = [];
			for (const entry of (listing ? listing.entries : []) || []) {
				rows.push(h("div", {
					key: entry.path,
					className: "dshLanP_entry" + (entry.hidden ? " hidden" : ""),
					onClick: () => list(entry.path),
					children: entry.name
				}));
			}
			return h("div", { className: "dshLanP_overlay" },
				h("div", { className: "dshLanP_card" },
					h("div", { className: "dshLanP_title", children: t("title") }),
					driveVisible ? h("div", { className: "dshLanP_row" },
						h("label", { children: t("drive") }),
						h("select", {
							value: currentRoot,
							onChange: (e) => { const root = e.target.value; if (root) list(root); },
							children: driveOptions
						})
					) : null,
					h("div", { className: "dshLanP_crumbs", children: crumbs }),
					h("div", { className: "dshLanP_entries", children: rows }),
					(listing && listing.truncated) ? h("div", { className: "dshLanP_note", children: t("truncated") }) : null,
					h("div", { className: "dshLanP_row" },
						h("input", {
							type: "text",
							placeholder: t("pathPlaceholder"),
							value: pathInput,
							onChange: (e) => setPathInput(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter") gotoPath(); }
						}),
						h("button", { type: "button", onClick: gotoPath, children: t("jump") })
					),
					h("div", { className: "dshLanP_row" },
						h("input", {
							type: "text",
							placeholder: t("newFolderPlaceholder"),
							value: newName,
							onChange: (e) => setNewName(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter") mkdir(); }
						}),
						h("button", { type: "button", onClick: mkdir, disabled: !ready || !newName.trim(), children: t("create") })
					),
					h("div", { className: "dshLanP_err", children: error || "" }),
					h("div", { className: "dshLanP_actions" },
						h("button", { type: "button", onClick: props.onCancel, children: t("cancel") }),
						h("button", { type: "button", className: "primary", disabled: !ready || busy, onClick: () => props.onPicked(listing.path), children: busy ? t("creating") : t("open") })
					)
				)
			);
		}

		// ── plugin ───────────────────────────────────────────────────────────
		// Cordis inject takes SERVICE names (what `ctx.get()` returns), not
		// package names. The web client provides `slots` (slot ledger/renderer),
		// `locale` and `connection`; the older package-name list below left the
		// fiber pending forever (no service is ever provided under a package
		// name), which failed the whole boot with "Failed to load plugins".
		// `workspaces` backs the desktop folder-picker dialog's browse calls
		// (same service the official directory-picker plugin injects).
		const inject = [
			"slots",
			"locale",
			"connection",
			"workspaces"
		];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("settings.dsh-lan", {
				zh: {
					"title": "\u5c40\u57df\u7f51\u8bbf\u95ee\uff08dsh-LAN\uff09",
					"description": "\u5141\u8bb8\u5c40\u57df\u7f51\u8bbe\u5907\u6253\u5f00\u672c\u9875\u9762\u64cd\u4f5c\u6b64 DeepSeek Harness\u3002\u5c40\u57df\u7f51\u7528\u6237\u53ef\u804a\u5929\u3001\u5207\u6362\u6a21\u578b\u4e0e\u5de5\u4f5c\u6a21\u5f0f\uff1b\u8f93\u5165\u53e3\u4ee4\u540e\u53ef\u8bbf\u95ee\u8bbe\u7f6e\u3001\u6743\u9650\u4e0e\u51ed\u636e\u7b49\u5168\u90e8\u529f\u80fd\u3002\u8bf7\u4ec5\u5728\u4fe1\u4efb\u7684\u7f51\u7edc\u542f\u7528\u3002",
					"toggle.on": "\u5f00\u542f\u5c40\u57df\u7f51\u8bbf\u95ee",
					"toggle.off": "\u5173\u95ed\u5c40\u57df\u7f51\u8bbf\u95ee",
					"status.bind": "\u7ed1\u5b9a\uff1a",
					"status.urls": "\u5c40\u57df\u7f51\u5730\u5740\uff1a",
					"status.off": "\u5f53\u524d\u4ec5\u672c\u673a\u53ef\u8bbf\u95ee\u3002",
					"firewall.ok": "\u9632\u706b\u5899\u5df2\u653e\u884c",
					"firewall.bad": "\u9632\u706b\u5899\u672a\u653e\u884c\uff08\u9700\u7ba1\u7406\u5458\u6743\u9650\uff09",
					"password.set": "\u5df2\u8bbe\u53e3\u4ee4",
					"password.unset": "\u672a\u8bbe\u53e3\u4ee4",
					"password.placeholder": "\u8bbe\u7f6e\u53e3\u4ee4\uff08\u81f3\u5c11 4 \u4f4d\uff09",
					"password.save": "\u4fdd\u5b58\u53e3\u4ee4",
					"password.clear": "\u6e05\u9664\u53e3\u4ee4",
					"unlock.placeholder": "\u8f93\u5165\u53e3\u4ee4\u89e3\u9501\u5168\u529f\u80fd",
					"unlock.btn": "\u89e3\u9501",
					"unlock.unlocked": "\u5df2\u89e3\u9501\uff1a\u8bbe\u7f6e\u3001\u6743\u9650\u3001\u51ed\u636e\u3001\u9884\u8bbe\u7ba1\u7406\u5747\u53ef\u4f7f\u7528",
					"unlock.failed": "\u53e3\u4ee4\u9519\u8bef",
					"error": "\u52a0\u8f7d\u5931\u8d25\uff1a"
				},
				en: {
					"title": "LAN access (dsh-LAN)",
					"description": "Let LAN devices open this page and operate this DeepSeek Harness. LAN users can chat, switch models and work modes; with the password they can also use settings, permissions and credentials. Enable only on trusted networks.",
					"toggle.on": "Enable LAN access",
					"toggle.off": "Disable LAN access",
					"status.bind": "Bind:",
					"status.urls": "LAN URLs:",
					"status.off": "Currently localhost-only.",
					"firewall.ok": "firewall open",
					"firewall.bad": "firewall blocked (needs admin)",
					"password.set": "password set",
					"password.unset": "no password",
					"password.placeholder": "Set password (min 4 chars)",
					"password.save": "Save password",
					"password.clear": "Clear password",
					"unlock.placeholder": "Enter password to unlock everything",
					"unlock.btn": "Unlock",
					"unlock.unlocked": "Unlocked: settings, permissions, credentials and preset management available",
					"unlock.failed": "Wrong password",
					"error": "Failed to load:"
				}
			}), "dsh-lan: dictionaries");

			ctx.effect(() => ctx.locale.register(LAN_PICKER_NS, {
				zh: {
					"title": "选择工作区目录",
					"drive": "盘符",
					"home": "主目录",
					"jump": "跳转",
					"pathPlaceholder": "输入路径，如 D:\\ 或 C:\\Users\\name",
					"newFolderPlaceholder": "在此新建文件夹…",
					"create": "创建",
					"open": "打开",
					"cancel": "取消",
					"creating": "正在创建…",
					"loading": "加载中…",
					"probing": "检测盘符中…",
					"noDrives": "未检测到磁盘",
					"truncated": "文件夹过多，仅显示开头部分。",
					"errList": "无法打开文件夹：",
					"errCreate": "新建文件夹失败："
				},
				en: {
					"title": "Select Workspace Directory",
					"drive": "Drive",
					"home": "Home",
					"jump": "Go",
					"pathPlaceholder": "Type a path, e.g. D:\\ or C:\\Users\\name",
					"newFolderPlaceholder": "New folder",
					"create": "Create",
					"open": "Open",
					"cancel": "Cancel",
					"creating": "Creating…",
					"loading": "Loading…",
					"probing": "Detecting drives…",
					"noDrives": "No drives detected",
					"truncated": "Too many folders to list; only the beginning is shown.",
					"errList": "Cannot open folder: ",
					"errCreate": "Failed to create folder: "
				}
			}), "dsh-lan: picker dictionaries");

			// Shadow the official workspace folder-picker dialog on the desktop
			// SPA (both directoryFlow holes) with our own dialog that adds a
			// drive dropdown. Boot-manifest plugins all register at the default
			// priority 0 (the runner's auto-priority only applies to on-demand
			// dynamic packages) — a same-priority second registration THROWS and
			// fails that plugin's apply. So we seat ourselves at a strictly
			// LOWER priority: the official picker then applies cleanly at 0 and
			// our occupant wins the `single` hole ("lowest renders"). A watcher
			// restores the seat if it is ever lost or abdicated (crashed), and
			// pauses while our dialog is open so an in-flight flow never
			// remounts mid-navigation.
			ensurePickerStyle();
			const pickerInjected = () => ({
				listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
				createDirectory: (path, name) => ctx.workspaces.createDirectory(path, name),
				t: ctx.locale.bind(LAN_PICKER_NS)
			});
			const PICKER_HOLES = ["conversation.hero.workspace.directoryFlow", "sidebar.workspaces.directoryFlow"];
			const pickerSeats = {};
			ctx.effect(() => {
				const seatIfNeeded = () => {
					// our dialog is open — never churn the entry mid-flow
					if (document.querySelector(".dshLanP_overlay") !== null) return;
					for (const hole of PICKER_HOLES) {
						if (ctx.slots.spec(hole) === void 0) continue; // not declared yet
						const winners = (typeof ctx.slots.entriesOfSlot === "function" ? ctx.slots.entriesOfSlot(hole) : ctx.slots.entries(hole)) || [];
						const winner = winners[0];
						if (winner && winner.registrant === "dsh-LAN") continue; // seated and winning
						if (pickerSeats[hole]) { pickerSeats[hole](); pickerSeats[hole] = null; }
						try {
							pickerSeats[hole] = ctx.slots.register({
								name: hole,
								priority: -1000,
								registrant: "dsh-LAN",
								inject: pickerInjected
							}, LanDirectoryFlow);
						} catch (error) {
							console.error("[dsh-LAN] picker shadow registration failed for " + hole, error);
						}
					}
				};
				seatIfNeeded();
				const watch = window.setInterval(seatIfNeeded, 1000);
				return () => {
					window.clearInterval(watch);
					for (const hole of PICKER_HOLES) {
						if (pickerSeats[hole]) { pickerSeats[hole](); pickerSeats[hole] = null; }
					}
				};
			}, "dsh-lan: picker shadow");

			wrapApi(ctx.get("connection"));
			ctx.on("connection/reset", () => {
				wrapApi(ctx.get("connection"));
			});
			if (!isLoopback()) void initGate();

			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "dsh-lan",
				order: -15,
				locale: "settings.dsh-lan",
				inject: () => ({
					hooks: { lan: store },
					refresh: fetchStatus,
					configure,
					setPassword,
					clearPassword,
					unlock
				})
			}, LanRow));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
