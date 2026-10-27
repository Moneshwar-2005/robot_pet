/**
 * React Hook for Kuro Desktop Companion State Management
 *
 * Scope: Phase 4, Step 4.2
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  CompanionConnectionState,
  CompanionHealthResponse,
  CompanionStatusResponse,
  CompanionTrackingStatusResponse,
  CompanionIdeSession,
} from '../lib/companion/types';
import {
  checkCompanionHealth,
  getCompanionStatus,
  pairWithCompanion,
  shutdownCompanion,
  startCompanionTracking,
  stopCompanionTracking,
  getCompanionTrackingStatus,
  getCompanionTrackingSessions,
  clearCompanionTrackingSessions,
  getCompanionBrowserTab,
  getStoredPairingToken,
  clearStoredPairingToken,
  COMPANION_DEFAULT_URL,
} from '../lib/companion/companionClient';

export interface UseDesktopCompanionReturn {
  connectionState: CompanionConnectionState;
  health: CompanionHealthResponse | null;
  status: CompanionStatusResponse | null;
  errorMessage: string | null;
  storedToken: string | null;
  isPairing: boolean;
  refreshStatus: () => Promise<void>;
  pair: (token: string) => Promise<{ success: boolean; message: string }>;
  disconnect: () => void;
  shutdown: () => Promise<void>;

  // Step 4.2 IDE Activity Tracking
  isTracking: boolean;
  trackingStatus: CompanionTrackingStatusResponse | null;
  activeSession: CompanionIdeSession | null;
  recentSessions: CompanionIdeSession[];
  isTrackingBusy: boolean;
  startTracking: () => Promise<boolean>;
  stopTracking: () => Promise<boolean>;
  clearHistory: () => Promise<boolean>;
  refreshTracking: () => Promise<void>;

  // Phase 7.4 Active Browser Tab
  activeBrowserTab: { hostname: string; title: string; timestamp: number } | null;
}

export function useDesktopCompanion(baseUrl = COMPANION_DEFAULT_URL): UseDesktopCompanionReturn {
  const [connectionState, setConnectionState] = useState<CompanionConnectionState>('checking');
  const [health, setHealth] = useState<CompanionHealthResponse | null>(null);
  const [status, setStatus] = useState<CompanionStatusResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storedToken, setStoredToken] = useState<string | null>(getStoredPairingToken());
  const [isPairing, setIsPairing] = useState<boolean>(false);

  // Tracking state
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [trackingStatus, setTrackingStatus] = useState<CompanionTrackingStatusResponse | null>(null);
  const [activeSession, setActiveSession] = useState<CompanionIdeSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<CompanionIdeSession[]>([]);
  const [isTrackingBusy, setIsTrackingBusy] = useState<boolean>(false);
  const [activeBrowserTab, setActiveBrowserTab] = useState<{ hostname: string; title: string; timestamp: number } | null>(null);

  const isMountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshTracking = useCallback(async () => {
    const token = getStoredPairingToken();
    if (!token) return;

    try {
      const [tStatus, sData, bData] = await Promise.all([
        getCompanionTrackingStatus(token, baseUrl),
        getCompanionTrackingSessions(token, baseUrl),
        getCompanionBrowserTab(token, baseUrl).catch(() => ({ status: 'error', tab: null })),
      ]);

      if (!isMountedRef.current) return;
      setTrackingStatus(tStatus);
      setIsTracking(tStatus.isTracking);
      setActiveSession(sData.currentSession || tStatus.activeSession || null);
      setRecentSessions(sData.sessions || []);
      setActiveBrowserTab(bData.tab || null);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;

      const errorMsg = err instanceof Error ? err.message : String(err);

      // Case 1: Unauthorized (companion restarted with a new session token)
      if (errorMsg.includes('401') || errorMsg.includes('UNAUTHORIZED')) {
        clearStoredPairingToken();
        setStoredToken(null);
        setStatus(null);
        setConnectionState('running_unpaired');
        setIsTracking(false);
        setActiveSession(null);
        setErrorMessage('Companion restarted with a new session token. Please enter the new pairing token.');
        return;
      }

      // Case 2: Server stopped or unreachable (failed to fetch, connection refused)
      try {
        await checkCompanionHealth(baseUrl);
      } catch {
        if (!isMountedRef.current) return;
        setConnectionState('not_running');
        setHealth(null);
        setStatus(null);
        setIsTracking(false);
        setActiveSession(null);
        setErrorMessage('Desktop companion service is unreachable or stopped.');
      }
    }
  }, [baseUrl]);

  const refreshStatus = useCallback(async () => {
    setConnectionState('checking');
    setErrorMessage(null);

    try {
      const healthData = await checkCompanionHealth(baseUrl);
      if (!isMountedRef.current) return;
      setHealth(healthData);

      const token = getStoredPairingToken();
      setStoredToken(token);

      if (!token) {
        setConnectionState('running_unpaired');
        setStatus(null);
        setIsTracking(false);
        setActiveSession(null);
        return;
      }

      try {
        const statusData = await getCompanionStatus(token, baseUrl);
        if (!isMountedRef.current) return;
        setStatus(statusData);
        setConnectionState('running_paired');

        if (statusData.tracking) {
          setTrackingStatus(statusData.tracking);
          setIsTracking(statusData.tracking.isTracking);
          setActiveSession(statusData.tracking.activeSession);
        }

        // Fetch recent sessions
        try {
          const sData = await getCompanionTrackingSessions(token, baseUrl);
          if (isMountedRef.current) {
            setRecentSessions(sData.sessions || []);
            if (sData.currentSession) {
              setActiveSession(sData.currentSession);
            }
          }
        } catch {
          // ignore
        }
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        if (err instanceof Error && err.message === 'UNAUTHORIZED') {
          clearStoredPairingToken();
          setStoredToken(null);
          setStatus(null);
          setConnectionState('running_unpaired');
          setIsTracking(false);
          setActiveSession(null);
          setErrorMessage('Companion restarted with a new session token. Please enter the new pairing token.');
        } else {
          setConnectionState('running_unpaired');
        }
      }
    } catch {
      if (!isMountedRef.current) return;
      setConnectionState('not_running');
      setHealth(null);
      setStatus(null);
      setIsTracking(false);
      setActiveSession(null);
    }
  }, [baseUrl]);

  // Initial status check
  useEffect(() => {
    isMountedRef.current = true;
    queueMicrotask(() => {
      if (isMountedRef.current) {
        void refreshStatus();
      }
    });
    return () => {
      isMountedRef.current = false;
    };
  }, [refreshStatus]);

  // Polling effect: only active when connected and tracking is enabled
  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (connectionState === 'running_paired' && isTracking) {
      pollTimerRef.current = setInterval(() => {
        if (isMountedRef.current) {
          void refreshTracking();
        }
      }, 4000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [connectionState, isTracking, refreshTracking]);

  const pair = useCallback(
    async (token: string): Promise<{ success: boolean; message: string }> => {
      setIsPairing(true);
      setErrorMessage(null);
      try {
        const result = await pairWithCompanion(token, baseUrl);
        if (result.success) {
          setStoredToken(token);
          await refreshStatus();
        } else {
          setErrorMessage(result.message);
        }
        return result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to pair with companion.';
        setErrorMessage(msg);
        return { success: false, message: msg };
      } finally {
        if (isMountedRef.current) {
          setIsPairing(false);
        }
      }
    },
    [baseUrl, refreshStatus]
  );

  const disconnect = useCallback(() => {
    clearStoredPairingToken();
    setStoredToken(null);
    setStatus(null);
    setIsTracking(false);
    setActiveSession(null);
    setConnectionState((prev) => (prev === 'running_paired' ? 'running_unpaired' : prev));
  }, []);

  const shutdown = useCallback(async () => {
    const token = getStoredPairingToken();
    if (!token) return;
    try {
      await shutdownCompanion(token, baseUrl);
    } catch {
      // ignore
    } finally {
      clearStoredPairingToken();
      setStoredToken(null);
      setStatus(null);
      setIsTracking(false);
      setActiveSession(null);
      setConnectionState('not_running');
      setHealth(null);
    }
  }, [baseUrl]);

  const startTracking = useCallback(async (): Promise<boolean> => {
    const token = getStoredPairingToken();
    if (!token) return false;

    setIsTrackingBusy(true);
    setErrorMessage(null);
    try {
      const res = await startCompanionTracking(token, baseUrl);
      if (res.success) {
        setIsTracking(true);
        if (res.tracking) {
          setTrackingStatus(res.tracking);
          setActiveSession(res.tracking.activeSession);
        }
        await refreshTracking();
        return true;
      } else {
        setErrorMessage(res.message);
        return false;
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start tracking');
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsTrackingBusy(false);
      }
    }
  }, [baseUrl, refreshTracking]);

  const stopTracking = useCallback(async (): Promise<boolean> => {
    const token = getStoredPairingToken();
    if (!token) return false;

    setIsTrackingBusy(true);
    setErrorMessage(null);
    try {
      const res = await stopCompanionTracking(token, baseUrl);
      if (res.success) {
        setIsTracking(false);
        if (res.tracking) {
          setTrackingStatus(res.tracking);
          setActiveSession(null);
        }
        await refreshTracking();
        return true;
      } else {
        setErrorMessage(res.message);
        return false;
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to stop tracking');
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsTrackingBusy(false);
      }
    }
  }, [baseUrl, refreshTracking]);

  const clearHistory = useCallback(async (): Promise<boolean> => {
    const token = getStoredPairingToken();
    if (!token) return false;

    try {
      const res = await clearCompanionTrackingSessions(token, baseUrl);
      if (res.success) {
        setRecentSessions([]);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [baseUrl]);

  return {
    connectionState,
    health,
    status,
    errorMessage,
    storedToken,
    isPairing,
    refreshStatus,
    pair,
    disconnect,
    shutdown,

    // Step 4.2 IDE Tracking
    isTracking,
    trackingStatus,
    activeSession,
    recentSessions,
    isTrackingBusy,
    startTracking,
    stopTracking,
    clearHistory,
    refreshTracking,

    // Phase 7.4 Active Browser Tab
    activeBrowserTab,
  };
}
