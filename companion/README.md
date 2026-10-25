# Kuro Windows Desktop Companion (Foundation, IDE Activity Service & Persistent Sessions)

## Overview
The Kuro Windows Desktop Companion is a secure, lightweight local loopback service (`127.0.0.1:48199`) that establishes a privacy-respecting bridge between your Windows workstation and the Kuro Web Application.

In **Phase 4, Step 4.3**, this service introduces **local atomic session persistence, crash recovery, and clock anomaly protection** to provide reliable work-session history for end-of-day AI daily summaries.

---

## Supported IDE Environments
The companion automatically detects coarse process presence and top-level workspace folder names for:
1. **Antigravity IDE** (`Antigravity IDE.exe`)
2. **Visual Studio Code** (`Code.exe`)
3. **Visual Studio** (`devenv.exe`)
4. **Cursor** (`Cursor.exe`)
5. **IntelliJ IDEA** (`idea64.exe`)
6. **PyCharm** (`pycharm64.exe`)
7. **WebStorm** (`webstorm64.exe`)
8. **Sublime Text** (`sublime_text.exe`)

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
   - File writes are atomic: written first to a `.tmp` file and atomically renamed/replaced (`fs.renameSync` / `os.replace`) with restricted user-only permissions (`0o600`).
   - Pairing tokens or credentials are **never** persisted in the session storage file.
   - Corrupted storage files are automatically backed up to `.sessions_history.json.corrupt_<timestamp>` and recovered gracefully without service crashes.
5. **Restart & Crash Recovery**:
   - If the companion or workstation unexpectedly terminates while an IDE session is active, the session is recovered on next startup as `completed` with `reconstructed: true` and a calculated duration based on the shutdown/restart timestamp.
   - Clock anomalies (system time jumping backwards or absurdly forward) are clamped safely to `[1, 604800]` seconds.
6. **Bounded History & Manual Eviction**: Session history is capped at **50 items** with automatic deduplication. Older sessions are evicted automatically. A manual "Clear History" control is provided in the UI.
7. **Strict Loopback Binding**: Binds exclusively to `127.0.0.1:48199`. Never accessible over the local area network (LAN) or public internet.
8. **Origin Validation**: Rejects requests from untrusted origins with `403 Forbidden` to prevent cross-site request forgery (CSRF) or browser-based hijacking.
9. **Per-Session Pairing Token**: Generates a cryptographically random 32-character hexadecimal token on startup. Protected state-changing endpoints require authorization.
10. **Zero Cloud Telemetry**: Raw process metadata is never transmitted to Supabase or any external cloud service.

---

## Startup Instructions

### Option 1: Native Node.js (Zero Dependencies)
```powershell
node companion/server.mjs
```

### Option 2: Python 3 (Standard Library Only)
```powershell
python companion/server.py
```

### Option 3: Double-Click Launcher
Double-click `companion/start-companion.bat` or run `companion/start-companion.ps1`.

---

## Endpoints

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/health` | No | Minimal health check reporting version and capabilities (`ideTracking: true`, `persistentSessions: true`) |
| `GET` | `/api/status` | Yes | Detailed status reporting uptime, memory, persistent storage stats, and tracking status |
| `POST` | `/api/pair` | Token in body | Validates pairing token provided by the web client |
| `POST` | `/api/shutdown` | Yes | Gracefully terminates companion, finalizes active sessions, and deletes session token |
| `POST` | `/api/tracking/start` | Yes | Starts 5-second polling loop and activates IDE activity detection |
| `POST` | `/api/tracking/stop` | Yes | Immediately stops polling loop and finalizes active work session with atomic write |
| `GET` | `/api/tracking/status` | Yes | Returns live tracking state, active IDE session, and supported IDEs |
| `GET` | `/api/tracking/sessions`| Yes | Returns bounded list of recent activity sessions and active session |
| `POST` | `/api/tracking/clear` | Yes | Clears locally stored activity sessions history from memory and disk |

---

## Testing
Run the companion automated test suite (21 test groups, 53 assertions):
```powershell
node companion/test_companion.mjs
```

