// Resolver alias target for `@chonkiejs/token` (see vite.config.ts `resolve.alias`).
//
// `@chonkiejs/core`'s `Tokenizer.create(model)` dynamically `import()`s `@chonkiejs/token`
// whenever a non-"character" model is requested (worker/chunk.ts requests EmbeddingGemma), wrapped
// in a try/catch that degrades to the built-in character tokenizer on failure. But `@chonkiejs/token`
// as published ships no `dist/` output, so its `main` (`./dist/index.js`) does not exist — the
// dynamic import can never resolve. Vite's import-analysis resolves that specifier eagerly at
// transform time and fails the whole dev server / build, even though the runtime path is designed
// to fall back gracefully.
//
// Aliasing the specifier to this stub makes the import always resolve. `HuggingFaceTokenizer.create`
// then throws the same "not usable" signal the missing package would have, which `@chonkiejs/core`
// catches and rethrows as a clear error — and which worker/chunk.ts catches to fall back to
// character-based chunking (FR-3's documented approximation). See test/chunk.test.ts.
export const HuggingFaceTokenizer = {
  create(model: string): never {
    throw new Error(
      `@chonkiejs/token is not installed, so the "${model}" tokenizer is unavailable; ` +
        "falling back to @chonkiejs/core's built-in character tokenizer.",
    );
  },
};
