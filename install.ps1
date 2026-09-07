<#
  dsh-LAN installer (patch-path install).

  Copies this package into the profile's node_modules and writes the install
  block into the profile's cordis.patch.yml. The running server hot-reloads
  the patch (no restart); refresh the browser afterwards to load the UI card.

  Usage:
    powershell -ExecutionPolicy Bypass -File install.ps1
    powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome C:\Users\me\.dsh -Profile web
#>
param(
	[string]$DshHome = "$env:USERPROFILE\.dsh",
	[string]$Profile = "web"
)

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$dest = Join-Path $DshHome "profiles\node_modules\dsh-LAN"
$legacyDest = Join-Path $DshHome "profiles\node_modules\dsh-lan-access"

if (Test-Path $dest) {
	Remove-Item $dest -Recurse -Force
}
if (Test-Path $legacyDest) {
	Remove-Item $legacyDest -Recurse -Force
}
# remove the pre-rename firewall rule name (one-time migration cleanup; the
# plugin re-creates its own rule under the current name on activation)
netsh advfirewall firewall delete rule name="DSH LAN Access (auto)" 2>$null | Out-Null
New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
Copy-Item $src $dest -Recurse -Force
foreach ($extra in @("install.ps1", "uninstall.ps1")) {
	$p = Join-Path $dest $extra
	if (Test-Path $p) { Remove-Item $p -Force }
}

$patchFile = Join-Path $DshHome "profiles\$Profile\cordis.patch.yml"
$installBegin = "# --- dsh-LAN install block (managed - do not edit) ---"
$installEnd = "# --- end dsh-LAN install block ---"
$toggleBegin = "# --- dsh-LAN toggle block (managed - do not edit) ---"
$toggleEnd = "# --- end dsh-LAN toggle block ---"

$installBlock = @"

$installBegin
- id: webserver
  config:
    host: !!js ctx.webStartup.host ?? '0.0.0.0'
    port: !!js ctx.webStartup.port ?? 3080
- insert:
    - id: dsh-lan
      name: 'dsh-LAN'
      config:
        profile: $Profile
$installEnd
"@

$content = if (Test-Path $patchFile) { Get-Content $patchFile -Raw } else { "" }

# strip any previously managed blocks (idempotent re-install)
$content = [regex]::Replace($content, "`r?`n?$([regex]::Escape($installBegin))[\s\S]*?$([regex]::Escape($installEnd))`r?`n?", "`n")
$content = [regex]::Replace($content, "`r?`n?$([regex]::Escape($toggleBegin))[\s\S]*?$([regex]::Escape($toggleEnd))`r?`n?", "`n")

# strip a pre-plugin hand-written webserver override (this plugin owns the row now)
$content = [regex]::Replace($content, "`r?`n?- id: webserver`r?`n  config:`r?`n    host:[^\r\n]*`r?`n    port:[^\r\n]*", "`n")

# The fresh-profile template ends with a standalone empty-array placeholder
# `[]`. Remove it (and only it — never a `config: []` value) so the install
# block entries become the top-level array instead of being appended after a
# stray `[]` (which would make the YAML unparseable).
$content = $content.TrimEnd()
if ($content.EndsWith("`n[]") -or $content -eq "[]") {
	$content = $content.Substring(0, $content.Length - 2).TrimEnd()
}

$content = $content + "`n`n" + $installBlock + "`n"
[System.IO.File]::WriteAllText($patchFile, $content, (New-Object System.Text.UTF8Encoding($false)))

# ── optional LAN enable + password setup (English prompts only) ─────────────
# Ask whether LAN access should be on right away and, if so, set the password
# (entered twice, hidden). The password file is written with Node using the
# exact salt/hash scheme of lib/index.js, so no shell-encoding pitfalls.
$lanStateFile = Join-Path $DshHome "dsh-lan.json"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$interactive = $true
try { $interactive = -not [Console]::IsInputRedirected } catch { $interactive = $true }

$lanChoice = ""
if ($interactive) {
	$lanChoice = Read-Host "Enable LAN access now? [Y/n]"
	if ($null -eq $lanChoice) { $lanChoice = "" }
} else {
	Write-Host "Non-interactive install: LAN stays enabled, password unchanged (set it later in Settings > General)."
}

if ($lanChoice -match "^[Nn]") {
	# Pin the GUI back to loopback: append the toggle block the plugin manages
	# (the install step above stripped any previous one, so this is fresh).
	$toggleBlock = "`n$toggleBegin`n- id: webserver`n  config:`n    host: '127.0.0.1'`n    port: !!js ctx.webStartup.port ?? 3080`n$toggleEnd`n"
	$content = if (Test-Path $patchFile) { Get-Content $patchFile -Raw } else { "" }
	$content = [regex]::Replace($content, "`r?`n?$([regex]::Escape($toggleBegin))[\s\S]*?$([regex]::Escape($toggleEnd))`r?`n?", "`n")
	$content = $content.TrimEnd() + "`n`n" + $toggleBlock.Trim() + "`n"
	[System.IO.File]::WriteAllText($patchFile, $content, (New-Object System.Text.UTF8Encoding($false)))
	Write-Host "LAN access left disabled (loopback only). You can enable it later in Settings > General."
} elseif ($interactive) {
	$pwPlain = $null
	while ($true) {
		try {
			$sec1 = Read-Host "Enter LAN password (min 4 chars, hidden)" -AsSecureString
			$sec2 = Read-Host "Enter LAN password again" -AsSecureString
		} catch {
			break
		}
		if ($null -eq $sec1 -or $null -eq $sec2) { break }
		$ptr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec1)
		$ptr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2)
		try {
			$plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr1)
			$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr2)
		} finally {
			[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr1)
			[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr2)
		}
		if ([string]::IsNullOrEmpty($plain1)) { Write-Host "Password cannot be empty; try again."; continue }
		if ($plain1.Length -lt 4) { Write-Host "Password too short (min 4 chars); try again."; continue }
		if ($plain1 -cne $plain2) { Write-Host "Passwords do not match; try again."; continue }
		$pwPlain = $plain1
		break
	}
	if (-not [string]::IsNullOrEmpty($pwPlain) -and $null -ne $nodeCmd) {
		$env:DSH_LAN_STATE_FILE = $lanStateFile
		$env:DSH_LAN_PASSWORD = $pwPlain
		$pwPlain = $null
		& $nodeCmd.Source -e @'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const file = process.env.DSH_LAN_STATE_FILE;
const password = process.env.DSH_LAN_PASSWORD ?? "";
if (password.length < 4) { console.error("dsh-LAN install: password too short"); process.exit(1); }
let state = {};
try {
	const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	if (parsed !== null && typeof parsed === "object") state = parsed;
} catch {}
// Same scheme as hashPassword() in lib/index.js: salt + sha256(salt, password).
const salt = crypto.randomBytes(16).toString("hex");
state.salt = salt;
state.passwordHash = crypto.createHash("sha256").update(salt).update(password).digest("hex");
state.passwordVersion = (typeof state.passwordVersion === "number" ? state.passwordVersion : 0) + 1;
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
'@
		Remove-Item Env:\DSH_LAN_PASSWORD -ErrorAction SilentlyContinue
		Remove-Item Env:\DSH_LAN_STATE_FILE -ErrorAction SilentlyContinue
		if ($LASTEXITCODE -eq 0) {
			Write-Host "LAN access enabled with your new password."
		} else {
			Write-Host "Password setup failed; LAN stays enabled, password unchanged (set it later in Settings > General)."
		}
	} elseif ($null -eq $nodeCmd) {
		Write-Host "Node was not found on PATH, skipping password setup; LAN stays enabled, password unchanged (set it later in Settings > General)."
	} else {
		Write-Host "Password setup skipped; LAN stays enabled, password unchanged (set it later in Settings > General)."
	}
}

Write-Host "dsh-LAN installed:"
Write-Host "  package -> $dest"
Write-Host "  patch   -> $patchFile"
Write-Host "The running server hot-reloads the patch; refresh the browser to see the LAN card in General settings."
