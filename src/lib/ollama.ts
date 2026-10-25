/**
 * Local Ollama AI Client for Kuro Personal Assistant.
 * Connects exclusively to local Ollama HTTP endpoints (default http://localhost:11434).
 * Never calls cloud AI providers or exposes secrets.
 */

import { getOllamaEnv } from './env';

export type OllamaRole = 'system' | 'user' | 'assistant';

export interface OllamaChatMessage {
  role: OllamaRole;
  content: string;
}

export interface OllamaModelDetails {
  format?: string;
  family?: string;
  parameterSize?: string;
  quantizationLevel?: string;
}

export interface OllamaModel {
  name: string;
  size?: number;
  modifiedAt?: string;
  digest?: string;
  details?: OllamaModelDetails;
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaChatMessage;
  done: boolean;
  totalDuration?: number;
  evalCount?: number;
}

export type OllamaConnectionState =
  | 'idle'
  | 'checking'
  | 'connected'
  | 'unavailable'
  | 'no_models'
  | 'cors_blocked'
  | 'timeout'
  | 'error';

export interface OllamaCheckResult {
  ok: boolean;
  state: OllamaConnectionState;
  models: OllamaModel[];
  error?: string;
  recoveryGuidance?: string;
}

export class OllamaClientError extends Error {
  code: OllamaConnectionState | 'aborted' | 'invalid_response';
  recoveryGuidance?: string;

  constructor(
    message: string,
    code: OllamaConnectionState | 'aborted' | 'invalid_response',
    recoveryGuidance?: string
  ) {
    super(message);
    this.name = 'OllamaClientError';
    this.code = code;
    this.recoveryGuidance = recoveryGuidance;
  }
}

/**
 * Normalizes and verifies the target base URL.
 */
export function getActiveOllamaBaseUrl(): string {
  const env = getOllamaEnv();
  return env.baseUrl;
}

/**
 * Builds request timeout signal combined with optional caller abort signal.
 */
function createTimeoutSignal(timeoutMs: number, callerSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Ollama request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  let callerAbortHandler: (() => void) | undefined;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerAbortHandler = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', callerAbortHandler, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (callerSignal && callerAbortHandler) {
      callerSignal.removeEventListener('abort', callerAbortHandler);
    }
  };

  return { signal: controller.signal, cleanup };
}

/**
 * Checks connectivity to local Ollama and discovers available models.
 */
export async function checkOllamaConnection(
  customBaseUrl?: string,
  timeoutMs = 5000
): Promise<OllamaCheckResult> {
  const baseUrl = customBaseUrl || getActiveOllamaBaseUrl();
  const endpoint = `${baseUrl}/api/tags`;
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal,
    });

    cleanup();

    if (!res.ok) {
      return {
        ok: false,
        state: 'error',
        models: [],
        error: `Ollama returned HTTP status ${res.status} (${res.statusText})`,
        recoveryGuidance: 'Check the Ollama service status or restart Ollama.',
      };
    }

    const data = await res.json();
    const rawModels: unknown[] = Array.isArray(data?.models) ? data.models : [];

    const models: OllamaModel[] = rawModels
      .map((item: unknown): OllamaModel | null => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const name = typeof obj.name === 'string' ? obj.name : (typeof obj.model === 'string' ? obj.model : '');
        if (!name) return null;

        const detailsObj = obj.details && typeof obj.details === 'object' ? (obj.details as Record<string, unknown>) : undefined;

        return {
          name,
          size: typeof obj.size === 'number' ? obj.size : undefined,
          modifiedAt: typeof obj.modified_at === 'string' ? obj.modified_at : undefined,
          digest: typeof obj.digest === 'string' ? obj.digest : undefined,
          details: detailsObj
            ? {
                format: typeof detailsObj.format === 'string' ? detailsObj.format : undefined,
                family: typeof detailsObj.family === 'string' ? detailsObj.family : undefined,
                parameterSize: typeof detailsObj.parameter_size === 'string' ? detailsObj.parameter_size : undefined,
                quantizationLevel: typeof detailsObj.quantization_level === 'string' ? detailsObj.quantization_level : undefined,
              }
            : undefined,
        };
      })
      .filter((m): m is OllamaModel => m !== null);

    if (models.length === 0) {
      return {
        ok: true,
        state: 'no_models',
        models: [],
        error: 'Ollama is running, but no models are currently installed.',
        recoveryGuidance: 'Run `ollama run llama3:8b` or `ollama pull qwen2.5:3b` in your terminal to install a model.',
      };
    }

    return {
      ok: true,
      state: 'connected',
      models,
    };
  } catch (err: unknown) {
    cleanup();

    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        state: 'timeout',
        models: [],
        error: `Connection timed out after ${timeoutMs}ms.`,
        recoveryGuidance: 'Ensure Ollama is running and responsive on port 11434.',
      };
    }

    // Network / CORS failure
    const errMsg = err instanceof Error ? err.message : String(err);
    const isNetworkOrCors = errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError');

    if (isNetworkOrCors) {
      return {
        ok: false,
        state: 'unavailable',
        models: [],
        error: 'Unable to reach local Ollama on ' + baseUrl,
        recoveryGuidance:
          '1. Ensure Ollama is installed and running (`ollama serve`).\n' +
          '2. If running but blocked by browser CORS, set `OLLAMA_ORIGINS="*"` and restart Ollama.\n' +
          '3. Alternatively, set VITE_OLLAMA_BASE_URL=/api/ollama in .env.local to use the Vite proxy.',
      };
    }

    return {
      ok: false,
      state: 'error',
      models: [],
      error: errMsg || 'Failed to connect to Ollama',
      recoveryGuidance: 'Check your Ollama installation and ensure the service is running.',
    };
  }
}

/**
 * Sends a chat completion request to Ollama's /api/chat endpoint.
 */
export async function sendOllamaChat(params: {
  baseUrl?: string;
  model: string;
  messages: OllamaChatMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<OllamaChatResponse> {
  const { baseUrl: rawBaseUrl, model, messages, signal: callerSignal, timeoutMs = 60000 } = params;

  if (!model.trim()) {
    throw new OllamaClientError('No Ollama model selected.', 'error', 'Select a model from the model list.');
  }

  if (messages.length === 0) {
    throw new OllamaClientError('Message list cannot be empty.', 'error', 'Please enter a message to send.');
  }

  const baseUrl = rawBaseUrl || getActiveOllamaBaseUrl();
  const endpoint = `${baseUrl}/api/chat`;
  const { signal, cleanup } = createTimeoutSignal(timeoutMs, callerSignal);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
      signal,
    });

    cleanup();

    if (!res.ok) {
      let errorBody = '';
      try {
        const json = await res.json();
        errorBody = typeof json?.error === 'string' ? json.error : JSON.stringify(json);
      } catch {
        errorBody = res.statusText;
      }

      if (res.status === 404) {
        throw new OllamaClientError(
          `Model "${model}" not found in Ollama.`,
          'unavailable',
          `Run \`ollama pull ${model}\` in your terminal to install it.`
        );
      }

      throw new OllamaClientError(
        `Ollama returned error ${res.status}: ${errorBody}`,
        'error',
        'Check Ollama logs or try another installed model.'
      );
    }

    const data = await res.json();

    if (!data || typeof data !== 'object') {
      throw new OllamaClientError('Invalid response received from Ollama.', 'invalid_response');
    }

    const message = data.message;
    if (!message || typeof message !== 'object' || typeof message.content !== 'string') {
      throw new OllamaClientError('Malformed chat message payload received from Ollama.', 'invalid_response');
    }

    const role: OllamaRole = message.role === 'user' || message.role === 'system' ? message.role : 'assistant';

    return {
      model: typeof data.model === 'string' ? data.model : model,
      message: {
        role,
        content: message.content,
      },
      done: Boolean(data.done),
      totalDuration: typeof data.total_duration === 'number' ? data.total_duration : undefined,
      evalCount: typeof data.eval_count === 'number' ? data.eval_count : undefined,
    };
  } catch (err: unknown) {
    cleanup();

    if (err instanceof OllamaClientError) {
      throw err;
    }

    if (err instanceof Error && err.name === 'AbortError') {
      // Check if user manually aborted vs timed out
      if (callerSignal?.aborted) {
        throw new OllamaClientError('Chat generation was cancelled by user.', 'aborted');
      }
      throw new OllamaClientError(
        `Ollama request timed out after ${timeoutMs}ms.`,
        'timeout',
        'The model may be compiling or loading into VRAM. Try again or choose a smaller model.'
      );
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    const isNetworkOrCors = errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError');

    if (isNetworkOrCors) {
      throw new OllamaClientError(
        'Unable to connect to Ollama on ' + baseUrl,
        'unavailable',
        'Verify that Ollama is running (`ollama serve`). If browser CORS is active, configure `OLLAMA_ORIGINS="*"` or use the Vite proxy.'
      );
    }

    throw new OllamaClientError(
      `Failed to communicate with Ollama: ${errMsg}`,
      'error',
      'Please check Ollama status and try again.'
    );
  }
}
