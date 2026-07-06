// PGlite + pgvector persistence (FR-5, FR-6, FR-9, AC-3, AC-4). Owns the DB connection for the
// worker's lifetime (plan "Data / control flow"). This module is deliberately Node-testable (no
// `self`/worker globals) so `test/db.persistence.test.ts` can exercise the real persistence +
// retrieval logic in CI (spec Test Strategy) — only the true browser IndexedDB/OPFS reload is
// manual (recorded in MEASUREMENTS.md).
//
// Slice 2 (A1/A2, plan step 2): dedup identity is `content_hash` (not a fresh UUID per upload);
// restore/list are corpus-wide (not latest-doc-only); delete cascades chunks via the existing
// `ON DELETE CASCADE`; `ensureSchemaVersion` drops/recreates a stale (pre-slice-2) local DB in
// place with a visible caller-surfaced notice (D5/EC-1) — see ADR:
// content-hash-dedup-multi-document-store.

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { EMBEDDING_DIM, HNSW_INDEX_SQL, RETRIEVE_SQL, SCHEMA_SQL, SCHEMA_VERSION } from "../lib/schema.sql";
import type { DocumentSummary, IndexStrategy, RetrievedChunk } from "../lib/messages";
import { createLogger } from "../lib/log";

const log = createLogger("db");

export interface DocumentInsert {
  id: string;
  title: string;
  sourceKind: "bundled" | "uploaded";
  byteSize: number | null;
  charLength: number;
  embedModel: string;
  embedDim?: number;
  contentHash: string;
}

export interface ChunkInsert {
  id: string;
  documentId: string;
  ordinal: number;
  text: string;
  tokenCount: number;
  charStart: number;
  charEnd: number;
  embedding: Float32Array | number[];
}

export interface RestoredCorpus {
  documents: DocumentSummary[];
  totalChunkCount: number;
}

/** No-relevant-chunks edge case threshold (cosine similarity, 1 = identical). */
export const RELEVANCE_THRESHOLD = 0.2;

function toVectorLiteral(embedding: Float32Array | number[]): string {
  return `[${Array.from(embedding).join(",")}]`;
}

async function tableExists(db: PGlite, tableName: string): Promise<boolean> {
  const result = await db.query<{ present: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS present;",
    [tableName],
  );
  return result.rows[0]?.present ?? false;
}

async function columnExists(db: PGlite, tableName: string, columnName: string): Promise<boolean> {
  const result = await db.query<{ present: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2) AS present;",
    [tableName, columnName],
  );
  return result.rows[0]?.present ?? false;
}

/**
 * Version gate (D5, EC-1, AC-9): a pre-slice-2 DB has no `content_hash` column and no
 * `schema_meta` row at or above `SCHEMA_VERSION`. Rather than a real migration (a deliberate
 * spike-only choice), such a DB is dropped and recreated in place; the caller (`openDb`) surfaces
 * the returned `true` as a visible user-facing notice. Returns `false` when the schema is already
 * current — no data is touched.
 */
export async function ensureSchemaVersion(db: PGlite): Promise<boolean> {
  const hasSchemaMeta = await tableExists(db, "schema_meta");
  const hasContentHash = await columnExists(db, "documents", "content_hash");
  let currentVersion = 0;
  if (hasSchemaMeta) {
    const result = await db.query<{ version: number }>(
      "SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1;",
    );
    currentVersion = result.rows[0]?.version ?? 0;
  }

  const needsReset = !hasSchemaMeta || !hasContentHash || currentVersion < SCHEMA_VERSION;
  if (!needsReset) return false;

  log.warn("Schema version stale or missing — resetting local store", {
    hasSchemaMeta,
    hasContentHash,
    currentVersion,
    targetVersion: SCHEMA_VERSION,
  });
  await db.exec("DROP TABLE IF EXISTS chunks, documents, schema_meta CASCADE;");
  await db.exec(SCHEMA_SQL);
  await db.query("INSERT INTO schema_meta (version) VALUES ($1);", [SCHEMA_VERSION]);
  return true;
}

/**
 * Open (or create) the persisted PGlite database and apply the schema. `dataDir` is
 * `idb://aafno-slice1` in the browser worker — the same store name slice 1 used (spec "Persistence
 * dir"); tests pass a temp filesystem directory to exercise the same close/reopen cycle under
 * Node. `wasReset` is `true` when a stale (pre-slice-2) schema was detected and dropped/recreated
 * (D5/EC-1/AC-9).
 */
export async function openDb(dataDir?: string): Promise<{ db: PGlite; wasReset: boolean }> {
  const db = await PGlite.create(dataDir, { extensions: { vector } });
  await db.exec(SCHEMA_SQL);
  const wasReset = await ensureSchemaVersion(db);
  return { db, wasReset };
}

/** Attempt the HNSW index (FR-6); on failure, fall back to no index (exact/flat scan). */
export async function attemptHnswIndex(db: PGlite): Promise<IndexStrategy> {
  try {
    await db.exec(HNSW_INDEX_SQL);
    return "hnsw";
  } catch (error) {
    log.warn(
      "pgvector HNSW index creation failed under PGlite — falling back to exact/flat scan:",
      error instanceof Error ? error.message : error,
    );
    return "flat";
  }
}

/** Byte-exact dedup lookup (FR-1..FR-4): does a document with this content hash already exist? */
export async function findDocumentByContentHash(
  db: PGlite,
  contentHash: string,
): Promise<{ id: string; title: string } | null> {
  const result = await db.query<{ id: string; title: string }>(
    "SELECT id, title FROM documents WHERE content_hash = $1;",
    [contentHash],
  );
  return result.rows[0] ?? null;
}

export async function insertDocument(db: PGlite, doc: DocumentInsert): Promise<void> {
  await db.query(
    `INSERT INTO documents (id, title, source_kind, byte_size, char_length, embed_model, embed_dim, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (content_hash) DO NOTHING;`,
    [
      doc.id,
      doc.title,
      doc.sourceKind,
      doc.byteSize,
      doc.charLength,
      doc.embedModel,
      doc.embedDim ?? EMBEDDING_DIM,
      doc.contentHash,
    ],
  );
}

export async function insertChunks(db: PGlite, chunks: ChunkInsert[]): Promise<void> {
  for (const chunk of chunks) {
    await db.query(
      `INSERT INTO chunks (id, document_id, ordinal, text, token_count, char_start, char_end, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
       ON CONFLICT (document_id, ordinal) DO NOTHING;`,
      [
        chunk.id,
        chunk.documentId,
        chunk.ordinal,
        chunk.text,
        chunk.tokenCount,
        chunk.charStart,
        chunk.charEnd,
        toVectorLiteral(chunk.embedding),
      ],
    );
  }
}

/** Store a document + its chunks, then attempt HNSW. Returns the definitive index outcome (AC-4). */
export async function storeDocumentAndChunks(
  db: PGlite,
  doc: DocumentInsert,
  chunks: ChunkInsert[],
): Promise<IndexStrategy> {
  await insertDocument(db, doc);
  await insertChunks(db, chunks);
  return attemptHnswIndex(db);
}

/** Every indexed document with its chunk count (A2, FR-5, FR-6), ordered oldest-first. */
export async function listDocuments(db: PGlite): Promise<DocumentSummary[]> {
  const result = await db.query<{
    id: string;
    title: string;
    source_kind: "bundled" | "uploaded";
    char_length: number;
    chunk_count: number;
  }>(
    `SELECT documents.id, documents.title, documents.source_kind, documents.char_length,
            COUNT(chunks.id)::int AS chunk_count
     FROM documents
     LEFT JOIN chunks ON chunks.document_id = documents.id
     GROUP BY documents.id
     ORDER BY documents.parsed_at ASC;`,
  );
  return result.rows.map((row) => ({
    documentId: row.id,
    title: row.title,
    chunkCount: row.chunk_count,
    sourceKind: row.source_kind,
    charLength: row.char_length,
  }));
}

/**
 * Delete a document and cascade-delete its chunks (FR-7; `chunks.document_id … ON DELETE CASCADE`
 * does the cascade). Returns the number of chunks that were removed with it.
 */
export async function deleteDocument(db: PGlite, documentId: string): Promise<number> {
  const counted = await db.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM chunks WHERE document_id = $1;",
    [documentId],
  );
  const deletedChunkCount = counted.rows[0]?.count ?? 0;
  await db.query("DELETE FROM documents WHERE id = $1;", [documentId]);
  return deletedChunkCount;
}

/** Restore ALL indexed documents on reload (FR-9, AC-6) — replaces the slice-1 latest-doc-only restore. */
export async function restoreAllDocuments(db: PGlite): Promise<RestoredCorpus> {
  const documents = await listDocuments(db);
  const totalChunkCount = documents.reduce((sum, doc) => sum + doc.chunkCount, 0);
  return { documents, totalChunkCount };
}

/**
 * Top-k cosine retrieval (FR-7, D8). Corpus-wide by construction — `RETRIEVE_SQL` carries no
 * `document_id` filter (D4), so results can be drawn from any indexed document (AC-5). Returns a
 * `belowRelevanceThreshold` flag rather than an empty/error result when nothing is strongly
 * relevant (edge case: "Question with no relevant chunks").
 */
export async function retrieveTopK(
  db: PGlite,
  questionEmbedding: Float32Array | number[],
  k: number,
): Promise<{ chunks: RetrievedChunk[]; belowRelevanceThreshold: boolean }> {
  const literal = toVectorLiteral(questionEmbedding);
  const result = await db.query<{
    id: string;
    document_id: string;
    ordinal: number;
    text: string;
    char_start: number;
    char_end: number;
    similarity: number;
  }>(RETRIEVE_SQL, [literal, k]);

  const chunks: RetrievedChunk[] = result.rows.map((row) => ({
    chunkId: row.id,
    documentId: row.document_id,
    ordinal: row.ordinal,
    text: row.text,
    charStart: row.char_start,
    charEnd: row.char_end,
    similarity: row.similarity,
  }));

  const belowRelevanceThreshold = chunks.length === 0 || chunks[0].similarity < RELEVANCE_THRESHOLD;
  return { chunks, belowRelevanceThreshold };
}
