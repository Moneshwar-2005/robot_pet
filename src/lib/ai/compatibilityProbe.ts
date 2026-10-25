/**
 * Mobile AI & WebGPU Client Compatibility Probe for Kuro.
 *
 * PRIVACY & SAFETY GUARANTEES:
 * 1. Executes 100% locally in the client browser.
 * 2. Transmits ZERO diagnostics or fingerprints over the network.
 * 3. Does not download models, allocate large tensors, or install packages.
 * 4. Gracefully handles missing, blocked, or vendor-restricted APIs.
 * 5. Does not automatically request persistent storage permissions; requests only on explicit user action.
 */

export interface StorageProbeResult {
  supported: boolean;
  quotaBytes?: number;
  usageBytes?: number;
  availableBytes?: number;
  isPersistent?: boolean;
}

export interface WebGPUProbeResult {
  apiPresent: boolean;
  adapterAvailable: boolean;
  isFallbackAdapter?: boolean;
  architectureDetails?: string;
  error?: string;
}

export interface SystemEnvironmentInfo {
  os: string;
  browser: string;
  isSecureContext: boolean;
  isMobileDevice: boolean;
}

export type ModelRecommendationTier =
  | 'none'
  | 'lower_resource_0_5b'
  | 'higher_resource_1_5b';

export interface CompatibilityReport {
  timestamp: string;
  environment: SystemEnvironmentInfo;
  webGpu: WebGPUProbeResult;
  webAssembly: boolean;
  indexedDb: boolean;
  storage: StorageProbeResult;
  canAttemptWebGPUInference: boolean;
  recommendedTier: ModelRecommendationTier;
  tierRationale: string;
  limitationsNotice: string;
}

/**
 * Safely extracts non-fingerprinting OS and browser display labels.
 */
export function detectEnvironmentInfo(): SystemEnvironmentInfo {
  const isSecureContext = typeof window !== 'undefined' && Boolean(window.isSecureContext);
  let os = 'Unknown OS';
  let browser = 'Unknown Browser';
  let isMobileDevice = false;

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    // Detect OS safely
    if (/Android/i.test(ua)) {
      os = 'Android';
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      os = 'iOS / iPadOS';
    } else if (/Windows/i.test(ua)) {
      os = 'Windows';
    } else if (/Macintosh|Mac OS X/i.test(ua)) {
      os = 'macOS';
    } else if (/Linux/i.test(ua)) {
      os = 'Linux';
    } else if (/CrOS/i.test(ua)) {
      os = 'ChromeOS';
    }

    // Detect Browser safely
    if (/Edg\//i.test(ua)) {
      browser = 'Microsoft Edge';
    } else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) {
      browser = 'Google Chrome / Chromium';
    } else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
      browser = 'Apple Safari';
    } else if (/Firefox\//i.test(ua)) {
      browser = 'Mozilla Firefox';
    } else if (/Opera|OPR\//i.test(ua)) {
      browser = 'Opera';
    }
  }

  return {
    os,
    browser,
    isSecureContext,
    isMobileDevice,
  };
}

/**
 * Probes WebGPU availability and adapter readiness.
 */
export async function probeWebGPU(): Promise<WebGPUProbeResult> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
    return {
      apiPresent: false,
      adapterAvailable: false,
      error: 'WebGPU API is not supported in this browser version.',
    };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return {
        apiPresent: true,
        adapterAvailable: false,
        error: 'WebGPU is supported by the browser, but no compatible GPU hardware adapter could be initialized.',
      };
    }

    const isFallback = Boolean(
      (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter
    );


    return {
      apiPresent: true,
      adapterAvailable: true,
      isFallbackAdapter: isFallback,
      architectureDetails: isFallback ? 'Software Fallback Adapter' : 'Hardware Accelerated GPU',
    };
  } catch (err: unknown) {
    return {
      apiPresent: true,
      adapterAvailable: false,
      error: err instanceof Error ? err.message : 'Failed to query WebGPU adapter.',
    };
  }
}

/**
 * Probes WebAssembly availability and SIMD support safely.
 */
export function probeWebAssembly(): boolean {
  try {
    return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  } catch {
    return false;
  }
}

/**
 * Probes IndexedDB availability.
 */
export function probeIndexedDB(): boolean {
  try {
    return typeof window !== 'undefined' && 'indexedDB' in window && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Probes browser storage quota and persistent storage status without requesting permissions.
 */
export async function probeStorage(): Promise<StorageProbeResult> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { supported: false };
  }

  let quotaBytes: number | undefined;
  let usageBytes: number | undefined;
  let availableBytes: number | undefined;
  let isPersistent: boolean | undefined;

  try {
    if (typeof navigator.storage.estimate === 'function') {
      const estimate = await navigator.storage.estimate();
      quotaBytes = estimate.quota;
      usageBytes = estimate.usage;
      if (quotaBytes !== undefined && usageBytes !== undefined) {
        availableBytes = Math.max(0, quotaBytes - usageBytes);
      }
    }
  } catch {
    // ignore storage estimation errors
  }

  try {
    if (typeof navigator.storage.persisted === 'function') {
      isPersistent = await navigator.storage.persisted();
    }
  } catch {
    // ignore persistence check errors
  }

  return {
    supported: true,
    quotaBytes,
    usageBytes,
    availableBytes,
    isPersistent,
  };
}

/**
 * Explicit user-triggered action to request persistent storage.
 */
export async function requestPersistentStoragePermission(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Evaluates provisional model tier recommendation based on detected capabilities.
 */
export function evaluateModelTier(
  canAttemptWebGPU: boolean,
  storage: StorageProbeResult,
  env: SystemEnvironmentInfo
): { tier: ModelRecommendationTier; rationale: string } {
  if (!canAttemptWebGPU) {
    return {
      tier: 'none',
      rationale:
        'Local on-device inference cannot be attempted because WebGPU is not supported or no hardware adapter was found in this browser.',
    };
  }

  const availableGB = storage.availableBytes ? storage.availableBytes / (1024 * 1024 * 1024) : 0;

  if (availableGB > 0 && availableGB < 1.0) {
    return {
      tier: 'none',
      rationale:
        `Browser available storage (${availableGB.toFixed(1)} GB) is below the 1.0 GB minimum required to cache model weights. Free up storage to enable local models.`,
    };
  }

  // If storage is between 1.0 GB and 2.5 GB, recommend 0.5B tier
  if (availableGB > 0 && availableGB < 2.5) {
    return {
      tier: 'lower_resource_0_5b',
      rationale:
        'Provisional recommendation: Lower-resource tier (e.g., Qwen 2.5 0.5B Instruct, ~380 MB download, ~600 MB RAM). Ideal for devices with constrained storage or ≤4 GB RAM.',
    };
  }

  // If desktop or mobile with ample storage, propose 1.5B with 0.5B option
  if (env.isMobileDevice) {
    return {
      tier: 'higher_resource_1_5b',
      rationale:
        'Provisional recommendation: Higher-resource tier (e.g., Qwen 2.5 1.5B Instruct, ~980 MB download, ~1.3 GB RAM) if device has ≥6 GB RAM. Devices with ≤4 GB RAM should evaluate the 0.5B tier instead.',
    };
  }

  return {
    tier: 'higher_resource_1_5b',
    rationale:
      'Provisional recommendation: 1.5B model tier (or larger if testing on desktop). Actual mobile performance depends on phone physical RAM and GPU core throughput.',
  };
}

/**
 * Runs the full client capability probe safely.
 */
export async function runMobileAICompatibilityProbe(): Promise<CompatibilityReport> {
  const env = detectEnvironmentInfo();
  const [webGpu, storage] = await Promise.all([probeWebGPU(), probeStorage()]);
  const webAssembly = probeWebAssembly();
  const indexedDb = probeIndexedDB();

  const canAttemptWebGPUInference =
    env.isSecureContext &&
    webGpu.apiPresent &&
    webGpu.adapterAvailable &&
    !webGpu.isFallbackAdapter &&
    webAssembly &&
    indexedDb;

  const { tier, rationale } = evaluateModelTier(canAttemptWebGPUInference, storage, env);

  const limitationsNotice =
    'Notice: This diagnostic checks browser API and storage availability only. It does not measure physical RAM, GPU core throughput, thermal throttling, or token generation speed. No model files were downloaded or executed.';

  return {
    timestamp: new Date().toISOString(),
    environment: env,
    webGpu,
    webAssembly,
    indexedDb,
    storage,
    canAttemptWebGPUInference,
    recommendedTier: tier,
    tierRationale: rationale,
    limitationsNotice,
  };
}
