// Local chunk (FR-3). Uses `@chonkiejs/core`'s RecursiveChunker. We request the EmbeddingGemma
// tokenizer for token-accurate sizing, but `@chonkiejs/token` (which supplies HuggingFace
// tokenizers) ships no usable build, so `@chonkiejs/core` falls back to its built-in character
// tokenizer — the documented approximation FR-3 allows for R1 (see the `.catch` below and §5
// unknown #2). `@chonkiejs/token` is aliased to a throwing stub at resolve time so the dynamic
// `import()` inside `@chonkiejs/core` resolves cleanly on every bundler version rather than failing
// build-time import analysis (vite.config.ts + src/shims/chonkiejs-token-shim.ts).

import { RecursiveChunker } from "@chonkiejs/core";
import { createLogger } from "../lib/log";

const log = createLogger("chunk");

// Same model id as the embedding pipeline (worker/embed.ts) — token-accurate sizing against the
// tokenizer that will actually encode these chunks.
const TOKENIZER_MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

// EmbeddingGemma's practical context window for this spike's chunking (not the model's absolute
// max) — leaves headroom for the retrieval-time question embedding to use the same limit.
const DEFAULT_CHUNK_SIZE_TOKENS = 512;
const MIN_CHARACTERS_PER_CHUNK = 24;

export interface TextChunk {
  text: string;
  tokenCount: number;
  charStart: number;
  charEnd: number;
}

let chunkerPromise: ReturnType<typeof RecursiveChunker.create> | null = null;

function getChunker() {
  if (!chunkerPromise) {
    chunkerPromise = RecursiveChunker.create({
      tokenizer: TOKENIZER_MODEL_ID,
      chunkSize: DEFAULT_CHUNK_SIZE_TOKENS,
      minCharactersPerChunk: MIN_CHARACTERS_PER_CHUNK,
    }).catch((error: unknown) => {
      // Documented observation for §5 unknown #2: if the HuggingFace tokenizer integration is
      // unavailable in this environment, fall back to chonkie's built-in character tokenizer
      // (FR-3 explicitly allows a documented approximation when exact integration fails).
      log.warn(
        "Falling back to character-based tokenizer — HuggingFace tokenizer integration " +
          `unavailable (${error instanceof Error ? error.message : String(error)}).`,
      );
      chunkerPromise = null;
      return RecursiveChunker.create({
        chunkSize: DEFAULT_CHUNK_SIZE_TOKENS * 4,
        minCharactersPerChunk: MIN_CHARACTERS_PER_CHUNK,
      });
    });
  }
  return chunkerPromise;
}

export async function chunkText(text: string): Promise<TextChunk[]> {
  const chunker = await getChunker();
  const chunks = await chunker.chunk(text);
  const result = chunks.map((chunk) => ({
    text: chunk.text,
    tokenCount: chunk.tokenCount,
    charStart: chunk.startIndex,
    charEnd: chunk.endIndex,
  }));
  log.debug(`Created ${result.length} chunks from ${text.length} characters`); // FR-14 (metadata only)
  log.content(() => result.map((chunk) => chunk.text)); // FR-16 — chunk bodies, dev-only
  return result;
}
