/**
 * dsh-LAN — node half.
 *
 * LAN access for the DSH Web GUI with a password-gated full-access channel:
 *
 * - Composition: the bundle patch (or the installer-written profile patch)
 *   defaults the webserver bind host to `0.0.0.0`, so the GUI listens on
 *   every interface. The profile's `cordis.patch.yml` is watched by the
 *   harness and hot-reloaded, so the UI toggle re-binds live.
 * - Firewall: keeps a Windows Defender Firewall rule (private+domain) for
 *   the bound port while LAN access is on, removes it when toggled off.
 * - `/lanapi/*` proxy: re-runs any `/api/*` request through the in-process
 *   API gateway, skipping the official loopback-pin for privileged methods.
 *   Non-loopback callers must present the password (`x-dsh-lan-key`).
 * - Own endpoints: `/dsh-lan/status` (read-only), `/dsh-lan/configure`
 *   (loopback-only), `/dsh-lan/unlock` (password check).
 *
 * SECURITY: this plugin deliberately relaxes the built-in "privileged
 * methods are loopback-only" posture. Anyone on the LAN who knows the
 * password can change settings, credentials, and agent presets — and anyone
 * on the LAN can chat/operate the agent without any password at all. Only
 * enable on networks you trust.
 *
 * @module dsh-LAN
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toFetchHandler } from "@deepseek-ai/dsh-host-apiproxy";

const name = "dsh-LAN";
const inject = ["webServer"];

const FIREWALL_RULE_NAME = "dsh-LAN (auto)";
const BLOCK_BEGIN = "# --- dsh-LAN toggle block (managed - do not edit) ---";
const BLOCK_END = "# --- end dsh-LAN toggle block ---";
const MAX_PROXY_BODY_BYTES = 256 * 1024 * 1024;
const MAX_CONFIG_BODY_BYTES = 1024 * 1024;
const REMOTE_UI_PATH = fileURLToPath(new URL("./remote-ui.html", import.meta.url));

function dshHome() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

function stateFile() {
	return join(dshHome(), "dsh-lan.json");
}

function profilePatchFile(profile) {
	return join(dshHome(), "profiles", profile, "cordis.patch.yml");
}

function readState() {
	try {
		const parsed = JSON.parse(readFileSync(stateFile(), "utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

function writeState(state) {
	writeFileSync(stateFile(), JSON.stringify(state, null, 2) + "\n");
}

/** Bare hostname from the request's Host header (brackets stripped). */
function hostnameOf(req) {
	const raw = String(req.headers.host ?? "");
	return raw.replace(/^\[/, "").split("]")[0].split(":")[0].toLowerCase();
}

function isLoopback(req) {
	const host = hostnameOf(req);
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function hashPassword(password, salt) {
	return createHash("sha256").update(salt).update(password).digest("hex");
}

function passwordMatches(state, candidate) {
	if (typeof state.passwordHash !== "string" || typeof state.salt !== "string") return false;
	const actual = Buffer.from(hashPassword(String(candidate), state.salt), "hex");
	const expected = Buffer.from(state.passwordHash, "hex");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Bump the password epoch whenever the password is set or cleared. */
function bumpPasswordVersion(state) {
	state.passwordVersion = (typeof state.passwordVersion === "number" ? state.passwordVersion : 0) + 1;
	return state;
}

function lanAddresses() {
	const out = [];
	for (const list of Object.values(networkInterfaces())) {
		for (const iface of list ?? []) {
			if (iface.family === "IPv4" && !iface.internal) out.push(iface.address);
		}
	}
	return out;
}

function netsh(args) {
	const result = spawnSync("netsh", args, { shell: false, encoding: "utf8", windowsHide: true });
	return { ok: result.status === 0, out: result.stdout ?? "", err: result.stderr ?? "" };
}

function firewallRuleExists() {
	return netsh(["advfirewall", "firewall", "show", "rule", `name=${FIREWALL_RULE_NAME}`]).ok;
}

/**
 * Delete-and-add: netsh output is localized, so parsing the current rule's
 * port is fragile — recreate the rule instead. Idempotent and locale-proof.
 */
function ensureFirewallRule(port) {
	removeFirewallRule();
	return netsh(["advfirewall", "firewall", "add", "rule", `name=${FIREWALL_RULE_NAME}`, "dir=in", "action=allow", "protocol=TCP", `localport=${port}`, "profile=private,domain"]).ok;
}

function removeFirewallRule() {
	if (!firewallRuleExists()) return true;
	return netsh(["advfirewall", "firewall", "delete", "rule", `name=${FIREWALL_RULE_NAME}`]).ok;
}

function escapeRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPatchContent(profile) {
	const file = profilePatchFile(profile);
	if (!existsSync(file)) return "";
	return readFileSync(file, "utf8");
}

function stripBlock(content, begin, end) {
	const pattern = new RegExp(`\\r?\\n?${escapeRegex(begin)}[\\s\\S]*?${escapeRegex(end)}\\r?\\n?`, "g");
	return content.replace(pattern, "\n");
}

function toggleBlockPresent(profile) {
	return readPatchContent(profile).includes(BLOCK_BEGIN);
}

/**
 * Insert/remove the toggle block that overrides the bind host to loopback.
 * `present: true` pins the GUI to 127.0.0.1 (LAN off); `false` removes the
 * override so the install layer's 0.0.0.0 default applies (LAN on). The
 * harness watches this file and hot-reloads the composition.
 */
function setToggleBlock(profile, present) {
	const file = profilePatchFile(profile);
	let content = stripBlock(readPatchContent(profile), BLOCK_BEGIN, BLOCK_END).trimEnd();
	if (present) {
		content = `${content}\n\n${BLOCK_BEGIN}\n- id: webserver\n  config:\n    host: '127.0.0.1'\n    port: !!js ctx.webStartup.port ?? 3080\n${BLOCK_END}\n`;
	} else {
		content = `${content}\n`;
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function buildStatus(ctx, config, req) {
	const profile = config.profile ?? "web";
	const state = readState();
	const enabled = !toggleBlockPresent(profile);
	const host = ctx.webServer.host;
	const port = ctx.webServer.port;
	const firewallOk = enabled ? firewallRuleExists() : !firewallRuleExists();
	return {
		ok: true,
		loopback: isLoopback(req),
		profile,
		enabled,
		bindHost: host,
		port,
		lanUrls: enabled ? lanAddresses().map((ip) => `http://${ip}:${port}`) : [],
		firewallOk,
		passwordSet: typeof state.passwordHash === "string",
		passwordVersion: typeof state.passwordVersion === "number" ? state.passwordVersion : 0
	};
}

function sendJson(res, status, value) {
	const body = Buffer.from(JSON.stringify(value));
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(body.length),
		"cache-control": "no-store"
	});
	res.end(body);
}

function sendText(res, status, text) {
	res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
	res.end(text);
}

async function readJsonBody(req, maxBytes) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > maxBytes) return { tooLarge: true };
		chunks.push(chunk);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") return { value: {} };
	try {
		return { value: JSON.parse(text) };
	} catch {
		return { invalid: true };
	}
}

/**
 * /lanapi proxy: password-gated re-entry into the in-process API gateway.
 * The official /api route pins privileged methods to loopback; this channel
 * applies its own gate (password for non-loopback callers) instead.
 */
async function handleProxy(ctx, req, res) {
	if (!isLoopback(req)) {
		const key = String(req.headers["x-dsh-lan-key"] ?? "");
		if (key === "" || !passwordMatches(readState(), key)) {
			sendText(res, 403, "forbidden: dsh-lan key required");
			return;
		}
	}
	const api = ctx.get("apiProxy");
	if (api === void 0) {
		sendText(res, 503, "api proxy unavailable");
		return;
	}
	const raw = req.url ?? "/";
	const qIndex = raw.indexOf("?");
	const suffix = qIndex === -1 ? raw : raw.slice(0, qIndex);
	const query = qIndex === -1 ? "" : raw.slice(qIndex);
	if (!suffix.startsWith("/lanapi/")) {
		sendText(res, 404, "not found");
		return;
	}
	const rewritten = `/api${suffix.slice("/lanapi".length)}${query}`;
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_PROXY_BODY_BYTES) {
			sendText(res, 413, "payload too large");
			return;
		}
		chunks.push(chunk);
	}
	const body = Buffer.concat(chunks);
	const headers = {};
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === void 0) continue;
		if (key === "content-length" || key === "x-dsh-lan-key") continue;
		headers[key] = Array.isArray(value) ? value.join(", ") : value;
	}
	let fetchResponse;
	try {
		const request = new Request(`http://127.0.0.1:${ctx.webServer.port}${rewritten}`, {
			method: req.method,
			headers,
			...(body.length === 0 ? {} : { body, duplex: "half" })
		});
		fetchResponse = await toFetchHandler(api).fetch(request);
	} catch (error) {
		sendText(res, 500, `proxy failure: ${String(error?.message ?? error)}`);
		return;
	}
	try {
		for (const [key, value] of fetchResponse.headers) res.setHeader(key, value);
		res.writeHead(fetchResponse.status);
		res.end(Buffer.from(await fetchResponse.arrayBuffer()));
	} catch (error) {
		sendText(res, 500, `proxy response failure: ${String(error?.message ?? error)}`);
	}
}

function apply(ctx, config = {}) {
	const profile = config.profile ?? "web";
	const log = (...args) => console.log("[dsh-LAN]", ...args);
	log(`activated (profile=${profile}, bind=${ctx.webServer.host}:${ctx.webServer.port})`);

	const statusRoute = {
		kind: "exact",
		path: "/dsh-lan/status",
		handler: (req, res) => {
			sendJson(res, 200, buildStatus(ctx, config, req));
		}
	};

	const configureRoute = {
		kind: "exact",
		path: "/dsh-lan/configure",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				sendJson(res, 405, { ok: false, error: "POST required" });
				return;
			}
			if (!isLoopback(req)) {
				sendJson(res, 403, { ok: false, error: "configure is loopback-only" });
				return;
			}
			const parsed = await readJsonBody(req, MAX_CONFIG_BODY_BYTES);
			if (parsed.tooLarge) {
				sendJson(res, 413, { ok: false, error: "payload too large" });
				return;
			}
			if (parsed.invalid) {
				sendJson(res, 400, { ok: false, error: "invalid JSON" });
				return;
			}
			const body = parsed.value ?? {};
			const state = readState();
			if (Object.prototype.hasOwnProperty.call(body, "password")) {
				const password = body.password;
				if (password === null || password === "") {
					delete state.passwordHash;
					delete state.salt;
					bumpPasswordVersion(state);
					writeState(state);
				} else if (typeof password === "string") {
					if (password.length < 4) {
						sendJson(res, 400, { ok: false, error: "password too short (min 4)" });
						return;
					}
					state.salt = randomBytes(16).toString("hex");
					state.passwordHash = hashPassword(password, state.salt);
					bumpPasswordVersion(state);
					writeState(state);
				} else {
					sendJson(res, 400, { ok: false, error: "password must be a string or null" });
					return;
				}
			}
			if (typeof body.enabled === "boolean") {
				setToggleBlock(profile, !body.enabled);
				if (body.enabled) {
					ensureFirewallRule(ctx.webServer.port);
				} else {
					removeFirewallRule();
				}
				log(`LAN ${body.enabled ? "enabled" : "disabled"} via toggle block`);
			}
			sendJson(res, 200, buildStatus(ctx, config, req));
		}
	};

	const unlockRoute = {
		kind: "exact",
		path: "/dsh-lan/unlock",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				sendJson(res, 405, { ok: false });
				return;
			}
			const parsed = await readJsonBody(req, MAX_CONFIG_BODY_BYTES);
			if (parsed.invalid || parsed.tooLarge) {
				sendJson(res, 400, { ok: false });
				return;
			}
			const candidate = parsed.value?.password;
			if (typeof candidate !== "string") {
				sendJson(res, 400, { ok: false });
				return;
			}
			sendJson(res, 200, { ok: passwordMatches(readState(), candidate) });
		}
	};

	const proxyRoute = {
		kind: "prefix",
		path: "/lanapi",
		handler: (req, res) => {
			void handleProxy(ctx, req, res);
		}
	};

	// The standalone remote UI (mobile-first, login-gated client) — the
	// surface LAN devices use; the desktop SPA stays the loopback surface.
	const uiRoute = {
		kind: "exact",
		path: "/dsh-lan/ui",
		handler: (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				sendText(res, 405, "GET required");
				return;
			}
			try {
				const body = readFileSync(REMOTE_UI_PATH);
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"content-length": String(body.length),
					"cache-control": "no-cache"
				});
				res.end(req.method === "HEAD" ? undefined : body);
			} catch (error) {
				sendText(res, 500, `remote ui unavailable: ${String(error?.message ?? error)}`);
			}
		}
	};

	const disposers = [
		ctx.webServer.register(statusRoute),
		ctx.webServer.register(configureRoute),
		ctx.webServer.register(unlockRoute),
		ctx.webServer.register(proxyRoute),
		ctx.webServer.register(uiRoute)
	];

	// Keep the firewall aligned with the current toggle state on activation.
	if (!toggleBlockPresent(profile)) {
		ensureFirewallRule(ctx.webServer.port);
	}

	return () => {
		for (const dispose of disposers) dispose();
	};
}

export { apply, inject, name };
