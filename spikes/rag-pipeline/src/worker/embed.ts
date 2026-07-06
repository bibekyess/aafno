// EmbeddingGemma via transformers.js (FR-4, D7). Embeddings are produced ONLY here, and only
// locally — never via a cloud endpoint (D7 is a hard requirement, not a preference). WebGPU is
// attempted first; on failure we fall back to the WASM backend transformers.js ships automatically
// (§5 unknown #5) and record which backend actually ran.
//
// Research findings baked into slice 1 (plan, "do not re-litigate"): model id
// `onnx-community/embeddinggemma-300m-ONNX`, q8 quantization (~155MB), output dimension 768.

import { EMBEDDING_DIM } from "../lib/schema.sql";

export const EMBEDDING_MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

// Chunks are embedded in fixed-size batches rather than one giant forward pass. transformers.js
// pads every sequence in a call to the longest one, so a single call over all N chunks allocates
// an [N × maxLen] activation tensor at once — on the WASM backend that memory spike thrashes the
// machine (observed: a 66-chunk document freezing the host). Batching caps peak memory to the
// batch and lets the worker report progress / stay cancellable between batches.
export const DEFAULT_EMBED_BATCH_SIZE = 16;

export type EmbedDevice = "webgpu" | "wasm";

export interface EmbedProgressInfo {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface EmbedOptions {
  // Sequences per forward pass; defaults to DEFAULT_EMBED_BATCH_SIZE.
  batchSize?: number;
  // Called after each batch completes with (chunks done so far, total) — for progress reporting.
  onBatch?: (done: number, total: number) => void;
}

export interface EmbedModelHandle {
  embed(texts: string[], options?: EmbedOptions): Promise<Float32Array[]>;
  dimension: number;
  device: EmbedDevice;
}

export interface LoadEmbedModelOptions {
  onProgress?: (info: EmbedProgressInfo) => void;
}

// Narrow surface of transformers.js we depend on; kept local rather than importing the (heavy,
// loosely-typed) library types everywhere.
interface FeatureExtractionOutput {
  tolist(): number[][];
}
type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<FeatureExtractionOutput>;

async function createExtractor(device: EmbedDevice, onProgress?: (info: EmbedProgressInfo) => void) {
  const { pipeline } = await import("@huggingface/transformers");
  return (await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
    dtype: "q8",
    device,
    progress_callback: onProgress as never,
  })) as unknown as FeatureExtractionPipeline;
}

export async function loadEmbeddingModel(options: LoadEmbedModelOptions = {}): Promise<EmbedModelHandle> {
  let device: EmbedDevice = "webgpu";
  let extractor: FeatureExtractionPipeline;
  try {
    extractor = await createExtractor("webgpu", options.onProgress);
  } catch (error) {
    // WebGPU unavailable or init failed (§5 unknown #5) — fall back to WASM and keep going rather
    // than failing the whole pipeline (edge case: "WebGPU unavailable / driver failure").
    device = "wasm";
    extractor = await createExtractor("wasm", options.onProgress);
    void error;
  }

  async function embed(texts: string[], options: EmbedOptions = {}): Promise<Float32Array[]> {
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_EMBED_BATCH_SIZE);
    const vectors: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const output = await extractor(batch, { pooling: "mean", normalize: true });
      for (const row of output.tolist()) vectors.push(Float32Array.from(row));
      options.onBatch?.(vectors.length, texts.length);
    }
    return vectors;
  }

  const probe = await embed(["dimension probe"]);
  const dimension = probe[0]?.length ?? 0;
  if (dimension !== EMBEDDING_DIM) {
    // Documented observation for R2 rather than a hard failure — the schema's vector(768) column
    // would need correcting if this ever fires; slice 1 records the mismatch instead of silently
    // truncating/padding vectors.
    console.warn(
      `[embed] EmbeddingGemma reported dimension ${dimension}, pinned schema expects ${EMBEDDING_DIM}. ` +
        "Record this in MEASUREMENTS.md and correct lib/schema.sql.ts if this is reproducible.",
    );
  }

  return { embed, dimension, device };
}
