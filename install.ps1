# OmniWeave standalone installer for Windows (PowerShell).
#
# Downloads a self-contained bundle (a vendored Node runtime + the app) from
# GitHub Releases. No Node.js, no build tools required.
#
#   irm https://raw.githubusercontent.com/SolvingLab/OmniWeave/main/install.ps1 | iex
#
# Upgrade with `omniweave upgrade` (or just re-run this). To uninstall: remove
# $env:LOCALAPPDATA\omniweave and drop its \current\bin entry from your user PATH.
#
# Environment:
#   OMNIWEAVE_VERSION      release tag to install (default: latest)
#   OMNIWEAVE_INSTALL_DIR  install location (default: %LOCALAPPDATA%\omniweave)

$ErrorActionPreference = 'Stop'
$repo = 'SolvingLab/OmniWeave'
$installDir = if ($env:OMNIWEAVE_INSTALL_DIR) { $env:OMNIWEAVE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'omniweave' }

# 1. Detect architecture -> target matching the release archives.
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' }
$target = "win32-$arch"

# 2. Resolve the version (latest release unless pinned).
$version = $env:OMNIWEAVE_VERSION
if (-not $version) {
  $version = (Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest").tag_name
}
if (-not $version) { throw "omniweave: could not resolve latest version; set OMNIWEAVE_VERSION." }

# 3. Download + extract the bundle into a stable 'current' dir (overwritten on upgrade).
$url = "https://github.com/$repo/releases/download/$version/omniweave-$target.zip"
Write-Host "Installing OmniWeave $version ($target)..."
$tmp = Join-Path $env:TEMP ("cg-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zip = Join-Path $tmp 'cg.zip'
Invoke-WebRequest -Uri $url -OutFile $zip

$dest = Join-Path $installDir 'current'
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
# Archives contain a top-level omniweave-<target>\ dir; flatten it.
$inner = Join-Path $dest "omniweave-$target"
if (Test-Path $inner) {
  Get-ChildItem -Force $inner | Move-Item -Destination $dest -Force
  Remove-Item -Recurse -Force $inner
}
Remove-Item -Recurse -Force $tmp

# 4. Put the launcher dir on the user's PATH.
$binDir = Join-Path $dest 'bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $binDir) {
  [Environment]::SetEnvironmentVariable('Path', "$binDir;$userPath", 'User')
  Write-Host "Added $binDir to your PATH (restart your terminal to pick it up)."
}

Write-Host "Installed to $dest"
Write-Host "Run: omniweave --help"
