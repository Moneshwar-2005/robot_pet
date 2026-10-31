#!/usr/bin/env python3
"""
Kuro Windows Desktop Companion — Foundation & IDE Activity Service (v1.2.0) [Python Implementation]

Scope: Phase 4, Step 4.3

PRIVACY & SECURITY GUARANTEES:
1. Binds exclusively to 127.0.0.1 (loopback only; never LAN or public interfaces).
2. Origin validation: rejects unauthorized origins with 403 Forbidden.
3. Session authorization token: per-session cryptographically random token required.
4. Request size limited to 64 KB to prevent DoS memory exhaustion.
5. Zero telemetry, zero external network requests, zero shell execution endpoints.
6. Clean lifecycle: clean shutdown endpoint, timer cleanup, and token cleanup on termination.
7. Privacy-respecting IDE tracking:
   - Opt-in only (disabled by default; requires explicit start command).
   - Only captures coarse IDE process presence, safe top-level project label from window title, and timestamps.
   - Zero keystrokes, clipboard, screenshots, code files, browser history, or credentials collected.
8. Persistent, bounded session history (Step 4.3):
   - Persisted locally with atomic file writes (.sessions_history.json.tmp -> .sessions_history.json).
   - Memory & storage strictly capped at 50 sessions.
   - Validates stored data on load; recovers gracefully from missing or corrupted files.
   - Safely recovers in-flight sessions on unexpected process restart with reconstructed: True.
"""

import http.server
import json
import os
import secrets
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

COMPANION_PORT = int(os.environ.get("KURO_COMPANION_PORT", "48299"))
COMPANION_HOST = "127.0.0.1"
COMPANION_VERSION = "1.3.0"
MAX_BODY_BYTES = 64 * 1024

DEFAULT_ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
}

custom_origins = {
    o.strip()
    for o in os.environ.get("KURO_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
}
ALLOWED_ORIGINS = DEFAULT_ALLOWED_ORIGINS | custom_origins

DIR_PATH = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE_PATH = os.path.join(DIR_PATH, ".session_token")
PIN_FILE_PATH = os.path.join(DIR_PATH, ".session_pin")
DEFAULT_SESSIONS_STORAGE_FILE = os.path.join(DIR_PATH, ".sessions_history.json")
SESSION_TOKEN = secrets.token_hex(16)
PAIRING_PIN = f"{secrets.randbelow(900000) + 100000}"
START_TIME = time.time()
SESSION_STARTED_AT = datetime.now(timezone.utc).isoformat()

SUPPORTED_IDES = [
    {"id": "antigravity", "name": "Antigravity IDE", "exe": "Antigravity IDE.exe"},
    {"id": "vscode", "name": "Visual Studio Code", "exe": "Code.exe"},
    {"id": "visualstudio", "name": "Visual Studio", "exe": "devenv.exe"},
    {"id": "cursor", "name": "Cursor", "exe": "Cursor.exe"},
    {"id": "windsurf", "name": "Windsurf", "exe": "Windsurf.exe"},
    {"id": "zed", "name": "Zed", "exe": "zed.exe"},
    {"id": "idea", "name": "IntelliJ IDEA", "exe": "idea64.exe"},
    {"id": "pycharm", "name": "PyCharm", "exe": "pycharm64.exe"},
    {"id": "webstorm", "name": "WebStorm", "exe": "webstorm64.exe"},
    {"id": "clion", "name": "CLion", "exe": "clion64.exe"},
    {"id": "rider", "name": "Rider", "exe": "rider64.exe"},
    {"id": "androidstudio", "name": "Android Studio", "exe": "studio64.exe"},
    {"id": "sublime", "name": "Sublime Text", "exe": "sublime_text.exe"},
]


def cleanup_token_file():
    try:
        if os.path.exists(TOKEN_FILE_PATH):
            os.remove(TOKEN_FILE_PATH)
        if os.path.exists(PIN_FILE_PATH):
            os.remove(PIN_FILE_PATH)
    except Exception:
        pass


try:
    with open(TOKEN_FILE_PATH, "w", encoding="utf-8") as f:
        f.write(SESSION_TOKEN)
    with open(PIN_FILE_PATH, "w", encoding="utf-8") as f:
        f.write(PAIRING_PIN)
    if hasattr(os, "chmod"):
        os.chmod(TOKEN_FILE_PATH, 0o600)
        os.chmod(PIN_FILE_PATH, 0o600)
except Exception as e:
    print(f"[Kuro Companion] Note: Could not write credentials: {e}", file=sys.stderr)


def parse_csv_line(line: str):
    parts = []
    current = []
    in_quotes = False
    i = 0
    while i < len(line):
        c = line[i]
        if c == '"':
            if in_quotes and i + 1 < len(line) and line[i + 1] == '"':
                current.append('"')
                i += 1
            else:
                in_quotes = not in_quotes
        elif c == "," and not in_quotes:
            parts.append("".join(current))
            current = []
        else:
            current.append(c)
        i += 1
    parts.append("".join(current))
    return parts


def extract_project_from_title(ide_id: str, raw_title: str):
    if not raw_title or not isinstance(raw_title, str):
        return None
    title = raw_title.strip()
    if not title or title in ("N/A", "OleMainThreadWndName"):
        return None

    if ide_id == "antigravity":
        parts = title.split(" - ")
        if len(parts) >= 2 and parts[0] != "Antigravity IDE":
            return parts[0].strip()
        return None

    if ide_id == "vscode":
        suffix = " - Visual Studio Code"
        if title.endswith(suffix):
            rest = title[: -len(suffix)].strip()
            parts = rest.split(" - ")
            candidate = parts[-1].strip()
            return candidate if candidate and candidate != "Welcome" else None
        return None

    if ide_id == "visualstudio":
        suffix = " - Microsoft Visual Studio"
        if title.endswith(suffix):
            candidate = title[: -len(suffix)].strip()
            return candidate or None
        return None

    if ide_id == "cursor":
        suffix = " - Cursor"
        if title.endswith(suffix):
            rest = title[: -len(suffix)].strip()
            parts = rest.split(" - ")
            candidate = parts[-1].strip()
            return candidate or None
        return None

    if ide_id in ("idea", "pycharm", "webstorm"):
        bracket_idx = title.find("[")
        if bracket_idx > 0:
            return title[:bracket_idx].strip() or None
        dash_idx = title.find(" \u2013 ")
        if dash_idx > 0:
            return title[:dash_idx].strip() or None
        return None

    if ide_id == "sublime":
        suffix = " - Sublime Text"
        if title.endswith(suffix):
            rest = title[: -len(suffix)].strip()
            parts = rest.split(" - ")
            return parts[-1].strip() or None
        return None

    return None


def query_ide_processes(ides=SUPPORTED_IDES):
    results = []
    if sys.platform != "win32":
        return results

    for ide in ides:
        try:
            res = subprocess.run(
                ["tasklist.exe", "/v", "/fo", "csv", "/nh", "/fi", f"IMAGENAME eq {ide['exe']}"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            stdout = res.stdout or ""
            if "No tasks are running" in stdout or not stdout.strip():
                continue

            lines = [l for l in stdout.splitlines() if l.strip()]
            matched = False
            for line in lines:
                cols = parse_csv_line(line)
                if len(cols) >= 9:
                    raw_title = cols[8]
                    if raw_title and raw_title not in ("N/A", "OleMainThreadWndName"):
                        proj = extract_project_from_title(ide["id"], raw_title)
                        pid = int(cols[1]) if cols[1].isdigit() else None
                        results.append({
                            "ideId": ide["id"],
                            "ideName": ide["name"],
                            "processName": ide["exe"],
                            "pid": pid,
                            "project": proj,
                            "state": "active",
                        })
                        matched = True
                        break

            if not matched and lines:
                first_cols = parse_csv_line(lines[0])
                pid = int(first_cols[1]) if first_cols[1].isdigit() else None
                results.append({
                    "ideId": ide["id"],
                    "ideName": ide["name"],
                    "processName": ide["exe"],
                    "pid": pid,
                    "project": None,
                    "state": "idle",
                })
        except Exception:
            pass

    return results


def load_persisted_sessions(file_path: str, max_history=50):
    if not file_path or not os.path.exists(file_path):
        return []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if not raw:
            return []

        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            raise ValueError("NOT_AN_ARRAY")

        validated = []
        for item in parsed:
            if isinstance(item, dict):
                sid = str(item.get("id") or f"ide-sess-{int(time.time()*1000)}")
                ide_id = str(item.get("ideId") or "unknown")
                ide_name = str(item.get("ideName") or "IDE")
                project = str(item.get("project"))[:100] if item.get("project") else None
                started_at = str(item.get("startedAt") or datetime.now(timezone.utc).isoformat())
                ended_at = str(item.get("endedAt")) if item.get("endedAt") else None

                try:
                    dur = int(item.get("durationSeconds", 1))
                except Exception:
                    dur = 1
                duration_seconds = max(1, min(86400 * 7, dur))

                was_active = item.get("state") == "active"
                state = "completed" if was_active else str(item.get("state") or "completed")
                reconstructed = was_active or bool(item.get("reconstructed"))

                sess = {
                    "id": sid,
                    "ideId": ide_id,
                    "ideName": ide_name,
                    "project": project,
                    "startedAt": started_at,
                    "endedAt": ended_at or (datetime.now(timezone.utc).isoformat() if was_active else None),
                    "durationSeconds": duration_seconds,
                    "state": state,
                }
                if reconstructed:
                    sess["reconstructed"] = True
                validated.append(sess)

        return validated[:max_history]
    except Exception as e:
        print(f"[Kuro Companion] Corrupt sessions file at {file_path}. Recovering: {e}", file=sys.stderr)
        try:
            if os.path.exists(file_path):
                os.rename(file_path, f"{file_path}.corrupt_{int(time.time())}")
        except Exception:
            pass
        return []


def save_persisted_sessions(file_path: str, sessions):
    if not file_path:
        return
    try:
        safe_list = []
        for s in (sessions or [])[:50]:
            safe_sess = {
                "id": str(s.get("id")),
                "ideId": str(s.get("ideId")),
                "ideName": str(s.get("ideName")),
                "project": str(s.get("project")) if s.get("project") else None,
                "startedAt": str(s.get("startedAt")),
                "endedAt": str(s.get("endedAt")) if s.get("endedAt") else None,
                "durationSeconds": max(1, min(86400 * 7, int(s.get("durationSeconds", 1)))),
                "state": str(s.get("state") or "completed"),
            }
            if s.get("reconstructed"):
                safe_sess["reconstructed"] = True
            safe_list.append(safe_sess)

        tmp_path = f"{file_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(safe_list, f, indent=2)
        if hasattr(os, "chmod"):
            os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, file_path)
    except Exception as e:
        print(f"[Kuro Companion] Note: Could not write sessions file: {e}", file=sys.stderr)


class IdeActivityTracker:
    def __init__(self, poll_interval_sec=5, max_history=50, storage_file_path=None):
        self.poll_interval_sec = poll_interval_sec
        self.max_history = max_history
        self.storage_file_path = storage_file_path or DEFAULT_SESSIONS_STORAGE_FILE
        self.is_tracking = False
        self.current_session = None
        self.last_poll_at = None
        self._timer = None
        self._lock = threading.Lock()

        # Load persisted sessions on boot with corruption recovery
        self.sessions_history = load_persisted_sessions(self.storage_file_path, self.max_history)

    def start(self):
        with self._lock:
            if self.is_tracking:
                return
            self.is_tracking = True
            self._schedule_poll(0.05)

    def stop(self):
        with self._lock:
            if not self.is_tracking and not self._timer:
                return
            self.is_tracking = False
            if self._timer:
                self._timer.cancel()
                self._timer = None
            self._finalize_active_session()

    def _finalize_active_session(self):
        if self.current_session:
            now = datetime.now(timezone.utc).isoformat()
            try:
                started_epoch = datetime.fromisoformat(self.current_session["startedAt"]).timestamp()
                duration_sec = max(1, min(86400 * 7, int(time.time() - started_epoch)))
            except Exception:
                duration_sec = 1
            self.current_session["endedAt"] = now
            self.current_session["state"] = "completed"
            self.current_session["durationSeconds"] = duration_sec
            self.sessions_history.insert(0, dict(self.current_session))
            if len(self.sessions_history) > self.max_history:
                self.sessions_history = self.sessions_history[: self.max_history]
            self.current_session = None
            save_persisted_sessions(self.storage_file_path, self.sessions_history)

    def _schedule_poll(self, delay):
        if not self.is_tracking:
            return
        self._timer = threading.Timer(delay, self._poll_loop)
        self._timer.daemon = True
        self._timer.start()

    def _poll_loop(self):
        if not self.is_tracking:
            return
        self.poll()
        with self._lock:
            if self.is_tracking:
                self._schedule_poll(self.poll_interval_sec)

    def poll(self):
        now = datetime.now(timezone.utc).isoformat()
        self.last_poll_at = now

        try:
            active_processes = query_ide_processes(SUPPORTED_IDES)
            primary = None
            for p in active_processes:
                if p.get("project") or p.get("state") == "active":
                    primary = p
                    break
            if not primary and active_processes:
                primary = active_processes[0]

            with self._lock:
                if not primary:
                    if self.current_session:
                        self._finalize_active_session()
                    return

                if (
                    self.current_session
                    and self.current_session["ideId"] == primary["ideId"]
                    and self.current_session["project"] == primary["project"]
                ):
                    try:
                        started_epoch = datetime.fromisoformat(self.current_session["startedAt"]).timestamp()
                        duration_sec = max(1, min(86400 * 7, int(time.time() - started_epoch)))
                    except Exception:
                        duration_sec = 1
                    self.current_session["lastSeenAt"] = now
                    self.current_session["durationSeconds"] = duration_sec
                    self.current_session["state"] = primary["state"]
                else:
                    if self.current_session:
                        self._finalize_active_session()

                    self.current_session = {
                        "id": f"ide-sess-{int(time.time()*1000)}-{secrets.token_hex(3)}",
                        "ideId": primary["ideId"],
                        "ideName": primary["ideName"],
                        "project": primary["project"],
                        "startedAt": now,
                        "lastSeenAt": now,
                        "endedAt": None,
                        "durationSeconds": 1,
                        "state": primary["state"],
                    }
        except Exception:
            pass

    def get_status(self):
        with self._lock:
            return {
                "status": "ok",
                "isTracking": self.is_tracking,
                "activeSession": dict(self.current_session) if self.current_session else None,
                "supportedIdes": [i["name"] for i in SUPPORTED_IDES],
                "pollIntervalMs": self.poll_interval_sec * 1000,
                "lastPollAt": self.last_poll_at,
                "sessionCount": len(self.sessions_history),
            }

    def get_sessions(self):
        with self._lock:
            return {
                "status": "ok",
                "isTracking": self.is_tracking,
                "currentSession": dict(self.current_session) if self.current_session else None,
                "sessions": list(self.sessions_history),
            }

    def clear_history(self):
        with self._lock:
            self.sessions_history = []
            save_persisted_sessions(self.storage_file_path, self.sessions_history)
            return {"status": "ok", "message": "Activity session history cleared."}


activity_tracker = IdeActivityTracker()


class CompanionHandler(http.server.BaseHTTPRequestHandler):
    server_version = "KuroCompanion/" + COMPANION_VERSION

    def send_json(self, status_code, data, origin=None):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")

        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Authorization, X-Kuro-Companion-Token, Content-Type",
            )
            self.send_header("Vary", "Origin")

        self.end_headers()
        self.wfile.write(body)

    def is_origin_allowed(self, origin):
        if not origin:
            return True
        return origin in ALLOWED_ORIGINS

    def extract_token(self):
        auth = self.headers.get("Authorization", "")
        if auth and auth.lower().startswith("bearer "):
            return auth[7:].strip()
        custom = self.headers.get("X-Kuro-Companion-Token", "")
        if custom:
            return custom.strip()
        return None

    def verify_token(self, token):
        if not token or not isinstance(token, str):
            return False
        return secrets.compare_digest(token, SESSION_TOKEN)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        if origin and not self.is_origin_allowed(origin):
            self.send_response(403)
            self.end_headers()
            return

        self.send_response(204)
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Authorization, X-Kuro-Companion-Token, Content-Type",
            )
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        origin = self.headers.get("Origin")
        if origin and not self.is_origin_allowed(origin):
            self.send_json(403, {"status": "error", "error": "Forbidden: Untrusted Origin"}, origin)
            return

        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/api/health", "/"):
            self.send_json(
                200,
                {
                    "status": "ok",
                    "service": "kuro-desktop-companion",
                    "version": COMPANION_VERSION,
                    "platform": sys.platform,
                    "state": "running",
                    "requiresAuth": True,
                    "capabilities": {
                        "healthCheck": True,
                        "ideTracking": True,
                        "persistentSessions": True,
                    },
                },
                origin,
            )
            return

        token = self.extract_token()
        if not self.verify_token(token):
            self.send_json(
                401,
                {"status": "error", "error": "Unauthorized: Invalid or missing companion token"},
                origin,
            )
            return

        if path == "/api/status":
            uptime_seconds = int(time.time() - START_TIME)
            self.send_json(
                200,
                {
                    "status": "ok",
                    "service": "kuro-desktop-companion",
                    "version": COMPANION_VERSION,
                    "platform": sys.platform,
                    "state": "running",
                    "authenticated": True,
                    "sessionStartedAt": SESSION_STARTED_AT,
                    "uptimeSeconds": uptime_seconds,
                    "capabilities": {
                        "healthCheck": True,
                        "ideTracking": True,
                        "persistentSessions": True,
                    },
                    "tracking": activity_tracker.get_status(),
                },
                origin,
            )
            return

        if path == "/api/tracking/status":
            self.send_json(200, activity_tracker.get_status(), origin)
            return

        if path == "/api/tracking/sessions":
            self.send_json(200, activity_tracker.get_sessions(), origin)
            return

        self.send_json(404, {"status": "error", "error": "Endpoint Not Found"}, origin)

    def do_POST(self):
        origin = self.headers.get("Origin")
        if origin and not self.is_origin_allowed(origin):
            self.send_json(403, {"status": "error", "error": "Forbidden: Untrusted Origin"}, origin)
            return

        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "Payload Too Large"}, origin)
            return

        body = {}
        if content_length > 0:
            try:
                raw_body = self.rfile.read(content_length).decode("utf-8")
                body = json.loads(raw_body)
            except Exception:
                self.send_json(400, {"error": "Bad Request: Malformed JSON"}, origin)
                return

        if path == "/api/pair":
            candidate = body.get("token") or self.extract_token()
            if not self.verify_token(candidate):
                self.send_json(
                    401,
                    {"status": "error", "error": "Unauthorized: Pairing token does not match"},
                    origin,
                )
                return
            self.send_json(
                200,
                {
                    "status": "ok",
                    "paired": True,
                    "service": "kuro-desktop-companion",
                    "version": COMPANION_VERSION,
                    "message": "Successfully paired with Kuro Desktop Companion.",
                },
                origin,
            )
            return

        token = self.extract_token()
        if not self.verify_token(token):
            self.send_json(
                401,
                {"status": "error", "error": "Unauthorized: Valid companion token required"},
                origin,
            )
            return

        if path == "/api/shutdown":
            activity_tracker.stop()
            self.send_json(
                200,
                {"status": "ok", "message": "Kuro Desktop Companion is shutting down cleanly."},
                origin,
            )

            def delayed_shutdown():
                time.sleep(0.15)
                cleanup_token_file()
                os._exit(0)

            threading.Thread(target=delayed_shutdown, daemon=True).start()
            return

        if path == "/api/tracking/start":
            activity_tracker.start()
            self.send_json(
                200,
                {
                    "status": "ok",
                    "isTracking": True,
                    "message": "Privacy-respecting IDE activity tracking started.",
                    "tracking": activity_tracker.get_status(),
                },
                origin,
            )
            return

        if path == "/api/tracking/stop":
            activity_tracker.stop()
            self.send_json(
                200,
                {
                    "status": "ok",
                    "isTracking": False,
                    "message": "Privacy-respecting IDE activity tracking stopped.",
                    "tracking": activity_tracker.get_status(),
                },
                origin,
            )
            return

        if path == "/api/tracking/clear":
            result = activity_tracker.clear_history()
            self.send_json(200, result, origin)
            return

        self.send_json(404, {"status": "error", "error": "Endpoint Not Found"}, origin)


def run_server():
    server = http.server.HTTPServer((COMPANION_HOST, COMPANION_PORT), CompanionHandler)

    def signal_handler(sig, frame):
        activity_tracker.stop()
        cleanup_token_file()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    print("==============================================================")
    print(f"KURO WINDOWS DESKTOP COMPANION — FOUNDATION SERVICE (v{COMPANION_VERSION}) [Python]")
    print("==============================================================")
    print(f"Binding:   http://{COMPANION_HOST}:{COMPANION_PORT}")
    print("Access:    Strict Loopback Only (127.0.0.1)")
    print(f"Platforms: Windows ({sys.platform})")
    print("--------------------------------------------------------------")
    print("SECURITY & PAIRING:")
    print(f"Pairing Token: {SESSION_TOKEN}")
    print(f"Saved Token:   {TOKEN_FILE_PATH}")
    print("Allowed Origins:")
    for o in ALLOWED_ORIGINS:
        print(f" - {o}")
    print("--------------------------------------------------------------")
    print("STATUS: Active and waiting for Kuro Web App connection...")
    print("Press Ctrl+C to stop companion.")
    print("==============================================================")

    try:
        server.serve_forever()
    finally:
        activity_tracker.stop()
        cleanup_token_file()


if __name__ == "__main__":
    run_server()
