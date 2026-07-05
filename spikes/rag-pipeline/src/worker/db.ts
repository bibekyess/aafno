// PGlite + pgvector persistence (FR-5, FR-6, FR-9, AC-3, AC-4). Owns the DB connection for the
// worker's lifetime (plan "Data / control flow"). This module is deliberately Node-testable (no
// `self`/worker globals) so `test/db.persistence.test.ts` can exercise the real persistence +
// retrieval logic in CI (spec Test Strategy) — only the true browser IndexedDB/OPFS reload is
// manual (recorded in MEASUREMENTS.md).

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { EMBEDDING_DIM, HNSW_INDEX_SQL, RETRIEVE_SQL, SCHEMA_SQL } from "../lib/schema.sql";
import type { IndexStrategy, RetrievedChunk } from "../lib/messages";

export interface DocumentInsert {
  id: string;
  title: string;
  sourceKind: "bundled" | "uploaded";
  byteSize: number | null;
  charLength: number;
  embedModel: string;
  embedDim?: number;
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

export interface RestoredState {
  documentId: string | null;
  chunkCount: number;
}

/** No-relevant-chunks edge case threshold (cosine similarity, 1 = identical). */
export const RELEVANCE_THRESHOLD = 0.2;

function toVectorLiteral(embedding: Float32Array | number[]): string {
  return `[${Array.from(embedding).join(",")}]`;
}

/**
 * Open (or create) the persisted PGlite database and apply the schema. `dataDir` is
 * `idb://aafno-slice1` in the browser worker (spec "Persistence dir"); tests pass a temp
 * filesystem directory to exercise the same close/reopen cycle under Node.
 */
export async function openDb(dataDir?: string): Promise<PGlite> {
  const db = await PGlite.create(dataDir, { extensions: { vector } });
  await db.exec(SCHEMA_SQL);
  return db;
}

/** Attempt the HNSW index (FR-6); on failure, fall back to no index (exact/flat scan). */
export async function attemptHnswIndex(db: PGlite): Promise<IndexStrategy> {
  try {
    await db.exec(HNSW_INDEX_SQL);
    return "hnsw";
  } catch (error) {
    console.warn(
      "[db] pgvector HNSW index creation failed under PGlite — falling back to exact/flat scan:",
      error instanceof Error ? error.message : error,
    );
    return "flat";
  }
}

export async function insertDocument(db: PGlite, doc: DocumentInsert): Promise<void> {
  await db.query(
    `INSERT INTO documents (id, title, source_kind, byte_size, char_length, embed_model, embed_dim)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING;`,
    [doc.id, doc.title, doc.sourceKind, doc.byteSize, doc.charLength, doc.embedModel, doc.embedDim ?? EMBEDDING_DIM],
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

/** Reopen check: does a persisted document + its chunks already exist (AC-3)? */
export async function restoreState(db: PGlite): Promise<RestoredState> {
  const docs = await db.query<{ id: string }>("SELECT id FROM documents ORDER BY parsed_at DESC LIMIT 1;");
  const documentId = docs.rows[0]?.id ?? null;
  if (!documentId) return { documentId: null, chunkCount: 0 };

  const counted = await db.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM chunks WHERE document_id = $1;",
    [documentId],
  );
  return { documentId, chunkCount: counted.rows[0]?.count ?? 0 };
}

/**
 * Top-k cosine retrieval (FR-7, D8). Returns a `belowRelevanceThreshold` flag rather than an
 * empty/error result when nothing is strongly relevant (edge case: "Question with no relevant
 * chunks").
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
