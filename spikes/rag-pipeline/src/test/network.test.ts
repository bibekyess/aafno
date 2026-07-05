// Unit tests for network classification (plan "Test Strategy"; PROJECT_ANALYSIS.md §10 "Unit
// tests for network classification"). Covers FR-11 / AC-8: dev-cloud calls are classified as
// `dev_cloud_inference` with `sentUserContent: true`; asset fetches as `app_asset`; the log is
// observable (both via `getNetworkLog` and `subscribeToNetworkLog`).

import { afterEach, describe, expect, it, vi } from "vitest";
import { classifiedFetch, getNetworkLog, subscribeToNetworkLog } from "../lib/network";

describe("classifiedFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies dev-cloud inference calls with sentUserContent true and records domain/method/status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    await classifiedFetch("https://api.example.com/v1/chat/completions", {
      method: "POST",
      purpose: "dev_cloud_inference",
      sentUserContent: true,
      body: "{}",
    });

    const entries = getNetworkLog();
    const last = entries[entries.length - 1];
    expect(last.purpose).toBe("dev_cloud_inference");
    expect(last.sentUserContent).toBe(true);
    expect(last.domain).toBe("api.example.com");
    expect(last.method).toBe("POST");
    expect(last.status).toBe(200);
  });

  it("classifies asset fetches as app_asset with sentUserContent false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );

    await classifiedFetch("https://example.com/app.js", { purpose: "app_asset", sentUserContent: false });

    const entries = getNetworkLog();
    const last = entries[entries.length - 1];
    expect(last.purpose).toBe("app_asset");
    expect(last.sentUserContent).toBe(false);
    expect(last.method).toBe("GET");
  });

  it("records a failed request with status 'error' and rethrows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(
      classifiedFetch("https://api.example.com/v1/chat/completions", {
        purpose: "dev_cloud_inference",
        sentUserContent: true,
      }),
    ).rejects.toThrow("network down");

    const entries = getNetworkLog();
    const last = entries[entries.length - 1];
    expect(last.status).toBe("error");
  });

  it("is observable via subscribeToNetworkLog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    const seen: string[] = [];
    const unsubscribe = subscribeToNetworkLog((entry) => seen.push(entry.purpose));
    try {
      await classifiedFetch("https://model-registry.example.com/weights.onnx", {
        purpose: "model_download",
        sentUserContent: false,
      });
    } finally {
      unsubscribe();
    }

    // Two emissions per call: the pending entry, then the settled entry.
    expect(seen).toContain("model_download");
  });
});
