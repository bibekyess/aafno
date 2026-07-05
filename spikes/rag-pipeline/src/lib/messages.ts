// Typed worker request/response/progress/error contract (plan §"Typed worker contract").
// Single source of truth for the main-thread <-> pipeline.worker.ts boundary — no untyped
// postMessage anywhere else (PROJECT_ANALYSIS.md §10 "Worker architecture guidelines").

import type { NetworkPurpose } from "./network";

// Reused verbatim from PROJECT_ANALYSIS.md §10.
export type WorkerJobStatus = "queued" | "running" | "progress" | "complete" | "failed" | "cancelled";

export type PipelineStage = "init" | "parse" | "chunk" | "embed" | "store" | "index" | "retrieve" | "generate";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  ordinal: number;
  text: string;
  charStart: number;
  charEnd: number;
  similarity: number;
}

export type IndexStrategy = "hnsw" | "flat";

export type ModelLoadKind = "cold" | "warm" | "already-loaded";

export interface InitResult {
  webgpuAvailable: boolean;
  opfsAvailable: boolean;
  indexedDbAvailable: boolean;
  restoredDocumentId: string | null;
  restoredChunkCount: number;
  modelLoadMs: number;
  modelLoadKind: ModelLoadKind;
  modelDevice: "webgpu" | "wasm";
}

export interface ParseResult {
  documentId: string;
  text: string;
  charLength: number;
  title: string;
  sourceKind: "bundled" | "uploaded";
  byteSize: number | null;
}

export interface IngestResult {
  chunkCount: number;
  indexStrategy: IndexStrategy;
  embedMs: number;
  storeMs: number;
  chunksPerSecond: number;
  charsPerSecond: number;
}

export interface RetrieveResult {
  question: string;
  k: number;
  chunks: RetrievedChunk[];
  retrievalMs: number;
  belowRelevanceThreshold: boolean;
}

export interface GenerateResult {
  answer: string;
  source: "dev-cloud" | "local";
}

export type PipelineResult = InitResult | ParseResult | IngestResult | RetrieveResult | GenerateResult;

export type DocumentSource = { kind: "bundled" } | { kind: "file"; bytes: ArrayBuffer; name: string };

// --- Requests: main thread -> worker ---

export type PipelineRequest =
  | { type: "init"; jobId: string }
  | { type: "parse"; jobId: string; source: DocumentSource }
  | {
      type: "ingest";
      jobId: string;
      docId: string;
      text: string;
      charLength: number;
      title: string;
      sourceKind: "bundled" | "uploaded";
    }
  | { type: "retrieve"; jobId: string; question: string; k: number }
  | { type: "restore"; jobId: string }
  | { type: "generateLocal"; jobId: string; question: string; contexts: RetrievedChunk[] }
  | { type: "cancel"; jobId: string };

// --- Events: worker -> main thread ---

export type PipelineEvent =
  | { type: "status"; jobId: string; status: WorkerJobStatus }
  | { type: "progress"; jobId: string; stage: PipelineStage; pct?: number; note: string }
  | { type: "network"; jobId: string; purpose: NetworkPurpose; domain: string; note: string }
  | { type: "result"; jobId: string; result: PipelineResult }
  | { type: "error"; jobId: string; stage: PipelineStage; message: string };

export function isPipelineRequest(value: unknown): value is PipelineRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "jobId" in value &&
    typeof (value as { jobId: unknown }).jobId === "string"
  );
}

export function isPipelineEvent(value: unknown): value is PipelineEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "jobId" in value &&
    typeof (value as { jobId: unknown }).jobId === "string"
  );
}
