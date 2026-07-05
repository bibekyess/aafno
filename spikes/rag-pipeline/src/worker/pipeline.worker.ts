// Single Web Worker (D3, §10 worker guidelines) owning PGlite + the transformers.js embedding
// pipeline for the worker's lifetime. Handles parse -> chunk -> embed -> store -> retrieve.
// This worker makes NO content-bearing network requests — its only network activity is the
// transformers.js model-weight download, surfaced as `network` events (purpose "model_download")
// so the main thread's network log stays complete (plan "Data / control flow", AC-2).

/// <reference lib="webworker" />

import { detectCapabilities } from "../lib/capabilities";
import { Stopwatch, embeddingThroughput } from "../lib/measure";
import type {
  DocumentSource,
  IngestResult,
  InitResult,
  ParseResult,
  PipelineEvent,
  PipelineRequest,
  PipelineStage,
  RetrieveResult,
} from "../lib/messages";
import { chunkText } from "./chunk";
import { EMBEDDING_MODEL_ID, loadEmbeddingModel, type EmbedModelHandle } from "./embed";
import { attemptHnswIndex, insertChunks, insertDocument, openDb, restoreState, retrieveTopK } from "./db";
import { NoExtractableTextError, parsePdf } from "./parse";
import type { PGlite } from "@electric-sql/pglite";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const DATA_DIR = "idb://aafno-slice1";
const BUNDLED_SAMPLE_URL = "/sample/sample.pdf";
const BUNDLED_SAMPLE_TITLE = "AAFNO Phase 0 sample document";

function post(event: PipelineEvent): void {
  ctx.postMessage(event);
}

function fail(jobId: string, stage: PipelineStage, error: unknown): void {
  post({ type: "status", jobId, status: "failed" });
  post({ type: "error", jobId, stage, message: error instanceof Error ? error.message : String(error) });
}

// --- Lazily-initialized, worker-lifetime singletons ---

let dbPromise: Promise<PGlite> | null = null;
function getDb(): Promise<PGlite> {
  if (!dbPromise) dbPromise = openDb(DATA_DIR);
  return dbPromise;
}

let embedModelPromise: Promise<EmbedModelHandle> | null = null;
let embedModelWasAlreadyLoaded = false;

function getEmbedModel(jobId: string): Promise<EmbedModelHandle> {
  if (!embedModelPromise) {
    let sawDownload = false;
    embedModelPromise = loadEmbeddingModel({
      onProgress: (info) => {
        // transformers.js emits a "download" status only when bytes are actually fetched (not
        // served from the OPFS/browser cache) — used as the cold-vs-warm heuristic below.
        if (info.status === "download" || info.status === "progress") {
          sawDownload = true;
          post({
            type: "network",
            jobId,
            purpose: "model_download",
            domain: "huggingface.co",
            note: `${info.file ?? EMBEDDING_MODEL_ID}: ${info.status}${info.progress !== undefined ? ` ${info.progress.toFixed(0)}%` : ""}`,
          });
        }
        post({
          type: "progress",
          jobId,
          stage: "init",
          pct: info.progress,
          note: `Loading embedding model: ${info.status}`,
        });
      },
    }).then((model) => {
      // Recorded for MEASUREMENTS.md (AC-5/AC-6): whether this init actually downloaded bytes.
      (model as EmbedModelHandle & { __sawDownload?: boolean }).__sawDownload = sawDownload;
      return model;
    });
  } else {
    embedModelWasAlreadyLoaded = true;
  }
  return embedModelPromise;
}

// --- Request handlers ---

async function handleInit(jobId: string): Promise<void> {
  post({ type: "status", jobId, status: "running" });
  post({ type: "progress", jobId, stage: "init", note: "Detecting browser capabilities" });
  const capabilities = await detectCapabilities();

  const modelStopwatch = new Stopwatch();
  const model = await getEmbedModel(jobId);
  const loadMs = modelStopwatch.elapsedMs();
  const sawDownload = (model as EmbedModelHandle & { __sawDownload?: boolean }).__sawDownload ?? false;
  post({
    type: "progress",
    jobId,
    stage: "init",
    note: `Embedding model ready on ${model.device} in ${loadMs.toFixed(0)}ms (${
      embedModelWasAlreadyLoaded
        ? "already loaded"
        : sawDownload
          ? "cold-load, downloaded weights"
          : "warm-load, served from cache"
    })`,
  });

  post({ type: "progress", jobId, stage: "init", note: "Opening persisted store" });
  const db = await getDb();
  const restored = await restoreState(db);

  const result: InitResult = {
    webgpuAvailable: capabilities.webgpu.available,
    opfsAvailable: capabilities.opfs,
    indexedDbAvailable: capabilities.indexedDb,
    restoredDocumentId: restored.documentId,
    restoredChunkCount: restored.chunkCount,
    modelLoadMs: loadMs,
    modelLoadKind: embedModelWasAlreadyLoaded ? "already-loaded" : sawDownload ? "cold" : "warm",
    modelDevice: model.device,
  };
  post({ type: "status", jobId, status: "complete" });
  post({ type: "result", jobId, result });
}

async function handleRestore(jobId: string): Promise<void> {
  post({ type: "status", jobId, status: "running" });
  const capabilities = await detectCapabilities();
  const modelStopwatch = new Stopwatch();
  const model = await getEmbedModel(jobId);
  const loadMs = modelStopwatch.elapsedMs();
  const sawDownload = (model as EmbedModelHandle & { __sawDownload?: boolean }).__sawDownload ?? false;
  const db = await getDb();
  const restored = await restoreState(db);
  const result: InitResult = {
    webgpuAvailable: capabilities.webgpu.available,
    opfsAvailable: capabilities.opfs,
    indexedDbAvailable: capabilities.indexedDb,
    restoredDocumentId: restored.documentId,
    restoredChunkCount: restored.chunkCount,
    modelLoadMs: loadMs,
    modelLoadKind: embedModelWasAlreadyLoaded ? "already-loaded" : sawDownload ? "cold" : "warm",
    modelDevice: model.device,
  };
  post({ type: "status", jobId, status: "complete" });
  post({ type: "result", jobId, result });
}

async function resolveSourceBytes(
  source: DocumentSource,
): Promise<{ bytes: Uint8Array; title: string; byteSize: number; sourceKind: "bundled" | "uploaded" }> {
  if (source.kind === "bundled") {
    const response = await fetch(BUNDLED_SAMPLE_URL);
    // The bundled sample is an `app_asset` fetch (served by the Vite dev server itself, not a
    // remote destination) — not routed through lib/network.ts, which lives on the main thread.
    if (!response.ok) throw new Error(`Failed to load bundled sample document (HTTP ${response.status})`);
    const buffer = await response.arrayBuffer();
    return {
      bytes: new Uint8Array(buffer),
      title: BUNDLED_SAMPLE_TITLE,
      byteSize: buffer.byteLength,
      sourceKind: "bundled",
    };
  }
  return {
    bytes: new Uint8Array(source.bytes),
    title: source.name,
    byteSize: source.bytes.byteLength,
    sourceKind: "uploaded",
  };
}

async function handleParse(jobId: string, source: DocumentSource): Promise<void> {
  post({ type: "status", jobId, status: "running" });
  post({ type: "progress", jobId, stage: "parse", note: "Reading document bytes" });
  const { bytes, title, byteSize, sourceKind } = await resolveSourceBytes(source);

  post({ type: "progress", jobId, stage: "parse", note: "Parsing PDF locally (liteparse-wasm)" });
  try {
    const parsed = await parsePdf(bytes);
    const documentId = crypto.randomUUID();
    const result: ParseResult = {
      documentId,
      text: parsed.text,
      charLength: parsed.charLength,
      title,
      sourceKind,
      byteSize,
    };
    post({ type: "progress", jobId, stage: "parse", note: `Parsed locally: ${parsed.charLength} characters` });
    post({ type: "status", jobId, status: "complete" });
    post({ type: "result", jobId, result });
  } catch (error) {
    if (error instanceof NoExtractableTextError) {
      fail(jobId, "parse", error);
      return;
    }
    throw error;
  }
}

async function handleIngest(jobId: string, docId: string, text: string, charLength: number): Promise<void> {
  post({ type: "status", jobId, status: "running" });

  post({ type: "progress", jobId, stage: "chunk", note: "Chunking locally (chonkie-ts RecursiveChunker)" });
  const chunks = await chunkText(text);
  post({ type: "progress", jobId, stage: "chunk", note: `Created ${chunks.length} chunks` });

  const model = await getEmbedModel(jobId);
  post({ type: "progress", jobId, stage: "embed", note: `Generating embeddings on this device (${model.device})` });
  const embedStopwatch = new Stopwatch();
  const vectors = await model.embed(chunks.map((chunk) => chunk.text));
  const embedMs = embedStopwatch.elapsedMs();
  const throughput = embeddingThroughput(chunks.length, charLength, embedMs);
  post({
    type: "progress",
    jobId,
    stage: "embed",
    note: `Embedded ${chunks.length} chunks in ${embedMs.toFixed(0)}ms (${throughput.chunksPerSecond.toFixed(2)} chunks/s)`,
  });

  post({ type: "progress", jobId, stage: "store", note: "Storing chunks + vectors locally (PGlite + pgvector)" });
  const db = await getDb();
  const storeStopwatch = new Stopwatch();
  await insertDocument(db, {
    id: docId,
    title: docId,
    sourceKind: "uploaded",
    byteSize: null,
    charLength,
    embedModel: EMBEDDING_MODEL_ID,
    embedDim: model.dimension,
  });
  await insertChunks(
    db,
    chunks.map((chunk, ordinal) => ({
      id: crypto.randomUUID(),
      documentId: docId,
      ordinal,
      text: chunk.text,
      tokenCount: chunk.tokenCount,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      embedding: vectors[ordinal],
    })),
  );
  const storeMs = storeStopwatch.elapsedMs();

  post({ type: "progress", jobId, stage: "index", note: "Attempting pgvector HNSW index" });
  const indexStrategy = await attemptHnswIndex(db);
  post({ type: "progress", jobId, stage: "index", note: `Index strategy: ${indexStrategy}` });

  const result: IngestResult = {
    chunkCount: chunks.length,
    indexStrategy,
    embedMs,
    storeMs,
    chunksPerSecond: throughput.chunksPerSecond,
    charsPerSecond: throughput.charsPerSecond,
  };
  post({ type: "status", jobId, status: "complete" });
  post({ type: "result", jobId, result });
}

async function handleRetrieve(jobId: string, question: string, k: number): Promise<void> {
  post({ type: "status", jobId, status: "running" });
  post({ type: "progress", jobId, stage: "retrieve", note: "Embedding question locally" });
  const model = await getEmbedModel(jobId);
  const [questionEmbedding] = await model.embed([question]);

  post({ type: "progress", jobId, stage: "retrieve", note: `Retrieving top-${k} passages locally` });
  const db = await getDb();
  const retrieveStopwatch = new Stopwatch();
  const { chunks, belowRelevanceThreshold } = await retrieveTopK(db, questionEmbedding, k);
  const retrievalMs = retrieveStopwatch.elapsedMs();

  post({
    type: "progress",
    jobId,
    stage: "retrieve",
    note: belowRelevanceThreshold
      ? "No strongly relevant passages found"
      : `Retrieved ${chunks.length} passages locally in ${retrievalMs.toFixed(0)}ms`,
  });

  const result: RetrieveResult = { question, k, chunks, retrievalMs, belowRelevanceThreshold };
  post({ type: "status", jobId, status: "complete" });
  post({ type: "result", jobId, result });
}

function handleGenerateLocal(jobId: string): void {
  // Stretch goal (D2): local SmolLM2-360M generation. Not implemented in slice 1 — the dev-cloud
  // path (lib/generate.ts, main thread) is the primary generation path. Reported as a clear
  // configuration/capability error rather than hanging (edge case: "no valid endpoint... report a
  // clear configuration error" — the analogous local case is "no local model available").
  fail(
    jobId,
    "generate",
    new Error("Local generation (SmolLM2-360M) is a slice-1 stretch goal and is not implemented."),
  );
}

const REQUEST_STAGE: Record<PipelineRequest["type"], PipelineStage> = {
  init: "init",
  restore: "init",
  parse: "parse",
  ingest: "store",
  retrieve: "retrieve",
  generateLocal: "generate",
  cancel: "init",
};

ctx.addEventListener("message", (event: MessageEvent<PipelineRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      switch (request.type) {
        case "init":
          await handleInit(request.jobId);
          break;
        case "restore":
          await handleRestore(request.jobId);
          break;
        case "parse":
          await handleParse(request.jobId, request.source);
          break;
        case "ingest":
          await handleIngest(request.jobId, request.docId, request.text, request.charLength);
          break;
        case "retrieve":
          await handleRetrieve(request.jobId, request.question, request.k);
          break;
        case "generateLocal":
          handleGenerateLocal(request.jobId);
          break;
        case "cancel":
          post({ type: "status", jobId: request.jobId, status: "cancelled" });
          break;
      }
    } catch (error) {
      fail(request.jobId, REQUEST_STAGE[request.type], error);
    }
  })();
});
