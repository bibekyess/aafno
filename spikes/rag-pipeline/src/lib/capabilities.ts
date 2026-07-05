// Capability detection (FR-13, AC-9). Never fail silently: every check resolves to a definite
// yes/no/blocked state that ui/CapabilityBanner.tsx renders in plain language.

export interface WebGpuCapability {
  available: boolean;
  adapterInfo: string | null;
  reason: string | null;
}

export async function detectWebGPU(): Promise<WebGpuCapability> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) {
    return {
      available: false,
      adapterInfo: null,
      reason: "navigator.gpu is undefined (WebGPU not supported by this browser)",
    };
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return {
        available: false,
        adapterInfo: null,
        reason: "requestAdapter() returned null (no compatible GPU adapter)",
      };
    }
    const info = "info" in adapter ? JSON.stringify((adapter as { info?: unknown }).info ?? {}) : "adapter available";
    return { available: true, adapterInfo: info, reason: null };
  } catch (error) {
    return { available: false, adapterInfo: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function detectOpfs(): boolean {
  return (
    typeof navigator !== "undefined" && "storage" in navigator && typeof navigator.storage.getDirectory === "function"
  );
}

export function detectIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

export interface CapabilitySnapshot {
  webgpu: WebGpuCapability;
  opfs: boolean;
  indexedDb: boolean;
  persistenceAvailable: boolean;
}

export async function detectCapabilities(): Promise<CapabilitySnapshot> {
  const webgpu = await detectWebGPU();
  const opfs = detectOpfs();
  const indexedDb = detectIndexedDb();
  return { webgpu, opfs, indexedDb, persistenceAvailable: opfs || indexedDb };
}
