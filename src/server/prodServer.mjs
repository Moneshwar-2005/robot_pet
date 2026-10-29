/**
 * Kuro Production Server Runtime
 *
 * Provides a dedicated, secure HTTP server for production deployments of Kuro:
 * 1. Serves production static client assets from `dist/` with security headers and caching.
 * 2. Implements SPA fallback routing to `dist/index.html`.
 * 3. Mounts Cloud AI endpoints (/api/cloud/status, /api/cloud/chat) with:
 *    - Process-only API keys (zero exposure to client).
 *    - Strict HTTP method validation.
 *    - Per-IP rate limiting.
 *    - Payload size bounding (2MB).
 *    - Request schema validation (model whitelist, message formatting).
 *    - Fast SSE streaming with keep-alive and disconnect cancellation.
 * 4. Proxies Local Ollama (/api/ollama/*) strictly to local loopback (127.0.0.1:11434),
 *    preventing public exposure of local LLM daemons.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPairingChallenge,
  confirmPairing,
  unpairDevice,
  getDeviceStatus,
  dispatchDeviceCommand,
  recordDeviceTelemetry,
  pullPendingCommands,
  recordCommandAck,
  resetDeviceGatewayState,
} from './deviceGateway.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DIST_DIR = path.resolve(PROJECT_ROOT, 'dist');

// Load environment variables from .env and .env.local if not already set
function loadEnvFile(filepath) {
  try {
    if (!fs.existsSync(filepath)) return;
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eqIdx = line.indexOf('=');
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore
  }
}

loadEnvFile(path.join(PROJECT_ROOT, '.env'));
loadEnvFile(path.join(PROJECT_ROOT, '.env.local'));

export const ALLOWED_CLOUD_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gpt-4o-mini',
  'gpt-4o',
];

// Sliding-window rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

export function resetRateLimitMap() {
  rateLimitMap.clear();
}

export function checkRateLimit(ip) {
  const now = Date.now();
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

export function normalizeOllamaTarget(raw) {
  if (!raw || !raw.trim()) return 'http://127.0.0.1:11434';
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  return `http://${trimmed}`.replace(/\/+$/, '');
}

// Security headers applied to all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

export function handleCloudStatus(req, res) {
  if (req.method && req.method !== 'GET') {
    res.writeHead(405, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
      Allow: 'GET',
    });
    res.end(JSON.stringify({ error: 'Method Not Allowed. Use GET.', code: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim() || '';
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || '';
  const configured = Boolean(geminiKey || openaiKey);

  const response = {
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
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  res.end(JSON.stringify(response));
}

export async function handleCloudChat(req, res) {
  if (req.method && req.method !== 'POST') {
    res.writeHead(405, {
      ...SECURITY_HEADERS,
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
      ...SECURITY_HEADERS,
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
      res.writeHead(413, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ error: 'Payload too large (max 2MB).' }));
      return;
    }
  }

  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ error: 'Invalid JSON request body.' }));
    return;
  }

  const requestedModel = body.model || 'gemini-3.8-flash';
  if (!ALLOWED_CLOUD_MODELS.includes(requestedModel)) {
    res.writeHead(400, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
    });
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

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    res.writeHead(400, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
    });
    res.end(
      JSON.stringify({
        error: 'Invalid request: "messages" must be a non-empty array.',
        code: 'INVALID_MESSAGES',
      })
    );
    return;
  }

  if (body.messages.length > 50) {
    res.writeHead(400, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
    });
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
      res.writeHead(400, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          error: 'Invalid message item. Each message must include a valid role (user, assistant, model, system).',
          code: 'INVALID_MESSAGE_ROLE',
        })
      );
      return;
    }
    if (typeof m.content !== 'string' || m.content.length > 65536) {
      res.writeHead(400, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
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
      res.writeHead(503, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
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
      res.writeHead(503, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
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

async function proxyGeminiStream(params) {
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

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const systemInstruction = messages.find((m) => m.role === 'system')?.content;
  const conversationMessages = messages.filter((m) => m.role !== 'system');

  const contents = conversationMessages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const payload = {
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
        const errJson = await upstreamRes.json();
        errText = errJson?.error?.message || JSON.stringify(errJson);
      } catch {
        errText = upstreamRes.statusText;
      }

      res.writeHead(upstreamRes.status, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          error: `Google Gemini API error (${upstreamRes.status}): ${errText}`,
          statusCode: upstreamRes.status,
        })
      );
      return;
    }

    if (!upstreamRes.body) {
      res.writeHead(502, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ error: 'No response body received from Gemini API.' }));
      return;
    }

    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
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
          const candidates = parsed?.candidates;
          if (Array.isArray(candidates) && candidates.length > 0) {
            const parts = candidates[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (typeof part?.text === 'string' && part.text) {
                  res.write(`data: ${JSON.stringify({ delta: part.text })}\n\n`);
                  if (typeof res.flush === 'function') {
                    res.flush();
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
  } catch (err) {
    if (timedOut) {
      if (!res.headersSent) {
        res.writeHead(504, {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/json',
        });
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
      res.writeHead(502, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
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

async function proxyOpenAIStream(params) {
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
        const errJson = await upstreamRes.json();
        errText = errJson?.error?.message || JSON.stringify(errJson);
      } catch {
        errText = upstreamRes.statusText;
      }

      res.writeHead(upstreamRes.status, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          error: `OpenAI API error (${upstreamRes.status}): ${errText}`,
          statusCode: upstreamRes.status,
        })
      );
      return;
    }

    if (!upstreamRes.body) {
      res.writeHead(502, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ error: 'No response body received from OpenAI API.' }));
      return;
    }

    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
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
            if (typeof res.flush === 'function') {
              res.flush();
            }
          }
        } catch {
          // ignore partial json
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (timedOut) {
      if (!res.headersSent) {
        res.writeHead(504, {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/json',
        });
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
      res.writeHead(502, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
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

// Reverse proxy for Local Ollama
async function handleOllamaProxy(req, res) {
  const ollamaTarget = normalizeOllamaTarget(
    process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST
  );
  const targetSubpath = req.url.replace(/^\/api\/ollama/, '') || '/';
  const targetUrl = new URL(targetSubpath, ollamaTarget);

  try {
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;

    let bodyBuffer = null;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      bodyBuffer = Buffer.concat(chunks);
    }

    const upstreamRes = await fetch(targetUrl.href, {
      method: req.method,
      headers: headers,
      body: bodyBuffer,
    });

    const responseHeaders = {
      ...SECURITY_HEADERS,
    };
    for (const [k, v] of upstreamRes.headers.entries()) {
      if (k.toLowerCase() !== 'content-security-policy' && k.toLowerCase() !== 'transfer-encoding') {
        responseHeaders[k] = v;
      }
    }

    res.writeHead(upstreamRes.status, responseHeaders);

    if (upstreamRes.body) {
      const reader = upstreamRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch {
    if (!res.headersSent) {
      res.writeHead(502, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          error: `Ollama daemon is offline or unreachable on ${ollamaTarget} (502 Bad Gateway)`,
          code: 'ECONNREFUSED',
          recovery: 'Start Ollama with `ollama serve` or launch the Ollama desktop app.',
        })
      );
    } else {
      res.end();
    }
  }
}

// Static file server with SPA routing
function serveStaticFile(req, res) {
  let reqPath = req.url.split('?')[0];
  try {
    reqPath = decodeURIComponent(reqPath);
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  let filePath = path.join(DIST_DIR, reqPath === '/' ? 'index.html' : reqPath);
  filePath = path.normalize(filePath);

  // Traversal prevention
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Check if file exists; if not and path does not look like static asset, fallback to index.html (SPA)
  let stats;
  try {
    stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stats = fs.statSync(filePath);
    }
  } catch {
    // If request has file extension, it's a real missing static file
    const ext = path.extname(reqPath);
    if (ext && ext !== '.html') {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    // Fallback to SPA index.html
    filePath = path.join(DIST_DIR, 'index.html');
    try {
      stats = fs.statSync(filePath);
    } catch {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
      res.end('Client build not found. Run `npm run build` before starting production server.');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  let cacheControl = 'public, max-age=3600';
  if (reqPath.startsWith('/assets/')) {
    cacheControl = 'public, max-age=31536000, immutable';
  } else if (reqPath === '/' || reqPath === '/index.html' || reqPath === '/sw.js' || reqPath === '/manifest.json') {
    cacheControl = 'no-cache';
  }

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Content-Length': stats.size,
    'Cache-Control': cacheControl,
  });

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

// Helper to extract bearer or header token
function extractDeviceToken(req, body = {}) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const customHeader = req.headers['x-device-token'];
  if (customHeader) {
    return String(customHeader).trim();
  }
  return body.token || null;
}

// Bounded JSON body reader for device endpoints (<64KB)
async function readDeviceJsonBody(req, res) {
  let bodyStr = '';
  for await (const chunk of req) {
    bodyStr += chunk;
    if (bodyStr.length > 64 * 1024) {
      res.writeHead(413, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload exceeds maximum limit of 64 KB.', code: 'PAYLOAD_TOO_LARGE' }));
      return null;
    }
  }
  if (!bodyStr.trim()) return {};
  try {
    return JSON.parse(bodyStr);
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Malformed JSON payload.', code: 'INVALID_JSON' }));
    return null;
  }
}

// Handler for all Device Gateway endpoints
async function handleDeviceRoute(req, res, url) {
  // 1. GET /api/device/status
  if (url === '/api/device/status') {
    if (req.method !== 'GET') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Allow: 'GET' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use GET.', code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const status = getDeviceStatus();
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // 2. POST /api/device/pair/request
  if (url === '/api/device/pair/request') {
    if (req.method !== 'POST') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const challenge = createPairingChallenge();
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(challenge));
    return;
  }

  // 3. POST /api/device/pair/confirm
  if (url === '/api/device/pair/confirm') {
    if (req.method !== 'POST') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const body = await readDeviceJsonBody(req, res);
    if (!body) return;
    if (!body.pin) {
      res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Missing required 'pin' parameter.", code: 'MISSING_PIN' }));
      return;
    }
    const result = confirmPairing(body.pin, body);
    res.writeHead(result.success ? 200 : 400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 4. POST /api/device/unpair
  if (url === '/api/device/unpair') {
    if (req.method !== 'POST') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const body = await readDeviceJsonBody(req, res);
    if (!body) return;
    const token = extractDeviceToken(req, body);
    const result = unpairDevice(token);
    res.writeHead(result.success ? 200 : 400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 5. POST /api/device/command
  if (url === '/api/device/command') {
    if (req.method !== 'POST') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const body = await readDeviceJsonBody(req, res);
    if (!body) return;
    const token = extractDeviceToken(req, body);
    const result = await dispatchDeviceCommand(body, token);
    res.writeHead(result.status || (result.success ? 200 : 400), { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 6. POST /api/device/telemetry
  if (url === '/api/device/telemetry') {
    if (req.method !== 'POST') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const body = await readDeviceJsonBody(req, res);
    if (!body) return;
    const result = recordDeviceTelemetry(body);
    res.writeHead(result.success ? 200 : 400, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 7. POST /api/device/poll (ESP32 Poll & Telemetry reporting)
  if (url === '/api/device/poll') {
    if (req.method !== 'POST') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const body = await readDeviceJsonBody(req, res);
    if (!body) return;
    const token = extractDeviceToken(req, body);
    const result = pullPendingCommands(token, body.telemetry);
    res.writeHead(result.status || (result.success ? 200 : 401), { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 8. POST /api/device/command/ack (ESP32 Command execution ACK)
  if (url === '/api/device/command/ack') {
    if (req.method !== 'POST') {
      res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const body = await readDeviceJsonBody(req, res);
    if (!body) return;
    const token = extractDeviceToken(req, body);
    const result = recordCommandAck(token, body);
    res.writeHead(result.status || (result.success ? 200 : 401), { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Unknown device endpoint
  res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Device endpoint not found.', code: 'NOT_FOUND' }));
}

export { resetDeviceGatewayState };

export function createProdServer() {
  return http.createServer((req, res) => {
    const url = req.url?.split('?')[0] || '';

    // Route: Cloud AI Status
    if (url === '/api/cloud/status') {
      handleCloudStatus(req, res);
      return;
    }

    // Route: Cloud AI Chat
    if (url === '/api/cloud/chat') {
      void handleCloudChat(req, res);
      return;
    }

    // Route: Local Ollama Proxy
    if (url.startsWith('/api/ollama')) {
      void handleOllamaProxy(req, res);
      return;
    }

    // Route: Hardware Robot Device Gateway
    if (url.startsWith('/api/device/')) {
      void handleDeviceRoute(req, res, url);
      return;
    }

    // Unmatched API routes return 404 JSON
    if (url.startsWith('/api/')) {
      res.writeHead(404, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ error: 'API endpoint not found', code: 'NOT_FOUND' }));
      return;
    }

    // Static Client Assets & SPA Fallback
    serveStaticFile(req, res);
  });
}

// Direct CLI invocation
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = process.env.HOST || '127.0.0.1';

  const server = createProdServer();
  server.listen(PORT, HOST, () => {
    console.log('==============================================================');
    console.log(`KURO PRODUCTION SERVER STARTED`);
    console.log('==============================================================');
    console.log(`Address:     http://${HOST}:${PORT}`);
    console.log(`Static Dir:  ${DIST_DIR}`);
    console.log(`Security:    Strict loopback / private runtime, rate limits, validated proxy`);
    console.log(`Cloud AI:    ${process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY ? 'Configured' : 'Unconfigured (Backend setup required)'}`);
    console.log(`Local Ollama: Target -> ${normalizeOllamaTarget(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST)}`);
    console.log('==============================================================');
  });
}
