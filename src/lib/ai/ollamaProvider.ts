/**
 * Ollama AI Provider Adapter for Kuro.
 *
 * Wraps local Ollama service into the common AIProvider contract.
 * Preserves streaming, model discovery, keep-alive, and cancellation.
 */

import {
  checkOllamaConnection,
  sendOllamaChatStream,
  OllamaClientError,
  getActiveOllamaBaseUrl,
  type OllamaChatMessage,
} from '../ollama';

import {
  type AIProvider,
  type AIProviderStatus,
  type AIModelInfo,
  type AIChatStreamParams,
  type AIChatStreamResult,
  type AIProviderErrorCode,
  AIProviderError,
} from './types';

export class OllamaAIProvider implements AIProvider {
  readonly id = 'ollama' as const;
  readonly name = 'Local Ollama (PC)';
  readonly description = 'Local on-device inference using Ollama runtime on your machine.';
  readonly isImplemented = true;

  readonly capabilities = {
    streaming: true,
    localOffline: true,
    modelDiscovery: true,
    multiTurnContext: true,
  } as const;

  async checkStatus(): Promise<AIProviderStatus> {
    const baseUrl = getActiveOllamaBaseUrl();
    const result = await checkOllamaConnection(baseUrl, 6000);

    const models: AIModelInfo[] = result.models.map((m) => ({
      id: m.name,
      name: m.name,
      size: m.size,
      digest: m.digest,
      details: m.details,
      isDefault: m.name.includes('qwen2.5:3b') || m.name.includes('llama3'),
    }));

    let activeModel = '';
    if (models.length > 0) {
      try {
        const saved = localStorage.getItem('kuro_selected_ollama_model');
        if (saved && models.some((m) => m.name === saved)) {
          activeModel = saved;
        }
      } catch {
        // ignore storage errors
      }

      if (!activeModel) {
        // Prefer qwen2.5:3b if installed, otherwise first model
        const qwen = models.find((m) => m.name.includes('qwen2.5:3b'));
        activeModel = qwen ? qwen.name : models[0].name;
      }
    }

    return {
      state: result.state,
      models,
      activeModel,
      error: result.error || null,
      recoveryGuidance: result.recoveryGuidance || null,
    };
  }

  async sendChatStream(params: AIChatStreamParams): Promise<AIChatStreamResult> {
    const { messages, model, signal, timeoutMs = 90000, options, onChunk } = params;

    if (!model || !model.trim()) {
      throw new AIProviderError(
        'No Ollama model selected.',
        'unavailable',
        'ollama',
        'Please select an installed model from the model selector.'
      );
    }

    // Adapt AIChatMessage to OllamaChatMessage
    const ollamaMessages: OllamaChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const streamResult = await sendOllamaChatStream({
        model,
        messages: ollamaMessages,
        signal,
        timeoutMs,
        options: {
          num_predict: options?.maxTokens ?? 384,
          temperature: options?.temperature ?? 0.6,
          top_p: options?.topP ?? 0.9,
        },
        keepAlive: '10m',
        onChunk: (delta, accumulated) => {
          onChunk(delta, accumulated);
        },
      });

      return {
        content: streamResult.content,
        modelUsed: streamResult.model,
        done: streamResult.done,
        totalDurationMs: streamResult.totalDuration,
        evalCount: streamResult.evalCount,
      };
    } catch (err: unknown) {
      if (err instanceof OllamaClientError) {
        const code: AIProviderErrorCode =
          err.code === 'aborted' ||
          err.code === 'timeout' ||
          err.code === 'unavailable' ||
          err.code === 'invalid_response' ||
          err.code === 'cors_blocked'
            ? err.code
            : 'error';

        throw new AIProviderError(
          err.message,
          code,
          'ollama',
          err.recoveryGuidance
        );
      }

      if (err instanceof Error) {
        throw new AIProviderError(err.message, 'error', 'ollama');
      }

      throw new AIProviderError(String(err), 'error', 'ollama');
    }
  }
}

export const ollamaProvider = new OllamaAIProvider();
