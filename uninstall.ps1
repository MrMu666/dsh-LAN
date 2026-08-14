<#
  dsh-LAN uninstaller. Removes the install/toggle blocks from the profile
  patch, the firewall rule, and the package copy. The running server
  hot-reloads the patch (no restart).
#>
param(
	[string]$DshHome = "$env:USERPROFILE\.dsh",
	[string]$Profile = "web"
)

$ErrorActionPreference = "Stop"
$dest = Join-Path $DshHome "profiles\node_modules\dsh-LAN"
$legacyDest = Join-Path $DshHome "profiles\node_modules\dsh-lan-access"

$patchFile = Join-Path $DshHome "profiles\$Profile\cordis.patch.yml"
$installBegin = "# --- dsh-LAN install block (managed - do not edit) ---"
$installEnd = "# --- end dsh-LAN install block ---"
$toggleBegin = "# --- dsh-LAN toggle block (managed - do not edit) ---"
$toggleEnd = "# --- end dsh-LAN toggle block ---"

if (Test-Path $patchFile) {
	$content = Get-Content $patchFile -Raw
	$content = [regex]::Replace($content, "`r?`n?$([regex]::Escape($installBegin))[\s\S]*?$([regex]::Escape($installEnd))`r?`n?", "`n")
	$content = [regex]::Replace($content, "`r?`n?$([regex]::Escape($toggleBegin))[\s\S]*?$([regex]::Escape($toggleEnd))`r?`n?", "`n")
	# If only comments/whitespace remain, restore a valid empty array so the
	# profile still parses as a top-level YAML array (an empty or comment-only
	# file would make the loader throw).
	$meaningful = (($content -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" -and -not $_.StartsWith("#") }) -join "`n"
	if ($meaningful -eq "") { $content = "[]" }
	[System.IO.File]::WriteAllText($patchFile, $content.TrimEnd() + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

netsh advfirewall firewall delete rule name="dsh-LAN (auto)" 2>$null | Out-Null
netsh advfirewall firewall delete rule name="DSH LAN Access (auto)" 2>$null | Out-Null

if (Test-Path $dest) {
	Remove-Item $dest -Recurse -Force
}
if (Test-Path $legacyDest) {
	Remove-Item $legacyDest -Recurse -Force
}
Write-Host "dsh-LAN uninstalled. The server hot-reloads the patch; no restart needed."
