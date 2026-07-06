// Integration test for persistence (plan "Test Strategy"; PROJECT_ANALYSIS.md §10 "Integration
// tests for storage persistence"). Runs PGlite in Node with a temp filesystem `dataDir`, applies
// the DDL, inserts a document + chunks with 768-dim vectors, closes, reopens with the same
// `dataDir`, and asserts rows survive and a cosine-`ORDER BY` retrieval returns them (AC-3's
// persistence logic; AC-4's HNSW-or-fallback outcome). The true browser IndexedDB/OPFS reload is
// exercised manually and recorded in MEASUREMENTS.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EMBEDDING_DIM } from "../lib/schema.sql";
import { attemptHnswIndex, insertChunks, insertDocument, openDb, restoreState, retrieveTopK } from "../worker/db";

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
  "PGlite + pgvector persistence across close/reopen (AC-3, AC-4)",
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

      const db1 = await openDb(dir);
      await insertDocument(db1, {
        id: "doc-1",
        title: "Test document",
        sourceKind: "uploaded",
        byteSize: 100,
        charLength: 24,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
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
      const db2 = await openDb(dir);
      const restored = await restoreState(db2);
      expect(restored.documentId).toBe("doc-1");
      expect(restored.chunkCount).toBe(2);

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

      const db = await openDb(dir);
      await insertDocument(db, {
        id: "doc-2",
        title: "Another document",
        sourceKind: "uploaded",
        byteSize: 50,
        charLength: 10,
        embedModel: "test-model",
        embedDim: EMBEDDING_DIM,
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
  },
  PERSISTENCE_SUITE_TIMEOUT_MS,
);
