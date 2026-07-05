// FR-13, AC-9: state WebGPU/OPFS/IndexedDB status in plain language, never silently.

export interface CapabilityBannerProps {
  webgpuAvailable: boolean | null;
  opfsAvailable: boolean | null;
  indexedDbAvailable: boolean | null;
}

function statusText(label: string, value: boolean | null): string {
  if (value === null) return `${label}: checking…`;
  return value ? `${label}: available` : `${label}: NOT available`;
}

export function CapabilityBanner({ webgpuAvailable, opfsAvailable, indexedDbAvailable }: CapabilityBannerProps) {
  const persistenceBlocked = opfsAvailable === false && indexedDbAvailable === false;
  return (
    <section aria-label="Capability status">
      <h2>Capabilities</h2>
      <ul>
        <li>{statusText("WebGPU", webgpuAvailable)}</li>
        <li>{statusText("OPFS", opfsAvailable)}</li>
        <li>{statusText("IndexedDB", indexedDbAvailable)}</li>
      </ul>
      {webgpuAvailable === false && (
        <p role="status">
          WebGPU is unavailable in this browser — falling back to the WASM backend (slower, but functional).
        </p>
      )}
      {persistenceBlocked && (
        <p role="alert">
          Neither OPFS nor IndexedDB is available — local persistence is blocked in this browser/mode. Data will not
          survive a reload.
        </p>
      )}
    </section>
  );
}
