# ============================================================================
# Claude Forge — build & run (pwsh 7, locked-down Windows env)
# Run from pwsh 7:
#   C:\Users\CKIRUser\Downloads\PowerShell-7.6.2-win-x64\pwsh.exe -NoProfile -File .\build-and-run.ps1
# Flags:
#   -NoRun     build only, don't launch the app
#   -Dev       run electron-vite dev (HMR) instead of prod build+launch
# ============================================================================
param(
  [switch]$NoRun,
  [switch]$Dev
)
$ErrorActionPreference = 'Stop'

$Repo        = $PSScriptRoot
$NodeDir     = 'C:\Users\CKIRUser\tools\node'
$ElectronVer = '42.4.0'
$ElectronUrl = "https://github.com/electron/electron/releases/download/v$ElectronVer/electron-v$ElectronVer-win32-x64.zip"
$Tmp         = $env:TEMP
if (-not $Tmp) { $Tmp = 'C:\Users\CKIRUser\AppData\Local\Temp' }

function Log($m) { Write-Host "[forge] $m" -ForegroundColor Yellow }

# --- PATH: put manual Node first -------------------------------------------
$env:PATH = "$NodeDir;$env:PATH"
Set-Location $Repo
Log "node $(node --version)  |  repo $Repo"

# --- 1. electron binary (npm postinstall was skipped via --ignore-scripts) --
$ElectronExe = Join-Path $Repo 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $ElectronExe)) {
  Log "electron binary missing — downloading v$ElectronVer ..."
  $zip = Join-Path $Tmp 'electron.zip'
  Invoke-WebRequest -Uri $ElectronUrl -OutFile $zip
  $dist = Join-Path $Repo 'node_modules\electron\dist'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  Expand-Archive -Path $zip -DestinationPath $dist -Force
  # path.txt must have NO trailing newline (-> electron.exe\n -> ENOENT)
  [System.IO.File]::WriteAllText((Join-Path $Repo 'node_modules\electron\path.txt'), 'electron.exe')
  Log "electron extracted."
} else {
  Log "electron binary OK."
}

# --- 2. idempotent source patches ------------------------------------------
if (Test-Path 'bootstrap\patch-vite.mjs')        { node bootstrap\patch-vite.mjs }
if (Test-Path 'bootstrap\patch-app-builder.mjs') { node bootstrap\patch-app-builder.mjs }

# --- 3. dev mode shortcut ---------------------------------------------------
if ($Dev) {
  Log "starting electron-vite dev (HMR) ..."
  node node_modules\electron-vite\bin\electron-vite.js dev
  return
}

# --- 4. production build ----------------------------------------------------
Log "electron-vite build ..."
node node_modules\electron-vite\bin\electron-vite.js build
if ($LASTEXITCODE -ne 0) { throw "electron-vite build failed (exit $LASTEXITCODE)" }
Log "build done -> out\"

# --- 5. launch the built app ------------------------------------------------
if ($NoRun) { Log "build complete (-NoRun set, not launching)."; return }
Log "launching Claude Forge ..."
& $ElectronExe $Repo
