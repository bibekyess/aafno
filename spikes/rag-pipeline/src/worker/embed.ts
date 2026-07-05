// EmbeddingGemma via transformers.js (FR-4, D7). Embeddings are produced ONLY here, and only
// locally — never via a cloud endpoint (D7 is a hard requirement, not a preference). WebGPU is
// attempted first; on failure we fall back to the WASM backend transformers.js ships automatically
// (§5 unknown #5) and record which backend actually ran.
//
// Research findings baked into slice 1 (plan, "do not re-litigate"): model id
// `onnx-community/embeddinggemma-300m-ONNX`, q8 quantization (~155MB), output dimension 768.

import { EMBEDDING_DIM } from "../lib/schema.sql";

export const EMBEDDING_MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

export type EmbedDevice = "webgpu" | "wasm";

export interface EmbedProgressInfo {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface EmbedModelHandle {
  embed(texts: string[]): Promise<Float32Array[]>;
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

  async function embed(texts: string[]): Promise<Float32Array[]> {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist().map((row) => Float32Array.from(row));
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
