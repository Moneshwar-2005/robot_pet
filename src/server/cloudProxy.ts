/**
 * Server-Side Cloud AI Proxy Middleware for Kuro.
 *
 * Implements a secure backend proxy for optional hosted inference (Google Gemini / OpenAI).
 *
 * PRIVACY & SECURITY GUARANTEES:
 * 1. Zero secrets in browser: GEMINI_API_KEY and OPENAI_API_KEY exist exclusively in server process.env.
 * 2. Status transparency: /api/cloud/status reports boolean availability without ever exposing secret values.
 * 3. Enforced gatekeeping: /api/cloud/chat returns 503 "Backend setup required" if server keys are missing.
 * 4. Cancellation propagation: Client disconnect cancels upstream AI provider fetch immediately without leaking controllers.
 * 5. Bounded requests: Maximum payload size (2MB) and 55s upstream timeout enforced.
 * 6. Streaming responsiveness: Flushes headers immediately with ': keep-alive' to eliminate TTFT delays.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface CloudStatusResponse {
  configured: boolean;
  providers: {
    gemini: boolean;
    openai: boolean;
  };
  defaultModel: string;
  models: Array<{
    id: string;
    name: string;
    provider: 'gemini' | 'openai';
    available: boolean;
  }>;
}

export const ALLOWED_CLOUD_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gpt-4o-mini',
  'gpt-4o',
] as const;

export type AllowedCloudModel = (typeof ALLOWED_CLOUD_MODELS)[number];

// Sliding-window rate limiter for production security
interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 requests per minute

export function resetRateLimitMap(): void {
  rateLimitMap.clear();
}

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();

  // Periodic garbage collection if map grows large
  if (rateLimitMap.size > 1000) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (now > val.resetAt) {
        rateLimitMap.delete(key);
      }
    }
  }

  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1, retryAfterSec: 0 };
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  record.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - record.count, retryAfterSec: 0 };
}

/**
 * Normalizes an Ollama base URL or host string into a standard HTTP URL.
 * Handles trailing slashes, missing schemes, and falls back to default 127.0.0.1:11434.
 */
export function normalizeOllamaTarget(raw?: string): string {
  if (!raw || !raw.trim()) return 'http://127.0.0.1:11434';
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  return `http://${trimmed}`.replace(/\/+$/, '');
}

export function handleCloudStatus(req: IncomingMessage, res: ServerResponse): void {
  if (req.method && req.method !== 'GET') {
    res.writeHead(405, {
      'Content-Type': 'application/json',
      Allow: 'GET',
    });
    res.end(JSON.stringify({ error: 'Method Not Allowed. Use GET.', code: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim() || '';
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || '';
  const configured = Boolean(geminiKey || openaiKey);

  const response: CloudStatusResponse = {
    configured,
    providers: {
      gemini: Boolean(geminiKey),
      openai: Boolean(openaiKey),
    },
    defaultModel: geminiKey ? 'gemini-3.8-flash' : 'gpt-4o-mini',
    models: [
      {
        id: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash (Google)',
        provider: 'gemini',
        available: Boolean(geminiKey),
      },
      {
        id: 'gemini-flash-latest',
        name: 'Gemini Flash Latest (Google)',
        provider: 'gemini',
        available: Boolean(geminiKey),
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini (OpenAI)',
        provider: 'openai',
        available: Boolean(openaiKey),
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o (OpenAI)',
        provider: 'openai',
        available: Boolean(openaiKey),
      },
    ],
  };

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  res.end(JSON.stringify(response));
}

export async function handleCloudChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.writeHead(405, {
      'Content-Type': 'application/json',
      Allow: 'POST',
    });
    res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  // Rate Limiting Enforcement
  const rawForwarded = req.headers ? req.headers['x-forwarded-for'] : undefined;
  const clientIp =
    (Array.isArray(rawForwarded) ? rawForwarded[0] : rawForwarded)?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    '127.0.0.1';

  const rateCheck = checkRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateCheck.retryAfterSec),
    });
    res.end(
      JSON.stringify({
        error: `Rate limit exceeded. Maximum ${MAX_REQUESTS_PER_WINDOW} requests per minute.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterSec: rateCheck.retryAfterSec,
      })
    );
    return;
  }

  // Read request body with 2MB bound
  let bodyStr = '';
  for await (const chunk of req) {
    bodyStr += chunk;
    if (bodyStr.length > 2 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large (max 2MB).' }));
      return;
    }
  }

  interface ChatRequestBody {
    model?: string;
    messages?: Array<{ role: string; content: string }>;
    options?: {
      temperature?: number;
      maxTokens?: number;
    };
  }

  let body: ChatRequestBody;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON request body.' }));
    return;
  }

  // Model Validation
  const requestedModel = body.model || 'gemini-3.8-flash';
  if (!ALLOWED_CLOUD_MODELS.includes(requestedModel as AllowedCloudModel)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Invalid or unsupported model "${requestedModel}". Supported models: ${ALLOWED_CLOUD_MODELS.join(
          ', '
        )}`,
        code: 'INVALID_MODEL',
      })
    );
    return;
  }

  // Messages Validation
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Invalid request: "messages" must be a non-empty array.',
        code: 'INVALID_MESSAGES',
      })
    );
    return;
  }

  if (body.messages.length > 50) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Request exceeds maximum history size of 50 messages.',
        code: 'PAYLOAD_TOO_LARGE',
      })
    );
    return;
  }

  const validRoles = new Set(['user', 'assistant', 'model', 'system']);
  for (const m of body.messages) {
    if (!m || typeof m !== 'object' || typeof m.role !== 'string' || !validRoles.has(m.role)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Invalid message item. Each message must include a valid role (user, assistant, model, system).',
          code: 'INVALID_MESSAGE_ROLE',
        })
      );
      return;
    }
    if (typeof m.content !== 'string' || m.content.length > 65536) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Message content must be a string under 64KB.',
          code: 'INVALID_MESSAGE_CONTENT',
        })
      );
      return;
    }
  }

  const model = requestedModel;
  const messages = body.messages;
  const rawTemp = body.options?.temperature;
  const temperature =
    typeof rawTemp === 'number' && !Number.isNaN(rawTemp)
      ? Math.min(2.0, Math.max(0.0, rawTemp))
      : 0.7;

  const rawMaxTokens = body.options?.maxTokens;
  const maxTokens =
    typeof rawMaxTokens === 'number' && !Number.isNaN(rawMaxTokens)
      ? Math.min(4096, Math.max(1, Math.round(rawMaxTokens)))
      : 512;

  const isGemini = model.startsWith('gemini');
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || '';
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || '';

  if (isGemini) {
    if (!geminiKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error:
            'Backend setup required: GEMINI_API_KEY is not configured in server environment. For security, API keys must be set on the server.',
          code: 'BACKEND_SETUP_REQUIRED',
        })
      );
      return;
    }

    await proxyGeminiStream({
      res,
      req,
      apiKey: geminiKey,
      model,
      messages,
      temperature,
      maxTokens,
    });
  } else {
    if (!openaiKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error:
            'Backend setup required: OPENAI_API_KEY is not configured in server environment. For security, API keys must be set on the server.',
          code: 'BACKEND_SETUP_REQUIRED',
        })
      );
      return;
    }

    await proxyOpenAIStream({
      res,
      req,
      apiKey: openaiKey,
      model,
      messages,
      temperature,
      maxTokens,
    });
  }
}

async function proxyGeminiStream(params: {
  res: ServerResponse;
  req: IncomingMessage;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  maxTokens: number;
}): Promise<void> {
  const { res, apiKey, model, messages, temperature, maxTokens } = params;

  const controller = new AbortController();
  let timedOut = false;

  // Upstream server timeout: 55 seconds
  const upstreamTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 55000);

  // Client cancellation: only abort if client drops before response completes
  const onClientClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  if (typeof res.on === 'function') {
    res.on('close', onClientClose);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const systemInstruction = messages.find((m) => m.role === 'system')?.content;
  const conversationMessages = messages.filter((m) => m.role !== 'system');

  const contents = conversationMessages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: Math.max(maxTokens, 1024),
    },
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  try {
    const upstreamRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!upstreamRes.ok) {
      let errText = '';
      try {
        const errJson = (await upstreamRes.json()) as { error?: { message?: string } } | undefined;
        errText = errJson?.error?.message || JSON.stringify(errJson);
      } catch {
        errText = upstreamRes.statusText;
      }

      res.writeHead(upstreamRes.status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: `Google Gemini API error (${upstreamRes.status}): ${errText}`,
          statusCode: upstreamRes.status,
        })
      );
      return;
    }

    if (!upstreamRes.body) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No response body received from Gemini API.' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as { flushHeaders: () => void }).flushHeaders();
    }
    // Immediate keep-alive comment to guarantee rapid initial connection
    res.write(': keep-alive\n\n');

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const candidates = parsed?.candidates;
          if (Array.isArray(candidates) && candidates.length > 0) {
            const parts = candidates[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (typeof part?.text === 'string' && part.text) {
                  res.write(`data: ${JSON.stringify({ delta: part.text })}\n\n`);
                  if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
                    (res as unknown as { flush: () => void }).flush();
                  }
                }
              }
            }
          }
        } catch {
          // ignore partial json
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: unknown) {
    if (timedOut) {
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cloud AI request timed out after 55s.', code: 'GATEWAY_TIMEOUT' }));
      } else {
        res.end();
      }
      return;
    }

    if (controller.signal.aborted) {
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Gemini proxy error: ${msg}` }));
    } else {
      res.end();
    }
  } finally {
    clearTimeout(upstreamTimer);
    if (typeof res.off === 'function') {
      res.off('close', onClientClose);
    } else if (typeof res.removeListener === 'function') {
      res.removeListener('close', onClientClose);
    }
  }
}

async function proxyOpenAIStream(params: {
  res: ServerResponse;
  req: IncomingMessage;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  maxTokens: number;
}): Promise<void> {
  const { res, apiKey, model, messages, temperature, maxTokens } = params;

  const controller = new AbortController();
  let timedOut = false;

  const upstreamTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 55000);

  const onClientClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  if (typeof res.on === 'function') {
    res.on('close', onClientClose);
  }

  const endpoint = 'https://api.openai.com/v1/chat/completions';

  try {
    const upstreamRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!upstreamRes.ok) {
      let errText = '';
      try {
        const errJson = (await upstreamRes.json()) as { error?: { message?: string } } | undefined;
        errText = errJson?.error?.message || JSON.stringify(errJson);
      } catch {
        errText = upstreamRes.statusText;
      }

      res.writeHead(upstreamRes.status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: `OpenAI API error (${upstreamRes.status}): ${errText}`,
          statusCode: upstreamRes.status,
        })
      );
      return;
    }

    if (!upstreamRes.body) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No response body received from OpenAI API.' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as { flushHeaders: () => void }).flushHeaders();
    }
    res.write(': keep-alive\n\n');

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed?.choices?.[0]?.delta?.content || '';
          if (delta) {
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
            if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
              (res as unknown as { flush: () => void }).flush();
            }
          }
        } catch {
          // ignore partial json
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: unknown) {
    if (timedOut) {
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cloud AI request timed out after 55s.', code: 'GATEWAY_TIMEOUT' }));
      } else {
        res.end();
      }
      return;
    }

    if (controller.signal.aborted) {
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `OpenAI proxy error: ${msg}` }));
    } else {
      res.end();
    }
  } finally {
    clearTimeout(upstreamTimer);
    if (typeof res.off === 'function') {
      res.off('close', onClientClose);
    } else if (typeof res.removeListener === 'function') {
      res.removeListener('close', onClientClose);
    }
  }
}

export function kuroCloudProxyPlugin(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0];

    if (url === '/api/cloud/status') {
      handleCloudStatus(req, res);
      return;
    }

    if (url === '/api/cloud/chat') {
      void handleCloudChat(req, res);
      return;
    }

    next();
  };

  return {
    name: 'kuro-cloud-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
