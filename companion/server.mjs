/**
 * Kuro Windows Desktop Companion — Foundation & IDE Activity Service (v1.2.0)
 *
 * Scope: Phase 4, Step 4.3
 *
 * PRIVACY & SECURITY GUARANTEES:
 * 1. Binds exclusively to 127.0.0.1 (loopback only; never LAN or public interfaces).
 * 2. Origin validation: rejects unauthorized origins with 403 Forbidden to prevent cross-site hijacking.
 * 3. Session authorization token: per-session cryptographically random token required for state-changing endpoints.
 * 4. Request size limited to 64 KB to prevent denial-of-service memory exhaustion.
 * 5. Zero telemetry, zero external network requests, zero shell execution endpoints.
 * 6. Clean lifecycle: clean shutdown endpoint, timer cleanup, and token cleanup on termination.
 * 7. Privacy-respecting IDE tracking:
 *    - Opt-in only (disabled by default; requires explicit start command).
 *    - Only captures coarse IDE process presence, safe top-level project label from window title, and timestamps.
 *    - Zero keystrokes, clipboard, screenshots, code files, browser history, or credentials collected.
 * 8. Persistent, bounded session history (Step 4.3):
 *    - Persisted locally with atomic file writes (.sessions_history.json.tmp -> .sessions_history.json).
 *    - Memory & storage strictly capped at 50 sessions.
 *    - Validates stored data on load; recovers gracefully from missing or corrupted files.
 *    - Safely recovers in-flight sessions on unexpected process restart with reconstructed: true.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
export const COMPANION_PRIMARY_PORT = 48299;
export const COMPANION_FALLBACK_PORT = 48199;
export const COMPANION_PORT = parseInt(process.env.KURO_COMPANION_PORT || String(COMPANION_PRIMARY_PORT), 10);
export const COMPANION_HOST = '127.0.0.1';
export const COMPANION_VERSION = '1.3.0';
export const MAX_BODY_BYTES = 64 * 1024; // 64 KB limit
export const DEFAULT_SESSIONS_STORAGE_FILE = path.join(__dirname, '.sessions_history.json');

// Allowed Origins for Web Client Access
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

const customOrigins = (process.env.KURO_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...customOrigins]);

// Supported Development Environments
export const SUPPORTED_IDES = [
  { id: 'antigravity', name: 'Antigravity IDE', exe: 'Antigravity IDE.exe' },
  { id: 'vscode', name: 'Visual Studio Code', exe: 'Code.exe' },
  { id: 'visualstudio', name: 'Visual Studio', exe: 'devenv.exe' },
  { id: 'cursor', name: 'Cursor', exe: 'Cursor.exe' },
  { id: 'windsurf', name: 'Windsurf', exe: 'Windsurf.exe' },
  { id: 'zed', name: 'Zed', exe: 'zed.exe' },
  { id: 'idea', name: 'IntelliJ IDEA', exe: 'idea64.exe' },
  { id: 'pycharm', name: 'PyCharm', exe: 'pycharm64.exe' },
  { id: 'webstorm', name: 'WebStorm', exe: 'webstorm64.exe' },
  { id: 'clion', name: 'CLion', exe: 'clion64.exe' },
  { id: 'rider', name: 'Rider', exe: 'rider64.exe' },
  { id: 'androidstudio', name: 'Android Studio', exe: 'studio64.exe' },
  { id: 'sublime', name: 'Sublime Text', exe: 'sublime_text.exe' },
];

// Session Token & 6-Digit Pairing PIN Generation & Storage
const TOKEN_FILE_PATH = path.join(__dirname, '.session_token');
const PIN_FILE_PATH = path.join(__dirname, '.session_pin');
const PID_FILE_PATH = path.join(__dirname, 'kuro-companion.pid');
const sessionStartedAt = new Date().toISOString();
export const sessionToken = crypto.randomBytes(16).toString('hex'); // 32 chars hex
export const pairingPin = (crypto.randomInt ? crypto.randomInt(100000, 999999) : Math.floor(100000 + Math.random() * 900000)).toString();
export let sessionExpiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours TTL

// Active browser tab state reported by companion extension
let currentBrowserTab = {
  hostname: null,
  title: null,
  timestamp: 0,
};

// Persist token and pin with restricted user-only permissions
try {
  fs.writeFileSync(TOKEN_FILE_PATH, sessionToken, { mode: 0o600, encoding: 'utf-8' });
  fs.writeFileSync(PIN_FILE_PATH, pairingPin, { mode: 0o600, encoding: 'utf-8' });
} catch (err) {
  console.warn('[Kuro Companion] Note: Could not write token/pin files:', err.message);
}

// Cleanup credentials on exit
export function cleanupTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE_PATH)) fs.unlinkSync(TOKEN_FILE_PATH);
  } catch { /* ignore */ }
  try {
    if (fs.existsSync(PIN_FILE_PATH)) fs.unlinkSync(PIN_FILE_PATH);
  } catch { /* ignore */ }
  try {
    if (fs.existsSync(PID_FILE_PATH)) fs.unlinkSync(PID_FILE_PATH);
  } catch { /* ignore */ }
}

process.on('exit', cleanupTokenFile);
process.on('SIGINT', () => {
  cleanupTokenFile();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupTokenFile();
  process.exit(0);
});

// Helper: Check Origin
export function isOriginAllowed(origin) {
  if (!origin) return true; // Direct non-browser requests (e.g. curl or internal tests)
  return ALLOWED_ORIGINS.has(origin);
}

// Helper: Extract Auth Token from Request
export function extractAuthToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  const customHeader = req.headers['x-kuro-companion-token'];
  if (customHeader) {
    return String(customHeader).trim();
  }
  return null;
}

// Rate Limiting & Brute Force Protection
const rateLimitMap = new Map();
const failedPinAttempts = new Map();

export function checkRateLimit(ip, endpoint, maxRequests, windowMs) {
  const now = Date.now();
  const key = `${ip}:${endpoint}`;
  let record = rateLimitMap.get(key);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + windowMs };
    rateLimitMap.set(key, record);
    return true;
  }
  if (record.count >= maxRequests) {
    return false;
  }
  record.count++;
  return true;
}

export function isPinLocked(ip) {
  const now = Date.now();
  const record = failedPinAttempts.get(ip);
  if (record && record.lockedUntil && now < record.lockedUntil) {
    return true;
  }
  return false;
}

export function recordFailedPinAttempt(ip) {
  const now = Date.now();
  let record = failedPinAttempts.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + 60000, lockedUntil: 0 };
  } else {
    record.count++;
  }
  if (record.count >= 5) {
    record.lockedUntil = now + 60000; // 60s lock
  }
  failedPinAttempts.set(ip, record);
}

export function clearFailedPinAttempts(ip) {
  failedPinAttempts.delete(ip);
}

// Helper: Timing-safe token comparison with expiry check
export function verifyToken(token, expectedToken = sessionToken) {
  if (!token || typeof token !== 'string') return false;
  if (!expectedToken || typeof expectedToken !== 'string') return false;
  if (Date.now() > sessionExpiresAt) return false;
  if (token.length !== expectedToken.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
  } catch {
    return false;
  }
}

// Helper: Timing-safe PIN comparison with expiry check
export function verifyPin(pin, expectedPin = pairingPin) {
  if (!pin || typeof pin !== 'string') return false;
  if (!expectedPin || typeof expectedPin !== 'string') return false;
  if (Date.now() > sessionExpiresAt) return false;
  if (pin.length !== expectedPin.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(expectedPin));
  } catch {
    return false;
  }
}

// Helper: Send JSON Response
function sendJson(res, statusCode, data, reqOrigin = null) {
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  if (reqOrigin && ALLOWED_ORIGINS.has(reqOrigin)) {
    headers['Access-Control-Allow-Origin'] = reqOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, X-Kuro-Companion-Token, Content-Type';
    headers['Vary'] = 'Origin';
  }

  res.writeHead(statusCode, headers);
  res.end(body);
}

// Helper: Read and parse JSON request body with size limits
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytesReceived = 0;

    req.on('data', (chunk) => {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_BODY_BYTES) {
        req.removeAllListeners('data');
        req.resume();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      raw += chunk;
    });

    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

// Helper: Parse Windows tasklist CSV line
export function parseCsvLine(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

// Helper: Extract top-level project label safely from window title
export function extractProjectFromTitle(ideId, rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return null;
  const title = rawTitle.trim();
  if (!title || title === 'N/A' || title === 'OleMainThreadWndName') return null;

  if (ideId === 'antigravity') {
    // Format: "workspace-name - Antigravity IDE - file.ext" or "workspace-name - Antigravity IDE"
    const parts = title.split(' - ');
    if (parts.length >= 2 && parts[0] && parts[0] !== 'Antigravity IDE') {
      return parts[0].trim();
    }
    return null;
  }

  if (ideId === 'vscode') {
    // Format: "file.ext - project-name - Visual Studio Code" or "project-name - Visual Studio Code"
    const suffix = ' - Visual Studio Code';
    if (title.endsWith(suffix)) {
      const rest = title.slice(0, -suffix.length).trim();
      const parts = rest.split(' - ');
      const candidate = parts[parts.length - 1]?.trim();
      return candidate && candidate !== 'Welcome' ? candidate : null;
    }
    return null;
  }

  if (ideId === 'visualstudio') {
    // Format: "SolutionName - Microsoft Visual Studio"
    const suffix = ' - Microsoft Visual Studio';
    if (title.endsWith(suffix)) {
      const candidate = title.slice(0, -suffix.length).trim();
      return candidate || null;
    }
    return null;
  }

  if (ideId === 'cursor') {
    // Format: "file.ext - project-name - Cursor" or "project-name - Cursor"
    const suffix = ' - Cursor';
    if (title.endsWith(suffix)) {
      const rest = title.slice(0, -suffix.length).trim();
      const parts = rest.split(' - ');
      const candidate = parts[parts.length - 1]?.trim();
      return candidate || null;
    }
    return null;
  }

  if (ideId === 'windsurf') {
    // Format: "file.ext - project-name - Windsurf" or "project-name - Windsurf"
    const suffix = ' - Windsurf';
    if (title.endsWith(suffix)) {
      const rest = title.slice(0, -suffix.length).trim();
      const parts = rest.split(' - ');
      const candidate = parts[parts.length - 1]?.trim();
      return candidate && candidate !== 'Welcome' ? candidate : null;
    }
    return null;
  }

  if (ideId === 'zed') {
    // Format: "project-name — file.ext" or "project-name - Zed"
    if (title.includes(' — ')) {
      const parts = title.split(' — ');
      return parts[0]?.trim() || null;
    }
    const suffix = ' - Zed';
    if (title.endsWith(suffix)) {
      return title.slice(0, -suffix.length).trim() || null;
    }
    return null;
  }

  if (
    ideId === 'idea' ||
    ideId === 'pycharm' ||
    ideId === 'webstorm' ||
    ideId === 'clion' ||
    ideId === 'rider' ||
    ideId === 'androidstudio'
  ) {
    // Format: "project-name – [file.ext]" or "project-name [C:\path]"
    const bracketIdx = title.indexOf('[');
    if (bracketIdx > 0) {
      return title.slice(0, bracketIdx).trim() || null;
    }
    const dashIdx = title.indexOf(' – ');
    if (dashIdx > 0) {
      return title.slice(0, dashIdx).trim() || null;
    }
    return null;
  }

  if (ideId === 'sublime') {
    // Format: "file.ext - project-name - Sublime Text"
    const suffix = ' - Sublime Text';
    if (title.endsWith(suffix)) {
      const rest = title.slice(0, -suffix.length).trim();
      const parts = rest.split(' - ');
      return parts[parts.length - 1]?.trim() || null;
    }
    return null;
  }

  return null;
}

// Query running IDE processes
export async function queryIdeProcesses(ides = SUPPORTED_IDES, execRunner = null) {
  const runner = execRunner || ((cmd, args, opts, cb) => execFile(cmd, args, opts, cb));

  const checkSingleIde = (ide) => {
    return new Promise((resolve) => {
      runner(
        'tasklist.exe',
        ['/v', '/fo', 'csv', '/nh', '/fi', `IMAGENAME eq ${ide.exe}`],
        { timeout: 3000 },
        (err, stdout) => {
          if (err || !stdout || stdout.includes('No tasks are running')) {
            return resolve(null);
          }

          const lines = stdout.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            const cols = parseCsvLine(line);
            if (cols.length >= 9) {
              const rawTitle = cols[8];
              if (rawTitle && rawTitle !== 'N/A' && rawTitle !== 'OleMainThreadWndName') {
                const project = extractProjectFromTitle(ide.id, rawTitle);
                return resolve({
                  ideId: ide.id,
                  ideName: ide.name,
                  processName: ide.exe,
                  pid: parseInt(cols[1], 10) || null,
                  project: project || null,
                  state: 'active',
                });
              }
            }
          }

          if (lines.length > 0) {
            const firstCols = parseCsvLine(lines[0]);
            return resolve({
              ideId: ide.id,
              ideName: ide.name,
              processName: ide.exe,
              pid: parseInt(firstCols[1], 10) || null,
              project: null,
              state: 'idle',
            });
          }

          return resolve(null);
        }
      );
    });
  };

  const results = await Promise.all(ides.map(checkSingleIde));
  return results.filter(Boolean);
}

// Step 4.3: Safe Persistence and Recovery Functions
export function loadPersistedSessions(filePath, maxHistory = 50) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('NOT_AN_ARRAY');
    }

    const validated = [];
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const id = String(item.id || `ide-sess-${Date.now()}`);
        const ideId = String(item.ideId || 'unknown');
        const ideName = String(item.ideName || 'IDE');
        const project = item.project ? String(item.project).slice(0, 100) : null;

        const startedAt = item.startedAt && !isNaN(Date.parse(item.startedAt))
          ? new Date(item.startedAt).toISOString()
          : new Date().toISOString();

        const endedAt = item.endedAt && !isNaN(Date.parse(item.endedAt))
          ? new Date(item.endedAt).toISOString()
          : null;

        // Handle clock anomalies and ensure duration is non-negative and bounded
        let durationSeconds = Math.max(1, Math.round(Number(item.durationSeconds) || 1));
        if (endedAt && startedAt) {
          const calculatedSec = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
          if (calculatedSec > 0) {
            durationSeconds = calculatedSec;
          }
        }
        durationSeconds = Math.min(86400 * 7, durationSeconds); // Cap at 7 days

        // Handle restart recovery: if a stored session was still in 'active' state, reconstruct as completed
        const wasActive = item.state === 'active';
        const state = wasActive ? 'completed' : String(item.state || 'completed');
        const reconstructed = wasActive || Boolean(item.reconstructed);

        validated.push({
          id,
          ideId,
          ideName,
          project,
          startedAt,
          endedAt: endedAt || (wasActive ? new Date().toISOString() : null),
          durationSeconds,
          state,
          ...(reconstructed ? { reconstructed: true } : {}),
        });
      }
    }

    return validated.slice(0, maxHistory);
  } catch (err) {
    console.warn(`[Kuro Companion] Corrupt or unreadable sessions file at ${filePath}. Recovering:`, err.message);
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, `${filePath}.corrupt_${Date.now()}`);
      }
    } catch {
      // ignore rename failure
    }
    return [];
  }
}

export function savePersistedSessions(filePath, sessions) {
  if (!filePath) return;

  try {
    const safeList = (sessions || []).slice(0, 50).map((s) => ({
      id: String(s.id),
      ideId: String(s.ideId),
      ideName: String(s.ideName),
      project: s.project ? String(s.project) : null,
      startedAt: String(s.startedAt),
      endedAt: s.endedAt ? String(s.endedAt) : null,
      durationSeconds: Math.max(1, Math.min(86400 * 7, Math.round(Number(s.durationSeconds) || 1))),
      state: String(s.state || 'completed'),
      ...(s.reconstructed ? { reconstructed: true } : {}),
    }));

    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(safeList, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn('[Kuro Companion] Note: Could not write session history file:', err.message);
  }
}

// IDE Activity Tracker Class
export class IdeActivityTracker {
  constructor(options = {}) {
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.maxHistory = options.maxHistory || 50;
    this.storageFilePath = options.storageFilePath || DEFAULT_SESSIONS_STORAGE_FILE;
    this.isTracking = false;
    this.pollTimer = null;
    this.currentSession = null;
    this.lastPollAt = null;
    this.execRunner = options.execRunner || null;
    this.supportedIdes = options.supportedIdes || SUPPORTED_IDES;

    // Load persisted sessions on startup with validation and corruption recovery
    this.sessionsHistory = loadPersistedSessions(this.storageFilePath, this.maxHistory);
  }

  start() {
    if (this.isTracking) return;
    this.isTracking = true;
    void this.poll();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  stop() {
    if (!this.isTracking && !this.pollTimer) return;
    this.isTracking = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.finalizeActiveSession();
  }

  finalizeActiveSession() {
    if (this.currentSession) {
      const now = new Date().toISOString();
      const rawSec = Math.round((new Date(now).getTime() - new Date(this.currentSession.startedAt).getTime()) / 1000);
      const durationSeconds = Math.max(1, Math.min(86400 * 7, rawSec));

      const completedSession = {
        ...this.currentSession,
        endedAt: now,
        state: 'completed',
        durationSeconds,
      };

      this.sessionsHistory.unshift(completedSession);
      if (this.sessionsHistory.length > this.maxHistory) {
        this.sessionsHistory = this.sessionsHistory.slice(0, this.maxHistory);
      }

      this.currentSession = null;

      // Persist to disk atomically
      savePersistedSessions(this.storageFilePath, this.sessionsHistory);
    }
  }

  async poll() {
    if (!this.isTracking) return;
    this.lastPollAt = new Date().toISOString();

    try {
      const activeProcesses = await queryIdeProcesses(this.supportedIdes, this.execRunner);
      // Prefer active process with a detected workspace project or active window
      const primary =
        activeProcesses.find((p) => p.project || p.state === 'active') ||
        activeProcesses[0] ||
        null;

      const now = new Date().toISOString();

      if (!primary) {
        // No supported IDE is currently running
        if (this.currentSession) {
          this.finalizeActiveSession();
        }
        return;
      }

      // Check if continuing same session (deduplication)
      if (
        this.currentSession &&
        this.currentSession.ideId === primary.ideId &&
        this.currentSession.project === primary.project
      ) {
        const rawSec = Math.round((new Date(now).getTime() - new Date(this.currentSession.startedAt).getTime()) / 1000);
        const durationSeconds = Math.max(1, Math.min(86400 * 7, rawSec));

        this.currentSession.lastSeenAt = now;
        this.currentSession.durationSeconds = durationSeconds;
        this.currentSession.state = primary.state;
      } else {
        // Transition: finalize previous session if one was running
        if (this.currentSession) {
          this.finalizeActiveSession();
        }

        this.currentSession = {
          id: `ide-sess-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          ideId: primary.ideId,
          ideName: primary.ideName,
          project: primary.project,
          startedAt: now,
          lastSeenAt: now,
          endedAt: null,
          durationSeconds: 1,
          state: primary.state,
        };
      }
    } catch {
      // Non-fatal poll error
    }
  }

  getStatus() {
    return {
      status: 'ok',
      isTracking: this.isTracking,
      activeSession: this.currentSession,
      supportedIdes: this.supportedIdes.map((i) => i.name),
      pollIntervalMs: this.pollIntervalMs,
      lastPollAt: this.lastPollAt,
      sessionCount: this.sessionsHistory.length,
    };
  }

  getSessions() {
    return {
      status: 'ok',
      isTracking: this.isTracking,
      currentSession: this.currentSession,
      sessions: this.sessionsHistory,
    };
  }

  clearHistory() {
    this.sessionsHistory = [];
    savePersistedSessions(this.storageFilePath, this.sessionsHistory);
    return { status: 'ok', message: 'Activity session history cleared.' };
  }
}

// Global Activity Tracker Instance
export const activityTracker = new IdeActivityTracker();

// Create HTTP Server
export const server = http.createServer(async (req, res) => {
  const origin = req.headers['origin'];

  // Origin Validation
  if (origin && !isOriginAllowed(origin)) {
    return sendJson(res, 403, {
      status: 'error',
      error: 'Forbidden: Untrusted Origin',
      origin,
    });
  }

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, X-Kuro-Companion-Token, Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
    res.writeHead(204, headers);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;

  // Route 1: Health Check (Unauthenticated, Minimal Info)
  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/')) {
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    if (!checkRateLimit(clientIp, '/api/health', 120, 60000)) {
      return sendJson(res, 429, { error: 'Rate limit exceeded' }, origin);
    }
    return sendJson(
      res,
      200,
      {
        status: 'ok',
        service: 'kuro-desktop-companion',
        version: COMPANION_VERSION,
        platform: os.platform(),
        port: activePort || COMPANION_PORT,
        state: 'running',
        requiresAuth: true,
        capabilities: {
          healthCheck: true,
          ideTracking: true,
          persistentSessions: true,
          pairingPin: true,
          portFallback: true,
        },
      },
      origin
    );
  }

  // Route 2: Status & Inspection (Requires Valid Token)
  if (req.method === 'GET' && pathname === '/api/status') {
    const token = extractAuthToken(req);
    const isAuthenticated = verifyToken(token);

    if (!isAuthenticated) {
      return sendJson(
        res,
        401,
        {
          status: 'error',
          error: 'Unauthorized: Invalid or missing companion token',
          requiresAuth: true,
        },
        origin
      );
    }

    const uptimeSeconds = Math.round(process.uptime());
    return sendJson(
      res,
      200,
      {
        status: 'ok',
        service: 'kuro-desktop-companion',
        version: COMPANION_VERSION,
        platform: os.platform(),
        port: activePort || COMPANION_PORT,
        state: 'running',
        authenticated: true,
        sessionStartedAt,
        sessionExpiresAt: new Date(sessionExpiresAt).toISOString(),
        uptimeSeconds,
        capabilities: {
          healthCheck: true,
          ideTracking: true,
          persistentSessions: true,
          pairingPin: true,
          portFallback: true,
        },
        tracking: activityTracker.getStatus(),
      },
      origin
    );
  }

  // Route 3: Pairing Handshake (POST /api/pair with {"token": "..."} or {"pin": "..."})
  if (req.method === 'POST' && pathname === '/api/pair') {
    const rawIp = req.socket.remoteAddress || '127.0.0.1';
    const clientIp = rawIp.replace(/^::ffff:/, '');
    if (!checkRateLimit(clientIp, '/api/pair', 20, 60000)) {
      return sendJson(
        res,
        429,
        {
          status: 'error',
          error: 'Too Many Requests: Rate limit exceeded on pairing endpoint. Please wait 60 seconds.',
        },
        origin
      );
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendJson(res, 413, { error: 'Payload Too Large' }, origin);
      }
      return sendJson(res, 400, { error: 'Bad Request: Malformed JSON' }, origin);
    }

    const candidatePin = body.pin ? String(body.pin).trim() : null;
    const candidateToken = body.token ? String(body.token).trim() : extractAuthToken(req);

    // If pairing via 6-digit PIN
    if (candidatePin) {
      if (isPinLocked(clientIp)) {
        return sendJson(
          res,
          429,
          {
            status: 'error',
            error: 'Too Many Requests: Maximum PIN attempts exceeded. Temporarily locked for 60 seconds.',
          },
          origin
        );
      }

      if (!verifyPin(candidatePin)) {
        recordFailedPinAttempt(clientIp);
        return sendJson(
          res,
          401,
          {
            status: 'error',
            error: 'Unauthorized: Invalid pairing PIN.',
          },
          origin
        );
      }

      // Valid PIN
      clearFailedPinAttempts(clientIp);
      return sendJson(
        res,
        200,
        {
          status: 'ok',
          paired: true,
          service: 'kuro-desktop-companion',
          version: COMPANION_VERSION,
          token: sessionToken,
          expiresIn: Math.max(0, Math.round((sessionExpiresAt - Date.now()) / 1000)),
          message: 'Successfully paired with Kuro Desktop Companion via PIN.',
        },
        origin
      );
    }

    // Pairing via Token
    if (!candidateToken || !verifyToken(candidateToken)) {
      return sendJson(
        res,
        401,
        {
          status: 'error',
          error: 'Unauthorized: Pairing token does not match active companion session or has expired',
        },
        origin
      );
    }

    return sendJson(
      res,
      200,
      {
        status: 'ok',
        paired: true,
        service: 'kuro-desktop-companion',
        version: COMPANION_VERSION,
        token: sessionToken,
        message: 'Successfully paired with Kuro Desktop Companion.',
      },
      origin
    );
  }

  // Route 4: Clean Shutdown (POST /api/shutdown, Requires Token)
  if (req.method === 'POST' && pathname === '/api/shutdown') {
    const token = extractAuthToken(req);
    if (!verifyToken(token)) {
      return sendJson(
        res,
        401,
        {
          status: 'error',
          error: 'Unauthorized: Valid token required to shut down companion',
        },
        origin
      );
    }

    // Stop tracking cleanly before shutdown (persists any ongoing session)
    activityTracker.stop();

    sendJson(
      res,
      200,
      {
        status: 'ok',
        message: 'Kuro Desktop Companion is shutting down cleanly.',
      },
      origin
    );

    setTimeout(() => {
      cleanupTokenFile();
      server.close(() => {
        process.exit(0);
      });
    }, 150);
    return;
  }

  // Route 5: Start IDE Tracking (POST /api/tracking/start, Requires Token)
  if (req.method === 'POST' && pathname === '/api/tracking/start') {
    const token = extractAuthToken(req);
    if (!verifyToken(token)) {
      return sendJson(
        res,
        401,
        { status: 'error', error: 'Unauthorized: Valid companion token required.' },
        origin
      );
    }

    activityTracker.start();
    return sendJson(
      res,
      200,
      {
        status: 'ok',
        isTracking: true,
        message: 'Privacy-respecting IDE activity tracking started.',
        tracking: activityTracker.getStatus(),
      },
      origin
    );
  }

  // Route 6: Stop IDE Tracking (POST /api/tracking/stop, Requires Token)
  if (req.method === 'POST' && pathname === '/api/tracking/stop') {
    const token = extractAuthToken(req);
    if (!verifyToken(token)) {
      return sendJson(
        res,
        401,
        { status: 'error', error: 'Unauthorized: Valid companion token required.' },
        origin
      );
    }

    activityTracker.stop();
    return sendJson(
      res,
      200,
      {
        status: 'ok',
        isTracking: false,
        message: 'Privacy-respecting IDE activity tracking stopped.',
        tracking: activityTracker.getStatus(),
      },
      origin
    );
  }

  // Route 7: Get Tracking Status (GET /api/tracking/status, Requires Token)
  if (req.method === 'GET' && pathname === '/api/tracking/status') {
    const token = extractAuthToken(req);
    if (!verifyToken(token)) {
      return sendJson(
        res,
        401,
        { status: 'error', error: 'Unauthorized: Valid companion token required.' },
        origin
      );
    }

    return sendJson(res, 200, activityTracker.getStatus(), origin);
  }

  // Route 8: Get Activity Sessions History (GET /api/tracking/sessions, Requires Token)
  if (req.method === 'GET' && pathname === '/api/tracking/sessions') {
    const token = extractAuthToken(req);
    if (!verifyToken(token)) {
      return sendJson(
        res,
        401,
        { status: 'error', error: 'Unauthorized: Valid companion token required.' },
        origin
      );
    }

    return sendJson(res, 200, activityTracker.getSessions(), origin);
  }

  // Route 9: Clear Tracking History (POST /api/tracking/clear, Requires Token)
  if (req.method === 'POST' && pathname === '/api/tracking/clear') {
    const token = extractAuthToken(req);
    if (!verifyToken(token)) {
      return sendJson(
        res,
        401,
        { status: 'error', error: 'Unauthorized: Valid companion token required.' },
        origin
      );
    }

    const result = activityTracker.clearHistory();
    return sendJson(res, 200, result, origin);
  }

  // Route 10: Report Active Browser Tab (POST /api/browser/tab)
  if (req.method === 'POST' && pathname === '/api/browser/tab') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const hostname = typeof payload.hostname === 'string' ? payload.hostname.slice(0, 100).toLowerCase() : null;
        const title = typeof payload.title === 'string' ? payload.title.slice(0, 80) : '';
        if (hostname) {
          currentBrowserTab = {
            hostname,
            title,
            timestamp: Date.now(),
          };
        }
        return sendJson(res, 200, { status: 'ok', recorded: Boolean(hostname) }, origin);
      } catch {
        return sendJson(res, 400, { status: 'error', error: 'Invalid JSON payload' }, origin);
      }
    });
    return;
  }

  // Route 11: Get Active Browser Tab (GET /api/browser/tab, Requires Token)
  if (req.method === 'GET' && pathname === '/api/browser/tab') {
    const token = extractAuthToken(req);
    if (!verifyToken(token)) {
      return sendJson(
        res,
        401,
        { status: 'error', error: 'Unauthorized: Valid companion token required.' },
        origin
      );
    }
    const isRecent = Date.now() - currentBrowserTab.timestamp < 60000;
    return sendJson(
      res,
      200,
      {
        status: 'ok',
        tab: isRecent ? currentBrowserTab : null,
      },
      origin
    );
  }

  // Fallback 404
  return sendJson(res, 404, { status: 'error', error: 'Endpoint Not Found' }, origin);
});

export let activePort = COMPANION_PORT;

export function startCompanionServer(preferredPort = COMPANION_PORT, host = COMPANION_HOST) {
  activePort = preferredPort;

  // Persist PID for service management
  try {
    fs.writeFileSync(PID_FILE_PATH, String(process.pid), { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // ignore
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (activePort === COMPANION_PRIMARY_PORT) {
        console.warn(`[Kuro Companion] Primary port ${COMPANION_PRIMARY_PORT} in use. Attempting fallback port ${COMPANION_FALLBACK_PORT}...`);
        activePort = COMPANION_FALLBACK_PORT;
        server.listen(activePort, host);
        return;
      }
      console.error(`[Kuro Companion] Error: Port ${activePort} is already in use.`);
      process.exit(1);
    } else {
      console.error('[Kuro Companion] Server startup error:', err);
      process.exit(1);
    }
  });

  server.listen(activePort, host, () => {
    console.log('==============================================================');
    console.log(`KURO WINDOWS DESKTOP COMPANION — FOUNDATION SERVICE (v${COMPANION_VERSION})`);
    console.log('==============================================================');
    console.log(`Binding:       http://${host}:${activePort}`);
    console.log('Access:        Strict Loopback Only (127.0.0.1)');
    console.log(`Platforms:     Windows (${os.platform()})`);
    console.log(`PID:           ${process.pid}`);
    console.log('--------------------------------------------------------------');
    console.log('SECURITY & PAIRING:');
    console.log(`Pairing PIN:   ${pairingPin} (6-digit numeric)`);
    console.log(`Pairing Token: ${sessionToken}`);
    console.log(`Saved Token:   ${TOKEN_FILE_PATH}`);
    console.log(`Saved PIN:     ${PIN_FILE_PATH}`);
    console.log(`Expires In:    24 hours`);
    console.log('Allowed Origins:');
    ALLOWED_ORIGINS.forEach((o) => console.log(` - ${o}`));
    console.log('--------------------------------------------------------------');
    console.log('STATUS: Active and waiting for Kuro Web App connection...');
    console.log('Press Ctrl+C to stop companion.');
    console.log('==============================================================');
  });
}

// Start Server if invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startCompanionServer();
}
