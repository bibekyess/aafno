// Byte-exact dedup identity (FR-1, FR-2, R2). Thread-agnostic: `crypto.subtle` exists on both the
// main thread and the worker (and Node exposes a global `crypto.subtle` too, so this is
// Node-testable without any DOM/worker shim — plan "New modules").

/**
 * SHA-256 of the raw file bytes, as a lowercase hex string. The dedup key is computed over the
 * original bytes, not parsed text (FR-1) — filename-independent, byte-exact (FR-4, EC-7).
 */
export async function computeContentHash(bytes: Uint8Array): Promise<string> {
  // @types/node's global Uint8Array augmentation widens the ambient `Uint8Array` type to
  // `Uint8Array<ArrayBufferLike>`, which DOM's `BufferSource` (expects `ArrayBuffer`) rejects —
  // a type-only mismatch, not a runtime one. Cast to unblock typecheck (pre-existing gate break,
  // unrelated to this change — surfaced only now that `npm ci` actually runs before `tsc`).
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
