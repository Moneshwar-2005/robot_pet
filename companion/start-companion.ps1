<#
.SYNOPSIS
    Kuro Windows Desktop Companion PowerShell Launcher
.DESCRIPTION
    Launches the local companion foundation service on 127.0.0.1:48199.
#>

$host.UI.RawUI.WindowTitle = "Kuro Windows Desktop Companion"

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "KURO WINDOWS DESKTOP COMPANION LAUNCHER" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Node.js runtime detected. Starting companion..." -ForegroundColor Green
    node "$scriptDir\server.mjs"
    exit $LASTEXITCODE
}

if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Python runtime detected. Starting companion..." -ForegroundColor Green
    python "$scriptDir\server.py"
    exit $LASTEXITCODE
}

if (Get-Command py -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Python launcher detected. Starting companion..." -ForegroundColor Green
    py "$scriptDir\server.py"
    exit $LASTEXITCODE
}

Write-Host "[ERROR] Neither Node.js nor Python runtime was found." -ForegroundColor Red
Write-Host "Please install Node.js (https://nodejs.org) or Python (https://python.org)."
Write-Host ""
pause
