/**
 * WebLLM On-Device Mobile AI Provider for Kuro.
 *
 * Implements hardware-accelerated local inference using WebLLM inside a dedicated
 * Web Worker. Ensures 60fps React UI smoothness, zero network telemetry, full offline
 * execution after model weight caching, and cancellation support.
 */

import {
  CreateWebWorkerMLCEngine,
  type WebWorkerMLCEngine,
  type InitProgressReport,
  hasModelInCache,
  deleteModelAllInfoInCache,
} from '@mlc-ai/web-llm';

import {
  type AIProvider,
  type AIProviderStatus,
  type AIModelInfo,
  type AIChatStreamParams,
  type AIChatStreamResult,
  type AIInitProgress,
  type WebLLMLifecycleState,
  AIProviderError,
} from './types';

import { probeWebGPU, probeStorage } from './compatibilityProbe';

export interface WebLLMModelCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly downloadSizeMB: number;
  readonly vramRequiredMB: number;
  readonly family: string;
  readonly parameterSize: string;
  readonly quantizationLevel: string;
  readonly isDefault: boolean;
  readonly description: string;
}

/**
 * Curated catalog of tested small-footprint instruction models for WebLLM.
 * Defaults to Qwen2.5-0.5B-Instruct-q4f16_1-MLC for ultra-low RAM and download size.
 */
export const WEBLLM_SUPPORTED_MODELS: readonly WebLLMModelCatalogItem[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct (q4f16)',
    downloadSizeMB: 380,
    vramRequiredMB: 945,
    family: 'qwen2',
    parameterSize: '0.5B',
    quantizationLevel: 'q4f16_1',
    isDefault: true,
    description: 'Ultra-lightweight model with strong structured action formatting. Recommended for mobile and quick local tests (~380 MB).',
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct (q4f32 fallback)',
    downloadSizeMB: 420,
    vramRequiredMB: 1060,
    family: 'qwen2',
    parameterSize: '0.5B',
    quantizationLevel: 'q4f32_1',
    isDefault: false,
    description: '32-bit float shader fallback for GPUs without 16-bit floating-point support (~420 MB).',
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M Instruct (q4f16)',
    downloadSizeMB: 230,
    vramRequiredMB: 376,
    family: 'smollm',
    parameterSize: '0.36B',
    quantizationLevel: 'q4f16_1',
    isDefault: false,
    description: 'Smallest available footprint (~230 MB). Extremely fast token generation, best for memory-constrained phones.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 1.5B Instruct (q4f16)',
    downloadSizeMB: 980,
    vramRequiredMB: 1630,
    family: 'qwen2',
    parameterSize: '1.5B',
    quantizationLevel: 'q4f16_1',
    isDefault: false,
    description: 'High-reasoning mobile tier matching desktop action fidelity. Recommended for devices with ≥6 GB RAM (~980 MB).',
  },
] as const;

export const DEFAULT_WEBLLM_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

export class WebLLMMobileAIProvider implements AIProvider {
  readonly id = 'on_device_mobile' as const;
  readonly name = 'On-Device Mobile (WebLLM)';
  readonly description = 'In-browser hardware-accelerated AI using WebGPU and a dedicated Web Worker.';
  readonly isImplemented = true;

  readonly capabilities = {
    streaming: true,
    localOffline: true,
    modelDiscovery: true,
    multiTurnContext: true,
  } as const;

  private worker: Worker | null = null;
  private engine: WebWorkerMLCEngine | null = null;
  private _isInitializing = false;
  private _isModelLoaded = false;
  private _loadedModelId: string | null = null;
  private _initProgress: AIInitProgress | null = null;
  private _lastError: string | null = null;
  private _lifecycleState: WebLLMLifecycleState = 'not_initialized';
  private _initPromise: Promise<void> | null = null;

  private progressListeners = new Set<(progress: AIInitProgress) => void>();
  private lifecycleListeners = new Set<(state: WebLLMLifecycleState) => void>();

  get isModelLoaded(): boolean {
    return this._isModelLoaded;
  }

  get isInitializing(): boolean {
    return this._isInitializing;
  }

  get initProgress(): AIInitProgress | null {
    return this._initProgress;
  }

  get loadedModelId(): string | null {
    return this._loadedModelId;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  get lifecycleState(): WebLLMLifecycleState {
    return this._lifecycleState;
  }

  private setLifecycleState(state: WebLLMLifecycleState): void {
    if (this._lifecycleState === state) return;
    this._lifecycleState = state;
    this.lifecycleListeners.forEach((fn) => {
      try {
        fn(state);
      } catch {
        // ignore subscriber errors
      }
    });
  }

  addProgressListener(listener: (p: AIInitProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  addLifecycleListener(listener: (state: WebLLMLifecycleState) => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  private notifyProgress(progress: AIInitProgress): void {
    this._initProgress = progress;
    this.progressListeners.forEach((fn) => {
      try {
        fn(progress);
      } catch {
        // ignore subscriber errors
      }
    });
  }

  /**
   * Checks whether weights for the given model are present in browser Cache API.
   */
  async checkModelCache(modelId: string): Promise<boolean> {
    try {
      return await hasModelInCache(modelId);
    } catch {
      return false;
    }
  }

  /**
   * Probes WebGPU availability, checks cache state, and returns connection status.
   */
  async checkStatus(): Promise<AIProviderStatus> {
    const gpuProbe = await probeWebGPU();

    if (!gpuProbe.apiPresent || !gpuProbe.adapterAvailable) {
      this.setLifecycleState('unsupported');
      return {
        state: 'unsupported',
        models: [],
        activeModel: '',
        error: gpuProbe.error || 'WebGPU is not supported in this browser version.',
        recoveryGuidance: 'Use Google Chrome 121+ on Android, Microsoft Edge, or Safari on iOS 18.2+ with WebGPU enabled.',
      };
    }

    if (gpuProbe.isFallbackAdapter) {
      this.setLifecycleState('unsupported');
      return {
        state: 'unsupported',
        models: [],
        activeModel: '',
        error: 'Only a software-emulated GPU adapter was detected. Real-time inference requires a hardware GPU.',
        recoveryGuidance: 'Ensure your device GPU drivers and WebGPU hardware acceleration are enabled.',
      };
    }

    // Inspect cache status for catalog models
    const modelsWithCache: AIModelInfo[] = await Promise.all(
      WEBLLM_SUPPORTED_MODELS.map(async (m) => {
        let isCached = false;
        try {
          isCached = await hasModelInCache(m.id);
        } catch {
          // ignore cache probing errors
        }

        return {
          id: m.id,
          name: `${m.name}${isCached ? ' [Cached]' : ''}`,
          size: m.downloadSizeMB * 1024 * 1024,
          details: {
            format: 'MLC / WebGPU',
            family: m.family,
            parameterSize: m.parameterSize,
            quantizationLevel: m.quantizationLevel,
          },
          isDefault: m.isDefault,
        };
      })
    );

    // If currently initializing
    if (this._isInitializing) {
      this.setLifecycleState('downloading_initializing');
      return {
        state: 'checking',
        models: modelsWithCache,
        activeModel: this._loadedModelId || DEFAULT_WEBLLM_MODEL_ID,
        error: null,
        recoveryGuidance: this._initProgress?.text || 'Initializing on-device model...',
      };
    }

    // If engine is already loaded and ready
    if (this._isModelLoaded && this.engine && this._loadedModelId) {
      this.setLifecycleState('ready');
      return {
        state: 'connected',
        models: modelsWithCache,
        activeModel: this._loadedModelId,
        error: null,
        recoveryGuidance: 'On-device WebLLM model is loaded and ready for private local chat.',
      };
    }

    // Check saved preference
    let preferredModel = DEFAULT_WEBLLM_MODEL_ID;
    try {
      const saved = localStorage.getItem('kuro_selected_webllm_model');
      if (saved && WEBLLM_SUPPORTED_MODELS.some((m) => m.id === saved)) {
        preferredModel = saved;
      }
    } catch {
      // ignore storage errors
    }

    if (this._lifecycleState === 'failed') {
      return {
        state: 'error',
        models: modelsWithCache,
        activeModel: preferredModel,
        error: this._lastError,
        recoveryGuidance: 'Retry initialization or switch to a lighter model.',
      };
    }

    if (this._lifecycleState === 'cancelled') {
      return {
        state: 'no_models',
        models: modelsWithCache,
        activeModel: preferredModel,
        error: 'Initialization was cancelled by user.',
        recoveryGuidance: 'Click "Download & Initialize Model" when ready to retry.',
      };
    }

    this.setLifecycleState('not_initialized');
    return {
      state: 'no_models',
      models: modelsWithCache,
      activeModel: preferredModel,
      error: this._lastError || null,
      recoveryGuidance: 'Click "Download & Initialize Model" to load the on-device AI into browser cache.',
    };
  }

  /**
   * Cleans up worker and engine resources safely.
   */
  private cleanupWorkerResources(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore termination errors
      }
      this.worker = null;
    }
    this.engine = null;
  }

  /**
   * Initializes the selected model inside a dedicated Web Worker.
   * Requires explicit user action; never runs automatically on page load.
   * Prevents concurrent runs and returns in-flight promise if duplicate call occurs.
   */
  async initializeModel(
    modelId?: string,
    onProgress?: (progress: AIInitProgress) => void
  ): Promise<void> {
    const targetModelId = modelId || this._loadedModelId || DEFAULT_WEBLLM_MODEL_ID;

    // Concurrency guard: If already initializing, attach listener and reuse existing promise
    if (this._isInitializing && this._initPromise) {
      if (onProgress) this.addProgressListener(onProgress);
      return this._initPromise;
    }

    // Fast-path: If target model is already loaded and ready, do not re-initialize
    if (this._isModelLoaded && this._loadedModelId === targetModelId && this.engine) {
      this.setLifecycleState('ready');
      if (onProgress) onProgress({ progress: 1, text: 'Model is already loaded and ready.' });
      return;
    }

    // If a different model is loaded, unload it first to prevent GPU memory saturation
    if (this._isModelLoaded && this._loadedModelId !== targetModelId) {
      await this.unload();
    }

    if (onProgress) {
      this.addProgressListener(onProgress);
    }

    this._initPromise = (async () => {
      this._isInitializing = true;
      this._lastError = null;
      this.setLifecycleState('checking_compatibility');
      this.notifyProgress({ progress: 0, text: 'Checking WebGPU compatibility & storage...' });

      // Step 1: Verify WebGPU before attempting any download
      const gpuProbe = await probeWebGPU();
      if (!gpuProbe.apiPresent || !gpuProbe.adapterAvailable || gpuProbe.isFallbackAdapter) {
        this._isInitializing = false;
        this.setLifecycleState('unsupported');
        throw new AIProviderError(
          'Cannot initialize WebLLM: WebGPU hardware acceleration is not supported on this device/browser.',
          'unsupported',
          'on_device_mobile',
          'Please use Chrome 121+ on Android, Edge, or Safari 18.2+ on iOS.'
        );
      }

      // Step 2: Storage safety check with model buffer margin
      const storage = await probeStorage();
      if (storage.supported && storage.availableBytes !== undefined) {
        const availableMB = storage.availableBytes / (1024 * 1024);
        const targetModel = WEBLLM_SUPPORTED_MODELS.find((m) => m.id === targetModelId);
        const neededMB = (targetModel?.downloadSizeMB || 400) * 1.5; // Include decompression margin
        if (availableMB < neededMB) {
          this._isInitializing = false;
          this.setLifecycleState('failed');
          throw new AIProviderError(
            `Insufficient browser storage: ${availableMB.toFixed(0)} MB available, but ~${neededMB.toFixed(0)} MB is recommended to cache this model safely.`,
            'error',
            'on_device_mobile',
            'Free up disk space or clear browser data before downloading this model.'
          );
        }
      }

      // Step 3: Start download & initialization
      this.setLifecycleState('downloading_initializing');
      this.notifyProgress({ progress: 0, text: 'Preparing Web Worker and GPU shaders...' });

      try {
        // Terminate any stale worker
        this.cleanupWorkerResources();

        // Spawn worker using modern Vite URL worker resolution
        this.worker = new Worker(new URL('../../workers/webllm.worker.ts', import.meta.url), {
          type: 'module',
        });

        this.worker.onerror = (err) => {
          console.error('[WebLLM Worker Error]:', err);
          const errMsg = err.message || 'Web Worker terminated unexpectedly or encountered an error.';
          this._lastError = errMsg;
          this._isInitializing = false;
          this._isModelLoaded = false;
          this.setLifecycleState('failed');
          this.cleanupWorkerResources();
        };

        this.worker.onmessageerror = (err) => {
          console.error('[WebLLM Worker Message Error]:', err);
          this._lastError = 'Web Worker failed to deserialize message payload.';
          this._isInitializing = false;
          this._isModelLoaded = false;
          this.setLifecycleState('failed');
          this.cleanupWorkerResources();
        };

        const progressCallback = (report: InitProgressReport) => {
          // If cancelled during callback, ignore
          if (!this._isInitializing) return;

          const text = report.text || 'Loading model weights...';
          const progress = Math.min(1, Math.max(0, report.progress || 0));
          this.notifyProgress({
            progress,
            text,
            timeElapsed: report.timeElapsed,
          });
        };

        // Create engine client through worker
        this.engine = await CreateWebWorkerMLCEngine(this.worker, targetModelId, {
          initProgressCallback: progressCallback,
          logLevel: 'WARN',
        });

        this._isModelLoaded = true;
        this._loadedModelId = targetModelId;
        this._isInitializing = false;
        this.setLifecycleState('ready');
        this.notifyProgress({ progress: 1, text: 'On-device model initialized successfully!' });

        try {
          localStorage.setItem('kuro_selected_webllm_model', targetModelId);
        } catch {
          // ignore storage errors
        }
      } catch (err: unknown) {
        this._isInitializing = false;
        this._isModelLoaded = false;
        this._loadedModelId = null;
        this.cleanupWorkerResources();

        const message = err instanceof Error ? err.message : 'Failed to initialize WebLLM model.';
        this._lastError = message;

        // If user cancelled, don't set to failed
        if (this._lifecycleState !== 'cancelled') {
          this.setLifecycleState('failed');
        }

        throw new AIProviderError(
          `WebLLM initialization failed: ${message}`,
          'error',
          'on_device_mobile',
          'Check network connectivity for the initial download, or try a smaller model like SmolLM2 360M.'
        );
      }
    })();

    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /**
   * Cancels an active model download/initialization and releases the worker.
   */
  cancelInitialization(): void {
    if (!this._isInitializing) return;

    this.setLifecycleState('cancelling');
    this.cleanupWorkerResources();
    this._isInitializing = false;
    this._isModelLoaded = false;
    this._loadedModelId = null;
    this._initProgress = null;
    this._lastError = 'Initialization was cancelled by user.';
    this.setLifecycleState('cancelled');
    this.notifyProgress({ progress: 0, text: 'Initialization was cancelled.' });
  }

  /**
   * Unloads the engine and releases worker and GPU memory.
   */
  async unload(): Promise<void> {
    try {
      if (this.engine) {
        await this.engine.unload();
      }
    } catch {
      // ignore unload error
    } finally {
      this.cleanupWorkerResources();
      this._isModelLoaded = false;
      this._loadedModelId = null;
      this._isInitializing = false;
      this._initProgress = null;
      this.setLifecycleState('not_initialized');
    }
  }

  /**
   * Deletes model files from browser Cache API / OPFS.
   */
  async deleteCachedModel(modelId: string): Promise<void> {
    if (this._loadedModelId === modelId) {
      await this.unload();
    }
    try {
      await deleteModelAllInfoInCache(modelId);
    } catch (err) {
      console.warn('[WebLLM] Error deleting cached model:', err);
    }
    this._lastError = null;
    this.setLifecycleState('not_initialized');
  }

  /**
   * Streams chat completions from the loaded on-device model.
   */
  async sendChatStream(params: AIChatStreamParams): Promise<AIChatStreamResult> {
    const { messages, signal, timeoutMs = 120000, options, onChunk } = params;

    if (!this._isModelLoaded || !this.engine) {
      throw new AIProviderError(
        'On-device AI model is not initialized yet. Please click "Initialize Model" first.',
        'unavailable',
        'on_device_mobile',
        'Select On-Device Mobile in the provider selector and click "Download & Initialize Model".'
      );
    }

    const startTime = performance.now();
    let accumulatedContent = '';
    let evalCount = 0;

    // Adapt AIChatMessage to OpenAI ChatCompletionMessageParam
    const openAiMessages = messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    // Setup cancellation through engine.interruptGenerate()
    const handleAbort = () => {
      try {
        void this.engine?.interruptGenerate();
      } catch {
        // ignore interrupt errors
      }
    };

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    // Setup timeout handler
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        handleAbort();
        reject(
          new AIProviderError(
            `On-device inference timed out after ${timeoutMs / 1000} seconds.`,
            'timeout',
            'on_device_mobile',
            'Consider shortening your message or switching to a lighter model.'
          )
        );
      }, timeoutMs);
    });

    try {
      const streamPromise = (async () => {
        const stream = await this.engine!.chat.completions.create({
          messages: openAiMessages,
          stream: true,
          temperature: options?.temperature ?? 0.6,
          top_p: options?.topP ?? 0.9,
          max_tokens: options?.maxTokens ?? 384,
        });

        for await (const chunk of stream) {
          if (signal?.aborted) {
            break;
          }
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            evalCount++;
            accumulatedContent += delta;
            onChunk(delta, accumulatedContent);
          }
        }

        return true;
      })();

      await Promise.race([streamPromise, timeoutPromise]);

      const totalDurationMs = Math.round(performance.now() - startTime);

      return {
        content: accumulatedContent,
        modelUsed: this._loadedModelId || DEFAULT_WEBLLM_MODEL_ID,
        done: true,
        totalDurationMs,
        evalCount,
      };
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new AIProviderError(
          'Generation was stopped by user.',
          'aborted',
          'on_device_mobile'
        );
      }
      if (err instanceof AIProviderError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'On-device generation failed.';
      this._lastError = message;
      this._isModelLoaded = false;
      this.setLifecycleState('failed');
      throw new AIProviderError(
        message,
        'error',
        'on_device_mobile',
        'The mobile WebGPU engine encountered an error. Try resetting the model or checking storage.'
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    }
  }
}

export const webllmMobileProvider = new WebLLMMobileAIProvider();
