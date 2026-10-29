import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { kuroCloudProxyPlugin, normalizeOllamaTarget } from './src/server/cloudProxy.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load server-side environment variables (.env, .env.local) securely without exposing to client bundle
  const env = loadEnv(mode, process.cwd(), '');
  if (env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }
  if (env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
  }
  if (env.OLLAMA_BASE_URL && !process.env.OLLAMA_BASE_URL) {
    process.env.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL;
  }
  if (env.OLLAMA_HOST && !process.env.OLLAMA_HOST) {
    process.env.OLLAMA_HOST = env.OLLAMA_HOST;
  }

  const ollamaTarget = normalizeOllamaTarget(
    process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST
  );

  return {
    plugins: [react(), kuroCloudProxyPlugin()],
    server: {
      proxy: {
        '/api/ollama': {
          target: ollamaTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
          configure: (proxy) => {
            proxy.on('error', (_err, _req, res) => {
              if (res && 'writeHead' in res && !(res as { headersSent?: boolean }).headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: `Ollama daemon is offline or unreachable on ${ollamaTarget} (502 Bad Gateway)`,
                    code: 'ECONNREFUSED',
                    recovery: 'Start Ollama with `ollama serve` or launch the Ollama desktop app.',
                  })
                );
              }
            });
          },
        },
      },
    },
    preview: {
      proxy: {
        '/api/ollama': {
          target: ollamaTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
          configure: (proxy) => {
            proxy.on('error', (_err, _req, res) => {
              if (res && 'writeHead' in res && !(res as { headersSent?: boolean }).headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: `Ollama daemon is offline or unreachable on ${ollamaTarget} (502 Bad Gateway)`,
                    code: 'ECONNREFUSED',
                    recovery: 'Start Ollama with `ollama serve` or launch the Ollama desktop app.',
                  })
                );
              }
            });
          },
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('@mlc-ai/web-llm')) {
              return 'webllm-vendor';
            }
            if (id.includes('@supabase')) {
              return 'supabase-vendor';
            }
            if (id.includes('lucide-react')) {
              return 'lucide-vendor';
            }
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor';
            }
          },
        },
      },
    },
  };
});
