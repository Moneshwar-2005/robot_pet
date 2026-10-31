/**
 * Kuro Desktop Companion Interface Definitions
 *
 * Scope: Phase 4, Step 4.3
 */

export type CompanionConnectionState =
  | 'not_running'
  | 'checking'
  | 'running_unpaired'
  | 'running_paired'
  | 'error';

export interface CompanionCapabilities {
  readonly healthCheck: boolean;
  readonly ideTracking: boolean;
  readonly persistentSessions?: boolean;
  readonly pairingPin?: boolean;
  readonly portFallback?: boolean;
}

export interface CompanionIdeSession {
  readonly id: string;
  readonly ideId: string;
  readonly ideName: string;
  readonly project: string | null;
  readonly startedAt: string;
  readonly lastSeenAt?: string;
  readonly endedAt?: string | null;
  readonly durationSeconds: number;
  readonly state: 'active' | 'completed' | 'idle';
  readonly reconstructed?: boolean;
}

export interface CompanionTrackingStatusResponse {
  readonly status: string;
  readonly isTracking: boolean;
  readonly activeSession: CompanionIdeSession | null;
  readonly supportedIdes: string[];
  readonly pollIntervalMs: number;
  readonly lastPollAt?: string | null;
  readonly sessionCount: number;
}

export interface CompanionTrackingSessionsResponse {
  readonly status: string;
  readonly isTracking: boolean;
  readonly currentSession: CompanionIdeSession | null;
  readonly sessions: CompanionIdeSession[];
}

export interface CompanionHealthResponse {
  readonly status: string;
  readonly service: string;
  readonly version: string;
  readonly platform: string;
  readonly port?: number;
  readonly state: string;
  readonly requiresAuth: boolean;
  readonly capabilities: CompanionCapabilities;
}

export interface CompanionStatusResponse extends CompanionHealthResponse {
  readonly authenticated: boolean;
  readonly sessionStartedAt?: string;
  readonly sessionExpiresAt?: string;
  readonly uptimeSeconds?: number;
  readonly tracking?: CompanionTrackingStatusResponse;
}
