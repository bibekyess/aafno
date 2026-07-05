// Local PDF parse (FR-2, AC-2). Wraps `@llamaindex/liteparse-wasm` (the WASM build of the team's
// confirmed `liteparse-wasm` — do NOT use MuPDF.js, PROJECT_ANALYSIS.md §3). Runs entirely inside
// this worker; no document bytes ever cross a network boundary here.

import init, { LiteParse } from "@llamaindex/liteparse-wasm";
// Vite `?url` asset import (resolved to a fetchable URL string at build time).
import wasmUrl from "@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm?url";

let initPromise: Promise<void> | null = null;

function ensureWasmInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init(wasmUrl).then(() => undefined);
  }
  return initPromise;
}

export interface ParsedDocument {
  text: string;
  charLength: number;
}

/** Minimum extracted character count before we consider a PDF to have "no extractable text". */
const MIN_EXTRACTABLE_CHARS = 20;

export class NoExtractableTextError extends Error {
  constructor() {
    super("No extractable text found in this document (it may be empty, image-only, or scanned).");
    this.name = "NoExtractableTextError";
  }
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  await ensureWasmInit();
  const parser = new LiteParse({ ocrEnabled: false, outputFormat: "text" });
  const result = await parser.parse(bytes);
  const text = result.text.trim();
  if (text.length < MIN_EXTRACTABLE_CHARS) {
    throw new NoExtractableTextError();
  }
  return { text, charLength: text.length };
}
