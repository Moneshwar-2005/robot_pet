<#
.SYNOPSIS
    Kuro Desktop Companion Service Manager
.DESCRIPTION
    Controls the background Kuro Desktop Companion service on Windows (start, stop, status, restart, startup).
.EXAMPLE
    .\kuro-companion.ps1 start
    .\kuro-companion.ps1 status
    .\kuro-companion.ps1 stop
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'enable-startup', 'disable-startup', 'help')]
    [string]$Command = 'status',

    [Parameter()]
    [switch]$Startup
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$primaryPort = 48299
$fallbackPort = 48199
$appVersion = "1.3.0"
$runRegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runValueName = "KuroCompanion"

function Get-RunningPort {
    foreach ($port in @($primaryPort, $fallbackPort)) {
        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -Method Get -TimeoutSec 1 -ErrorAction Stop
            if ($resp.status -eq 'ok') {
                return $port
            }
        } catch { }
    }
    return $null
}

function Show-Help {
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host "KURO DESKTOP COMPANION SERVICE MANAGER (v$appVersion)" -ForegroundColor Cyan
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host "Usage: .\kuro-companion.ps1 <command> [options]"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  start [-Startup]    Start background companion service without console window"
    Write-Host "  stop                Stop the running companion service cleanly"
    Write-Host "  restart             Restart the companion service"
    Write-Host "  status              Inspect health, port, PID, and pairing PIN"
    Write-Host "  enable-startup      Configure companion to run automatically on Windows login"
    Write-Host "  disable-startup     Remove companion from Windows startup"
    Write-Host "  help                Display this help screen"
    Write-Host "=============================================================="
}

function Start-CompanionService {
    Write-Host "[Kuro] Checking companion service status..." -ForegroundColor Cyan

    $activePort = Get-RunningPort
    if ($activePort) {
        Write-Host "[INFO] Kuro Desktop Companion is already running on http://127.0.0.1:$activePort" -ForegroundColor Yellow
        $pinFile = Join-Path $scriptDir ".session_pin"
        if (Test-Path $pinFile) {
            $pin = (Get-Content $pinFile -Raw).Trim()
            Write-Host "  Pairing PIN: $pin" -ForegroundColor Green
        }
        if ($Startup) { Set-StartupRegistration $true }
        return
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] Node.js is required but was not found on PATH." -ForegroundColor Red
        Write-Host "Please install Node.js from https://nodejs.org"
        return
    }

    $vbsLauncher = Join-Path $scriptDir "launch-headless.vbs"
    if (Test-Path $vbsLauncher) {
        Start-Process "wscript.exe" -ArgumentList "`"$vbsLauncher`"" -WorkingDirectory $scriptDir
    } else {
        $serverMjs = Join-Path $scriptDir "server.mjs"
        Start-Process "node.exe" -ArgumentList "`"$serverMjs`"" -WorkingDirectory $scriptDir -WindowStyle Hidden
    }

    Write-Host "[Kuro] Initializing background service" -NoNewline
    $startedPort = $null
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 400
        Write-Host "." -NoNewline
        $startedPort = Get-RunningPort
        if ($startedPort) { break }
    }
    Write-Host ""

    if ($startedPort) {
        Write-Host "[SUCCESS] Kuro Desktop Companion is RUNNING in background!" -ForegroundColor Green
        Write-Host "  Loopback Address: http://127.0.0.1:$startedPort" -ForegroundColor Gray

        $pidFile = Join-Path $scriptDir "kuro-companion.pid"
        if (Test-Path $pidFile) {
            $procId = (Get-Content $pidFile -Raw).Trim()
            Write-Host "  Process ID:       $procId" -ForegroundColor Gray
        }

        $pinFile = Join-Path $scriptDir ".session_pin"
        if (Test-Path $pinFile) {
            $pin = (Get-Content $pinFile -Raw).Trim()
            Write-Host "  Pairing PIN:      $pin (Enter in Kuro Settings -> Desktop Companion)" -ForegroundColor Green
        }

        if ($Startup) {
            Set-StartupRegistration $true
        }
    } else {
        Write-Host "[WARN] Companion process started, but health check has not responded yet." -ForegroundColor Yellow
        Write-Host "Run '.\kuro-companion.ps1 status' to verify."
    }
}

function Stop-CompanionService {
    Write-Host "[Kuro] Stopping Kuro Desktop Companion service..." -ForegroundColor Cyan

    $activePort = Get-RunningPort
    $tokenFile = Join-Path $scriptDir ".session_token"

    if ($activePort -and (Test-Path $tokenFile)) {
        try {
            $token = (Get-Content $tokenFile -Raw).Trim()
            $headers = @{ Authorization = "Bearer $token" }
            Invoke-RestMethod -Uri "http://127.0.0.1:$activePort/api/shutdown" -Method Post -Headers $headers -TimeoutSec 2 -ErrorAction SilentlyContinue | Out-Null
        } catch { }
    }

    $pidFile = Join-Path $scriptDir "kuro-companion.pid"
    if (Test-Path $pidFile) {
        try {
            $procId = [int](Get-Content $pidFile -Raw).Trim()
            $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($p) {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        } catch { }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path $tokenFile) { Remove-Item $tokenFile -Force -ErrorAction SilentlyContinue }
    $pinFile = Join-Path $scriptDir ".session_pin"
    if (Test-Path $pinFile) { Remove-Item $pinFile -Force -ErrorAction SilentlyContinue }

    Start-Sleep -Milliseconds 400
    Write-Host "[SUCCESS] Kuro Desktop Companion stopped." -ForegroundColor Green
}

function Show-Status {
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host "KURO DESKTOP COMPANION STATUS" -ForegroundColor Cyan
    Write-Host "==============================================================" -ForegroundColor Cyan

    $activePort = Get-RunningPort
    if ($activePort) {
        Write-Host "Status:        ACTIVE (RUNNING)" -ForegroundColor Green
        Write-Host "Port:          $activePort"
        Write-Host "Address:       http://127.0.0.1:$activePort"
        Write-Host "Binding:       Strict Loopback Only (127.0.0.1)"

        $pidFile = Join-Path $scriptDir "kuro-companion.pid"
        if (Test-Path $pidFile) {
            $procId = (Get-Content $pidFile -Raw).Trim()
            Write-Host "Process ID:    $procId"
        }

        $pinFile = Join-Path $scriptDir ".session_pin"
        if (Test-Path $pinFile) {
            $pin = (Get-Content $pinFile -Raw).Trim()
            Write-Host "Pairing PIN:   $pin" -ForegroundColor Green
        }

        $autoStart = (Get-ItemProperty -Path $runRegPath -Name $runValueName -ErrorAction SilentlyContinue)
        $autoText = if ($autoStart) { "Enabled (Starts on login)" } else { "Disabled" }
        Write-Host "Auto-Start:    $autoText"
    } else {
        Write-Host "Status:        STOPPED (NOT RUNNING)" -ForegroundColor DarkYellow
        Write-Host "Start with:    .\kuro-companion.ps1 start"
    }
    Write-Host "=============================================================="
}

function Set-StartupRegistration([bool]$enable) {
    try {
        if ($enable) {
            $vbsPath = Join-Path $scriptDir "launch-headless.vbs"
            $cmd = "wscript.exe `"$vbsPath`""
            Set-ItemProperty -Path $runRegPath -Name $runValueName -Value $cmd -ErrorAction Stop
            Write-Host "[OK] Auto-start on Windows login ENABLED." -ForegroundColor Green
        } else {
            Remove-ItemProperty -Path $runRegPath -Name $runValueName -ErrorAction SilentlyContinue
            Write-Host "[OK] Auto-start on Windows login DISABLED." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[WARN] Could not update startup registry: $_" -ForegroundColor Yellow
    }
}

switch ($Command) {
    'start'          { Start-CompanionService }
    'stop'           { Stop-CompanionService }
    'restart'        { Stop-CompanionService; Start-Sleep -Milliseconds 600; Start-CompanionService }
    'status'         { Show-Status }
    'enable-startup' { Set-StartupRegistration $true }
    'disable-startup'{ Set-StartupRegistration $false }
    'help'           { Show-Help }
}

