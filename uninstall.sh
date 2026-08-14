#!/usr/bin/env bash
#
# dsh-LAN uninstaller for Linux / macOS.
#
# Removes the install/toggle blocks from the profile patch, the firewall rule
# (best-effort across firewalld / ufw / iptables), and the package copy. The
# running server hot-reloads the patch (no restart).
#
# Usage:
#   ./uninstall.sh
#   ./uninstall.sh --dsh-home /home/me/.dsh --profile web --port 3080

set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="web"
PORT="3080"

usage() {
	sed -n '2,13p' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--dsh-home) DSH_HOME="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--port) PORT="$2"; shift 2 ;;
		-h|--help) usage; exit 0 ;;
		*) echo "dsh-LAN uninstall.sh: unknown argument: $1" >&2; exit 2 ;;
	esac
done

DEST="$DSH_HOME/profiles/node_modules/dsh-LAN"
LEGACY_DEST="$DSH_HOME/profiles/node_modules/dsh-lan-access"
PATCH_FILE="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"

export DSH_LAN_INSTALL_BEGIN='# --- dsh-LAN install block (managed - do not edit) ---'
export DSH_LAN_INSTALL_END='# --- end dsh-LAN install block ---'
export DSH_LAN_TOGGLE_BEGIN='# --- dsh-LAN toggle block (managed - do not edit) ---'
export DSH_LAN_TOGGLE_END='# --- end dsh-LAN toggle block ---'
export DSH_LAN_PATCH_FILE="$PATCH_FILE"

if [[ -f "$PATCH_FILE" ]]; then
	node <<'NODE'
const fs = require("node:fs");
const {
	DSH_LAN_INSTALL_BEGIN, DSH_LAN_INSTALL_END,
	DSH_LAN_TOGGLE_BEGIN, DSH_LAN_TOGGLE_END,
	DSH_LAN_PATCH_FILE
} = process.env;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let content = fs.readFileSync(DSH_LAN_PATCH_FILE, "utf8");
content = content.replace(new RegExp(`\\r?\\n?${escapeRegex(DSH_LAN_INSTALL_BEGIN)}[\\s\\S]*?${escapeRegex(DSH_LAN_INSTALL_END)}\\r?\\n?`, "g"), "\n");
content = content.replace(new RegExp(`\\r?\\n?${escapeRegex(DSH_LAN_TOGGLE_BEGIN)}[\\s\\S]*?${escapeRegex(DSH_LAN_TOGGLE_END)}\\r?\\n?`, "g"), "\n");
// If only comments/whitespace remain, restore a valid empty array so the
// profile still parses as a top-level YAML array (an empty or comment-only
// file would make the loader throw).
const meaningful = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")).join("\n");
fs.writeFileSync(DSH_LAN_PATCH_FILE, (meaningful === "" ? "[]\n" : content.trimEnd() + "\n"));
NODE
fi

# Best-effort firewall rule removal. Only meaningful when the plugin previously
# ran with enough privilege to add a rule; deleting is safe when none exists.
remove_firewall_rule() {
	local port="$1"
	if command -v firewall-cmd >/dev/null 2>&1; then
		firewall-cmd --permanent --remove-port="${port}/tcp" >/dev/null 2>&1 || true
		firewall-cmd --reload >/dev/null 2>&1 || true
	elif command -v ufw >/dev/null 2>&1; then
		ufw delete allow "${port}/tcp" >/dev/null 2>&1 || true
	elif command -v iptables >/dev/null 2>&1; then
		iptables -D INPUT -p tcp --dport "${port}" -j ACCEPT >/dev/null 2>&1 || true
	fi
}
remove_firewall_rule "$PORT"

rm -rf "$DEST" "$LEGACY_DEST"
echo "dsh-LAN uninstalled. The server hot-reloads the patch; no restart needed."
