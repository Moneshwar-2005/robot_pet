<#
.SYNOPSIS
    Kuro Windows Desktop Companion Production Installer
.DESCRIPTION
    Installs the Kuro Desktop Companion into the user application directory (%LOCALAPPDATA%\Programs\KuroDesktopCompanion),
    registers in Windows Add/Remove Programs, sets up Start Menu shortcuts, configures optional auto-start,
    and initiates the background loopback service.
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'Programs\KuroDesktopCompanion'),

    [Parameter()]
    [switch]$Silent,

    [Parameter()]
    [switch]$Startup
)

$ErrorActionPreference = 'Stop'
$companionVersion = '1.3.0'
$sourceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path (Join-Path $sourceDir 'server.mjs'))) {
    $sourceDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'
}
$sourceDir = [System.IO.Path]::GetFullPath($sourceDir)

Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host "KURO WINDOWS DESKTOP COMPANION -- INSTALLER (v$companionVersion)" -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host "Target Directory: $InstallPath" -ForegroundColor Gray
Write-Host "Source Directory: $sourceDir" -ForegroundColor Gray
Write-Host ''

# 1. Prerequisite Checks
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '[ERROR] Node.js is required for Kuro Desktop Companion but was not found on PATH.' -ForegroundColor Red
    Write-Host 'Please install Node.js (https://nodejs.org) and run the installer again.'
    if (-not $Silent) { Read-Host 'Press Enter to exit...' }
    exit 1
}

# 2. Stop any existing running instance
Write-Host '[1/5] Stopping any running companion instance...' -ForegroundColor Cyan
try {
    foreach ($p in @(48299, 48199)) {
        try {
            $tokenFile = Join-Path $InstallPath '.session_token'
            if (Test-Path $tokenFile) {
                $tok = (Get-Content $tokenFile -Raw).Trim()
                Invoke-RestMethod -Uri "http://127.0.0.1:$p/api/shutdown" -Method Post -Headers @{ Authorization = "Bearer $tok" } -TimeoutSec 1 -ErrorAction SilentlyContinue | Out-Null
            }
        } catch { }
    }
} catch { }

# 3. Create destination directory and copy files
Write-Host '[2/5] Installing companion runtime files...' -ForegroundColor Cyan
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

$filesToCopy = @(
    'server.mjs',
    'server.py',
    'package.json',
    'README.md',
    'launch-headless.vbs',
    'kuro-companion.ps1',
    'kuro-companion.bat',
    'start-companion.bat',
    'start-companion.ps1'
)

foreach ($file in $filesToCopy) {
    $src = Join-Path $sourceDir $file
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $InstallPath $file) -Force
    }
}

# Copy uninstall scripts into installation directory
$uninstallSrc = Join-Path $PSScriptRoot 'uninstall.ps1'
if (Test-Path $uninstallSrc) {
    Copy-Item -Path $uninstallSrc -Destination (Join-Path $InstallPath 'uninstall.ps1') -Force
}

$uninstallBatSrc = Join-Path $PSScriptRoot 'uninstall.bat'
if (Test-Path $uninstallBatSrc) {
    Copy-Item -Path $uninstallBatSrc -Destination (Join-Path $InstallPath 'uninstall.bat') -Force
}

# 4. Create Windows Start Menu shortcuts
Write-Host '[3/5] Creating Windows Start Menu shortcuts...' -ForegroundColor Cyan
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Kuro Desktop Companion'
if (-not (Test-Path $startMenuDir)) {
    New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
}

$wshShell = New-Object -ComObject WScript.Shell

# Shortcut 1: Start Companion
$shortcutStart = $wshShell.CreateShortcut((Join-Path $startMenuDir 'Start Kuro Companion.lnk'))
$shortcutStart.TargetPath = (Join-Path $InstallPath 'kuro-companion.bat')
$shortcutStart.Arguments = 'start'
$shortcutStart.WorkingDirectory = $InstallPath
$shortcutStart.Description = 'Start Kuro Desktop Companion loopback service'
$shortcutStart.Save()

# Shortcut 2: Stop Companion
$shortcutStop = $wshShell.CreateShortcut((Join-Path $startMenuDir 'Stop Kuro Companion.lnk'))
$shortcutStop.TargetPath = (Join-Path $InstallPath 'kuro-companion.bat')
$shortcutStop.Arguments = 'stop'
$shortcutStop.WorkingDirectory = $InstallPath
$shortcutStop.Description = 'Stop Kuro Desktop Companion service'
$shortcutStop.Save()

# Shortcut 3: Uninstall
$shortcutUninstall = $wshShell.CreateShortcut((Join-Path $startMenuDir 'Uninstall Kuro Desktop Companion.lnk'))
$shortcutUninstall.TargetPath = (Join-Path $InstallPath 'uninstall.bat')
$shortcutUninstall.WorkingDirectory = $InstallPath
$shortcutUninstall.Description = 'Uninstall Kuro Desktop Companion'
$shortcutUninstall.Save()

# 5. Register in Windows Add/Remove Programs (Installed apps)
Write-Host '[4/5] Registering in Windows Add/Remove Programs...' -ForegroundColor Cyan
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\KuroDesktopCompanion'
if (-not (Test-Path $uninstallKey)) {
    New-Item -Path $uninstallKey -Force | Out-Null
}

Set-ItemProperty -Path $uninstallKey -Name 'DisplayName' -Value 'Kuro Desktop Companion'
Set-ItemProperty -Path $uninstallKey -Name 'DisplayVersion' -Value $companionVersion
Set-ItemProperty -Path $uninstallKey -Name 'Publisher' -Value 'Kuro Systems'
Set-ItemProperty -Path $uninstallKey -Name 'InstallLocation' -Value $InstallPath
$uninstallCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $InstallPath + '\uninstall.ps1"'
$quietUninstallCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $InstallPath + '\uninstall.ps1" -Silent'
Set-ItemProperty -Path $uninstallKey -Name 'UninstallString' -Value $uninstallCmd
Set-ItemProperty -Path $uninstallKey -Name 'QuietUninstallString' -Value $quietUninstallCmd
Set-ItemProperty -Path $uninstallKey -Name 'NoModify' -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name 'NoRepair' -Value 1 -Type DWord

# Optional Startup on Login
if ($Startup) {
    Write-Host 'Configuring automatic launch on Windows login...' -ForegroundColor Cyan
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $vbsPath = Join-Path $InstallPath 'launch-headless.vbs'
    $runCmd = 'wscript.exe "' + $vbsPath + '"'
    Set-ItemProperty -Path $runKey -Name 'KuroCompanion' -Value $runCmd
}

# 6. Start the companion background service and verify health
Write-Host '[5/5] Starting background service on 127.0.0.1:48299...' -ForegroundColor Cyan
& (Join-Path $InstallPath 'kuro-companion.bat') start

Start-Sleep -Seconds 1
$healthOk = $false
$runningPort = $null
foreach ($port in @(48299, 48199)) {
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($res.status -eq 'ok') {
            $healthOk = $true
            $runningPort = $port
            break
        }
    } catch { }
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'INSTALLATION COMPLETED SUCCESSFULLY!' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
Write-Host "Location:      $InstallPath"
$healthStatus = if ($healthOk) { "ONLINE (Port $runningPort)" } else { "PENDING" }
Write-Host "Health Check:  $healthStatus"

$pinFile = Join-Path $InstallPath '.session_pin'
if (Test-Path $pinFile) {
    $pin = (Get-Content $pinFile -Raw).Trim()
    Write-Host "Pairing PIN:   $pin" -ForegroundColor Yellow
    Write-Host "Next Step:     Enter PIN '$pin' in Kuro Settings -> Desktop Companion" -ForegroundColor Cyan
}

Write-Host '=============================================================='
