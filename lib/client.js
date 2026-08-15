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
				// ── portrait-mobile: adapt the desktop SPA in place (v47) ────────────
		// Mobile uses the desktop UI itself (the standalone /dsh-lan/ui was
		// removed in v48); while a touch device is in portrait we inject a
		// mobile-touch adaptation. The official layout already auto-collapses
		// the sidebar to a compact rail below 1024px; this overlay adds
		// touch-target sizing, input font-size (iOS zoom), safe-area handling,
		// slightly smaller type (v50) and hides the collapsed rail behind a
		// floating whale button (v50). Landscape, desktop and wide viewports
		// stay untouched; a manual sessionStorage opt-out
		// (dsh-lan-force-desktop=1) still disables it.
		(function mobileAdapt() {
			const ADAPT_CSS_ID = "dsh-LAN/mobile-adapt.css";
			let active = false;
			let savedViewportContent = null;
			let whaleEl = null;
			let whaleObserver = null;
			let whaleTimer = null;
			let whaleSuppressClick = false;
			function isMobilePortrait() {
				if (!window.matchMedia("(orientation: portrait)").matches) return false;
				if (!window.matchMedia("(pointer: coarse)").matches) return false;
				if (window.innerWidth >= 1100) return false;
				if (window.sessionStorage.getItem("dsh-lan-force-desktop") === "1") return false;
				return true;
			}
			// CSS Modules class names are hash-prefixed with the semantic name
			// as a stable suffix (e.g. `pI_x6G_centerCol`) — attribute suffix
			// selectors survive official rebuilds that change the hash only.
			const ADAPT_CSS = [
				"html,body{height:100%}",
				"[class$=\"_frame\"]{width:100%;height:100dvh}",
				// compact rail: bigger touch targets
				"[class$=\"_railFish\"] button,[class$=\"_panelIcon\"],[class$=\"_newSession\"]{min-width:44px;min-height:44px}",
				// message list padding on narrow screens
				"[class$=\"_scroll\"]{padding:8px 10px}",
				// 16px inputs prevent iOS focus zoom; keep send button touchy
				"[class$=\"_input\"],textarea,input{font-size:16px}",
				"[class$=\"_composer\"]{padding-bottom:calc(4px + env(safe-area-inset-bottom))}",
				// ── v50: slightly smaller type on portrait phones ───────────────
				"[class$=\"_scrollBody\"] [class$=\"_root\"]{font-size:14.5px}",
				"[class$=\"_scrollBody\"] [class$=\"_bubble\"]{font-size:14.5px}",
				"[class$=\"_titleRow\"] *{font-size:13px}",
				"[class$=\"_sidebarCol\"] [class$=\"_root\"],[class$=\"_sidebarCol\"] [class$=\"_newSession\"],[class$=\"_sidebarCol\"] [class$=\"_trigger\"],[class$=\"_sidebarCol\"] [class$=\"_title\"]{font-size:13px}",
				"[class$=\"_sidebarCol\"] [class$=\"_meta\"],[class$=\"_sidebarCol\"] [class$=\"_time\"]{font-size:11.5px}",
				// ── v50: collapsed rail hidden; whale button is the entry ────────
				// the frame's grid is inline-styled (56px rail track when
				// collapsed); pin the first track to 0 so content uses the full
				// width. On portrait phones the details track is always 0
				// (computeColumns drops it when there is no room), so the
				// three-track override is safe here.
				"[class$=\"_frame\"][data-sidebar-collapsed]{grid-template-columns:0 minmax(0,1fr) 0 !important}",
				// keep the chat header title clear of the floating whale
				"body.dsh-lan-rail-hidden [class$=\"_titleRow\"]{padding-left:52px}",
				"#dshLanWhale{position:fixed;top:calc(4px + env(safe-area-inset-top));left:calc(8px + env(safe-area-inset-left));z-index:2147482999;width:34px;height:34px;min-width:34px;padding:0;border-radius:10px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.25)}",
				"#dshLanWhale svg{width:20px;height:15px;display:block}",
				"#dshLanWhale:active{opacity:.72}",
				// ── v51/v52: mobile-only tweaks ──────────────────────────────
				// smaller collapse toggle in the expanded sidebar (the toggle
				// carries two classes, so match by containment)
				"[class$=\"_sidebarCol\"] [class$=\"_logoRow\"] [class*=\"_iconButton\"]{width:18px;height:18px}",
				// v47's panelIcon touch rule forces a 44px min on the icon
				// itself — zero it out so the 13px glyph fits the 18px button
				"[class$=\"_sidebarCol\"] [class$=\"_logoRow\"] [class*=\"_iconButton\"] svg{width:13px;height:13px;min-width:0;min-height:0}",
				// hide the header Session-log download button (no space on phones)
				"[class$=\"_headerUtilities\"]{display:none}",
				// v52 composer: the two lines (permission / model) stay stacked
				// with zero row gap; the command, context-meter and send/stop
				// buttons float at the left/right edges vertically centered
				// over both lines; permission label expanded; 1px bottom gap
				"[class$=\"_composerSeat\"] [class$=\"_card\"]{margin-bottom:1px}",
				"[class$=\"_composerSeat\"] [class$=\"_row\"]{flex-wrap:wrap;row-gap:0;padding:2px 8px 1px;position:relative}",
				"[class$=\"_composerSeat\"] [class$=\"_add\"]{position:absolute;left:8px;top:50%;transform:translateY(-50%)}",
				"[class$=\"_composerSeat\"] [class$=\"_modes\"]{min-width:0;padding-left:38px}",
				"[class$=\"_composerSeat\"] [class$=\"_modes\"] [class$=\"_trigger\"]{max-width:none}",
				"[class$=\"_composerSeat\"] [class$=\"_modes\"] [class$=\"_triggerLabel\"]{display:block}",
				// model line left-aligned with the permission line (same
				// command-button clearance), rows stay tightly stacked
				"[class$=\"_composerSeat\"] [class$=\"_trailing\"]{flex-basis:100%;justify-content:flex-start;padding-left:38px;padding-right:78px}",
				"[class$=\"_composerSeat\"] [class$=\"_trailing\"] *{font-size:12px}",
				// v54: smaller permission/model buttons (font + height)
				"[class$=\"_composerSeat\"] [class$=\"_modes\"] [class$=\"_trigger\"]{height:24px;min-height:24px;font-size:12px}",
				"[class$=\"_composerSeat\"] [class$=\"_trailing\"] [class$=\"_trigger\"]{height:24px;min-height:24px;font-size:11px}",
				// context meter + send/stop float at the right edge, vertically
				// centered over both lines (the meter's root contains the track)
				"[class$=\"_composerSeat\"] [class$=\"_trailing\"] > [class$=\"_root\"]:has([class$=\"_track\"]){position:absolute;right:52px;top:50%;transform:translateY(-50%)}",
				"[class$=\"_composerSeat\"] [class$=\"_primary\"]{position:absolute;right:8px;top:50%;transform:translateY(-50%)}",
				// bottom stats line (N 轮 · M 步 …) two sizes below the tabs —
				// higher specificity than the reply-root rule above; v55: wrap
				// freely but clamp at two lines (the official rule is
				// nowrap + single-line ellipsis); v56: left-aligned with the
				// v60: drop the official 32px right padding so the text also
				// extends to the card's right edge
				"[class$=\"_composerSeat\"] [data-slot=\"conversation.composer.dock\"] [class$=\"_root\"]{font-size:10px;white-space:normal;word-break:break-word;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-align:left;line-height:13px;letter-spacing:-0.2px;padding-left:0;padding-right:0}",
				// (user bubbles keep the v50 14.5px via the _bubble rule)
				"[class$=\"_scrollBody\"] [class$=\"_root\"]{font-size:13px}",
				"[class$=\"_scrollBody\"] [class$=\"_body\"]{gap:6px}",
				"#dshLanWhale{touch-action:none}",
				// v58: on touch, taps leave :hover/:focus stuck, so the official
				// Tooltip bubbles ("发送消息" above the send button, sidebar
				// labels, composer controls…) stay visible on mobile. Hide all
				// tooltip bubbles in portrait (scoped by role — user message
				// bubbles share the _bubble suffix).
				"[class$=\"_bubble\"][role=\"tooltip\"]{display:none}",
				// v64: the ask_user_question takeover (QuestionComposer /
				// PlanReviewPanel share the _frame/_card suffixes) overflows a
				// narrow phone: its frame is width:100% + 32px content-box
				// paddings (446px on a 390px screen) and the sticky bottom
				// composer seat pushes the card top above the viewport. Pin
				// the frame to the viewport with border-box and cap its
				// height so the card sits fully on screen.
				"[class$=\"_composerSeat\"] [class$=\"_frame\"]{box-sizing:border-box;width:100%;max-width:100%;padding-left:12px;padding-right:12px;height:auto;max-height:calc(100dvh - 96px);align-items:flex-start;overflow-y:auto}",
				"[class$=\"_composerSeat\"] [class$=\"_frame\"] [class$=\"_card\"]{max-width:none;width:100%}"
			].join("");
			function apply() {
				if (active) return;
				active = true;
				document.body.classList.add("dsh-lan-portrait");
				if (document.querySelector("style[data-plugin-css=\"" + ADAPT_CSS_ID + "\"]") === null) {
					const tag = document.createElement("style");
					tag.dataset.plugin = "dsh-LAN";
					tag.dataset.pluginCss = ADAPT_CSS_ID;
					tag.textContent = ADAPT_CSS;
					document.head.appendChild(tag);
				}
				// viewport-fit=cover enables env(safe-area-inset-*); restore on revert
				const meta = document.querySelector("meta[name=viewport]");
				if (meta && meta.getAttribute("content") && meta.getAttribute("content").indexOf("viewport-fit") === -1) {
					savedViewportContent = meta.getAttribute("content");
					meta.setAttribute("content", savedViewportContent + ", viewport-fit=cover");
				}
				ensureWhale();
				syncWhale();
				// React builds nodes with attributes before inserting them, so
				// attribute observers miss the initial collapsed state — a
				// light interval is the reliable sync.
				if (whaleTimer === null) whaleTimer = window.setInterval(syncWhale, 600);
			}
			function revert() {
				if (!active) return;
				active = false;
				document.body.classList.remove("dsh-lan-portrait");
				document.body.classList.remove("dsh-lan-rail-hidden");
				const tag = document.querySelector("style[data-plugin-css=\"" + ADAPT_CSS_ID + "\"]");
				if (tag) tag.remove();
				const meta = document.querySelector("meta[name=viewport]");
				if (meta && savedViewportContent !== null) {
					meta.setAttribute("content", savedViewportContent);
					savedViewportContent = null;
				}
				if (whaleEl !== null) whaleEl.style.display = "none";
				if (whaleTimer !== null) { window.clearInterval(whaleTimer); whaleTimer = null; }
			}
			// The whale (fish logo) button: the only entry point to the sidebar
			// while the collapsed rail is hidden. Clicking expands the sidebar
			// through the layout service (wired by the plugin apply() once
			// ctx.layout is live). Hidden while the sidebar is expanded (its own
			// collapse control takes over) and while any overlay/modal is up.
			const FISH_PATH = "M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z";
			function ensureWhale() {
				if (whaleEl !== null) return;
				if (typeof document === "undefined" || !document.body) return;
				whaleEl = document.createElement("button");
				whaleEl.id = "dshLanWhale";
				whaleEl.type = "button";
				whaleEl.title = "打开侧边栏";
				whaleEl.setAttribute("aria-label", "打开侧边栏");
				whaleEl.innerHTML = '<svg viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="' + FISH_PATH + '" fill="currentColor"/></svg>';
				whaleEl.addEventListener("click", () => {
					if (whaleSuppressClick) { whaleSuppressClick = false; return; }
					const toggle = window.__dshLanAdapt && window.__dshLanAdapt.toggleSidebar;
					if (typeof toggle === "function") toggle();
				});
				// v51: the whale floats — pointer-drag repositions it (persisted)
				whaleEl.addEventListener("pointerdown", (e) => {
					if (e.button !== 0 && e.pointerType === "mouse") return;
					// v61: opening the sidebar must not leave a focused composer
					// input behind — on phones a still-focused input makes the
					// first tap re-pop the keyboard (iOS) or keeps it open.
					// Blur at pointerdown (before the tap completes; click is
					// too late for iOS) and block pending programmatic refocus.
					if (active) {
						const ta = document.querySelector('[class$="_composerSeat"] textarea, [class$="_composerSeat"] input');
						if (ta !== null && document.activeElement === ta) {
							ta.blur();
							lastComposerTap = 0;
						}
					}
					drag = { x: e.clientX, y: e.clientY, left: whaleEl.offsetLeft, top: whaleEl.offsetTop, moved: false };
					try { whaleEl.setPointerCapture(e.pointerId); } catch (err) {}
					e.preventDefault();
					e.stopPropagation();
				});
				whaleEl.addEventListener("pointermove", (e) => {
					if (drag === null) return;
					const dx = e.clientX - drag.x;
					const dy = e.clientY - drag.y;
					whaleEl.style.left = Math.min(Math.max(4, drag.left + dx), window.innerWidth - 38) + "px";
					whaleEl.style.top = Math.min(Math.max(4, drag.top + dy), window.innerHeight - 38) + "px";
					e.preventDefault();
					e.stopPropagation();
				});
				const endWhaleDrag = () => {
					if (drag === null) return;
					const moved = drag.moved;
					drag = null;
					whaleSuppressClick = moved;
					try {
						window.localStorage.setItem("dsh-lan-whale-pos", JSON.stringify({ x: whaleEl.offsetLeft, y: whaleEl.offsetTop }));
					} catch (err) {}
				};
				whaleEl.addEventListener("pointerup", endWhaleDrag);
				whaleEl.addEventListener("pointercancel", endWhaleDrag);
				document.body.appendChild(whaleEl);
			}
			// restore a dragged position when the whale becomes visible again
			function applyWhalePos() {
				if (whaleEl === null) return;
				let pos = null;
				try { pos = JSON.parse(window.localStorage.getItem("dsh-lan-whale-pos") || "null"); } catch (err) {}
				if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
					whaleEl.style.left = pos.x + "px";
					whaleEl.style.top = pos.y + "px";
				}
			}
			function syncWhale() {
				if (whaleEl === null) return;
				if (!active) { whaleEl.style.display = "none"; return; }
				const collapsed = document.querySelector('[class$="_frame"][data-sidebar-collapsed]') !== null;
				const overlayUp = document.querySelector('[class$="_overlay"]') !== null;
				const show = collapsed && !overlayUp;
				if (show && whaleEl.style.display !== "") applyWhalePos();
				whaleEl.style.display = show ? "" : "none";
				document.body.classList.toggle("dsh-lan-rail-hidden", collapsed);
			}
			function ensureWhaleObserver() {
				if (whaleObserver !== null || typeof MutationObserver === "undefined" || !document.body) return;
				whaleObserver = new MutationObserver(() => syncWhale());
				whaleObserver.observe(document.body, { attributes: true, attributeFilter: ["data-sidebar-collapsed"], subtree: true });
			}
			function evaluate() {
				if (isMobilePortrait()) { apply(); ensureWhaleObserver(); }
				else revert();
			}
			evaluate();
			window.addEventListener("orientationchange", evaluate);
			window.addEventListener("resize", evaluate);
			// ── v51: mobile input & sidebar behaviors ─────────────────────────
			// Enter only inserts a newline on mobile (send goes through the
			// send button). Captured at document level so the official
			// Enter-to-send handler never sees the event.
			function onKeydownCapture(e) {
				if (!active) return;
				if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
				const t = e.target;
				if (!(t instanceof HTMLElement)) return;
				if (!t.closest('[class$="_input"]')) return;
				if (e.isComposing || t.isComposing) return;
				e.preventDefault();
				e.stopPropagation();
				try { document.execCommand("insertText", false, "\n"); } catch (err) {}
			}
			document.addEventListener("keydown", onKeydownCapture, true);
			function collapseSidebar() {
				const toggle = window.__dshLanAdapt && window.__dshLanAdapt.toggleSidebar;
				if (typeof toggle === "function") toggle();
			}
			// Auto-collapse the expanded sidebar on mobile: after clicking a
			// session row, or when tapping anywhere outside the sidebar
			// (overlays/dialogs/whale excluded).
			function onClickCapture(e) {
				if (!active) return;
				const frame = document.querySelector('[class$="_frame"]');
				if (!frame || frame.hasAttribute("data-sidebar-collapsed")) return;
				const t = e.target;
				if (t.closest('[class$="_sidebarCol"]')) {
					if (t.closest('[class$="_sessionRow"]')) collapseSidebar();
					return;
				}
				if (t.closest('[class$="_overlay"], [class$="_dialog"], [class$="_menu"], #dshLanWhale, #dshLanGate')) return;
				collapseSidebar();
			}
			document.addEventListener("click", onClickCapture, true);
			// v59: the official composer auto-focuses its textarea on mount and
			// on [locked, sessionId] changes. On phones a programmatic focus
			// alone doesn't raise the keyboard, but the first user tap (e.g. on
			// the whale) then reveals the keyboard for that focused input — so
			// tapping the whale looks like it pops the input method. Only allow
			// composer focus that follows a real tap on the input itself; drop
			// every other (programmatic) focus of it.
			let lastComposerTap = 0;
			document.addEventListener("pointerdown", (e) => {
				if (!active) return;
				const t = e.target;
				if (t instanceof HTMLElement && (t.tagName === "TEXTAREA" || t.tagName === "INPUT") && t.closest('[class$="_composerSeat"]') !== null) lastComposerTap = Date.now();
			}, true);
			// Intercept every explicit .focus() on the composer input. The
			// official conversation component focuses it on mount and on
			// [locked, sessionId] changes; user taps focus it through the
			// browser's own pipeline (not this method), so the flag below
			// cleanly separates "user tapped the input" from "code focused
			// it". Installed here (factory top, before React mounts).
			const lanOrigFocus = HTMLElement.prototype.focus;
			HTMLElement.prototype.focus = function (options) {
				if (active && this instanceof HTMLElement && (this.tagName === "TEXTAREA" || this.tagName === "INPUT") && this.closest('[class$="_composerSeat"]') !== null && Date.now() - lastComposerTap >= 800) {
					return;
				}
				return lanOrigFocus.call(this, options);
			};
			// plugin apply() wires toggleSidebar to ctx.layout once it is live
			window.__dshLanAdapt = { evaluate, toggleSidebar: null };
		})();
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		// ── constants ──
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
		const css = ".dshLan_row{flex-direction:column;gap:10px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;display:flex}.dshLan_head{align-items:center;gap:8px;display:flex}.dshLan_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}.dshLan_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}.dshLan_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}.dshLan_toggle{appearance:none;flex:none;width:44px;height:24px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);cursor:pointer;position:relative;transition:background .15s}.dshLan_toggle:disabled{cursor:default;opacity:.5}.dshLan_toggle::after{content:\"\";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left .15s,background .15s}.dshLan_toggle[aria-checked=\"true\"]{background:var(--dsw-alias-brand-primary)}.dshLan_toggle[aria-checked=\"true\"]::after{left:22px;background:#fff}.dshLan_status{flex-direction:column;gap:2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:flex}.dshLan_urls{font-family:var(--dsw-font-family-mono,monospace);word-break:break-all}.dshLan_row2{align-items:center;gap:8px;display:flex;flex-wrap:wrap}.dshLan_input{flex:1;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0 10px;outline:none;max-width:280px;min-width:160px}.dshLan_btn{height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0 14px;cursor:pointer}.dshLan_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshLan_btn:disabled{cursor:default;opacity:.5}.dshLan_badge{align-self:flex-start;border-radius:999px;background:var(--dsw-alias-success-bg,rgba(46,160,67,.15));color:var(--dsw-alias-success-fg,#2ea043);font-size:12px;line-height:18px;padding:2px 10px}.dshLan_err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dshLanLock{box-sizing:border-box;cursor:pointer;width:calc(100% + 8px);height:34px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:12px;flex:none;align-items:center;gap:8px;margin:4px -4px;padding:6px 2px 6px 10px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}.dshLanLock:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshLanLock.rail{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:8px 0 10px;padding:0}.dshLanLockLabel{white-space:nowrap;overflow:hidden}[class$=\"_footerActions\"]{flex-wrap:wrap}";
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
				const firewallLabel = data.firewallManaged === false
					? t("firewall.na")
					: t(data.firewallOk ? "firewall.ok" : "firewall.bad");
				const firewallText = data.firewallNote ? firewallLabel + " (" + data.firewallNote + ")" : firewallLabel;
				statusLines.push(react.createElement("div", { children: t("status.bind") + " " + data.bindHost + ":" + data.port + " \u00b7 " + firewallText + " \u00b7 " + t(data.passwordSet ? "password.set" : "password.unset") }));
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
						if (!isLoopback()) mountGate();
					}
					if (!response.ok) throw new Error("transport failure for " + path + ": HTTP " + response.status);
					return response;
				});
			};
			}
			// v62: official surfaces (agent-preset controller etc.) call
			// connection.api.postJson — so wrapApi above never sees them and
			// they hit /api/* directly, which the host pins to loopback (403
			// on LAN). Intercept at the network layer instead: reroute
			// privileged /api/<method> requests to /lanapi/<method> with the
			// stored key. Non-privileged calls and /lanapi itself pass through.
			let lanFetchWrapped = false;
			function installLanFetchReroute() {
				if (lanFetchWrapped || typeof window === "undefined") return;
				lanFetchWrapped = true;
				const lanOrigFetch = window.fetch.bind(window);
				window.fetch = function (input, init) {
					let pathname = "";
					try { pathname = new URL(typeof input === "string" ? input : input && input.url, window.location.href).pathname; } catch (err) {}
					const method = pathname.startsWith("/api/") ? pathname.slice(5) : "";
					if (method !== "" && !isLoopback() && PRIVILEGED.has(method)) {
						const headers = new Headers((init && init.headers) || (typeof input === "object" && input.headers) || {});
						const key = storedKey();
						if (key !== "") headers.set("x-dsh-lan-key", key);
						let lanUrl = "";
						try {
							const u = new URL("/lanapi/" + method, window.location.href);
							u.search = new URL(typeof input === "string" ? input : input && input.url, window.location.href).search;
							lanUrl = u.href;
						} catch (err) { return lanOrigFetch(input, init); }
						const body = (init && init.body) || (typeof input === "object" && input.body);
						return lanOrigFetch(lanUrl, { ...(init || {}), headers, body }).then((response) => {
							if (response.status === 403) {
								clearStoredKey();
								store.set({ unlocked: false });
								if (!isLoopback()) mountGate();
							}
							return response;
						});
					}
					return lanOrigFetch(input, init);
				};
			}
			// ── login gate overlay (non-loopback desktop) ────────────────────────
			const GATE_CSS = "#dshLanGate{position:fixed;inset:0;z-index:2147483000;background:rgba(10,12,16,.96);display:flex;align-items:center;justify-content:center;padding:24px}#dshLanGate .card{width:100%;max-width:380px;background:#171a21;border:1px solid #2a2f3a;border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:12px;color:#e6e9ef;font:14px/1.55 -apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}#dshLanGate .t{font-size:20px;font-weight:700;text-align:center}#dshLanGate .s{color:#9aa3b2;font-size:13px;text-align:center;margin-top:-6px}#dshLanGate input[type=password]{font:inherit;color:inherit;background:#0f1117;border:1px solid #2a2f3a;border-radius:10px;padding:11px 12px;outline:none}#dshLanGate input[type=password]:focus{border-color:#4c8dff}#dshLanGate label{display:flex;align-items:center;gap:8px;color:#9aa3b2;font-size:13px}#dshLanGate button{font:inherit;border:none;border-radius:10px;padding:11px;background:#4c8dff;color:#fff;font-weight:600;cursor:pointer}#dshLanGate button:disabled{opacity:.5;cursor:default}#dshLanGate .err{color:#e5534b;font-size:13px;min-height:16px;text-align:center}#dshLanLock{position:fixed;right:14px;bottom:14px;z-index:2147483000;font:13px -apple-system,'Segoe UI','PingFang SC',sans-serif;border-radius:999px;border:1px solid #2a2f3a;background:#171a21;color:#9aa3b2;padding:7px 14px;cursor:pointer}";
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
				return;
			}
			clearStoredKey();
			store.set({ unlocked: false });
			mountGate();
		}

		// ── desktop workspace-folder picker (shadows the official dialog) ─────
		// dsh-LAN binds 0.0.0.0, so the directory-picker resolver
		// (bindHost !== "127.0.0.1" → `browse` backend) serves the in-app
		// DirectoryBrowser on every client — crumbs + path editing, no drive
		// enumeration. We shadow both directoryFlow holes (single slots; the
		// runner assigns strictly decreasing priorities, lowest renders) with
		// our own dialog that adds a drive dropdown, matching the mobile UI
		// (v36). v49: the shadow applies to LAN clients ONLY — on the host
		// machine (127.0.0.1/localhost) the official picker flow stays as-is.
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

		// ── sidebar lock button (v48) ────────────────────────────────────────
		// The lock control for LAN clients sits in the official sidebar foot:
		// `sidebar.footer.action` entries render directly above the
		// `sidebar.settings` trigger (SettingsRoot), so the button appears right
		// above the bottom-left settings gear. It mirrors the settings
		// trigger's own CSS (same geometry, tokens, hover and rail variant) —
		// "样式与设置按钮一致". Visible only for non-loopback clients that have
		// unlocked (the gate flow sets store.unlocked); clicking it clears the
		// stored key and re-mounts the login gate.
		const LOCK_ICON_PATH = "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z";
		function LanLockButton({ wide, t }) {
			const unlocked = useLan((snapshot) => snapshot.unlocked);
			if (isLoopback() || unlocked !== true) return null;
			return h("button", {
				type: "button",
				className: "dshLanLock" + (wide ? "" : " rail"),
				title: t("lock"),
				"aria-label": t("lock"),
				onClick: () => {
					clearStoredKey();
					store.set({ unlocked: false });
					mountGate();
				},
				children: [
					h("svg", {
						viewBox: "0 0 24 24",
						width: wide ? 16 : 18,
						height: wide ? 16 : 18,
						fill: "currentColor",
						"aria-hidden": "true",
						children: h("path", { d: LOCK_ICON_PATH })
					}),
					wide ? h("span", { className: "dshLanLockLabel", children: t("lock") }) : null
				]
			});
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
			"workspaces",
			"layout"
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
					"firewall.na": "\u9632\u706b\u5899\u672a\u7531\u63d2\u4ef6\u7ba1\u7406\uff08\u672a\u68c0\u6d4b\u5230\u53d7\u652f\u6301\u7684\u9632\u706b\u5899\uff09",
					"password.set": "\u5df2\u8bbe\u53e3\u4ee4",
					"password.unset": "\u672a\u8bbe\u53e3\u4ee4",
					"password.placeholder": "\u8bbe\u7f6e\u53e3\u4ee4\uff08\u81f3\u5c11 4 \u4f4d\uff09",
					"password.save": "\u4fdd\u5b58\u53e3\u4ee4",
					"password.clear": "\u6e05\u9664\u53e3\u4ee4",
					"unlock.placeholder": "\u8f93\u5165\u53e3\u4ee4\u89e3\u9501\u5168\u529f\u80fd",
					"unlock.btn": "\u89e3\u9501",
					"unlock.unlocked": "\u5df2\u89e3\u9501\uff1a\u8bbe\u7f6e\u3001\u6743\u9650\u3001\u51ed\u636e\u3001\u9884\u8bbe\u7ba1\u7406\u5747\u53ef\u4f7f\u7528",
					"unlock.failed": "\u53e3\u4ee4\u9519\u8bef",
					"lock": "\u9501\u5b9a",
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
					"firewall.na": "firewall not managed (no supported firewall detected)",
					"password.set": "password set",
					"password.unset": "no password",
					"password.placeholder": "Set password (min 4 chars)",
					"password.save": "Save password",
					"password.clear": "Clear password",
					"unlock.placeholder": "Enter password to unlock everything",
					"unlock.btn": "Unlock",
					"unlock.unlocked": "Unlocked: settings, permissions, credentials and preset management available",
					"unlock.failed": "Wrong password",
					"lock": "Lock",
					"error": "Failed to load:"
				}
			}), "dsh-lan: dictionaries");

			ctx.effect(() => ctx.locale.register(LAN_PICKER_NS, {
				zh: {
					"title": "选择工作区目录",
					"drive": "盘符",
					"home": "主目录",
					"jump": "跳转",
					"pathPlaceholder": "输入路径，如 D:\\、C:\\Users\\name 或 /home/name",
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
					"pathPlaceholder": "Type a path, e.g. D:\\, C:\\Users\\name or /home/name",
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
			// LAN clients only: the host machine keeps the official picker
			// flow (v49) — this whole shadow block is skipped on loopback,
			// while the rest of the plugin (gate, lock button, LAN card,
			// whale/layout wiring) applies everywhere.
			if (!isLoopback()) {
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
			}
			wrapApi(ctx.get("connection"));
			installLanFetchReroute();
			ctx.on("connection/reset", () => {
				wrapApi(ctx.get("connection"));
			});
			// the mobile whale button expands the collapsed sidebar through the
			// official layout service (narrow mode flips narrowExpanded)
			if (window.__dshLanAdapt) {
				window.__dshLanAdapt.toggleSidebar = () => ctx.layout.toggleSidebar();
			}
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
			// settings trigger (`sidebar.settings`). It is a LIST slot — each
			// registrant needs its own id; order 10 keeps it below the official
			// cordis-panel badge (order 0) so it is the entry directly above
			// the settings button. Our CSS wraps the foot row so the two
			// full-width entries stack instead of overflowing.
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-lan-lock",
				order: 10,
				locale: "settings.dsh-lan"
			}, LanLockButton));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
