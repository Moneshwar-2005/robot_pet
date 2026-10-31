/**
 * Local Ollama AI Client for Kuro Personal Assistant.
 * Connects exclusively to local Ollama HTTP endpoints (default http://localhost:11434).
 * Never calls cloud AI providers or exposes secrets.
 */

import { getOllamaEnv } from './env.ts';

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

let cachedTagsResult: { result: OllamaCheckResult; timestamp: number; baseUrl: string } | null = null;

/**
 * Clears the 30-second in-memory Ollama model discovery cache.
 */
export function clearOllamaDiscoveryCache(): void {
  cachedTagsResult = null;
}

/**
 * Checks connectivity to local Ollama and discovers available models.
 * Results are cached in-memory for 30 seconds to prevent redundant network round-trips.
 */
export async function checkOllamaConnection(
  customBaseUrl?: string,
  timeoutMs = 5000,
  forceRefresh = false
): Promise<OllamaCheckResult> {
  const baseUrl = customBaseUrl || getActiveOllamaBaseUrl();

  if (!forceRefresh && cachedTagsResult && cachedTagsResult.baseUrl === baseUrl && (Date.now() - cachedTagsResult.timestamp < 30000)) {
    return cachedTagsResult.result;
  }

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
      let errorBody = '';
      try {
        const json = (await res.json()) as { error?: string } | undefined;
        errorBody = typeof json?.error === 'string' ? json.error : JSON.stringify(json);
      } catch {
        errorBody = res.statusText || '';
      }

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        return {
          ok: false,
          state: 'unavailable',
          models: [],
          error: `Ollama daemon is offline or unreachable on ${baseUrl} (${res.status} Bad Gateway).`,
          recoveryGuidance:
            '1. Start the Ollama daemon with `ollama serve` in your terminal or launch the Ollama desktop app.\n' +
            '2. Verify Ollama is listening on http://127.0.0.1:11434.\n' +
            '3. Run `ollama run qwen2.5:3b` to pull a lightweight model.\n' +
            '4. Click "Retry" or switch to On-Device WebLLM / Cloud AI.',
        };
      }

      if (res.status === 404) {
        return {
          ok: false,
          state: 'error',
          models: [],
          error: `Ollama tags endpoint not found (404) at ${endpoint}.`,
          recoveryGuidance: 'Verify that the target URL is an active Ollama instance.',
        };
      }

      return {
        ok: false,
        state: 'error',
        models: [],
        error: `Ollama returned HTTP status ${res.status} (${res.statusText}): ${errorBody}`.trim(),
        recoveryGuidance: 'Check the Ollama service status or restart Ollama.',
      };
    }

    let data: Record<string, unknown> | null = null;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        state: 'error',
        models: [],
        error: 'Malformed response received from Ollama API: invalid JSON format.',
        recoveryGuidance: 'Ensure the endpoint is a genuine Ollama server listening on port 11434.',
      };
    }
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
      const resNoModels: OllamaCheckResult = {
        ok: true,
        state: 'no_models',
        models: [],
        error: 'Ollama is running, but no models are currently installed.',
        recoveryGuidance: 'Run `ollama run llama3:8b` or `ollama pull qwen2.5:3b` in your terminal to install a model.',
      };
      cachedTagsResult = { result: resNoModels, timestamp: Date.now(), baseUrl };
      return resNoModels;
    }

    const resConnected: OllamaCheckResult = {
      ok: true,
      state: 'connected',
      models,
    };
    cachedTagsResult = { result: resConnected, timestamp: Date.now(), baseUrl };
    return resConnected;
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

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new OllamaClientError(
          `Ollama daemon is offline or unreachable (${res.status} ${res.statusText}).`,
          'unavailable',
          'Start Ollama with `ollama serve` in your terminal or switch to On-Device WebLLM / Cloud AI.'
        );
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
        'Verify that Ollama is running (`ollama serve`). If browser CORS is active, configure `OLLAMA_ORIGINS="http://localhost:5173"` or use the Vite proxy.'
      );
    }

    throw new OllamaClientError(
      `Failed to communicate with Ollama: ${errMsg}`,
      'error',
      'Please check Ollama status and try again.'
    );
  }
}

export interface OllamaGenerationOptions {
  num_predict?: number;
  temperature?: number;
  top_p?: number;
}

export interface OllamaChatStreamParams {
  baseUrl?: string;
  model: string;
  messages: OllamaChatMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  options?: OllamaGenerationOptions;
  keepAlive?: string;
  onChunk: (delta: string, fullTextSoFar: string) => void;
}

export interface OllamaChatStreamResult {
  model: string;
  content: string;
  done: boolean;
  totalDuration?: number;
  ttftMs?: number;
  evalCount?: number;
}

/**
 * Streams chat response chunks incrementally from Ollama's /api/chat endpoint.
 * Optimizes TTFT (Time to First Token) and memory retention via keep_alive.
 */
export async function sendOllamaChatStream(params: OllamaChatStreamParams): Promise<OllamaChatStreamResult> {
  const {
    baseUrl: rawBaseUrl,
    model,
    messages,
    signal: callerSignal,
    timeoutMs = 90000,
    options = {
      num_predict: 384,
      temperature: 0.6,
      top_p: 0.9,
    },
    keepAlive = '10m',
    onChunk,
  } = params;

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
        Accept: 'application/x-ndjson, application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options,
        keep_alive: keepAlive,
      }),
      signal,
    });

    if (!res.ok) {
      cleanup();
      let errorBody = '';
      try {
        const json = await res.json();
        errorBody = typeof json?.error === 'string' ? json.error : JSON.stringify(json);
      } catch {
        errorBody = res.statusText;
      }

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new OllamaClientError(
          `Ollama daemon is offline or unreachable (${res.status} ${res.statusText}).`,
          'unavailable',
          'Start Ollama with `ollama serve` in your terminal or switch to On-Device WebLLM / Cloud AI.'
        );
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

    if (!res.body) {
      cleanup();
      throw new OllamaClientError('No readable stream body returned from Ollama.', 'invalid_response');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');

    const streamStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let firstTokenTime: number | null = null;
    let accumulatedContent = '';
    let buffer = '';
    let finalModel = model;
    let totalDuration: number | undefined;
    let evalCount: number | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const textChunk = decoder.decode(value, { stream: true });
        buffer += textChunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);
            if (data.model) finalModel = data.model;
            if (data.total_duration) totalDuration = data.total_duration;
            if (data.eval_count) evalCount = data.eval_count;

            const delta = data.message?.content || '';
            if (delta) {
              if (firstTokenTime === null) {
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                firstTokenTime = now - streamStartTime;
              }
              accumulatedContent += delta;
              onChunk(delta, accumulatedContent);
            }
          } catch {
            // Incomplete or non-JSON chunk ignored defensively
          }
        }
      }

      // Check trailing buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.trim());
          if (data.model) finalModel = data.model;
          if (data.total_duration) totalDuration = data.total_duration;
          if (data.eval_count) evalCount = data.eval_count;

          const delta = data.message?.content || '';
          if (delta) {
            if (firstTokenTime === null) {
              const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
              firstTokenTime = now - streamStartTime;
            }
            accumulatedContent += delta;
            onChunk(delta, accumulatedContent);
          }
        } catch {
          // ignore
        }
      }
    } finally {
      reader.releaseLock();
      cleanup();
    }

    const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - streamStartTime);

    return {
      model: finalModel,
      content: accumulatedContent,
      done: true,
      totalDuration: totalDuration ? Math.round(totalDuration / 1e6) : elapsedMs,
      ttftMs: firstTokenTime !== null ? Math.round(firstTokenTime) : undefined,
      evalCount,
    };
  } catch (err: unknown) {
    cleanup();

    if (err instanceof OllamaClientError) {
      throw err;
    }

    if (err instanceof Error && err.name === 'AbortError') {
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
        'Verify that Ollama is running (`ollama serve`). If browser CORS is active, configure `OLLAMA_ORIGINS="http://localhost:5173"` or use the Vite proxy.'
      );
    }

    throw new OllamaClientError(
      `Failed to communicate with Ollama: ${errMsg}`,
      'error',
      'Please check Ollama status and try again.'
    );
  }
}
