# Kuro Windows Desktop Companion (Production v1.3.0)

## Overview
The Kuro Windows Desktop Companion is a secure, lightweight local loopback service (`127.0.0.1:48299` with automatic fallback to `48199`) that establishes a privacy-respecting bridge between your Windows workstation and the Kuro Web Application.

In **Phase 8.8**, this service is enhanced with:
- **Port 48299 primary binding** with graceful `EADDRINUSE` fallback to port `48199`.
- **6-digit numeric Pairing PIN** (`.session_pin`) for simplified, instant browser pairing alongside 32-character hexadecimal tokens (`.session_token`).
- **Sliding-window rate limiting** (protection against PIN brute-forcing with 60-second lockouts).
- **Session expiry** (24-hour TTL) and timing-safe comparison (`crypto.timingSafeEqual`).
- **Expanded IDE workspace detection** covering 13 development environments.
- **Production Windows packaging**: Native installer, Start Menu shortcuts, Windows Add/Remove Programs integration, clean uninstallation, and headless background execution (`launch-headless.vbs`).

---

## Supported IDE Environments
The companion automatically detects coarse process presence and top-level workspace folder names for:
1. **Antigravity IDE** (`Antigravity IDE.exe`)
2. **Visual Studio Code** (`Code.exe`)
3. **Visual Studio** (`devenv.exe`)
4. **Cursor** (`Cursor.exe`)
5. **Windsurf** (`Windsurf.exe`)
6. **Zed Editor** (`zed.exe`)
7. **IntelliJ IDEA** (`idea64.exe`)
8. **PyCharm** (`pycharm64.exe`)
9. **WebStorm** (`webstorm64.exe`)
10. **CLion** (`clion64.exe`)
11. **Rider** (`rider64.exe`)
12. **Android Studio** (`studio64.exe`)
13. **Sublime Text** (`sublime_text.exe`)

---

## Privacy & Security Guarantees

1. **Opt-In Only**: Tracking is disabled by default. The companion will **never** poll or inspect running processes until the user explicitly clicks "Start Tracking" in the Kuro Settings interface.
2. **Zero Sensitive Data Ingestion**:
   - **NO keystrokes** are ever recorded.
   - **NO clipboard contents** are ever read.
   - **NO screenshots or window pixel contents** are captured.
   - **NO source code or file contents** are scanned or opened.
   - **NO command-line arguments** (which could hold secrets or tokens) are queried.
   - **NO browser history or credentials** are accessed.
3. **Safe Workspace Name Extraction**: Project labels are extracted solely from the top-level window title (e.g. `smart-pet-assistant-web - Antigravity IDE`). If an IDE title is ambiguous or missing, `project: null` is reported.
4. **Atomic Local Persistence**:
   - Completed work sessions are safely stored locally in `companion/.sessions_history.json`.
   - File writes are atomic: written first to a `.tmp` file and atomically renamed/replaced (`fs.renameSync`) with restricted user-only permissions (`0o600`).
   - Pairing tokens or credentials are **never** persisted in the session storage file.
   - Corrupted storage files are automatically backed up to `.sessions_history.json.corrupt_<timestamp>` and recovered gracefully without service crashes.
5. **Restart & Crash Recovery**:
   - If the companion or workstation unexpectedly terminates while an IDE session is active, the session is recovered on next startup as `completed` with `reconstructed: true` and a calculated duration based on the shutdown/restart timestamp.
   - Clock anomalies (system time jumping backwards or absurdly forward) are clamped safely to `[1, 604800]` seconds.
6. **Bounded History & Manual Eviction**: Session history is capped at **50 items** with automatic deduplication. Older sessions are evicted automatically. A manual "Clear History" control is provided in the UI.
7. **Strict Loopback Binding**: Binds exclusively to `127.0.0.1:48299` (or `48199`). Never accessible over the local area network (LAN) or public internet.
8. **Origin Validation**: Rejects requests from untrusted origins with `403 Forbidden` to prevent cross-site request forgery (CSRF) or browser-based hijacking.
9. **Dual Pairing Security**: Supports both a 6-digit numeric PIN and a 32-character hexadecimal token. Rate-limited to prevent brute-forcing.
10. **Zero Cloud Telemetry**: Raw process metadata is never transmitted to Supabase or any external cloud service.

---

## Windows Desktop Installation & Packaging

### Method 1: Double-Click Installer
Run `companion/installer/Setup-KuroCompanion.bat`. This automatically:
- Installs to `%LOCALAPPDATA%\Programs\KuroDesktopCompanion`.
- Creates Start Menu shortcuts (`Start Kuro Companion`, `Stop Kuro Companion`, `Uninstall`).
- Registers in Windows Add/Remove Programs (Control Panel & Windows Settings).
- Starts the background service on `127.0.0.1:48299`.

### Method 2: PowerShell Installer
```powershell
powershell.exe -ExecutionPolicy Bypass -File companion/installer/install.ps1 [-Startup]
```
Add `-Startup` to automatically start Kuro Companion upon Windows login.

### Method 3: Uninstallation
Run `uninstall.bat` or `powershell.exe -ExecutionPolicy Bypass -File uninstall.ps1`:
- Shuts down the background service cleanly.
- Unregisters from Windows startup.
- Unregisters from Windows Add/Remove Programs.
- Purges all sensitive credentials (`.session_token`, `.session_pin`, `.sessions_history.json`).

---

## Service Management CLI

Manage the companion from PowerShell or Command Prompt:

```powershell
# Check running status, PID, port, and pairing PIN
.\companion\kuro-companion.bat status

# Start service in the background (no console window)
.\companion\kuro-companion.bat start

# Stop service cleanly
.\companion\kuro-companion.bat stop

# Restart service
.\companion\kuro-companion.bat restart
```

---

## Endpoints

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/health` | No | Minimal health check reporting version, port, and capabilities |
| `GET` | `/api/status` | Yes | Detailed status reporting uptime, memory, storage stats, and tracking status |
| `POST` | `/api/pair` | PIN or Token | Validates 6-digit PIN or 32-char token; returns session token |
| `POST` | `/api/shutdown` | Yes | Gracefully terminates companion, finalizes active sessions, and deletes session token |
| `POST` | `/api/tracking/start` | Yes | Starts 5-second polling loop and activates IDE activity detection |
| `POST` | `/api/tracking/stop` | Yes | Immediately stops polling loop and finalizes active work session with atomic write |
| `GET` | `/api/tracking/status` | Yes | Returns live tracking state, active IDE session, and supported IDEs |
| `GET` | `/api/tracking/sessions`| Yes | Returns bounded list of recent activity sessions and active session |
| `POST` | `/api/tracking/clear` | Yes | Clears locally stored activity sessions history from memory and disk |

---

## Automated Test Suites

```powershell
# Companion Unit & Integration Suite
node companion/test_companion.mjs

# Complete Production Reliability & Security Suite
node test/companion_production_reliability.test.mjs
```
