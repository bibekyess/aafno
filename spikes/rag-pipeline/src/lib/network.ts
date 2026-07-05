// Central network client (ADR: central-network-client-network-purpose; PROJECT_ANALYSIS.md §9).
// All intentional, content-bearing network requests the main thread makes route through here so
// they can be observed, classified, and (for dev-cloud calls) visibly disclosed. This is the ONLY
// content-bearing egress point in the spike (plan "Data / control flow"): parse/chunk/embed/store/
// retrieve happen in the worker and never call this client with document content.
//
// The worker's own network activity (transformers.js model downloads) cannot be routed through a
// main-thread `fetch` wrapper — it is surfaced instead as `network` PipelineEvents (purpose
// "model_download") and fed into this same log via `recordExternalEntry` (see App.tsx).

// Matches PROJECT_ANALYSIS.md §9 verbatim.
export type NetworkPurpose = "app_asset" | "model_download" | "dev_cloud_inference" | "update_check" | "unknown";

export interface NetworkLogEntry {
  url: string;
  domain: string;
  method: string;
  purpose: NetworkPurpose;
  timestamp: number;
  status: number | "error" | "pending";
  sentUserContent: boolean;
  note?: string;
}

type Listener = (entry: NetworkLogEntry) => void;

const log: NetworkLogEntry[] = [];
const listeners = new Set<Listener>();

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function emit(entry: NetworkLogEntry): void {
  log.push(entry);
  for (const listener of listeners) listener(entry);
}

export function getNetworkLog(): readonly NetworkLogEntry[] {
  return log;
}

export function subscribeToNetworkLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record a network event that this client did not itself issue the `fetch` for (e.g. a
 * transformers.js model-download progress event surfaced from the worker). Keeps the Privacy
 * Console-precursor log complete (PROJECT_ANALYSIS.md §9 Network section) even for requests that
 * structurally can't go through `classifiedFetch`.
 */
export function recordExternalEntry(entry: Omit<NetworkLogEntry, "timestamp">): void {
  emit({ ...entry, timestamp: Date.now() });
}

export interface ClassifiedFetchOptions extends RequestInit {
  purpose: NetworkPurpose;
  sentUserContent: boolean;
  note?: string;
}

/**
 * `fetch` wrapper that classifies and records every request it makes (FR-11, AC-8). Dev-cloud
 * calls (`lib/generate.ts`) are the only caller that passes `sentUserContent: true`.
 */
export async function classifiedFetch(url: string, options: ClassifiedFetchOptions): Promise<Response> {
  const { purpose, sentUserContent, note, ...init } = options;
  const domain = domainOf(url);
  const method = init.method ?? "GET";

  const pendingEntry: NetworkLogEntry = {
    url,
    domain,
    method,
    purpose,
    timestamp: Date.now(),
    status: "pending",
    sentUserContent,
    note,
  };
  emit(pendingEntry);

  try {
    const response = await fetch(url, init);
    emit({ ...pendingEntry, timestamp: Date.now(), status: response.status });
    return response;
  } catch (error) {
    emit({
      ...pendingEntry,
      timestamp: Date.now(),
      status: "error",
      note: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
