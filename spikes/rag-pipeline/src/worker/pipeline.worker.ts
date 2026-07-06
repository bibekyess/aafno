// Single Web Worker (D3, §10 worker guidelines) owning PGlite + the transformers.js embedding
// pipeline for the worker's lifetime. Handles parse -> chunk -> embed -> store -> retrieve.
// This worker makes NO content-bearing network requests — its only network activity is the
// transformers.js model-weight download, surfaced as `network` events (purpose "model_download")
// so the main thread's network log stays complete (plan "Data / control flow", AC-2).
//
// Slice 2 (A1/A2, plan step 5): hashes bytes before parsing and short-circuits a duplicate upload
// (FR-1..FR-4); adds listDocuments/deleteDocument; restores the whole corpus on init (FR-9);
// surfaces a schema-reset notice (D5/EC-1). Pipeline I/O is traced via `lib/log.ts` (A3) — metadata
// through `debug`, document/prompt content only through the DEV-gated `content()` channel (FR-16).

/// <reference lib="webworker" />

import { detectCapabilities } from "../lib/capabilities";
import { computeContentHash } from "../lib/hash";
import { createLogger } from "../lib/log";
import { Stopwatch, embeddingThroughput } from "../lib/measure";
import type {
  DedupOutcome,
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
import {
  attemptHnswIndex,
  deleteDocument,
  findDocumentByContentHash,
  insertChunks,
  insertDocument,
  listDocuments,
  openDb,
  restoreAllDocuments,
  retrieveTopK,
} from "./db";
import { NoExtractableTextError, parsePdf } from "./parse";
import type { PGlite } from "@electric-sql/pglite";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Same store name as slice 1 — the version gate below (`ensureSchemaVersion`) depends on reopening
// the SAME persisted store to detect and reset a stale pre-slice-2 schema in place (D5/EC-1),
// rather than orphaning the old data under a new name.
const DATA_DIR = "idb://aafno-slice1";
const BUNDLED_SAMPLE_URL = "/sample/sample.pdf";
const BUNDLED_SAMPLE_TITLE = "AAFNO Phase 0 sample document";

const parseLog = createLogger("parse");
const dbLog = createLogger("db");
const retrieveLog = createLogger("retrieve");
const generateLog = createLogger("generate");

function post(event: PipelineEvent): void {
  ctx.postMessage(event);
}

function fail(jobId: string, stage: PipelineStage, error: unknown): void {
  post({ type: "status", jobId, status: "failed" });
  post({ type: "error", jobId, stage, message: error instanceof Error ? error.message : String(error) });
}

// --- Lazily-initialized, worker-lifetime singletons ---

let dbPromise: Promise<{ db: PGlite; wasReset: boolean }> | null = null;
function getDb(): Promise<{ db: PGlite; wasReset: boolean }> {
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
        }
        // Record ONE network-log entry per file, at start ("download") and completion ("done") —
        // never on "progress". transformers.js fires "progress" many times per second per file;
        // emitting a network event on each tick appends a new row to the Privacy Console log and
        // re-renders the panel continuously, pinning the main thread and freezing the tab. The
        // progress bar below still updates every tick (single element, cheap).
        if (info.status === "download" || info.status === "done") {
          post({
            type: "network",
            jobId,
            purpose: "model_download",
            domain: "huggingface.co",
            note: `${info.file ?? EMBEDDING_MODEL_ID}: ${info.status}${info.progress !== undefined ? ` ${info.progress.toFixed(0)}%` : ""}`,
          });
        }
        // The Activity Log records plain-language milestones (FR-12), not per-byte ticks.
        // transformers.js fires "progress"/"progress_total" many times per second while a file
        // downloads; forwarding each as an activity entry floods the log. Emit only lifecycle
        // milestones (initiate/download/done/ready); the noisy tick statuses are dropped.
        if (info.status !== "progress" && info.status !== "progress_total") {
          post({
            type: "progress",
            jobId,
            stage: "init",
            pct: info.progress,
            note: `Loading embedding model: ${info.status}`,
          });
        }
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
  const modelLoadKind = embedModelWasAlreadyLoaded ? "already-loaded" : sawDownload ? "cold" : "warm";
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
  const { db, wasReset } = await getDb();
  if (wasReset) {
    dbLog.warn("Local index was reset — schema version stale (D5/EC-1)");
  }
  const restored = await restoreAllDocuments(db);

  const result: InitResult = {
    webgpuAvailable: capabilities.webgpu.available,
    opfsAvailable: capabilities.opfs,
    indexedDbAvailable: capabilities.indexedDb,
    restoredDocuments: restored.documents,
    restoredChunkCount: restored.totalChunkCount,
    schemaReset: wasReset,
    modelLoadMs: loadMs,
    modelLoadKind,
    modelDevice: model.device,
  };
  dbLog.debug(`Restored ${restored.documents.length} document(s), ${restored.totalChunkCount} chunk(s)`);
  post({ type: "status", jobId, status: "complete" });
  post({ type: "result", jobId, result });
}

async function resolveSourceBytes(source: DocumentSource): Promise<{
  bytes: Uint8Array;
  title: string;
  byteSize: number;
  sourceKind: "bundled" | "uploaded";
}> {
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

  // EC-6: a zero-byte input is surfaced as a clear error rather than silently indexed.
  if (byteSize === 0) {
    fail(jobId, "parse", new Error("The selected file is empty (0 bytes) and cannot be indexed."));
    return;
  }

  parseLog.debug(`Read ${title} (${byteSize} bytes, ${sourceKind})`); // FR-14 (metadata only)
  const contentHash = await computeContentHash(bytes);

  const { db } = await getDb();
  const existing = await findDocumentByContentHash(db, contentHash);
  if (existing) {
    // FR-3: warn-and-skip BEFORE parse/chunk/embed/store — the real dedup decision point.
    parseLog.info(`Duplicate upload detected — already indexed as "${existing.title}" (${existing.id})`);
    const dedup: DedupOutcome = { skipped: true, existingDocumentId: existing.id, existingTitle: existing.title };
    const result: ParseResult = {
      documentId: existing.id,
      text: "",
      charLength: 0,
      title: existing.title,
      sourceKind,
      byteSize,
      contentHash,
      dedup,
    };
    post({ type: "progress", jobId, stage: "parse", note: `This file is already indexed as "${existing.title}"` });
    post({ type: "status", jobId, status: "complete" });
    post({ type: "result", jobId, result });
    return;
  }

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
      contentHash,
      dedup: { skipped: false },
    };
    parseLog.debug(`Parsed locally: ${parsed.charLength} characters`);
    parseLog.content(() => [parsed.text]); // FR-16 — parsed text, dev-only
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

async function handleIngest(
  jobId: string,
  docId: string,
  text: string,
  charLength: number,
  title: string,
  sourceKind: "bundled" | "uploaded",
  contentHash: string,
  byteSize: number | null,
): Promise<void> {
  post({ type: "status", jobId, status: "running" });

  post({ type: "progress", jobId, stage: "chunk", note: "Chunking locally (chonkie-ts RecursiveChunker)" });
  const chunks = await chunkText(text);
  post({ type: "progress", jobId, stage: "chunk", note: `Created ${chunks.length} chunks` });

  const model = await getEmbedModel(jobId);
  post({ type: "progress", jobId, stage: "embed", note: `Generating embeddings on this device (${model.device})` });
  const embedStopwatch = new Stopwatch();
  const vectors = await model.embed(
    chunks.map((chunk) => chunk.text),
    {
      // One progress note per batch (not per chunk) — bounded to a handful of entries even for
      // large documents, so it informs without flooding the Activity Log.
      onBatch: (done, total) => {
        post({ type: "progress", jobId, stage: "embed", note: `Embedded ${done}/${total} chunks` });
      },
    },
  );
  const embedMs = embedStopwatch.elapsedMs();
  const throughput = embeddingThroughput(chunks.length, charLength, embedMs);
  createLogger("embed").debug(
    `Embedded ${chunks.length} chunks (dim=${model.dimension}) in ${embedMs.toFixed(0)}ms on ${model.device}`,
  ); // FR-14 (metadata only)
  post({
    type: "progress",
    jobId,
    stage: "embed",
    note: `Embedded ${chunks.length} chunks in ${embedMs.toFixed(0)}ms (${throughput.chunksPerSecond.toFixed(2)} chunks/s)`,
  });

  post({ type: "progress", jobId, stage: "store", note: "Storing chunks + vectors locally (PGlite + pgvector)" });
  const { db } = await getDb();
  const storeStopwatch = new Stopwatch();
  await insertDocument(db, {
    id: docId,
    title,
    sourceKind,
    byteSize,
    charLength,
    embedModel: EMBEDDING_MODEL_ID,
    embedDim: model.dimension,
    contentHash,
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
    dedup: { skipped: false },
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
  const { db } = await getDb();
  const retrieveStopwatch = new Stopwatch();
  const { chunks, belowRelevanceThreshold } = await retrieveTopK(db, questionEmbedding, k);
  const retrievalMs = retrieveStopwatch.elapsedMs();

  retrieveLog.debug(
    `Retrieved ${chunks.length} chunk(s) in ${retrievalMs.toFixed(0)}ms, scores=[${chunks
      .map((chunk) => chunk.similarity.toFixed(3))
      .join(", ")}]`,
  ); // FR-14 — scores are metadata, not content
  retrieveLog.content(() => [question, ...chunks.map((chunk) => chunk.text)]); // FR-16 — query + passage bodies

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

async function handleListDocuments(jobId: string): Promise<void> {
  post({ type: "status", jobId, status: "running" });
  const { db } = await getDb();
  const documents = await listDocuments(db);
  post({ type: "status", jobId, status: "complete" });
  post({ type: "result", jobId, result: { documents } });
}

async function handleDeleteDocument(jobId: string, documentId: string): Promise<void> {
  post({ type: "status", jobId, status: "running" });
  const { db } = await getDb();
  const deletedChunkCount = await deleteDocument(db, documentId);
  dbLog.info(`Deleted document ${documentId} (${deletedChunkCount} chunk(s) cascaded)`);
  post({ type: "status", jobId, status: "complete" });
  post({ type: "result", jobId, result: { documentId, deletedChunkCount } });
}

function handleGenerateLocal(jobId: string): void {
  // Stretch goal (D2): local SmolLM2-360M generation. Not implemented in slice 1 — the dev-cloud
  // path (lib/generate.ts, main thread) is the primary generation path. Reported as a clear
  // configuration/capability error rather than hanging (edge case: "no valid endpoint... report a
  // clear configuration error" — the analogous local case is "no local model available").
  generateLog.warn("Local generation requested but not implemented (slice-1 stretch goal)");
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
  listDocuments: "store",
  deleteDocument: "store",
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
          // `restore` reopens the same persisted DB/model state as `init` (App.tsx's `init` call
          // already restores on reload) — no distinct behavior, so it delegates rather than
          // duplicating handleInit's body.
          await handleInit(request.jobId);
          break;
        case "parse":
          await handleParse(request.jobId, request.source);
          break;
        case "ingest":
          await handleIngest(
            request.jobId,
            request.docId,
            request.text,
            request.charLength,
            request.title,
            request.sourceKind,
            request.contentHash,
            request.byteSize,
          );
          break;
        case "retrieve":
          await handleRetrieve(request.jobId, request.question, request.k);
          break;
        case "listDocuments":
          await handleListDocuments(request.jobId);
          break;
        case "deleteDocument":
          await handleDeleteDocument(request.jobId, request.documentId);
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
