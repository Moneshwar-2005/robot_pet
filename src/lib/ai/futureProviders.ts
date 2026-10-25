/**
 * Future AI Provider Descriptors for Kuro.
 *
 * Implements the AIProvider contract for planned providers (Mobile On-Device and Hosted Cloud).
 * Strictly marked as isImplemented = false to prevent invocation or false claims.
 */

import {
  type AIProvider,
  type AIProviderStatus,
  type AIChatStreamParams,
  type AIChatStreamResult,
  AIProviderError,
} from './types';

export class OnDeviceMobileAIProvider implements AIProvider {
  readonly id = 'on_device_mobile' as const;
  readonly name = 'On-Device Mobile (WebLLM / Wasm)';
  readonly description = 'Hardware-accelerated on-device neural inference for mobile phones and tablets.';
  readonly isImplemented = false;

  readonly capabilities = {
    streaming: true,
    localOffline: true,
    modelDiscovery: false,
    multiTurnContext: true,
  } as const;

  async checkStatus(): Promise<AIProviderStatus> {
    return {
      state: 'unsupported',
      models: [],
      activeModel: '',
      error: 'On-device mobile AI runtime is scheduled for Phase 4.',
      recoveryGuidance: 'Use Local Ollama (PC) for active local AI chat.',
    };
  }

  async sendChatStream(_params: AIChatStreamParams): Promise<AIChatStreamResult> {
    throw new AIProviderError(
      'On-device mobile AI provider is not implemented in this step.',
      'unsupported',
      'on_device_mobile',
      'Please select Local Ollama (PC).'
    );
  }
}

export class HostedCloudAIProvider implements AIProvider {
  readonly id = 'hosted_cloud' as const;
  readonly name = 'Optional Cloud AI';
  readonly description = 'Optional hosted AI gateway for systems without local inference compute.';
  readonly isImplemented = false;

  readonly capabilities = {
    streaming: true,
    localOffline: false,
    modelDiscovery: false,
    multiTurnContext: true,
  } as const;

  async checkStatus(): Promise<AIProviderStatus> {
    return {
      state: 'unsupported',
      models: [],
      activeModel: '',
      error: 'Cloud AI is disabled. Kuro is strictly local-first.',
      recoveryGuidance: 'Kuro connects directly to local Ollama on your machine without cloud dependencies.',
    };
  }

  async sendChatStream(_params: AIChatStreamParams): Promise<AIChatStreamResult> {
    throw new AIProviderError(
      'Cloud AI provider is not enabled in this build.',
      'unsupported',
      'hosted_cloud',
      'Please use Local Ollama (PC).'
    );
  }
}

export const onDeviceMobileProvider = new OnDeviceMobileAIProvider();
export const hostedCloudProvider = new HostedCloudAIProvider();
