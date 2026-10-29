/**
 * Kuro Robot Companion — Device Gateway Client Service
 *
 * Provides typed client-side methods for communicating with the Kuro Server-Side Device Gateway
 * and paired physical or simulated ESP32-S3 robot companions.
 *
 * Guarantees:
 * - Ephemeral session tokens stored only in browser localStorage (never logged or exposed in URLs).
 * - Request ID (reqId) generation for end-to-end command tracking.
 * - Strict protocol v1.0 alignment.
 */

export interface DeviceTelemetry {
  proto: string;
  version: string;
  uptime: number;
  wifiState: 'connected' | 'connecting' | 'failed' | 'disconnected';
  ip: string;
  rssi: number;
  freeHeap: number;
  freePsram: number;
  mood: string;
  isSpeaking: boolean;
  displayOk: boolean;
  lastReportedAt?: number;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  isSimulated?: boolean;
  telemetry?: DeviceTelemetry | null;
}

export interface DeviceStatusResponse {
  proto: string;
  paired: boolean;
  connected: boolean;
  isSimulated?: boolean;
  connectionState: 'online' | 'heartbeat_stale' | 'awaiting_device' | 'disconnected' | 'unpaired';
  lastHeartbeatSecAgo: number | null;
  pendingCommandsCount?: number;
  device: DeviceInfo | null;
}

export interface PairingChallengeResponse {
  success: boolean;
  pin: string;
  proto: string;
  expiresAt: number;
  expiresInSec: number;
}

export interface PairingConfirmResponse {
  success: boolean;
  paired?: boolean;
  sessionToken?: string;
  proto?: string;
  deviceId?: string;
  deviceName?: string;
  isSimulated?: boolean;
  expiresAt?: number;
  error?: string;
  code?: string;
}

export interface DeviceCommandPayload {
  cmd: 'set_mood' | 'speak' | 'set_palette' | 'set_eye_shape' | 'ping' | 'get_status';
  mood?: string;
  palette?: string;
  shape?: string;
  speech?: string;
  durationMs?: number;
  ts?: number;
  reqId?: string;
}

export interface DeviceCommandResponse {
  success: boolean;
  status?: number;
  type?: 'ack' | 'pong' | 'telemetry' | 'error';
  proto?: string;
  cmd?: string;
  reqId?: string;
  deliveredDirectly?: boolean;
  queuedForPoll?: boolean;
  isSimulated?: boolean;
  error?: string;
  code?: string;
  telemetry?: DeviceTelemetry | null;
}

const STORAGE_KEY_TOKEN = 'kuro_device_session_token';
const STORAGE_KEY_DEVICE_ID = 'kuro_device_id';

export function getStoredDeviceToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_TOKEN);
  } catch {
    return null;
  }
}

export function setStoredDeviceToken(token: string, deviceId?: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_TOKEN, token);
    if (deviceId) {
      localStorage.setItem(STORAGE_KEY_DEVICE_ID, deviceId);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function clearStoredDeviceToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_DEVICE_ID);
  } catch {
    // Ignore
  }
}

/**
 * Fetch current device connection & pairing status
 */
export async function fetchDeviceStatus(): Promise<DeviceStatusResponse> {
  const token = getStoredDeviceToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('/api/device/status', {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch device status: HTTP ${res.status}`);
  }

  return (await res.json()) as DeviceStatusResponse;
}

/**
 * Request a 6-digit pairing PIN challenge
 */
export async function requestPairingPin(): Promise<PairingChallengeResponse> {
  const res = await fetch('/api/device/pair/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Failed to generate pairing PIN: HTTP ${res.status}`);
  }

  return (await res.json()) as PairingChallengeResponse;
}

/**
 * Confirm pairing with PIN and receive authenticated session token
 */
export async function confirmDevicePairing(
  pin: string,
  deviceInfo: { deviceId?: string; deviceIp?: string; deviceName?: string; isSimulated?: boolean } = {}
): Promise<PairingConfirmResponse> {
  const res = await fetch('/api/device/pair/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pin: pin.trim(),
      deviceId: deviceInfo.deviceId || 'kuro-robot-1',
      deviceIp: deviceInfo.deviceIp || '127.0.0.1',
      deviceName: deviceInfo.deviceName || 'Kuro Desktop Companion',
      isSimulated: deviceInfo.isSimulated,
    }),
  });

  const data = (await res.json()) as PairingConfirmResponse;

  if (res.ok && data.success && data.sessionToken) {
    setStoredDeviceToken(data.sessionToken, data.deviceId);
  }

  return data;
}

/**
 * Unpair active device session
 */
export async function unpairDevice(): Promise<boolean> {
  const token = getStoredDeviceToken();
  if (!token) {
    clearStoredDeviceToken();
    return true;
  }

  try {
    const res = await fetch('/api/device/unpair', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    clearStoredDeviceToken();
    return res.ok;
  } catch {
    clearStoredDeviceToken();
    return false;
  }
}

/**
 * Dispatch an authenticated command to the robot companion
 */
export async function sendDeviceCommand(command: DeviceCommandPayload): Promise<DeviceCommandResponse> {
  const token = getStoredDeviceToken();
  if (!token) {
    return {
      success: false,
      status: 401,
      code: 'UNAUTHORIZED',
      error: 'Device is not paired. Please pair your robot first.',
    };
  }

  const reqId = command.reqId || `web-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  try {
    const res = await fetch('/api/device/command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...command,
        reqId,
        proto: '1.0',
      }),
    });

    const data = (await res.json()) as DeviceCommandResponse;
    return {
      ...data,
      status: res.status,
    };
  } catch (err) {
    return {
      success: false,
      status: 502,
      code: 'NETWORK_ERROR',
      error: err instanceof Error ? err.message : 'Network communication error',
      reqId,
    };
  }
}

