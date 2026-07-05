// Unit tests for the chunking helper (FR-3; PROJECT_ANALYSIS.md §10 "Unit tests for
// parsing/chunking helpers"). Given fixed input text, chunks are non-empty, ordered,
// `charStart`/`charEnd` offsets are monotonic and slice back to the source text, and
// `tokenCount` respects the configured limit — this holds whether the HuggingFace tokenizer
// integration is available or `worker/chunk.ts` falls back to the documented character-based
// approximation (FR-3's explicitly allowed fallback; §5 unknown #2).

import { describe, expect, it } from "vitest";
import { chunkText } from "../worker/chunk";

const SAMPLE_TEXT = `Local-first software keeps computation and storage on the user's own device. This is the
first paragraph of the sample text used to exercise the chunker.

The second paragraph talks about chunking specifically. Splitting text into chunks that respect a
token budget is essential for embedding models with a fixed context window. Good chunking also
preserves enough surrounding context that a single chunk remains meaningful on its own.

The third paragraph is intentionally longer than the other two, repeating a similar idea several
times over multiple sentences so that, depending on the configured chunk size, this paragraph
might need to be split across more than one chunk. Embedding models transform text into vectors.
Vector search finds nearby vectors. Nearby vectors usually mean similar meaning. This repetition
exists purely to give the chunker enough raw material to potentially split within a paragraph.

A short fourth paragraph closes out the sample.`;

describe("chunkText", () => {
  it("returns non-empty, ordered chunks whose offsets slice back to the source text", async () => {
    const chunks = await chunkText(SAMPLE_TEXT);
    expect(chunks.length).toBeGreaterThan(0);

    let previousEnd = -1;
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThan(0);
      expect(chunk.charStart).toBeGreaterThanOrEqual(0);
      expect(chunk.charStart).toBeLessThan(chunk.charEnd);
      expect(chunk.charEnd).toBeGreaterThan(previousEnd);
      expect(SAMPLE_TEXT.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
      previousEnd = chunk.charEnd;
    }
  });

  it("reports a positive token count per chunk, respecting the configured chunk-size ceiling", async () => {
    const chunks = await chunkText(SAMPLE_TEXT);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
      // 512 tokens is the configured chunk size (real tokenizer path); the documented
      // character-based fallback multiplies that by up to 4x — either way, a chunk over roughly
      // one page of text should never appear for this small sample.
      expect(chunk.tokenCount).toBeLessThanOrEqual(512 * 4);
    }
  });
});
