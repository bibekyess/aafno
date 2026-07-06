// Worker-contract sanity (plan "Test Strategy"): the discriminated unions type-check and a fake
// message round-trip preserves `jobId` and narrows on `type`, guarding against untyped
// `postMessage` drift (§10 worker guidelines: typed request/response, no untyped messages).

import { describe, expect, it } from "vitest";
import {
  isPipelineEvent,
  isPipelineRequest,
  type ParseResult,
  type PipelineEvent,
  type PipelineRequest,
} from "../lib/messages";

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
          // `request.contentHash`/`request.byteSize` are only accessible because of narrowing —
          // guards the slice-2 `ingest` contract extension (plan "Typed worker contract").
          return {
            type: "progress",
            jobId: request.jobId,
            stage: "chunk",
            note: `doc: ${request.docId} hash: ${request.contentHash} bytes: ${request.byteSize}`,
          };
        case "listDocuments":
          return { type: "result", jobId: request.jobId, result: { documents: [] } };
        case "deleteDocument":
          return {
            type: "result",
            jobId: request.jobId,
            result: { documentId: request.documentId, deletedChunkCount: 0 },
          };
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

    const listEvent = handle({ type: "listDocuments", jobId: "list-1" });
    expect(listEvent).toEqual({ type: "result", jobId: "list-1", result: { documents: [] } });

    const deleteEvent = handle({ type: "deleteDocument", jobId: "del-1", documentId: "doc-9" });
    expect(deleteEvent).toEqual({
      type: "result",
      jobId: "del-1",
      result: { documentId: "doc-9", deletedChunkCount: 0 },
    });
  });

  it("narrows a dedup ParseResult on `dedup.skipped` (FR-3, FR-11)", () => {
    const skippedResult: ParseResult = {
      documentId: "doc-1",
      text: "",
      charLength: 0,
      title: "Existing title",
      sourceKind: "uploaded",
      byteSize: 1024,
      contentHash: "abc123",
      dedup: { skipped: true, existingDocumentId: "doc-1", existingTitle: "Existing title" },
    };
    expect(skippedResult.dedup.skipped).toBe(true);
    if (skippedResult.dedup.skipped) {
      // Only accessible after narrowing on `skipped: true`.
      expect(skippedResult.dedup.existingDocumentId).toBe("doc-1");
      expect(skippedResult.dedup.existingTitle).toBe("Existing title");
    }

    const freshResult: ParseResult = {
      documentId: "doc-2",
      text: "some parsed text",
      charLength: 16,
      title: "New title",
      sourceKind: "uploaded",
      byteSize: 2048,
      contentHash: "def456",
      dedup: { skipped: false },
    };
    expect(freshResult.dedup.skipped).toBe(false);
  });
});
