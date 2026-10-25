@echo off
setlocal
title Kuro Windows Desktop Companion

echo ==============================================================
echo KURO WINDOWS DESKTOP COMPANION LAUNCHER
echo ==============================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Node.js runtime detected. Launching companion service...
    node "%~dp0server.mjs"
    goto :end
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Python runtime detected. Launching companion service...
    python "%~dp0server.py"
    goto :end
)

where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Python launcher detected. Launching companion service...
    py "%~dp0server.py"
    goto :end
)

echo [ERROR] Neither Node.js nor Python runtime was found on your system.
echo Please install Node.js (https://nodejs.org) or Python 3 (https://python.org).
echo.
pause

:end
endlocal
