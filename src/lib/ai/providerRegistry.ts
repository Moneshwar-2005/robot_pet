/**
 * AI Provider Registry for Kuro.
 *
 * Central registry managing configured AI providers.
 * Local Ollama is the default and only active provider in Step 3.4.
 */

import type { AIProvider, AIProviderId } from './types';
import { ollamaProvider } from './ollamaProvider';
import { hostedCloudProvider } from './futureProviders';
import { webllmMobileProvider } from './webllmProvider';

const providers: Record<AIProviderId, AIProvider> = {
  ollama: ollamaProvider,
  on_device_mobile: webllmMobileProvider,
  hosted_cloud: hostedCloudProvider,
};

export const DEFAULT_PROVIDER_ID: AIProviderId = 'ollama';

export function getAllProviders(): AIProvider[] {
  return [
    ollamaProvider,
    webllmMobileProvider,
    hostedCloudProvider,
  ];
}


export function getProvider(id: AIProviderId): AIProvider {
  return providers[id] || ollamaProvider;
}

export function getDefaultProvider(): AIProvider {
  return ollamaProvider;
}

export function getSavedProviderId(): AIProviderId {
  try {
    const saved = localStorage.getItem('kuro_active_ai_provider');
    if (saved && (saved === 'ollama' || saved === 'on_device_mobile' || saved === 'hosted_cloud')) {
      // Only allow selection of implemented providers
      if (providers[saved]?.isImplemented) {
        return saved;
      }
    }
  } catch {
    // ignore localStorage errors
  }
  return DEFAULT_PROVIDER_ID;
}

export function saveProviderId(id: AIProviderId): void {
  try {
    localStorage.setItem('kuro_active_ai_provider', id);
  } catch {
    // ignore localStorage errors
  }
}
