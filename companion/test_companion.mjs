/**
 * Automated Test Suite for Kuro Windows Desktop Companion
 *
 * Scope: Phase 4, Step 4.3 (Persistence & Daily Summaries)
 *
 * Tests:
 * 1. Health check endpoint (unauthenticated) & capabilities (ideTracking: true, persistentSessions: true)
 * 2. Status endpoint without token (401 Unauthorized)
 * 3. Status endpoint with valid Bearer token (200 OK)
 * 4. Pairing endpoint with valid token (200 OK)
 * 5. Pairing endpoint with invalid token (401 Unauthorized)
 * 6. Origin validation (403 Forbidden for untrusted origin)
 * 7. Request body size limit (>64 KB returns 413)
 * 8. Unit tests for extractProjectFromTitle (Antigravity, VS Code, VS, Cursor, JetBrains, Sublime)
 * 9. Tracking endpoints authentication (401 without token)
 * 10. Tracking endpoints origin guard (403 with untrusted origin)
 * 11. Tracking lifecycle: start tracking (200, isTracking: true)
 * 12. Tracking status & active session reporting
 * 13. Tracking sessions history retrieval
 * 14. Tracking lifecycle: stop tracking (200, isTracking: false)
 * 15. Tracking history clear (200, history emptied)
 * 16. IdeActivityTracker unit logic: deduplication, transitions, and retention capping (max 50)
 * 17. Step 4.3 Persistence: Atomic save and load validation
 * 18. Step 4.3 Persistence: Corrupted file recovery (graceful fallback without crash)
 * 19. Step 4.3 Persistence: Clock anomaly duration clamping & restart recovery (active -> completed, reconstructed)
 * 20. Shutdown endpoint with authorization & clean process termination
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  extractProjectFromTitle,
  parseCsvLine,
  IdeActivityTracker,
  loadPersistedSessions,
  savePersistedSessions,
  extractAuthToken,
  verifyToken,
  verifyPin,
  checkRateLimit,
  isOriginAllowed,
} from './server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 48299; // Dedicated test port
const TEST_HOST = '127.0.0.1';

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: TEST_HOST,
        port: TEST_PORT,
        ...options,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', (err) => reject(err));
    if (data) {
      if (typeof data === 'string') {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    req.end();
  });
}

async function runTestSuite() {
  console.log(`[Test Suite] Starting Desktop Companion test server on port ${TEST_PORT}`);

  const serverProc = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], {
    env: {
      ...process.env,
      KURO_COMPANION_PORT: String(TEST_PORT),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  let serverSessionToken = null;
  let serverPairingPin = null;
  let exitCleanly = false;

  const tokenPromise = new Promise((resolve, reject) => {
    let captured = '';
    serverProc.stdout.on('data', (chunk) => {
      captured += chunk.toString();
      const pinMatch = captured.match(/Pairing PIN:\s+(\d{6})/);
      if (pinMatch) {
        serverPairingPin = pinMatch[1];
      }
      const match = captured.match(/Pairing Token:\s+([a-f0-9]{32})/);
      if (match) {
        serverSessionToken = match[1];
        resolve(match[1]);
      }
    });

    serverProc.on('error', reject);
    serverProc.on('exit', (code) => {
      if (!exitCleanly) {
        reject(new Error(`Server exited unexpectedly with code ${code}`));
      }
    });
  });

  try {
    await Promise.race([
      tokenPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for server startup')), 4000)),
    ]);
  } catch (err) {
    console.error('Failed to start companion test server:', err);
    serverProc.kill();
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  assert(Boolean(serverSessionToken), 'Session token generated and retrieved');

  try {
    // 1. Health check endpoint (unauthenticated)
    const healthRes = await request({ path: '/api/health', method: 'GET' });
    assert(healthRes.status === 200, 'GET /api/health returns 200 OK');
    assert(healthRes.body.status === 'ok', 'Health reports status ok');
    assert(healthRes.body.capabilities?.ideTracking === true, 'Health indicates ideTracking capability is active');
    assert(healthRes.body.capabilities?.persistentSessions === true, 'Health indicates persistentSessions capability is active');

    // 2. Status endpoint without token
    const unauthRes = await request({ path: '/api/status', method: 'GET' });
    assert(unauthRes.status === 401, 'GET /api/status without token returns 401 Unauthorized');

    // 3. Status with invalid token
    const invalidAuthRes = await request({
      path: '/api/status',
      method: 'GET',
      headers: { Authorization: 'Bearer 00000000000000000000000000000000' },
    });
    assert(invalidAuthRes.status === 401, 'GET /api/status with invalid token returns 401');

    // 4. Status with valid token
    const authRes = await request({
      path: '/api/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(authRes.status === 200, 'GET /api/status with valid token returns 200 OK');
    assert(authRes.body.authenticated === true, 'Status reports authenticated: true');
    assert(authRes.body.tracking?.isTracking === false, 'Default tracking state is false (opt-in)');

    // 5. Pairing with invalid token
    const badPairRes = await request(
      { path: '/api/pair', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { token: 'wrongtoken1234567890123456789012' }
    );
    assert(badPairRes.status === 401, 'POST /api/pair with wrong token returns 401');

    // 6. Pairing with valid token
    const goodPairRes = await request(
      { path: '/api/pair', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { token: serverSessionToken }
    );
    assert(goodPairRes.status === 200, 'POST /api/pair with valid token returns 200 OK');
    assert(goodPairRes.body.paired === true, 'Pairing response confirms paired: true');

    // 6b. Pairing with valid 6-digit PIN
    const savedPin = fs.readFileSync(path.join(__dirname, '.session_pin'), 'utf-8').trim();
    assert(/^\d{6}$/.test(savedPin), 'Saved PIN is a 6-digit numeric string');
    assert(serverPairingPin === savedPin, 'Captured stdout PIN matches saved session PIN');

    const goodPinPairRes = await request(
      { path: '/api/pair', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { pin: savedPin }
    );
    assert(goodPinPairRes.status === 200, 'POST /api/pair with valid 6-digit PIN returns 200 OK');
    assert(goodPinPairRes.body.paired === true, 'PIN pairing confirms paired: true');
    assert(goodPinPairRes.body.token === serverSessionToken, 'PIN pairing returns authenticated session token');

    // 6c. Pairing with invalid 6-digit PIN
    const badPinPairRes = await request(
      { path: '/api/pair', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { pin: '000000' }
    );
    assert(badPinPairRes.status === 401, 'POST /api/pair with wrong PIN returns 401 Unauthorized');

    // 7. Origin validation
    const evilOriginRes = await request({
      path: '/api/health',
      method: 'GET',
      headers: { Origin: 'http://malicious-website.com' },
    });
    assert(evilOriginRes.status === 403, 'Request from untrusted origin returns 403 Forbidden');

    const goodOriginRes = await request({
      path: '/api/health',
      method: 'GET',
      headers: { Origin: 'http://localhost:5173' },
    });
    assert(goodOriginRes.status === 200, 'Request from trusted origin returns 200');

    // 8. Payload size limit (>64 KB returns 413)
    const largeBody = 'x'.repeat(65 * 1024);
    const oversizedRes = await request(
      {
        path: '/api/pair',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      largeBody
    );
    assert(oversizedRes.status === 413, 'Payload > 64 KB returns 413 Payload Too Large');

    // 9. Unit tests for extractProjectFromTitle
    assert(
      extractProjectFromTitle('antigravity', 'smart-pet-assistant-web - Antigravity IDE - .gitignore') ===
        'smart-pet-assistant-web',
      'extractProjectFromTitle extracts Antigravity workspace project correctly'
    );
    assert(
      extractProjectFromTitle('vscode', 'App.tsx - my-web-app - Visual Studio Code') === 'my-web-app',
      'extractProjectFromTitle extracts VS Code workspace project correctly'
    );
    assert(
      extractProjectFromTitle('visualstudio', 'KuroEngine - Microsoft Visual Studio') === 'KuroEngine',
      'extractProjectFromTitle extracts Visual Studio solution correctly'
    );
    assert(
      extractProjectFromTitle('cursor', 'index.ts - ai-agent - Cursor') === 'ai-agent',
      'extractProjectFromTitle extracts Cursor project correctly'
    );
    assert(
      extractProjectFromTitle('idea', 'backend-service [C:\\dev\\backend]') === 'backend-service',
      'extractProjectFromTitle extracts IntelliJ project correctly'
    );
    assert(
      extractProjectFromTitle('sublime', 'script.py - data-pipeline - Sublime Text') === 'data-pipeline',
      'extractProjectFromTitle extracts Sublime Text project correctly'
    );
    assert(
      extractProjectFromTitle('windsurf', 'server.ts - kuro-companion - Windsurf') === 'kuro-companion',
      'extractProjectFromTitle extracts Windsurf workspace project correctly'
    );
    assert(
      extractProjectFromTitle('zed', 'smart-pet-assistant — App.tsx') === 'smart-pet-assistant',
      'extractProjectFromTitle extracts Zed editor workspace project correctly'
    );
    assert(
      extractProjectFromTitle('clion', 'firmware-esp32 [C:\\projects\\firmware]') === 'firmware-esp32',
      'extractProjectFromTitle extracts CLion project correctly'
    );
    assert(
      extractProjectFromTitle('rider', 'GameClient [C:\\unity\\GameClient]') === 'GameClient',
      'extractProjectFromTitle extracts Rider project correctly'
    );
    assert(
      extractProjectFromTitle('androidstudio', 'KuroMobileApp [C:\\android\\app]') === 'KuroMobileApp',
      'extractProjectFromTitle extracts Android Studio project correctly'
    );
    assert(
      extractProjectFromTitle('vscode', 'N/A') === null &&
        extractProjectFromTitle('vscode', 'OleMainThreadWndName') === null &&
        extractProjectFromTitle('vscode', 'Welcome - Visual Studio Code') === null,
      'extractProjectFromTitle returns null for empty or non-project window titles'
    );

    // 10. Unit test for parseCsvLine
    const testCsv = '"Code.exe","1234","Console","1","50,000 K","Running","User","0:01","project - Visual Studio Code"';
    const parsedCols = parseCsvLine(testCsv);
    assert(parsedCols[0] === 'Code.exe' && parsedCols[8] === 'project - Visual Studio Code', 'parseCsvLine parses CSV with commas inside quotes properly');

    // 11. Tracking endpoints authentication
    const unauthStart = await request({ path: '/api/tracking/start', method: 'POST' });
    assert(unauthStart.status === 401, 'POST /api/tracking/start without token returns 401');

    const unauthStatus = await request({ path: '/api/tracking/status', method: 'GET' });
    assert(unauthStatus.status === 401, 'GET /api/tracking/status without token returns 401');

    const unauthSessions = await request({ path: '/api/tracking/sessions', method: 'GET' });
    assert(unauthSessions.status === 401, 'GET /api/tracking/sessions without token returns 401');

    const unauthClear = await request({ path: '/api/tracking/clear', method: 'POST' });
    assert(unauthClear.status === 401, 'POST /api/tracking/clear without token returns 401');

    // 12. Tracking lifecycle: start tracking
    const startRes = await request({
      path: '/api/tracking/start',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(startRes.status === 200, 'POST /api/tracking/start with valid token returns 200');
    assert(startRes.body.isTracking === true, 'Tracking response confirms isTracking: true');

    // 13. Tracking status
    const trackStatusRes = await request({
      path: '/api/tracking/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(trackStatusRes.status === 200, 'GET /api/tracking/status returns 200');
    assert(trackStatusRes.body.isTracking === true, 'Status confirms tracking active');
    assert(Array.isArray(trackStatusRes.body.supportedIdes) && trackStatusRes.body.supportedIdes.length >= 4, 'Status returns supported IDEs list');

    // 14. Tracking sessions endpoint
    const sessionsRes = await request({
      path: '/api/tracking/sessions',
      method: 'GET',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(sessionsRes.status === 200, 'GET /api/tracking/sessions returns 200');
    assert(Array.isArray(sessionsRes.body.sessions), 'Sessions response contains sessions array');

    // 15. Tracking lifecycle: stop tracking
    const stopRes = await request({
      path: '/api/tracking/stop',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(stopRes.status === 200, 'POST /api/tracking/stop with valid token returns 200');
    assert(stopRes.body.isTracking === false, 'Stop response confirms isTracking: false');

    // 15b. Idempotent stop: calling stop when already stopped succeeds safely
    const stopAgainRes = await request({
      path: '/api/tracking/stop',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(stopAgainRes.status === 200, 'POST /api/tracking/stop when already stopped returns 200 (idempotent stop)');

    // 15c. Idempotent start: calling start twice maintains single active state
    await request({
      path: '/api/tracking/start',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    const startAgainRes = await request({
      path: '/api/tracking/start',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(startAgainRes.status === 200 && startAgainRes.body.isTracking === true, 'POST /api/tracking/start when already tracking returns 200 (idempotent start)');

    // 15d. Authorization tolerance: lowercase "bearer" header works
    const statusBearerRes = await request({
      path: '/api/tracking/status',
      method: 'GET',
      headers: { Authorization: `bearer ${serverSessionToken}` },
    });
    assert(statusBearerRes.status === 200, 'GET /api/tracking/status accepts lowercase bearer token');

    // Clean stop after idempotency test
    await request({
      path: '/api/tracking/stop',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });

    // 16. Tracking history clear
    const clearRes = await request({
      path: '/api/tracking/clear',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(clearRes.status === 200, 'POST /api/tracking/clear returns 200');
    assert(clearRes.body.status === 'ok', 'Clear response status ok');

    // 16b. Idempotent clear: clearing when already empty is safe
    const clearAgainRes = await request({
      path: '/api/tracking/clear',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(clearAgainRes.status === 200, 'POST /api/tracking/clear when already empty returns 200');

    // 17. Step 4.3 Persistence: Atomic save and load validation
    const testStorageFile = path.join(__dirname, '.test_storage_sessions.json');
    try {
      if (fs.existsSync(testStorageFile)) fs.unlinkSync(testStorageFile);

      const mockSessions = [
        {
          id: 'test-sess-1',
          ideId: 'antigravity',
          ideName: 'Antigravity IDE',
          project: 'smart-pet-assistant-web',
          startedAt: new Date(Date.now() - 3600000).toISOString(),
          endedAt: new Date().toISOString(),
          durationSeconds: 3600,
          state: 'completed',
        },
      ];

      savePersistedSessions(testStorageFile, mockSessions);
      assert(fs.existsSync(testStorageFile), 'savePersistedSessions creates file on disk');

      const loaded = loadPersistedSessions(testStorageFile);
      assert(loaded.length === 1, 'loadPersistedSessions loads saved session count');
      assert(loaded[0].id === 'test-sess-1', 'Loaded session preserves id');
      assert(loaded[0].durationSeconds === 3600, 'Loaded session preserves duration');
    } finally {
      if (fs.existsSync(testStorageFile)) fs.unlinkSync(testStorageFile);
    }

    // 18. Step 4.3 Persistence: Corrupted file recovery
    const testCorruptFile = path.join(__dirname, '.test_corrupt_sessions.json');
    try {
      fs.writeFileSync(testCorruptFile, '{ this is corrupted non-json content }}}');
      const recovered = loadPersistedSessions(testCorruptFile);
      assert(Array.isArray(recovered) && recovered.length === 0, 'loadPersistedSessions recovers gracefully from corrupt JSON without crashing');
    } finally {
      try {
        if (fs.existsSync(testCorruptFile)) fs.unlinkSync(testCorruptFile);
      } catch {}
      // Clean up any corrupt backup files
      const dirFiles = fs.readdirSync(__dirname);
      for (const f of dirFiles) {
        if (f.startsWith('.test_corrupt_sessions.json.corrupt')) {
          try { fs.unlinkSync(path.join(__dirname, f)); } catch {}
        }
      }
    }

    // 19. Step 4.3 Persistence: Clock anomaly duration clamping & restart recovery
    const testAnomalyFile = path.join(__dirname, '.test_anomaly_sessions.json');
    try {
      const anomalySessions = [
        {
          id: 'crash-recovered-sess',
          ideId: 'vscode',
          ideName: 'Visual Studio Code',
          project: 'my-project',
          startedAt: new Date(Date.now() - 120000).toISOString(),
          durationSeconds: -50, // Negative duration (clock jumped backwards)
          state: 'active', // Process crashed while active
        },
      ];

      fs.writeFileSync(testAnomalyFile, JSON.stringify(anomalySessions));
      const normalized = loadPersistedSessions(testAnomalyFile);

      assert(normalized[0].durationSeconds >= 1, 'Duration is safely clamped to positive integer despite clock anomaly');
      assert(normalized[0].state === 'completed', 'Incomplete active session from crash is reconstructed as completed');
      assert(normalized[0].reconstructed === true, 'Session has reconstructed flag set to true');
    } finally {
      if (fs.existsSync(testAnomalyFile)) fs.unlinkSync(testAnomalyFile);
    }

    // 20. IdeActivityTracker unit logic: deduplication, transitions, and retention
    let mockProcesses = [];
    const mockRunner = (cmd, args, opts, cb) => {
      const ideFilter = args[5].replace('IMAGENAME eq ', '');
      const match = mockProcesses.find((p) => p.exe === ideFilter);
      if (match) {
        cb(null, `"${match.exe}","1001","Console","1","50,000 K","Running","User","0:01","${match.title}"\n`);
      } else {
        cb(null, 'INFO: No tasks are running which match the specified criteria.\n');
      }
    };

    const unitStorageFile = path.join(__dirname, '.test_unit_sessions.json');
    try {
      const unitTracker = new IdeActivityTracker({
        pollIntervalMs: 50,
        maxHistory: 3,
        storageFilePath: unitStorageFile,
        execRunner: mockRunner,
      });

      unitTracker.isTracking = true;

      // First poll: Antigravity IDE with project-alpha
      mockProcesses = [{ exe: 'Antigravity IDE.exe', title: 'project-alpha - Antigravity IDE - main.ts' }];
      await unitTracker.poll();
      assert(
        unitTracker.currentSession?.project === 'project-alpha' && unitTracker.currentSession?.ideId === 'antigravity',
        'Unit tracker starts session for detected IDE and workspace'
      );
      const initialSessionId = unitTracker.currentSession.id;

      // Second poll: Same IDE & project -> Deduplication test
      await unitTracker.poll();
      assert(
        unitTracker.currentSession?.id === initialSessionId,
        'Unit tracker deduplicates consecutive polls on same project without creating duplicate sessions'
      );

      // Third poll: Transition to Visual Studio Code with project-beta
      mockProcesses = [{ exe: 'Code.exe', title: 'index.ts - project-beta - Visual Studio Code' }];
      await unitTracker.poll();
      assert(
        unitTracker.currentSession?.project === 'project-beta' && unitTracker.sessionsHistory.length === 1,
        'Unit tracker transitions cleanly, finalizing old session to history and starting new session'
      );

      // Fourth and fifth transitions to test retention capping (maxHistory = 3)
      mockProcesses = [{ exe: 'Cursor.exe', title: 'test.ts - project-gamma - Cursor' }];
      await unitTracker.poll();
      mockProcesses = [{ exe: 'devenv.exe', title: 'project-delta - Microsoft Visual Studio' }];
      await unitTracker.poll();
      mockProcesses = []; // All closed
      await unitTracker.poll();

      assert(
        unitTracker.sessionsHistory.length === 3,
        'Unit tracker strictly caps session history at maxHistory (bounded memory & file)'
      );

      unitTracker.stop();
    } finally {
      if (fs.existsSync(unitStorageFile)) fs.unlinkSync(unitStorageFile);
    }

    // 21. Unit tests for auth helpers
    assert(extractAuthToken({ headers: { authorization: 'Bearer abc123def' } }) === 'abc123def', 'extractAuthToken parses standard Bearer header');
    assert(extractAuthToken({ headers: { authorization: 'bearer abc123def' } }) === 'abc123def', 'extractAuthToken parses lowercase bearer header');
    assert(extractAuthToken({ headers: { 'x-kuro-companion-token': 'custom-tok' } }) === 'custom-tok', 'extractAuthToken parses X-Kuro-Companion-Token');
    assert(extractAuthToken({ headers: {} }) === null, 'extractAuthToken returns null when header is missing');
    assert(isOriginAllowed(null) === true, 'isOriginAllowed allows null/internal origin');
    assert(isOriginAllowed('http://localhost:5173') === true, 'isOriginAllowed allows localhost:5173');
    assert(isOriginAllowed('http://malicious-site.com') === false, 'isOriginAllowed rejects untrusted origins');
    assert(verifyToken(serverSessionToken, serverSessionToken) === true, 'verifyToken validates identical token');
    assert(verifyToken('wrong-token', serverSessionToken) === false, 'verifyToken rejects wrong token');
    assert(verifyPin('123456', '123456') === true, 'verifyPin validates identical 6-digit PIN');
    assert(verifyPin('654321', '123456') === false, 'verifyPin rejects wrong PIN');
    assert(checkRateLimit('127.0.0.1', 'test-endpoint', 3, 10000) === true, 'checkRateLimit allows within limit');
    assert(checkRateLimit('127.0.0.1', 'test-endpoint', 3, 10000) === true, 'checkRateLimit tracks hit 2');
    assert(checkRateLimit('127.0.0.1', 'test-endpoint', 3, 10000) === true, 'checkRateLimit tracks hit 3');
    assert(checkRateLimit('127.0.0.1', 'test-endpoint', 3, 10000) === false, 'checkRateLimit rejects when limit exceeded');

    // 22. Shutdown security: invalid token returns 401 and DOES NOT terminate server
    const badShutdownRes = await request({
      path: '/api/shutdown',
      method: 'POST',
      headers: { Authorization: 'Bearer bad-token-12345' },
    });
    assert(badShutdownRes.status === 401, 'POST /api/shutdown with bad token returns 401 Unauthorized');

    // Server must still be responsive
    const healthAfterBadShutdown = await request({ path: '/api/health', method: 'GET' });
    assert(healthAfterBadShutdown.status === 200, 'Server remains alive and healthy after rejected shutdown attempt');

    // 23. Shutdown endpoint with valid token
    exitCleanly = true;
    const shutdownRes = await request({
      path: '/api/shutdown',
      method: 'POST',
      headers: { Authorization: `Bearer ${serverSessionToken}` },
    });
    assert(shutdownRes.status === 200, 'POST /api/shutdown with valid token returns 200');

    // Wait for server to exit
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert(serverProc.killed || serverProc.exitCode !== null, 'Companion process terminated cleanly on shutdown');
  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    if (!serverProc.killed && serverProc.exitCode === null) {
      exitCleanly = true;
      serverProc.kill();
    }
  }

  console.log(`\n[Test Summary]: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTestSuite();
