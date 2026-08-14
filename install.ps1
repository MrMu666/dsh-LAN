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

$content = $content.TrimEnd() + "`n`n" + $installBlock + "`n"
[System.IO.File]::WriteAllText($patchFile, $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "dsh-LAN installed:"
Write-Host "  package -> $dest"
Write-Host "  patch   -> $patchFile"
Write-Host "The running server hot-reloads the patch; refresh the browser to see the LAN card in General settings."
