/**
 * Provider-Independent AI Architecture for Kuro.
 *
 * Defines the common contract for AI backends:
 * - Local Ollama on PC (active in Step 3.4)
 * - On-Device Mobile AI (planned future provider)
 * - Optional Hosted Cloud AI (planned future provider)
 */

export type AIProviderId = 'ollama' | 'on_device_mobile' | 'hosted_cloud';

export type AIConnectionState =
  | 'idle'
  | 'checking'
  | 'connected'
  | 'no_models'
  | 'unavailable'
  | 'cors_blocked'
  | 'timeout'
  | 'error'
  | 'unsupported';

export interface AIProviderCapabilities {
  readonly streaming: boolean;
  readonly localOffline: boolean;
  readonly modelDiscovery: boolean;
  readonly multiTurnContext: boolean;
}

export interface AIModelInfo {
  readonly id: string;
  readonly name: string;
  readonly size?: number;
  readonly digest?: string;
  readonly details?: {
    format?: string;
    family?: string;
    parameterSize?: string;
    quantizationLevel?: string;
  };
  readonly isDefault?: boolean;
}

export interface AIProviderStatus {
  readonly state: AIConnectionState;
  readonly models: AIModelInfo[];
  readonly activeModel: string;
  readonly error?: string | null;
  readonly recoveryGuidance?: string | null;
}

export type AIChatRole = 'system' | 'user' | 'assistant';

export interface AIChatMessage {
  readonly role: AIChatRole;
  readonly content: string;
}

export interface AIChatGenerationOptions {
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
}

export interface AIChatStreamParams {
  readonly messages: AIChatMessage[];
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly options?: AIChatGenerationOptions;
  readonly onChunk: (delta: string, accumulated: string) => void;
}

export interface AIChatStreamResult {
  readonly content: string;
  readonly modelUsed: string;
  readonly done: boolean;
  readonly totalDurationMs?: number;
  readonly evalCount?: number;
}

export type AIProviderErrorCode =
  | 'unavailable'
  | 'timeout'
  | 'aborted'
  | 'invalid_response'
  | 'cors_blocked'
  | 'unsupported'
  | 'error';

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly recoveryGuidance?: string;
  readonly providerId: AIProviderId;

  constructor(
    message: string,
    code: AIProviderErrorCode = 'error',
    providerId: AIProviderId = 'ollama',
    recoveryGuidance?: string
  ) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.providerId = providerId;
    this.recoveryGuidance = recoveryGuidance;
  }
}

export interface AIInitProgress {
  readonly progress: number; // 0 to 1
  readonly text: string;
  readonly timeElapsed?: number;
}

/**
 * Granular lifecycle states for on-device mobile AI runtimes.
 */
export type WebLLMLifecycleState =
  | 'not_initialized'
  | 'checking_compatibility'
  | 'downloading_initializing'
  | 'ready'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'unsupported';

/**
 * Common contract that every AI provider must implement.
 */
export interface AIProvider {
  readonly id: AIProviderId;
  readonly name: string;
  readonly description: string;
  readonly isImplemented: boolean;
  readonly capabilities: AIProviderCapabilities;

  /**
   * Probes the provider availability and returns its connection state and available models.
   */
  checkStatus(): Promise<AIProviderStatus>;

  /**
   * Streams a chat completion response incrementally.
   */
  sendChatStream(params: AIChatStreamParams): Promise<AIChatStreamResult>;

  /**
   * Optional lifecycle methods and states for client-side WebLLM on-device runtimes
   */
  readonly isModelLoaded?: boolean;
  readonly isInitializing?: boolean;
  readonly initProgress?: AIInitProgress | null;
  readonly lifecycleState?: WebLLMLifecycleState;
  readonly isCached?: boolean;
  initializeModel?(modelId?: string, onProgress?: (p: AIInitProgress) => void): Promise<void>;
  cancelInitialization?(): void;
  unload?(): Promise<void>;
  checkModelCache?(modelId: string): Promise<boolean>;
  deleteCachedModel?(modelId: string): Promise<void>;
}

