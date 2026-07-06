// Integration tests for persistence (plan "Test Strategy"; PROJECT_ANALYSIS.md §10 "Integration
// tests for storage persistence"). Runs PGlite in Node with a temp filesystem `dataDir`, applies
// the DDL, inserts documents + chunks with 768-dim vectors, closes, reopens with the same
// `dataDir`, and asserts rows survive and a cosine-`ORDER BY` retrieval returns them (AC-3's
// persistence logic; AC-4's HNSW-or-fallback outcome). The true browser IndexedDB/OPFS reload is
// exercised manually and recorded in MEASUREMENTS.md.
//
// Slice 2 additions (plan step 12): dedup-skip (AC-1/AC-2), cascade delete + post-delete
// retrieval (AC-3, R1), multi-doc restore (AC-6), and the schema-version reset (AC-9/EC-1).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, describe, expect, it } from "vitest";
import { EMBEDDING_DIM, SCHEMA_SQL } from "../lib/schema.sql";
import {
  attemptHnswIndex,
  deleteDocument,
  ensureSchemaVersion,
  findDocumentByContentHash,
  insertChunks,
  insertDocument,
  listDocuments,
  openDb,
  restoreAllDocuments,
  retrieveTopK,
} from "../worker/db";

/** Deterministic pseudo-embedding so retrieval ordering is stable across runs. */
function makeVector(dim: number, seed: number): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(seed * 13.37 + i));
}

function negate(vector: number[]): number[] {
  return vector.map((value) => -value);
}

// PGlite persistence tests do real-filesystem open/DDL/insert/close/reopen cycles that exceed
// Vitest's 5s default on slower or loaded machines (notably CI runners), timing out without ever
// failing an assertion. Give the suite generous headroom.
const PERSISTENCE_SUITE_TIMEOUT_MS = 30_000;

describe(
  "PGlite + pgvector persistence across close/reopen (AC-3, AC-4, AC-6, AC-9)",
  () => {
    const tempDirs: string[] = [];

    function makeTempDir(): string {
      const dir = mkdtempSync(join(tmpdir(), "aafno-pglite-"));
      tempDirs.push(dir);
      return dir;
    }

    afterAll(() => {
      for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    });

    it("persists a document + chunks across a close/reopen cycle and retrieves the exact-match chunk first", async () => {
      const dir = makeTempDir();
      const vectorA = makeVector(EMBEDDING_DIM, 1);
      const vectorB = makeVector(EMBEDDING_DIM, 2);

      const { db: db1 } = await openDb(dir);
      await insertDocument(db1, {
        id: "doc-1",
        title: "Test document",
        sourceKind: "uploaded",
        byteSize: 100,
        charLength: 24,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "hash-doc-1",
      });
      await insertChunks(db1, [
        {
          id: "chunk-1",
          documentId: "doc-1",
          ordinal: 0,
          text: "first chunk",
          tokenCount: 2,
          charStart: 0,
          charEnd: 11,
          embedding: vectorA,
        },
        {
          id: "chunk-2",
          documentId: "doc-1",
          ordinal: 1,
          text: "second chunk",
          tokenCount: 2,
          charStart: 12,
          charEnd: 24,
          embedding: vectorB,
        },
      ]);
      const indexStrategy = await attemptHnswIndex(db1);
      expect(["hnsw", "flat"]).toContain(indexStrategy);
      await db1.close();

      // Reopen with the SAME dataDir — this is the persistence assertion.
      const { db: db2, wasReset } = await openDb(dir);
      expect(wasReset).toBe(false); // already current schema — nothing to reset
      const restored = await restoreAllDocuments(db2);
      expect(restored.documents).toHaveLength(1);
      expect(restored.documents[0].documentId).toBe("doc-1");
      expect(restored.totalChunkCount).toBe(2);

      const { chunks, belowRelevanceThreshold } = await retrieveTopK(db2, vectorA, 1);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkId).toBe("chunk-1");
      expect(chunks[0].similarity).toBeCloseTo(1, 5);
      expect(belowRelevanceThreshold).toBe(false);
      await db2.close();
    });

    it("flags a query with no strongly relevant stored vectors as belowRelevanceThreshold", async () => {
      const dir = makeTempDir();
      const vectorA = makeVector(EMBEDDING_DIM, 3);

      const { db } = await openDb(dir);
      await insertDocument(db, {
        id: "doc-2",
        title: "Another document",
        sourceKind: "uploaded",
        byteSize: 50,
        charLength: 10,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "hash-doc-2",
      });
      await insertChunks(db, [
        {
          id: "chunk-3",
          documentId: "doc-2",
          ordinal: 0,
          text: "only chunk",
          tokenCount: 2,
          charStart: 0,
          charEnd: 10,
          embedding: vectorA,
        },
      ]);

      // Query with the exact opposite vector — cosine similarity should be ~-1, well below the
      // relevance threshold (edge case: "Question with no relevant chunks").
      const { chunks, belowRelevanceThreshold } = await retrieveTopK(db, negate(vectorA), 5);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].similarity).toBeLessThan(0);
      expect(belowRelevanceThreshold).toBe(true);
      await db.close();
    });

    it("dedup: finds an existing document by content hash and skips a second insert with the same hash (AC-1)", async () => {
      const dir = makeTempDir();
      const { db } = await openDb(dir);

      expect(await findDocumentByContentHash(db, "shared-hash")).toBeNull();

      await insertDocument(db, {
        id: "doc-dup-1",
        title: "Original",
        sourceKind: "uploaded",
        byteSize: 10,
        charLength: 5,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "shared-hash",
      });

      const found = await findDocumentByContentHash(db, "shared-hash");
      expect(found).toEqual({ id: "doc-dup-1", title: "Original" });
      expect(await findDocumentByContentHash(db, "no-such-hash")).toBeNull();

      // A second insert with the SAME content_hash but a different id must not create a new row
      // (the ON CONFLICT (content_hash) DO NOTHING backstop).
      await insertDocument(db, {
        id: "doc-dup-2",
        title: "Should not appear",
        sourceKind: "uploaded",
        byteSize: 10,
        charLength: 5,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "shared-hash",
      });

      const documents = await listDocuments(db);
      expect(documents).toHaveLength(1);
      expect(documents[0].documentId).toBe("doc-dup-1");
      expect(documents[0].chunkCount).toBe(0);
      await db.close();
    });

    it("dedup: a different content hash inserts a distinct second document (AC-2)", async () => {
      const dir = makeTempDir();
      const { db } = await openDb(dir);

      await insertDocument(db, {
        id: "doc-a",
        title: "Doc A",
        sourceKind: "uploaded",
        byteSize: 10,
        charLength: 5,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "hash-a",
      });
      await insertDocument(db, {
        id: "doc-b",
        title: "Doc B",
        sourceKind: "uploaded",
        byteSize: 10,
        charLength: 5,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "hash-b",
      });

      const documents = await listDocuments(db);
      expect(documents.map((doc) => doc.documentId).sort()).toEqual(["doc-a", "doc-b"]);
      await db.close();
    });

    it("cascade delete: removes a document + its chunks, leaves other documents intact, and hides its chunks from retrieval (AC-3, R1)", async () => {
      const dir = makeTempDir();
      const vectorA = makeVector(EMBEDDING_DIM, 5);
      const vectorB = makeVector(EMBEDDING_DIM, 6);

      const { db } = await openDb(dir);
      await insertDocument(db, {
        id: "doc-keep",
        title: "Keep me",
        sourceKind: "uploaded",
        byteSize: 10,
        charLength: 5,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "hash-keep",
      });
      await insertDocument(db, {
        id: "doc-delete",
        title: "Delete me",
        sourceKind: "uploaded",
        byteSize: 10,
        charLength: 5,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "hash-delete",
      });
      await insertChunks(db, [
        {
          id: "chunk-keep",
          documentId: "doc-keep",
          ordinal: 0,
          text: "kept chunk",
          tokenCount: 2,
          charStart: 0,
          charEnd: 10,
          embedding: vectorA,
        },
        {
          id: "chunk-delete",
          documentId: "doc-delete",
          ordinal: 0,
          text: "deleted chunk",
          tokenCount: 2,
          charStart: 0,
          charEnd: 13,
          embedding: vectorB,
        },
      ]);
      await attemptHnswIndex(db);

      const deletedChunkCount = await deleteDocument(db, "doc-delete");
      expect(deletedChunkCount).toBe(1);

      const documents = await listDocuments(db);
      expect(documents).toHaveLength(1);
      expect(documents[0].documentId).toBe("doc-keep");

      // The deleted document's chunk must never come back from retrieval, regardless of whether
      // HNSW or flat scan is in effect (R1).
      const { chunks } = await retrieveTopK(db, vectorB, 5);
      expect(chunks.every((chunk) => chunk.documentId !== "doc-delete")).toBe(true);
      expect(chunks.some((chunk) => chunk.documentId === "doc-keep")).toBe(true);
      await db.close();
    });

    it("cascade delete: deleting the last document leaves an empty corpus and retrieval reports belowRelevanceThreshold (EC-3, EC-4)", async () => {
      const dir = makeTempDir();
      const vectorA = makeVector(EMBEDDING_DIM, 7);

      const { db } = await openDb(dir);
      await insertDocument(db, {
        id: "doc-only",
        title: "Only document",
        sourceKind: "uploaded",
        byteSize: 10,
        charLength: 5,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "hash-only",
      });
      await insertChunks(db, [
        {
          id: "chunk-only",
          documentId: "doc-only",
          ordinal: 0,
          text: "only chunk",
          tokenCount: 2,
          charStart: 0,
          charEnd: 10,
          embedding: vectorA,
        },
      ]);

      await deleteDocument(db, "doc-only");

      expect(await listDocuments(db)).toEqual([]);
      const { chunks, belowRelevanceThreshold } = await retrieveTopK(db, vectorA, 5);
      expect(chunks).toHaveLength(0);
      expect(belowRelevanceThreshold).toBe(true);
      await db.close();
    });

    it("restores ALL N (N>=2) indexed documents with correct chunk counts, matching listDocuments (AC-6)", async () => {
      const dir = makeTempDir();
      const docs = ["multi-1", "multi-2", "multi-3"];

      const { db: db1 } = await openDb(dir);
      for (const [index, id] of docs.entries()) {
        await insertDocument(db1, {
          id,
          title: `Document ${index}`,
          sourceKind: "uploaded",
          byteSize: 10,
          charLength: 5,
          embedModel: "test-model",
          embedDim: EMBEDDING_DIM,
          contentHash: `hash-${id}`,
        });
        await insertChunks(db1, [
          {
            id: `${id}-chunk-0`,
            documentId: id,
            ordinal: 0,
            text: `chunk for ${id}`,
            tokenCount: 2,
            charStart: 0,
            charEnd: 10,
            embedding: makeVector(EMBEDDING_DIM, index + 10),
          },
          {
            id: `${id}-chunk-1`,
            documentId: id,
            ordinal: 1,
            text: `second chunk for ${id}`,
            tokenCount: 2,
            charStart: 11,
            charEnd: 20,
            embedding: makeVector(EMBEDDING_DIM, index + 20),
          },
        ]);
      }
      await db1.close();

      const { db: db2 } = await openDb(dir);
      const restored = await restoreAllDocuments(db2);
      expect(restored.documents).toHaveLength(3);
      expect(restored.documents.map((doc) => doc.documentId).sort()).toEqual([...docs].sort());
      for (const doc of restored.documents) expect(doc.chunkCount).toBe(2);
      expect(restored.totalChunkCount).toBe(6);

      const listed = await listDocuments(db2);
      expect(listed).toEqual(restored.documents);
      await db2.close();
    });

    it("does NOT report a reset on a brand-new profile's very first open (nothing existed to reset)", async () => {
      const dir = makeTempDir();
      const { db, wasReset } = await openDb(dir);
      expect(wasReset).toBe(false);
      await db.close();
    });

    it("resets a pre-existing slice-1-shaped DB (no content_hash, no schema_meta) on reopen (AC-9/EC-1)", async () => {
      const dir = makeTempDir();

      // Build a slice-1-shaped DB directly (bypassing openDb/SCHEMA_SQL's content_hash column and
      // schema_meta table) to simulate a DB persisted before slice 2 shipped.
      const legacyDb = await PGlite.create(dir, { extensions: { vector } });
      await legacyDb.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS documents (
          id           TEXT PRIMARY KEY,
          title        TEXT NOT NULL,
          source_kind  TEXT NOT NULL,
          byte_size    INTEGER,
          char_length  INTEGER NOT NULL,
          parsed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          embed_model  TEXT NOT NULL,
          embed_dim    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunks (
          id           TEXT PRIMARY KEY,
          document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          ordinal      INTEGER NOT NULL,
          text         TEXT NOT NULL,
          token_count  INTEGER NOT NULL,
          char_start   INTEGER NOT NULL,
          char_end     INTEGER NOT NULL,
          embedding    vector(${EMBEDDING_DIM}) NOT NULL
        );
      `);
      await legacyDb.query(
        `INSERT INTO documents (id, title, source_kind, byte_size, char_length, embed_model, embed_dim)
         VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        ["legacy-doc", "Pre-slice-2 document", "uploaded", 10, 5, "test-model", EMBEDDING_DIM],
      );
      await legacyDb.close();

      // Reopen via the real slice-2 openDb() — this is the code path App/pipeline.worker use.
      const { db, wasReset } = await openDb(dir);
      expect(wasReset).toBe(true);

      // The new schema is present: content_hash exists and dedup/list work normally.
      await insertDocument(db, {
        id: "fresh-doc",
        title: "Fresh document",
        sourceKind: "uploaded",
        byteSize: 10,
        charLength: 5,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
        contentHash: "fresh-hash",
      });
      const documents = await listDocuments(db);
      expect(documents).toHaveLength(1);
      expect(documents[0].documentId).toBe("fresh-doc");
      await db.close();
    });

    it("ensureSchemaVersion returns false and applies SCHEMA_SQL idempotently once current", async () => {
      const dir = makeTempDir();
      const { db } = await openDb(dir);
      expect(await ensureSchemaVersion(db)).toBe(false);
      await db.exec(SCHEMA_SQL); // idempotent re-apply must not throw
      await db.close();
    });
  },
  PERSISTENCE_SUITE_TIMEOUT_MS,
);
