// Browser build shim for `node:crypto`.
//
// `@chonkiejs/core`'s single barrel export (`import { RecursiveChunker } from "@chonkiejs/core"`)
// statically re-exports every vector-DB "handshake" adapter (Pinecone, Qdrant, pgvector, etc.) —
// none of which this spike uses — and `handshakes/base.js` statically imports Node's
// `createHash` from `node:crypto`. That import must resolve for the bundle to build at all, even
// though the handshake classes referencing it are dead code for this spike (an integration
// wrinkle worth recording for §5 unknown #2: chonkie-ts's package structure is not fully
// browser-clean). This stub only needs to satisfy the static import — it is never actually called.
export function createHash(): never {
  throw new Error(
    "createHash() is a browser-build stub: @chonkiejs/core's vector-DB handshake adapters are unused by this spike.",
  );
}
