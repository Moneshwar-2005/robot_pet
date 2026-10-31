<#
.SYNOPSIS
    Kuro Windows Desktop Companion Uninstaller
.DESCRIPTION
    Stops the background companion service, purges all sensitive tokens and local session logs,
    removes Windows startup run keys, deletes Start Menu shortcuts, and unregisters from Windows Add/Remove Programs.
#>

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$Silent
)

$ErrorActionPreference = 'SilentlyContinue'
$installPath = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '==============================================================' -ForegroundColor Yellow
Write-Host 'KURO WINDOWS DESKTOP COMPANION -- UNINSTALLER' -ForegroundColor Yellow
Write-Host '==============================================================' -ForegroundColor Yellow
Write-Host "Removing from: $installPath" -ForegroundColor Gray
Write-Host ''

# 1. Stop background service
Write-Host '[1/5] Stopping companion background service...' -ForegroundColor Cyan
$bat = Join-Path $installPath 'kuro-companion.bat'
if (Test-Path $bat) {
    & $bat stop | Out-Null
} else {
    foreach ($p in @(48299, 48199)) {
        try {
            $tokenFile = Join-Path $installPath '.session_token'
            if (Test-Path $tokenFile) {
                $tok = (Get-Content $tokenFile -Raw).Trim()
                Invoke-RestMethod -Uri "http://127.0.0.1:$p/api/shutdown" -Method Post -Headers @{ Authorization = "Bearer $tok" } -TimeoutSec 1 | Out-Null
            }
        } catch { }
    }
}

# Ensure process is dead
$pidFile = Join-Path $installPath 'kuro-companion.pid'
if (Test-Path $pidFile) {
    try {
        $procId = [int](Get-Content $pidFile -Raw).Trim()
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    } catch { }
}

# 2. Purge sensitive credentials & temporary files
Write-Host '[2/5] Purging sensitive credentials and pairing tokens...' -ForegroundColor Cyan
$sensitiveFiles = @(
    '.session_token',
    '.session_pin',
    '.sessions_history.json',
    'kuro-companion.pid'
)
foreach ($f in $sensitiveFiles) {
    $fullPath = Join-Path $installPath $f
    if (Test-Path $fullPath) {
        Remove-Item $fullPath -Force -ErrorAction SilentlyContinue
    }
}

# 3. Remove Windows startup registration
Write-Host '[3/5] Removing Windows startup auto-launch...' -ForegroundColor Cyan
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $runKey -Name 'KuroCompanion' -ErrorAction SilentlyContinue

# 4. Remove Start Menu folder and shortcuts
Write-Host '[4/5] Removing Start Menu shortcuts...' -ForegroundColor Cyan
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Kuro Desktop Companion'
if (Test-Path $startMenuDir) {
    Remove-Item -Path $startMenuDir -Recurse -Force -ErrorAction SilentlyContinue
}

# 5. Remove Windows Add/Remove Programs registry entry
Write-Host '[5/5] Unregistering from Windows Add/Remove Programs...' -ForegroundColor Cyan
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\KuroDesktopCompanion'
if (Test-Path $uninstallKey) {
    Remove-Item -Path $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
}

# Delete install directory
Start-Sleep -Milliseconds 500
$allFiles = Get-ChildItem -Path $installPath -Recurse -File -ErrorAction SilentlyContinue
foreach ($file in $allFiles) {
    if ($file.Name -ne 'uninstall.ps1' -and $file.Name -ne 'uninstall.bat') {
        Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'UNINSTALLATION COMPLETE!' -ForegroundColor Green
Write-Host 'All files, shortcuts, startup entries, and credentials purged.' -ForegroundColor Green
Write-Host '=============================================================='
