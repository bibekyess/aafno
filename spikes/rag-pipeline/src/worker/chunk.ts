// Local chunk (FR-3). Uses `@chonkiejs/core`'s RecursiveChunker configured with the EmbeddingGemma
// tokenizer via `@chonkiejs/token` (research finding, plan §"New dependencies": chonkie-ts accepts
// the HuggingFace tokenizer for token-accurate sizing — no approximation fallback needed for R1).
//
// We deliberately do NOT statically import `@chonkiejs/token` here: `@chonkiejs/core`'s
// `Tokenizer.create(modelName)` dynamically `import()`s it internally only when a non-"character"
// tokenizer name is requested (see its README "How It Works"), and wraps that in a try/catch that
// raises a clear, catchable error if the package isn't usable. A static import would force every
// bundler (and this spike's own dependency resolution) to resolve `@chonkiejs/token` eagerly even
// when the character-based fallback below ends up being used.

import { RecursiveChunker } from "@chonkiejs/core";

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
      console.warn(
        "[chunk] Falling back to character-based tokenizer — HuggingFace tokenizer integration " +
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
  return chunks.map((chunk) => ({
    text: chunk.text,
    tokenCount: chunk.tokenCount,
    charStart: chunk.startIndex,
    charEnd: chunk.endIndex,
  }));
}
