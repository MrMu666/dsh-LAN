#!/usr/bin/env bash
#
# dsh-LAN installer (patch-path install) for Linux / macOS.
#
# Copies this package into the profile's node_modules and writes the install
# block into the profile's cordis.patch.yml. The running server hot-reloads
# the patch (no restart); refresh the browser afterwards to load the UI card.
#
# Usage:
#   ./install.sh
#   ./install.sh --dsh-home /home/me/.dsh --profile web
#
# The block rewriting is done with Node (guaranteed present, since dsh needs
# it) so the result is byte-for-byte identical to the PowerShell installer.

set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="web"

usage() {
	sed -n '2,12p' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--dsh-home) DSH_HOME="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		-h|--help) usage; exit 0 ;;
		*) echo "dsh-LAN install.sh: unknown argument: $1" >&2; exit 2 ;;
	esac
done

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$DSH_HOME/profiles/node_modules/dsh-LAN"
LEGACY_DEST="$DSH_HOME/profiles/node_modules/dsh-lan-access"
PATCH_FILE="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"

rm -rf "$DEST" "$LEGACY_DEST"
mkdir -p "$(dirname "$DEST")"
cp -a "$SRC" "$DEST"

# Ship a clean package: drop the installers and VCS metadata.
rm -f "$DEST/install.ps1" "$DEST/uninstall.ps1" "$DEST/install.sh" "$DEST/uninstall.sh"
rm -rf "$DEST/.git"

export DSH_LAN_INSTALL_BEGIN='# --- dsh-LAN install block (managed - do not edit) ---'
export DSH_LAN_INSTALL_END='# --- end dsh-LAN install block ---'
export DSH_LAN_TOGGLE_BEGIN='# --- dsh-LAN toggle block (managed - do not edit) ---'
export DSH_LAN_TOGGLE_END='# --- end dsh-LAN toggle block ---'
export DSH_LAN_PROFILE="$PROFILE"
export DSH_LAN_PATCH_FILE="$PATCH_FILE"

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const {
	DSH_LAN_INSTALL_BEGIN, DSH_LAN_INSTALL_END,
	DSH_LAN_TOGGLE_BEGIN, DSH_LAN_TOGGLE_END,
	DSH_LAN_PROFILE, DSH_LAN_PATCH_FILE
} = process.env;

const installBlock =
	"\n" + DSH_LAN_INSTALL_BEGIN + "\n" +
	"- id: webserver\n" +
	"  config:\n" +
	"    host: !!js ctx.webStartup.host ?? '0.0.0.0'\n" +
	"    port: !!js ctx.webStartup.port ?? 3080\n" +
	"- insert:\n" +
	"    - id: dsh-lan\n" +
	"      name: 'dsh-LAN'\n" +
	"      config:\n" +
	"        profile: " + DSH_LAN_PROFILE + "\n" +
	DSH_LAN_INSTALL_END + "\n";

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let content = fs.existsSync(DSH_LAN_PATCH_FILE) ? fs.readFileSync(DSH_LAN_PATCH_FILE, "utf8") : "";

// strip any previously managed blocks (idempotent re-install)
content = content.replace(new RegExp(`\\r?\\n?${escapeRegex(DSH_LAN_INSTALL_BEGIN)}[\\s\\S]*?${escapeRegex(DSH_LAN_INSTALL_END)}\\r?\\n?`, "g"), "\n");
content = content.replace(new RegExp(`\\r?\\n?${escapeRegex(DSH_LAN_TOGGLE_BEGIN)}[\\s\\S]*?${escapeRegex(DSH_LAN_TOGGLE_END)}\\r?\\n?`, "g"), "\n");

// strip a pre-plugin hand-written webserver override (this plugin owns the row now)
content = content.replace(/\r?\n?- id: webserver\r?\n  config:\r?\n    host:[^\r\n]*\r?\n    port:[^\r\n]*/g, "\n");

// The fresh-profile template ends with a standalone empty-array placeholder
// `[]`. Remove it (and only it — never a `config: []` value) so the install
// block entries become the top-level array instead of being appended after a
// stray `[]` (which would make the YAML unparseable).
content = content.replace(/(^|\n)\[\]\s*$/, "$1").trimEnd();

fs.mkdirSync(path.dirname(DSH_LAN_PATCH_FILE), { recursive: true });
fs.writeFileSync(DSH_LAN_PATCH_FILE, content.trimEnd() + "\n\n" + installBlock + "\n");
NODE

echo "dsh-LAN installed:"
echo "  package -> $DEST"
echo "  patch   -> $PATCH_FILE"
echo "The running server hot-reloads the patch; refresh the browser to see the LAN card in General settings."
