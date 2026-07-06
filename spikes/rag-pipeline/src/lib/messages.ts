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

/** Rendered document-list row (A2, FR-5, FR-6). */
export interface DocumentSummary {
  documentId: string;
  title: string;
  chunkCount: number;
  sourceKind: "bundled" | "uploaded";
  charLength: number;
}

/** Dedup decision surfaced on both `parse` (the real skip point, FR-3) and `ingest` (FR-11). */
export type DedupOutcome = { skipped: false } | { skipped: true; existingDocumentId: string; existingTitle: string };

export interface InitResult {
  webgpuAvailable: boolean;
  opfsAvailable: boolean;
  indexedDbAvailable: boolean;
  restoredDocuments: DocumentSummary[]; // replaces restoredDocumentId (FR-9, AC-6)
  restoredChunkCount: number; // total across the corpus (kept for existing UI text)
  schemaReset: boolean; // D5/EC-1/AC-9 — DB was dropped/recreated on version bump
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
  contentHash: string; // FR-1/FR-2 — threaded to ingest
  dedup: DedupOutcome; // FR-3/FR-11 — skip short-circuit
}

export interface IngestResult {
  chunkCount: number;
  indexStrategy: IndexStrategy;
  embedMs: number;
  storeMs: number;
  chunksPerSecond: number;
  charsPerSecond: number;
  dedup: DedupOutcome; // FR-11 — always { skipped: false } on a real ingest
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

export interface ListDocumentsResult {
  documents: DocumentSummary[];
}

export interface DeleteDocumentResult {
  documentId: string;
  deletedChunkCount: number;
}

export type PipelineResult =
  | InitResult
  | ParseResult
  | IngestResult
  | RetrieveResult
  | GenerateResult
  | ListDocumentsResult
  | DeleteDocumentResult;

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
      contentHash: string;
      byteSize: number | null;
    }
  | { type: "retrieve"; jobId: string; question: string; k: number }
  | { type: "restore"; jobId: string }
  | { type: "listDocuments"; jobId: string }
  | { type: "deleteDocument"; jobId: string; documentId: string }
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
