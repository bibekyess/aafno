// Dev-cloud generation (D2, FR-8, FR-11). Guarded by the `__DEV_CLOUD__` build-time define (ADR:
// dev-cloud-compile-time-exclusion) so this path is tree-shakeable out of any non-dev build; the
// full production build-exclusion mechanism is a Phase 1 concern (the ADR is Proposed, not
// Accepted, for exactly that reason). Runs on the MAIN THREAD — this is the only place in the
// spike that may send document/chunk content over the network, and only when the user has
// explicitly opted in (AC-8).

import { classifiedFetch } from "./network";
import type { RetrievedChunk } from "./messages";

export interface DevCloudConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export class DevCloudConfigError extends Error {}

export function readDevCloudConfig(): DevCloudConfig | null {
  const baseUrl = import.meta.env.VITE_DEV_CLOUD_BASE_URL;
  const model = import.meta.env.VITE_DEV_CLOUD_MODEL;
  const apiKey = import.meta.env.VITE_DEV_CLOUD_API_KEY;
  if (!baseUrl || !model) return null;
  return { baseUrl, model, apiKey: apiKey ?? "" };
}

export function buildRagPrompt(question: string, contexts: RetrievedChunk[]): string {
  const contextBlock = contexts
    .map((chunk, i) => `[${i + 1}] (chunk ${chunk.ordinal}, similarity ${chunk.similarity.toFixed(3)})\n${chunk.text}`)
    .join("\n\n");
  return [
    "Answer the question using ONLY the context passages below. If the answer is not present, say so plainly.",
    "",
    "Context:",
    contextBlock || "(no relevant passages retrieved)",
    "",
    `Question: ${question}`,
  ].join("\n");
}

export function destinationDomain(config: DevCloudConfig): string {
  try {
    return new URL(config.baseUrl).hostname;
  } catch {
    return config.baseUrl;
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Generate an answer via the dev-only OpenAI-compatible endpoint. Throws `DevCloudConfigError`
 * if no endpoint is configured (edge case: "Dev-cloud endpoint not configured / unreachable").
 */
export async function generateViaDevCloud(question: string, contexts: RetrievedChunk[]): Promise<string> {
  if (!__DEV_CLOUD__) {
    throw new DevCloudConfigError("Dev-cloud generation is compiled out of this build.");
  }
  const config = readDevCloudConfig();
  if (!config) {
    throw new DevCloudConfigError(
      "No dev-cloud endpoint configured. Set VITE_DEV_CLOUD_BASE_URL and VITE_DEV_CLOUD_MODEL in .env.local.",
    );
  }

  const prompt = buildRagPrompt(question, contexts);
  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  let response: Response;
  try {
    response = await classifiedFetch(url, {
      method: "POST",
      purpose: "dev_cloud_inference",
      sentUserContent: true,
      note: `RAG generation: question + ${contexts.length} retrieved chunk(s)`,
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
  } catch (error) {
    throw new DevCloudConfigError(
      `Dev-cloud endpoint unreachable at ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new DevCloudConfigError(`Dev-cloud endpoint returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) {
    throw new DevCloudConfigError("Dev-cloud endpoint returned no answer content.");
  }
  return answer;
}
