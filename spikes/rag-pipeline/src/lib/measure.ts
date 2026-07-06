// Timing + throughput helpers (FR-10) plus the A4/B measurement snapshot/export tooling
// (FR-17..FR-21). Deliberately simple — this is measurement plumbing for the spike's
// evidence-gathering goal, not a general perf library. `buildMeasurementMarkdown` is pure and
// Node-testable; `measurementStore` touches `localStorage` (browser-only) so its effects are
// guarded rather than unit-tested directly (the actual browser run is manual, per NFR).

import type { IndexStrategy, ModelLoadKind } from "./messages";

export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class Stopwatch {
  private readonly startedAt = nowMs();

  elapsedMs(): number {
    return nowMs() - this.startedAt;
  }
}

export function throughputPerSecond(count: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return count > 0 ? Infinity : 0;
  return (count / elapsedMs) * 1000;
}

export interface EmbeddingThroughput {
  chunkCount: number;
  charCount: number;
  embedMs: number;
  chunksPerSecond: number;
  charsPerSecond: number;
}

export function embeddingThroughput(chunkCount: number, charCount: number, embedMs: number): EmbeddingThroughput {
  return {
    chunkCount,
    charCount,
    embedMs,
    chunksPerSecond: throughputPerSecond(chunkCount, embedMs),
    charsPerSecond: throughputPerSecond(charCount, embedMs),
  };
}

// --- Measurement snapshot + Markdown export (A4/B, FR-17..FR-21) ---

/** Tri-state persistence self-check (FR-19, AC-11). */
export type PersistenceSelfCheck = "pass" | "fail" | "no-prior-corpus";

/**
 * Given what `init` restored and whether a prior corpus was ever recorded (measurementStore),
 * compute the definitive persistence-self-check outcome (FR-19). Pure — the restore itself already
 * ran with no parse/chunk/embed job, so "restored non-empty" is structurally "pass".
 */
export function computePersistenceSelfCheck(
  restoredDocumentCount: number,
  restoredChunkCount: number,
  priorCorpusRecorded: boolean,
): PersistenceSelfCheck {
  if (restoredDocumentCount > 0 && restoredChunkCount > 0) return "pass";
  if (priorCorpusRecorded) return "fail";
  return "no-prior-corpus";
}

export interface MeasurementSnapshot {
  environment: {
    userAgent: string | null;
    webgpuAvailable: boolean | null;
    wasmFallbackObserved: boolean | null;
  };
  coldLoadMs: number | null;
  warmLoadMs: number | null;
  modelLoadKind: ModelLoadKind | null;
  modelDevice: "webgpu" | "wasm" | null;
  chunksPerSecond: number | null;
  charsPerSecond: number | null;
  chunkCount: number | null;
  retrievalMs: number | null;
  indexStrategy: IndexStrategy | null;
  persistenceSelfCheck: PersistenceSelfCheck;
  cloudOffNoEgress: boolean | null;
}

function fmt(value: number | null, digits = 1, unit = ""): string {
  return value === null ? "TBD" : `${value.toFixed(digits)}${unit}`;
}

function fmtBool(value: boolean | null): string {
  return value === null ? "TBD" : value ? "yes" : "no";
}

function fmtStr<T extends string>(value: T | null): string {
  return value === null ? "TBD" : value;
}

/**
 * Render a `MeasurementSnapshot` as Markdown matching `MEASUREMENTS.md`'s section structure
 * (AC-10). `null`/unknown fields render as `TBD` so an export before a full run is still
 * well-formed (EC-9) — never malformed Markdown, never a crash.
 */
export function buildMeasurementMarkdown(snapshot: MeasurementSnapshot): string {
  return `## Environment

| Field | Value |
|---|---|
| Browser / user agent | ${fmtStr(snapshot.environment.userAgent)} |
| WebGPU available | ${fmtBool(snapshot.environment.webgpuAvailable)} |
| WASM fallback observed | ${fmtBool(snapshot.environment.wasmFallbackObserved)} |

## Model load (cold vs warm)

| Metric | Result |
|---|---|
| Cold-load | ${fmt(snapshot.coldLoadMs, 0, "ms")} |
| Warm-load | ${fmt(snapshot.warmLoadMs, 0, "ms")} |
| Load kind (this run) | ${fmtStr(snapshot.modelLoadKind)} |
| Model backend used | ${fmtStr(snapshot.modelDevice)} |

## Embedding + retrieval

| Metric | Result |
|---|---|
| Embedding throughput | ${fmt(snapshot.chunksPerSecond, 2, " chunks/s")}, ${fmt(snapshot.charsPerSecond, 0, " chars/s")} |
| Chunk count | ${snapshot.chunkCount === null ? "TBD" : snapshot.chunkCount} |
| Retrieval latency (top-k) | ${fmt(snapshot.retrievalMs, 0, "ms")} |
| Index strategy | ${fmtStr(snapshot.indexStrategy)} |

## Persistence self-check (AC-11)

| Check | Result |
|---|---|
| Restored from storage without re-parse/chunk/embed | ${snapshot.persistenceSelfCheck} |

## Privacy / hard gates

| Requirement | Result |
|---|---|
| No content egress with cloud off | ${fmtBool(snapshot.cloudOffNoEgress)} |

_Numbers require a real WebGPU browser run — not producible in CI/headless (NFR)._
`;
}

// --- localStorage-backed measurement store (browser-only; guarded for Node/test environments) ---

const COLD_LOAD_KEY_PREFIX = "aafno:measure:cold-load-ms:";
const HAD_CORPUS_KEY = "aafno:measure:had-corpus";

function getStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const measurementStore = {
  /** Persist a cold-load ms measurement, keyed by model id, so a later warm-load can compare. */
  recordColdLoadMs(modelId: string, ms: number): void {
    getStorage()?.setItem(COLD_LOAD_KEY_PREFIX + modelId, String(ms));
  },
  getColdLoadMs(modelId: string): number | null {
    const raw = getStorage()?.getItem(COLD_LOAD_KEY_PREFIX + modelId) ?? null;
    return raw === null ? null : Number(raw);
  },
  /** Mark that a corpus was successfully ingested at least once (drives the self-check's `fail` branch). */
  recordCorpusIngested(): void {
    getStorage()?.setItem(HAD_CORPUS_KEY, "true");
  },
  hasPriorCorpusRecorded(): boolean {
    return getStorage()?.getItem(HAD_CORPUS_KEY) === "true";
  },
};
