/**
 * Cloud AI Provider Adapter for Kuro.
 *
 * Implements optional hosted inference (Google Gemini / OpenAI compatible)
 * via a secure server-side proxy (/api/cloud/chat, /api/cloud/status).
 *
 * PRIVACY & SECURITY GUARANTEES:
 * 1. Opt-in only: strictly disabled until explicit user consent is granted.
 * 2. Zero browser secrets: API keys are NEVER stored in localStorage, sessionStorage,
 *    cookies, or client-side bundles. They reside exclusively in server process.env.
 * 3. Transparent proxying: prompts leave local boundary only via the server-side proxy
 *    when this provider is explicitly selected.
 * 4. Honest backend reporting: if server environment lacks API keys, provider status
 *    reports "Backend setup required" and inference is disabled.
 * 5. Full streaming & cancellation: supports token streaming via SSE and AbortSignal.
 */

import {
  type AIProvider,
  type AIProviderStatus,
  type AIModelInfo,
  type AIChatStreamParams,
  type AIChatStreamResult,
  AIProviderError,
} from './types.ts';

export type CloudServiceType = 'gemini' | 'openai';

export interface CloudAIConfig {
  serviceType: CloudServiceType;
  userConsent: boolean;
  selectedModel: string;
}

export interface CloudBackendStatus {
  configured: boolean;
  providers: {
    gemini: boolean;
    openai: boolean;
  };
  defaultModel?: string;
}

export const CLOUD_MODELS: readonly AIModelInfo[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Google)',
    isDefault: true,
    details: {
      family: 'gemini',
      parameterSize: 'Flash',
    },
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest (Google)',
    isDefault: false,
    details: {
      family: 'gemini',
      parameterSize: 'Flash',
    },
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini (OpenAI)',
    isDefault: false,
    details: {
      family: 'gpt4',
      parameterSize: 'Mini',
    },
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o (OpenAI)',
    isDefault: false,
    details: {
      family: 'gpt4',
      parameterSize: 'Full',
    },
  },
];

const STORAGE_KEY_CONSENT = 'kuro_cloud_user_consent';
const STORAGE_KEY_SERVICE = 'kuro_cloud_service_type';
const STORAGE_KEY_MODEL = 'kuro_cloud_selected_model';

export function getStoredCloudConfig(): CloudAIConfig {
  let userConsent = false;
  let serviceType: CloudServiceType = 'gemini';
  let selectedModel = 'gemini-3.8-flash';

  try {
    userConsent = localStorage.getItem(STORAGE_KEY_CONSENT) === 'true';
    const storedService = localStorage.getItem(STORAGE_KEY_SERVICE);
    if (storedService === 'gemini' || storedService === 'openai') {
      serviceType = storedService;
    }
    const storedModel = localStorage.getItem(STORAGE_KEY_MODEL);
    if (storedModel && CLOUD_MODELS.some((m) => m.id === storedModel)) {
      selectedModel = storedModel;
    }
  } catch {
    // Storage access unavailable
  }

  return { serviceType, userConsent, selectedModel };
}

export function saveStoredCloudConfig(config: Partial<CloudAIConfig>): void {
  try {
    if (config.userConsent !== undefined) {
      localStorage.setItem(STORAGE_KEY_CONSENT, config.userConsent ? 'true' : 'false');
    }
    if (config.serviceType) {
      localStorage.setItem(STORAGE_KEY_SERVICE, config.serviceType);
    }
    if (config.selectedModel) {
      localStorage.setItem(STORAGE_KEY_MODEL, config.selectedModel);
    }
  } catch {
    // Storage access unavailable
  }
}

export function clearStoredCloudConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_CONSENT);
    localStorage.removeItem(STORAGE_KEY_SERVICE);
    localStorage.removeItem(STORAGE_KEY_MODEL);
  } catch {
    // Storage access unavailable
  }
}

export async function fetchCloudBackendStatus(): Promise<CloudBackendStatus> {
  try {
    const res = await fetch('/api/cloud/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return {
        configured: false,
        providers: { gemini: false, openai: false },
      };
    }

    const data = (await res.json()) as CloudBackendStatus;
    return {
      configured: Boolean(data.configured),
      providers: {
        gemini: Boolean(data.providers?.gemini),
        openai: Boolean(data.providers?.openai),
      },
      defaultModel: data.defaultModel,
    };
  } catch {
    return {
      configured: false,
      providers: { gemini: false, openai: false },
    };
  }
}

export class CloudAIProvider implements AIProvider {
  readonly id = 'hosted_cloud' as const;
  readonly name = 'Optional Cloud AI (Gemini / OpenAI)';
  readonly description = 'Optional hosted cloud inference for complex reasoning. Requires server-side API keys and explicit consent.';
  readonly isImplemented = true;

  readonly capabilities = {
    streaming: true,
    localOffline: false,
    modelDiscovery: true,
    multiTurnContext: true,
  } as const;

  async checkStatus(): Promise<AIProviderStatus> {
    const config = getStoredCloudConfig();

    if (!config.userConsent) {
      return {
        state: 'unsupported',
        models: [...CLOUD_MODELS],
        activeModel: config.selectedModel,
        error: 'Cloud AI is disabled by default. Explicit user consent is required before prompts leave your device.',
        recoveryGuidance: 'Open Cloud AI Settings to review privacy disclosure and enable Cloud AI.',
      };
    }

    // Check server backend status
    const backend = await fetchCloudBackendStatus();

    if (!backend.configured) {
      return {
        state: 'unavailable',
        models: [...CLOUD_MODELS],
        activeModel: config.selectedModel,
        error: 'Backend setup required: GEMINI_API_KEY or OPENAI_API_KEY is not configured in server environment.',
        recoveryGuidance:
          'Set GEMINI_API_KEY or OPENAI_API_KEY in your server environment variables (.env.local on the server) and restart Kuro.',
      };
    }

    return {
      state: 'connected',
      models: [...CLOUD_MODELS],
      activeModel: config.selectedModel,
      error: null,
      recoveryGuidance: null,
    };
  }

  async sendChatStream(params: AIChatStreamParams): Promise<AIChatStreamResult> {
    const { messages, model, signal: callerSignal, timeoutMs = 60000, options, onChunk } = params;
    const config = getStoredCloudConfig();

    if (!config.userConsent) {
      throw new AIProviderError(
        'Cloud AI requires explicit user consent.',
        'unavailable',
        'hosted_cloud',
        'Please review and accept the Cloud AI privacy disclosure before sending messages.'
      );
    }

    const targetModel = model || config.selectedModel || 'gemini-3.8-flash';
    const startTime = Date.now();

    const controller = new AbortController();
    let isTimedOut = false;
    const timer = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, timeoutMs);

    const onCallerAbort = () => {
      controller.abort();
    };

    if (callerSignal) {
      if (callerSignal.aborted) {
        clearTimeout(timer);
        throw new AIProviderError('Cloud AI request cancelled by user.', 'aborted', 'hosted_cloud');
      }
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const res = await fetch('/api/cloud/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: targetModel,
          messages,
          options: {
            temperature: options?.temperature ?? 0.7,
            maxTokens: options?.maxTokens ?? 512,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        let errJson: { error?: string; code?: string } = {};
        try {
          errJson = await res.json();
        } catch {
          // ignore
        }

        const errMsg = errJson.error || res.statusText;

        if (res.status === 503) {
          throw new AIProviderError(
            `Backend setup required: ${errMsg}`,
            'unavailable',
            'hosted_cloud',
            'Please configure GEMINI_API_KEY or OPENAI_API_KEY in your server environment variables.'
          );
        }

        if (res.status === 504) {
          throw new AIProviderError(
            `Cloud provider timed out (${res.status}): ${errMsg}`,
            'timeout',
            'hosted_cloud',
            'The cloud AI service took too long to respond. Please retry or switch to Local Ollama.'
          );
        }

        if (res.status === 401 || res.status === 403) {
          throw new AIProviderError(
            `Cloud API key is invalid or unauthorized (${res.status}): ${errMsg}`,
            'unavailable',
            'hosted_cloud',
            'Verify server environment credentials for GEMINI_API_KEY or OPENAI_API_KEY.'
          );
        }

        if (res.status === 429) {
          throw new AIProviderError(
            `Cloud rate limit or quota exceeded (${res.status}): ${errMsg}`,
            'error',
            'hosted_cloud',
            'Rate limit reached on server cloud account. Switch to Local Ollama or On-Device WebLLM.'
          );
        }

        throw new AIProviderError(
          `Cloud AI request failed (${res.status}): ${errMsg}`,
          'error',
          'hosted_cloud'
        );
      }

      if (!res.body) {
        throw new AIProviderError('No response stream returned from server proxy.', 'invalid_response', 'hosted_cloud');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulated = '';
      let buffer = '';
      let firstTokenTime: number | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            // Skip comments (like SSE keep-alive ": keep-alive")
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed?.delta || '';
              if (delta) {
                if (firstTokenTime === null) {
                  firstTokenTime = Date.now() - startTime;
                }
                accumulated += delta;
                onChunk(delta, accumulated);
              }
            } catch {
              // Ignore incomplete SSE chunk
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return {
        content: accumulated,
        modelUsed: targetModel,
        done: true,
        totalDurationMs: Date.now() - startTime,
        ttftMs: firstTokenTime !== null ? firstTokenTime : undefined,
      };
    } catch (err: unknown) {
      clearTimeout(timer);

      if (err instanceof AIProviderError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        if (isTimedOut) {
          throw new AIProviderError(
            `Cloud AI request timed out after ${timeoutMs}ms. Upstream provider took too long to respond.`,
            'timeout',
            'hosted_cloud',
            'The cloud service timed out. Check network connection or retry.'
          );
        }
        if (callerSignal?.aborted) {
          throw new AIProviderError('Cloud AI request cancelled by user.', 'aborted', 'hosted_cloud');
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      throw new AIProviderError(`Failed to reach Cloud AI server proxy: ${msg}`, 'error', 'hosted_cloud');
    } finally {
      clearTimeout(timer);
      if (callerSignal) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  }
}

export const cloudProvider = new CloudAIProvider();
