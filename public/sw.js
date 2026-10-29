/**
 * Kuro Service Worker — Offline Application Shell & Static Asset Caching
 *
 * PRIVACY & SECURITY RULES:
 * 1. NEVER cache Ollama AI endpoints (/api/ollama, :11434, /api/chat, /api/tags, etc.)
 * 2. NEVER cache Supabase authentication or REST API endpoints (*.supabase.co, /auth/v1, /rest/v1)
 * 3. NEVER cache private user data, conversation content, AI prompts, or AI completions
 * 4. NEVER cache non-GET requests (POST, PUT, PATCH, DELETE)
 * 5. NEVER cache development-only HMR or Vite dev server endpoints
 */

const CACHE_NAME = 'kuro-app-shell-v1';

// Versioned core static application shell assets
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Domains and URL patterns strictly excluded from service worker caching
const NEVER_CACHE_PATTERNS = [
  /\/api\/ollama/i,
  /\/api\/cloud/i,
  /:11434/i,
  /supabase\.co/i,
  /\/auth\/v1/i,
  /\/rest\/v1/i,
  /\/@vite/i,
  /\/@react-refresh/i,
  /__vite_ping/i,
  /chrome-extension:/i,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        // Pre-cache static shell assets safely
        return cache.addAll(PRECACHE_ASSETS).catch((err) => {
          console.warn('[Kuro SW] Precaching error (some assets may be created at build time):', err);
        });
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name.startsWith('kuro-'))
            .map((name) => {
              console.log('[Kuro SW] Removing outdated cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Allow application to signal skipWaiting when safe (e.g., user confirms or no active chat)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Rule 1: Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Rule 2: Strictly bypass Ollama, Supabase, Auth, and Dev endpoints
  const isExcluded = NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(request.url));
  if (isExcluded) {
    return;
  }

  // Rule 3: Skip requests with explicit authorization headers (prevent caching private API calls)
  if (request.headers.has('Authorization') || request.headers.has('apikey')) {
    return;
  }

  // Rule 4: Handle HTML navigation requests (Single Page App routing offline)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Offline fallback: serve cached index.html or root
          const cachedResponse =
            (await caches.match(request)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/'));

          if (cachedResponse) {
            return cachedResponse;
          }

          // Return an offline fallback HTML if not yet in cache
          return new Response(
            `<!DOCTYPE html>
            <html lang="en" data-theme="dark">
              <head>
                <meta charset="utf-8" />
                <title>Kuro — Offline</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <style>
                  body {
                    margin: 0;
                    padding: 40px 20px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background: #0a0d14;
                    color: #f1f5f9;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 80vh;
                    text-align: center;
                  }
                  .card {
                    max-width: 420px;
                    background: #111827;
                    border: 1px solid #1f2937;
                    border-radius: 12px;
                    padding: 32px 24px;
                  }
                  h1 { font-size: 20px; margin-bottom: 12px; color: #863bff; }
                  p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }
                  button {
                    background: #863bff;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    padding: 10px 20px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                  }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1>Kuro is Offline</h1>
                  <p>You appear to be offline and the application shell hasn't been cached yet. Reconnect to the internet and refresh to enable offline use.</p>
                  <button onclick="window.location.reload()">Retry Connection</button>
                </div>
              </body>
            </html>`,
            {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              status: 503,
            }
          );
        })
    );
    return;
  }

  // Rule 5: Static assets (JS, CSS, images, fonts) — Stale-While-Revalidate
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.woff2') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse.ok && networkResponse.type === 'basic') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Network failure: cachedResponse will be returned
          });

        return cachedResponse || fetchPromise;
      })
    );
  }
});
