import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Spike harness (spikes/rag-pipeline) — see PROJECT_ANALYSIS.md §10 #5: spike code is typed
// but not production-polished. No production app shell is scaffolded here (Phase 1 concern).
// `@chonkiejs/token` is an OPTIONAL peer of `@chonkiejs/core` (dynamically `import()`-ed only when
// a non-"character" tokenizer name is requested, and wrapped in a try/catch there — see
// worker/chunk.ts). As published, this package ships no `dist/` output at all, so any bundler that
// tries to eagerly resolve it fails the whole build even though the code path that references it
// is designed to degrade gracefully at runtime. Marking it external keeps that dynamic import
// unresolved at build time, exactly matching how it already behaves at runtime in this environment
// (worker/chunk.ts's fallback to character-based chunking, exercised by test/chunk.test.ts).
const EXTERNALIZE_BROKEN_OPTIONAL_DEPS = ["@chonkiejs/token"];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // See src/shims/node-crypto-shim.ts: only needed to satisfy @chonkiejs/core's dead-code
      // handshake imports, never actually invoked.
      "node:crypto": fileURLToPath(new URL("./src/shims/node-crypto-shim.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    // PGlite and transformers.js ship their own WASM/worker assets; let them load natively
    // instead of being pre-bundled, which can break their internal asset resolution.
    exclude: [
      "@electric-sql/pglite",
      "@electric-sql/pglite-pgvector",
      "@huggingface/transformers",
      ...EXTERNALIZE_BROKEN_OPTIONAL_DEPS,
    ],
  },
  build: {
    rollupOptions: {
      external: EXTERNALIZE_BROKEN_OPTIONAL_DEPS,
    },
  },
  worker: {
    format: "es",
    rollupOptions: {
      external: EXTERNALIZE_BROKEN_OPTIONAL_DEPS,
    },
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
