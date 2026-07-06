// FR-1, FR-4: byte-exact, filename-independent content hashing (dedup identity).

import { describe, expect, it } from "vitest";
import { computeContentHash } from "../lib/hash";

describe("computeContentHash", () => {
  it("produces identical hashes for identical bytes", async () => {
    const bytesA = new Uint8Array([1, 2, 3, 4, 5]);
    const bytesB = new Uint8Array([1, 2, 3, 4, 5]);
    expect(await computeContentHash(bytesA)).toBe(await computeContentHash(bytesB));
  });

  it("produces different hashes for different bytes", async () => {
    const bytesA = new Uint8Array([1, 2, 3, 4, 5]);
    const bytesB = new Uint8Array([1, 2, 3, 4, 6]);
    expect(await computeContentHash(bytesA)).not.toBe(await computeContentHash(bytesB));
  });

  it("is filename-independent — hash is purely a function of the byte input (EC-7, FR-4)", async () => {
    // The hash function itself takes no filename; identical bytes always hash identically
    // regardless of what name a caller associates with them.
    const bytes = new Uint8Array([9, 8, 7]);
    const hash1 = await computeContentHash(bytes);
    const hash2 = await computeContentHash(bytes);
    expect(hash1).toBe(hash2);
  });

  it("hashes a zero-byte buffer deterministically without crashing (EC-6)", async () => {
    const hash = await computeContentHash(new Uint8Array(0));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // SHA-256 of the empty input is a well-known constant.
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("returns a lowercase hex string of the expected length", async () => {
    const hash = await computeContentHash(new Uint8Array([42]));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
