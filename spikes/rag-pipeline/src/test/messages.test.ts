// Worker-contract sanity (plan "Test Strategy"): the discriminated unions type-check and a fake
// message round-trip preserves `jobId` and narrows on `type`, guarding against untyped
// `postMessage` drift (§10 worker guidelines: typed request/response, no untyped messages).

import { describe, expect, it } from "vitest";
import { isPipelineEvent, isPipelineRequest, type PipelineEvent, type PipelineRequest } from "../lib/messages";

describe("worker message contract", () => {
  it("type-guards recognize well-formed requests and events, and reject malformed values", () => {
    const request: PipelineRequest = { type: "retrieve", jobId: "job-1", question: "q", k: 5 };
    expect(isPipelineRequest(request)).toBe(true);
    expect(isPipelineRequest({})).toBe(false);
    expect(isPipelineRequest(null)).toBe(false);
    expect(isPipelineRequest({ type: "retrieve" })).toBe(false);

    const event: PipelineEvent = { type: "status", jobId: "job-1", status: "running" };
    expect(isPipelineEvent(event)).toBe(true);
    expect(isPipelineEvent("not an event")).toBe(false);
  });

  it("preserves jobId through a request -> handler stub -> event round trip and narrows on type", () => {
    function handle(request: PipelineRequest): PipelineEvent {
      switch (request.type) {
        case "retrieve":
          // `request.question` / `request.k` are only accessible because of the switch narrowing.
          return {
            type: "result",
            jobId: request.jobId,
            result: {
              question: request.question,
              k: request.k,
              chunks: [],
              retrievalMs: 0,
              belowRelevanceThreshold: true,
            },
          };
        case "cancel":
          return { type: "status", jobId: request.jobId, status: "cancelled" };
        case "init":
        case "restore":
          return { type: "status", jobId: request.jobId, status: "queued" };
        case "parse":
          return { type: "progress", jobId: request.jobId, stage: "parse", note: `source: ${request.source.kind}` };
        case "ingest":
          return { type: "progress", jobId: request.jobId, stage: "chunk", note: `doc: ${request.docId}` };
        case "generateLocal":
          return {
            type: "progress",
            jobId: request.jobId,
            stage: "generate",
            note: `contexts: ${request.contexts.length}`,
          };
      }
    }

    const request: PipelineRequest = { type: "retrieve", jobId: "abc-123", question: "What is X?", k: 5 };
    const event = handle(request);
    expect(event.jobId).toBe(request.jobId);
    expect(event.type).toBe("result");

    const cancelEvent = handle({ type: "cancel", jobId: "xyz-789" });
    expect(cancelEvent).toEqual({ type: "status", jobId: "xyz-789", status: "cancelled" });
  });
});
