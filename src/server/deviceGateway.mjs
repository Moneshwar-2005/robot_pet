/**
 * Kuro Robot Companion — Device Gateway & Pairing Service
 *
 * Provides a dedicated, secure server-side gateway to communicate with physical
 * or simulated Kuro ESP32-S3 robot companions on the local trusted network:
 *
 * SECURITY & CREDENTIAL BOUNDARY GUARANTEES:
 * 1. Zero-trust isolation: No Supabase keys, cloud AI API keys, or companion tokens
 *    are ever passed to or accessible by the device gateway or firmware.
 * 2. Ephemeral Pairing: Requires explicit user pairing via short-lived 6-digit PIN.
 *    Generates cryptographically random 24-hour session tokens. No hardcoded shared secrets.
 * 3. Schema & Enum Validation: Inbound commands are strictly validated against Protocol v1.0.
 * 4. Bounded Queues & Safe Timeouts: Prevents memory leaks and hung sockets.
 * 5. Heartbeat & Loss Detection: Automatically flags disconnected robots when heartbeat > 15s.
 * 6. Dual-Mode Transport: Immediate HTTP push to device IP with fallback to bounded long-polling queue.
 */

import crypto from 'node:crypto';

// Protocol & Timing Constants
export const PROTOCOL_VERSION = '1.0';
export const HEARTBEAT_TIMEOUT_MS = 15_000;   // 15 seconds: marks connection as stale/lost
export const PIN_EXPIRY_MS = 5 * 60_000;       // 5 minutes: pairing challenge validity
export const SESSION_EXPIRY_MS = 24 * 3600_000;// 24 hours: active paired session validity
export const MAX_QUEUE_SIZE = 16;              // Max bounded pending commands

// In-memory state store
const activePairingChallenges = new Map(); // pin -> { pin, expiresAt, requestedAt }
const activeDeviceSessions = new Map();     // token -> { token, deviceId, deviceIp, deviceName, createdAt, expiresAt }
let currentDeviceTelemetry = null;
let lastHeartbeatTimestamp = 0;
const commandQueue = [];
const executedCommandAcks = new Map();      // reqId -> { reqId, status, timestamp }

// Whitelist of valid commands & enums (Protocol v1.0)
export const ALLOWED_MOODS = new Set([
  'idle', 'attentive', 'focused', 'curious', 'thinking', 'happy', 'excited',
  'sleepy', 'playful', 'caring', 'surprised', 'confused', 'worried', 'proud',
  'listening', 'speaking', 'error'
]);

export const ALLOWED_PALETTES = new Set(['cyan', 'emerald', 'amber', 'violet']);
export const ALLOWED_EYE_SHAPES = new Set(['curved', 'round', 'pixel']);

export function resetDeviceGatewayState() {
  activePairingChallenges.clear();
  activeDeviceSessions.clear();
  currentDeviceTelemetry = null;
  lastHeartbeatTimestamp = 0;
  commandQueue.length = 0;
  executedCommandAcks.clear();
}

/**
 * Generate a secure 6-digit pairing PIN challenge
 */
export function createPairingChallenge() {
  // Clean expired challenges
  const now = Date.now();
  for (const [pin, challenge] of activePairingChallenges.entries()) {
    if (now > challenge.expiresAt) {
      activePairingChallenges.delete(pin);
    }
  }

  // Generate random 6-digit numeric PIN
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const challenge = {
    pin,
    proto: PROTOCOL_VERSION,
    requestedAt: now,
    expiresAt: now + PIN_EXPIRY_MS,
  };
  activePairingChallenges.set(pin, challenge);

  return {
    success: true,
    pin,
    proto: PROTOCOL_VERSION,
    expiresAt: challenge.expiresAt,
    expiresInSec: Math.floor(PIN_EXPIRY_MS / 1000),
  };
}

/**
 * Confirm pairing with PIN and generate authenticated session token
 */
export function confirmPairing(pin, deviceInfo = {}) {
  const now = Date.now();
  const challenge = activePairingChallenges.get(String(pin));

  if (!challenge) {
    return {
      success: false,
      code: 'INVALID_PIN',
      error: 'Invalid or non-existent pairing PIN.',
    };
  }

  if (now > challenge.expiresAt) {
    activePairingChallenges.delete(String(pin));
    return {
      success: false,
      code: 'EXPIRED_PIN',
      error: 'Pairing PIN has expired. Request a new PIN.',
    };
  }

  // Consume PIN (one-time use)
  activePairingChallenges.delete(String(pin));

  // Generate secure 48-char hex session token
  const sessionToken = crypto.randomBytes(24).toString('hex');
  const session = {
    token: sessionToken,
    proto: PROTOCOL_VERSION,
    deviceId: deviceInfo.deviceId || 'kuro-esp32s3-robot',
    deviceIp: deviceInfo.deviceIp || '127.0.0.1',
    deviceName: deviceInfo.deviceName || 'Kuro Desktop Companion',
    isSimulated: Boolean(deviceInfo.isSimulated || deviceInfo.deviceIp === '127.0.0.1' || !deviceInfo.deviceIp),
    createdAt: now,
    expiresAt: now + SESSION_EXPIRY_MS,
  };

  activeDeviceSessions.set(sessionToken, session);

  // Initialize baseline virtual telemetry if simulated; physical hardware awaits real telemetry
  if (session.isSimulated) {
    if (!currentDeviceTelemetry) {
      currentDeviceTelemetry = {
        proto: PROTOCOL_VERSION,
        version: '0.1.0',
        uptime: 0,
        wifiState: 'connected',
        ip: session.deviceIp,
        rssi: -55,
        freeHeap: 256000,
        freePsram: 8192000,
        mood: 'attentive',
        isSpeaking: false,
        displayOk: true,
      };
    }
    lastHeartbeatTimestamp = now;
  } else {
    currentDeviceTelemetry = null;
    lastHeartbeatTimestamp = 0;
  }

  return {
    success: true,
    paired: true,
    sessionToken,
    proto: PROTOCOL_VERSION,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    isSimulated: session.isSimulated,
    expiresAt: session.expiresAt,
  };
}

/**
 * Validate active session token
 */
export function validateDeviceSession(token) {
  if (!token) return null;
  const session = activeDeviceSessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    activeDeviceSessions.delete(token);
    return null;
  }
  return session;
}

/**
 * Unpair device session
 */
export function unpairDevice(token) {
  if (!token) return { success: false, error: 'Token required.' };
  const existed = activeDeviceSessions.delete(token);
  if (activeDeviceSessions.size === 0) {
    commandQueue.length = 0;
    currentDeviceTelemetry = null;
    lastHeartbeatTimestamp = 0;
  }
  return { success: true, unpaired: existed };
}

/**
 * Record inbound telemetry from the physical or simulated robot
 */
export function recordDeviceTelemetry(telemetry) {
  if (!telemetry || typeof telemetry !== 'object') {
    return { success: false, error: 'Invalid telemetry object.' };
  }

  const now = Date.now();
  currentDeviceTelemetry = {
    proto: telemetry.proto || PROTOCOL_VERSION,
    version: telemetry.version || '0.1.0',
    uptime: Number(telemetry.uptime) || 0,
    wifiState: telemetry.wifiState || 'connected',
    ip: telemetry.ip || '127.0.0.1',
    rssi: Number(telemetry.rssi) || -60,
    freeHeap: Number(telemetry.freeHeap) || 0,
    freePsram: Number(telemetry.freePsram) || 0,
    mood: telemetry.mood || 'attentive',
    isSpeaking: Boolean(telemetry.isSpeaking),
    displayOk: Boolean(telemetry.displayOk),
    lastReportedAt: now,
  };
  lastHeartbeatTimestamp = now;

  return { success: true, recordedAt: now };
}

/**
 * Query current device status and heartbeat health
 */
export function getDeviceStatus() {
  const now = Date.now();
  const hasActiveSession = activeDeviceSessions.size > 0;
  const timeSinceHeartbeat = now - lastHeartbeatTimestamp;

  const isConnected = hasActiveSession && lastHeartbeatTimestamp > 0 && timeSinceHeartbeat <= HEARTBEAT_TIMEOUT_MS;
  const isStale = hasActiveSession && lastHeartbeatTimestamp > 0 && timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS && timeSinceHeartbeat <= 60_000;
  const isAwaiting = hasActiveSession && lastHeartbeatTimestamp === 0;

  // Retrieve active session details
  let activeSession = null;
  for (const s of activeDeviceSessions.values()) {
    if (now <= s.expiresAt) {
      activeSession = s;
      break;
    }
  }

  return {
    proto: PROTOCOL_VERSION,
    paired: hasActiveSession,
    connected: isConnected,
    isSimulated: activeSession ? Boolean(activeSession.isSimulated) : false,
    connectionState: isConnected
      ? 'online'
      : (isStale ? 'heartbeat_stale' : (isAwaiting ? 'awaiting_device' : (hasActiveSession ? 'disconnected' : 'unpaired'))),
    lastHeartbeatSecAgo: lastHeartbeatTimestamp > 0 ? Math.floor(timeSinceHeartbeat / 1000) : null,
    pendingCommandsCount: commandQueue.length,
    device: activeSession ? {
      deviceId: activeSession.deviceId,
      deviceName: activeSession.deviceName,
      deviceIp: activeSession.deviceIp,
      isSimulated: activeSession.isSimulated,
      telemetry: currentDeviceTelemetry,
    } : null,
  };
}

/**
 * Device-side Polling: Pull pending commands and report telemetry
 */
export function pullPendingCommands(token, telemetry = null) {
  const session = validateDeviceSession(token);
  if (!session) {
    return {
      success: false,
      status: 401,
      code: 'UNAUTHORIZED',
      error: 'Invalid or expired device session token.',
    };
  }

  if (telemetry && typeof telemetry === 'object') {
    recordDeviceTelemetry(telemetry);
  } else {
    lastHeartbeatTimestamp = Date.now();
  }

  // Drain pending commands from queue
  const commandsToDispatch = commandQueue.splice(0, 4);

  return {
    success: true,
    status: 200,
    proto: PROTOCOL_VERSION,
    timestamp: Date.now(),
    commands: commandsToDispatch,
  };
}

/**
 * Record command execution acknowledgment from the robot
 */
export function recordCommandAck(token, ackData = {}) {
  const session = validateDeviceSession(token);
  if (!session) {
    return { success: false, status: 401, error: 'Unauthorized.' };
  }

  const { reqId, cmd, status = 'ok' } = ackData;
  if (!reqId) {
    return { success: false, status: 400, error: "Missing 'reqId' in acknowledgment." };
  }

  executedCommandAcks.set(reqId, {
    reqId,
    cmd,
    status,
    timestamp: Date.now(),
  });

  lastHeartbeatTimestamp = Date.now();
  return { success: true, proto: PROTOCOL_VERSION, acked: reqId };
}

/**
 * Validate and execute/enqueue a robot command (Protocol v1.0)
 */
export async function dispatchDeviceCommand(rawCommand, token) {
  // 1. Session verification
  const session = validateDeviceSession(token);
  if (!session) {
    return {
      success: false,
      code: 'UNAUTHORIZED',
      status: 401,
      error: 'Unauthorized. Valid device pairing session token required.',
    };
  }

  // 2. Payload validation
  if (!rawCommand || typeof rawCommand !== 'object') {
    return {
      success: false,
      code: 'INVALID_PAYLOAD',
      status: 400,
      error: 'Command must be a valid JSON object.',
    };
  }

  const { cmd, reqId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}` } = rawCommand;

  if (!cmd || typeof cmd !== 'string') {
    return {
      success: false,
      code: 'MISSING_CMD',
      status: 400,
      reqId,
      error: "Missing required 'cmd' field.",
    };
  }

  // 3. Command schema validation against Protocol v1.0
  switch (cmd) {
    case 'set_mood': {
      const { mood, palette } = rawCommand;
      if (!mood || typeof mood !== 'string') {
        return { success: false, code: 'MISSING_PARAM', status: 400, reqId, error: "Missing 'mood' parameter." };
      }
      if (!ALLOWED_MOODS.has(mood)) {
        return { success: false, code: 'INVALID_MOOD', status: 400, reqId, error: `Mood '${mood}' is not recognized.` };
      }
      if (palette && !ALLOWED_PALETTES.has(palette)) {
        return { success: false, code: 'INVALID_PALETTE', status: 400, reqId, error: `Invalid palette '${palette}'.` };
      }

      // Update local telemetry
      if (currentDeviceTelemetry) {
        currentDeviceTelemetry.mood = mood;
      }
      break;
    }

    case 'speak': {
      const { speech, durationMs } = rawCommand;
      if (!speech || typeof speech !== 'string' || speech.trim().length === 0) {
        return { success: false, code: 'MISSING_PARAM', status: 400, reqId, error: "Missing 'speech' text parameter." };
      }
      if (speech.length > 200) {
        return { success: false, code: 'PAYLOAD_TOO_LARGE', status: 400, reqId, error: 'Speech text exceeds 200 characters.' };
      }
      if (durationMs !== undefined && (typeof durationMs !== 'number' || durationMs < 2200 || durationMs > 10000)) {
        return { success: false, code: 'INVALID_PARAM', status: 400, reqId, error: 'durationMs must be between 2200 and 10000.' };
      }

      if (currentDeviceTelemetry) {
        currentDeviceTelemetry.isSpeaking = true;
      }
      break;
    }

    case 'set_palette': {
      const { palette } = rawCommand;
      if (!palette || !ALLOWED_PALETTES.has(palette)) {
        return { success: false, code: 'INVALID_PALETTE', status: 400, reqId, error: 'Palette must be cyan, emerald, amber, or violet.' };
      }
      break;
    }

    case 'set_eye_shape': {
      const { shape } = rawCommand;
      if (!shape || !ALLOWED_EYE_SHAPES.has(shape)) {
        return { success: false, code: 'INVALID_SHAPE', status: 400, reqId, error: 'Shape must be curved, round, or pixel.' };
      }
      break;
    }

    case 'ping': {
      lastHeartbeatTimestamp = Date.now();
      return {
        success: true,
        status: 200,
        reqId,
        proto: PROTOCOL_VERSION,
        type: 'pong',
        ts: rawCommand.ts || Date.now(),
        version: currentDeviceTelemetry?.version || '0.1.0',
      };
    }

    case 'get_status': {
      return {
        success: true,
        status: 200,
        reqId,
        proto: PROTOCOL_VERSION,
        type: 'telemetry',
        telemetry: currentDeviceTelemetry,
      };
    }

    default:
      return {
        success: false,
        code: 'UNKNOWN_CMD',
        status: 400,
        reqId,
        error: `Command '${cmd}' is not supported.`,
      };
  }

  // 4. Transport Dispatch: Attempt direct push if device has external IP, otherwise enqueue
  let deliveredDirectly = false;
  const targetIp = session.deviceIp;

  if (targetIp && targetIp !== '127.0.0.1' && targetIp !== 'localhost' && !session.isSimulated) {
    try {
      const pushUrl = `http://${targetIp}:80/api/command`;
      const pushRes = await fetch(pushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ ...rawCommand, reqId, proto: PROTOCOL_VERSION }),
        signal: AbortSignal.timeout(1500), // Bounded 1.5s timeout
      });

      if (pushRes.ok) {
        deliveredDirectly = true;
      }
    } catch {
      // Network drop, device in sleep, or behind NAT -> fallback to queue
      deliveredDirectly = false;
    }
  }

  if (!deliveredDirectly) {
    // Bounded queue management
    if (commandQueue.length >= MAX_QUEUE_SIZE) {
      commandQueue.shift(); // Evict oldest
    }
    commandQueue.push({ ...rawCommand, reqId, proto: PROTOCOL_VERSION, enqueuedAt: Date.now() });
  }

  // Reset heartbeat only on actual device delivery or simulated loopback
  if (session.isSimulated || deliveredDirectly) {
    lastHeartbeatTimestamp = Date.now();
  }

  return {
    success: true,
    status: 200,
    type: 'ack',
    proto: PROTOCOL_VERSION,
    cmd,
    reqId,
    deliveredDirectly,
    queuedForPoll: !deliveredDirectly,
    isSimulated: Boolean(session.isSimulated),
  };
}
