/**
 * Kuro Desktop Companion HTTP Client
 *
 * Scope: Phase 4, Step 4.2
 *
 * Communicates exclusively with the local loopback companion service on 127.0.0.1:48199.
 * Handles timeouts, pairing authentication, IDE activity tracking, and error recovery safely.
 */

import type {
  CompanionHealthResponse,
  CompanionStatusResponse,
  CompanionTrackingStatusResponse,
  CompanionTrackingSessionsResponse,
} from './types';

export const COMPANION_DEFAULT_PORT = 48199;
export const COMPANION_DEFAULT_URL = `http://127.0.0.1:${COMPANION_DEFAULT_PORT}`;
const TOKEN_STORAGE_KEY = 'kuro_companion_session_token';
const TIMEOUT_MS = 3000;

function createTimeoutSignal(timeoutMs = TIMEOUT_MS): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export function getStoredPairingToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredPairingToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  } catch {
    // ignore local storage errors
  }
}

export function clearStoredPairingToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Checks if the desktop companion service is running and returns basic health info.
 */
export async function checkCompanionHealth(
  baseUrl = COMPANION_DEFAULT_URL
): Promise<CompanionHealthResponse> {
  const res = await fetch(`${baseUrl}/api/health`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal: createTimeoutSignal(),
  });

  if (!res.ok) {
    throw new Error(`Companion responded with status ${res.status}`);
  }

  return (await res.json()) as CompanionHealthResponse;
}

/**
 * Validates session token and returns detailed status with uptime.
 */
export async function getCompanionStatus(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<CompanionStatusResponse> {
  const res = await fetch(`${baseUrl}/api/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    signal: createTimeoutSignal(),
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(`Companion error HTTP ${res.status}`);
  }

  return (await res.json()) as CompanionStatusResponse;
}

/**
 * Pairs the web client with the companion using the provided session pairing token.
 */
export async function pairWithCompanion(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${baseUrl}/api/pair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token: token.trim() }),
    signal: createTimeoutSignal(),
  });

  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
    error?: string;
  };

  if (!res.ok) {
    return {
      success: false,
      message: data.error || 'Pairing token rejected by companion service.',
    };
  }

  setStoredPairingToken(token);
  return {
    success: true,
    message: data.message || 'Successfully paired with Desktop Companion.',
  };
}

/**
 * Sends a clean shutdown signal to the desktop companion.
 */
export async function shutdownCompanion(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${baseUrl}/api/shutdown`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    signal: createTimeoutSignal(),
  });

  if (!res.ok) {
    throw new Error(`Shutdown failed with HTTP ${res.status}`);
  }

  clearStoredPairingToken();
  return {
    success: true,
    message: 'Companion shutdown command acknowledged.',
  };
}

/**
 * Starts privacy-respecting IDE activity tracking.
 */
export async function startCompanionTracking(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<{ success: boolean; message: string; tracking?: CompanionTrackingStatusResponse }> {
  const res = await fetch(`${baseUrl}/api/tracking/start`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    signal: createTimeoutSignal(),
  });

  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
    error?: string;
    tracking?: CompanionTrackingStatusResponse;
  };

  if (!res.ok) {
    return {
      success: false,
      message: data.error || `Failed to start tracking (HTTP ${res.status})`,
    };
  }

  return {
    success: true,
    message: data.message || 'IDE tracking started.',
    tracking: data.tracking,
  };
}

/**
 * Stops privacy-respecting IDE activity tracking immediately.
 */
export async function stopCompanionTracking(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<{ success: boolean; message: string; tracking?: CompanionTrackingStatusResponse }> {
  const res = await fetch(`${baseUrl}/api/tracking/stop`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    signal: createTimeoutSignal(),
  });

  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
    error?: string;
    tracking?: CompanionTrackingStatusResponse;
  };

  if (!res.ok) {
    return {
      success: false,
      message: data.error || `Failed to stop tracking (HTTP ${res.status})`,
    };
  }

  return {
    success: true,
    message: data.message || 'IDE tracking stopped.',
    tracking: data.tracking,
  };
}

/**
 * Fetches current IDE tracking status.
 */
export async function getCompanionTrackingStatus(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<CompanionTrackingStatusResponse> {
  const res = await fetch(`${baseUrl}/api/tracking/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    signal: createTimeoutSignal(),
  });

  if (!res.ok) {
    throw new Error(`Failed to get tracking status (HTTP ${res.status})`);
  }

  return (await res.json()) as CompanionTrackingStatusResponse;
}

/**
 * Fetches completed activity session history and current session.
 */
export async function getCompanionTrackingSessions(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<CompanionTrackingSessionsResponse> {
  const res = await fetch(`${baseUrl}/api/tracking/sessions`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    signal: createTimeoutSignal(),
  });

  if (!res.ok) {
    throw new Error(`Failed to get tracking sessions (HTTP ${res.status})`);
  }

  return (await res.json()) as CompanionTrackingSessionsResponse;
}

/**
 * Clears locally stored companion activity sessions.
 */
export async function clearCompanionTrackingSessions(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${baseUrl}/api/tracking/clear`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    signal: createTimeoutSignal(),
  });

  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
    error?: string;
  };

  if (!res.ok) {
    return {
      success: false,
      message: data.error || `Failed to clear history (HTTP ${res.status})`,
    };
  }

  return {
    success: true,
    message: data.message || 'Activity session history cleared.',
  };
}

export interface CompanionBrowserTabResponse {
  status: string;
  tab: {
    hostname: string;
    title: string;
    timestamp: number;
  } | null;
}

/**
 * Fetches the active browser tab reported to the companion service.
 */
export async function getCompanionBrowserTab(
  token: string,
  baseUrl = COMPANION_DEFAULT_URL
): Promise<CompanionBrowserTabResponse> {
  const res = await fetch(`${baseUrl}/api/browser/tab`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    signal: createTimeoutSignal(),
  });

  if (!res.ok) {
    return { status: 'error', tab: null };
  }

  return (await res.json()) as CompanionBrowserTabResponse;
}
