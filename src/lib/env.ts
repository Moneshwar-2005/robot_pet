/**
 * Safe Vite environment variable loader and validator for Kuro.
 * Strictly avoids logging or exposing credential values.
 */

export interface EnvValidationResult {
  isConfigured: boolean;
  errors: string[];
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
}

function validateHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSupabaseEnv(): EnvValidationResult {
  const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  const errors: string[] = [];

  if (!rawUrl) {
    errors.push('Missing VITE_SUPABASE_URL environment variable.');
  } else if (!validateHttpUrl(rawUrl)) {
    errors.push('VITE_SUPABASE_URL must be a valid HTTP or HTTPS URL.');
  }

  if (!rawKey) {
    errors.push('Missing VITE_SUPABASE_PUBLISHABLE_KEY environment variable.');
  } else if (rawKey.length < 10) {
    errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is too short to be a valid key.');
  }

  const isConfigured = errors.length === 0 && Boolean(rawUrl && rawKey);

  return {
    isConfigured,
    errors,
    supabaseUrl: isConfigured && rawUrl ? rawUrl : null,
    supabasePublishableKey: isConfigured && rawKey ? rawKey : null,
  };
}

export interface OllamaEnvResult {
  baseUrl: string;
  isCustom: boolean;
  error: string | null;
}

export function getOllamaEnv(): OllamaEnvResult {
  const rawUrl = import.meta.env.VITE_OLLAMA_BASE_URL?.trim();
  const defaultUrl = 'http://localhost:11434';

  if (!rawUrl) {
    return { baseUrl: defaultUrl, isCustom: false, error: null };
  }

  // Support relative path for local proxy (e.g. '/api/ollama')
  if (rawUrl.startsWith('/')) {
    return { baseUrl: rawUrl.replace(/\/+$/, ''), isCustom: true, error: null };
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        baseUrl: defaultUrl,
        isCustom: true,
        error: 'VITE_OLLAMA_BASE_URL must use http:// or https:// scheme.',
      };
    }
    const cleanUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
    return { baseUrl: cleanUrl, isCustom: true, error: null };
  } catch {
    return {
      baseUrl: defaultUrl,
      isCustom: true,
      error: 'Invalid URL format for VITE_OLLAMA_BASE_URL.',
    };
  }
}
