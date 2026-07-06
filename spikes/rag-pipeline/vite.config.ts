import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Spike harness (spikes/rag-pipeline) — see PROJECT_ANALYSIS.md §10 #5: spike code is typed
// but not production-polished. No production app shell is scaffolded here (Phase 1 concern).

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // See src/shims/node-crypto-shim.ts: only needed to satisfy @chonkiejs/core's dead-code
      // handshake imports, never actually invoked.
      "node:crypto": fileURLToPath(new URL("./src/shims/node-crypto-shim.ts", import.meta.url)),
      // `@chonkiejs/core` dynamically `import()`s `@chonkiejs/token` for non-"character" tokenizers,
      // but that package ships no `dist/` so the specifier is unresolvable — failing Vite's eager
      // import-analysis on any version. Aliasing it to a local stub makes the import always resolve;
      // the stub throws, which @chonkiejs/core catches to fall back to its character tokenizer
      // (worker/chunk.ts, exercised by test/chunk.test.ts). See src/shims/chonkiejs-token-shim.ts.
      "@chonkiejs/token": fileURLToPath(new URL("./src/shims/chonkiejs-token-shim.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    // PGlite and transformers.js ship their own WASM/worker assets; let them load natively
    // instead of being pre-bundled, which can break their internal asset resolution.
    exclude: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "@huggingface/transformers"],
  },
  worker: {
    format: "es",
  },
  define: {
    // Build-time seam for ADR #4 (dev-cloud compile-time exclusion): the dev-cloud generation
    // path in lib/generate.ts is guarded by this constant so it is tree-shakeable out of any
    // non-dev build. Slice 1 is dev-only by nature; this establishes the seam Phase 1 formalizes.
    __DEV_CLOUD__: JSON.stringify(true),
  },
  test: {
    // Node environment: test/db.persistence.test.ts exercises real PGlite persistence under
    // Node (spec Test Strategy); the true browser IndexedDB/OPFS reload is manual (MEASUREMENTS.md).
    environment: "node",
    include: ["src/test/**/*.test.ts"],
  },
});
