// A4/B: buildMeasurementMarkdown produces valid, well-formed Markdown even before a real run
// (AC-10, EC-9), and the persistence self-check tri-state maps correctly (FR-19, AC-11).

import { describe, expect, it } from "vitest";
import { buildMeasurementMarkdown, computePersistenceSelfCheck, type MeasurementSnapshot } from "../lib/measure";

const FULL_SNAPSHOT: MeasurementSnapshot = {
  environment: { userAgent: "TestBrowser/1.0", webgpuAvailable: true, wasmFallbackObserved: false },
  coldLoadMs: 4200,
  warmLoadMs: 1800,
  modelLoadKind: "warm",
  modelDevice: "webgpu",
  chunksPerSecond: 12.5,
  charsPerSecond: 3400,
  chunkCount: 42,
  retrievalMs: 120,
  indexStrategy: "hnsw",
  persistenceSelfCheck: "pass",
  cloudOffNoEgress: true,
};

const EMPTY_SNAPSHOT: MeasurementSnapshot = {
  environment: { userAgent: null, webgpuAvailable: null, wasmFallbackObserved: null },
  coldLoadMs: null,
  warmLoadMs: null,
  modelLoadKind: null,
  modelDevice: null,
  chunksPerSecond: null,
  charsPerSecond: null,
  chunkCount: null,
  retrievalMs: null,
  indexStrategy: null,
  persistenceSelfCheck: "no-prior-corpus",
  cloudOffNoEgress: null,
};

describe("buildMeasurementMarkdown", () => {
  it("renders a fully-populated snapshot with real values and the expected section structure (AC-10)", () => {
    const markdown = buildMeasurementMarkdown(FULL_SNAPSHOT);
    expect(markdown).toContain("## Environment");
    expect(markdown).toContain("## Model load (cold vs warm)");
    expect(markdown).toContain("## Embedding + retrieval");
    expect(markdown).toContain("## Persistence self-check (AC-11)");
    expect(markdown).toContain("## Privacy / hard gates");
    expect(markdown).toContain("4200ms");
    expect(markdown).toContain("1800ms");
    expect(markdown).toContain("hnsw");
    expect(markdown).toContain("pass");
    expect(markdown).not.toContain("TBD");
  });

  it("renders TBD for every null/unknown field without crashing (EC-9)", () => {
    const markdown = buildMeasurementMarkdown(EMPTY_SNAPSHOT);
    expect(markdown).toContain("## Environment");
    expect(markdown.match(/TBD/g)?.length).toBeGreaterThan(0);
    expect(markdown).toContain("no-prior-corpus");
  });

  it("always states measurement numbers require a real browser run (NFR)", () => {
    expect(buildMeasurementMarkdown(FULL_SNAPSHOT)).toMatch(/real WebGPU browser run/i);
    expect(buildMeasurementMarkdown(EMPTY_SNAPSHOT)).toMatch(/real WebGPU browser run/i);
  });
});

describe("computePersistenceSelfCheck", () => {
  it("passes when documents and chunks were restored", () => {
    expect(computePersistenceSelfCheck(2, 10, false)).toBe("pass");
    expect(computePersistenceSelfCheck(2, 10, true)).toBe("pass");
  });

  it("fails when a prior corpus was recorded but nothing restored", () => {
    expect(computePersistenceSelfCheck(0, 0, true)).toBe("fail");
  });

  it("reports no-prior-corpus when nothing was restored and none was ever recorded", () => {
    expect(computePersistenceSelfCheck(0, 0, false)).toBe("no-prior-corpus");
  });
});
