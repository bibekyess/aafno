// FR-13, FR-16: level gating (dev = everything fires, production posture = warn/error only) and
// the content() channel's DEV gate — the metadata-vs-content split the AC-8 privacy gate depends
// on. `import.meta.env.DEV` is a real, mutable object property under Vitest (not yet inlined to a
// literal the way a production `vite build` inlines it), so tests drive it directly to simulate
// both postures without needing an actual production build.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_LOG_SENTINEL, createLogger } from "../lib/log";

function setDev(value: boolean): void {
  (import.meta.env as unknown as { DEV: boolean }).DEV = value;
}

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setDev(true); // restore Vitest's default dev posture for later tests
  });

  it("in dev, debug/info/warn/error all fire", () => {
    setDev(true);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const log = createLogger("test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(debugSpy).toHaveBeenCalledWith("[test]", "d");
    expect(infoSpy).toHaveBeenCalledWith("[test]", "i");
    expect(warnSpy).toHaveBeenCalledWith("[test]", "w");
    expect(errorSpy).toHaveBeenCalledWith("[test]", "e");
  });

  it("with the production-posture active level (warn), debug/info are no-ops and warn/error still fire", () => {
    setDev(false);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const log = createLogger("test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[test]", "w");
    expect(errorSpy).toHaveBeenCalledWith("[test]", "e");
  });

  it("content() invokes its thunk and emits the sentinel only when import.meta.env.DEV is true (FR-16)", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = createLogger("test");

    setDev(true);
    const devThunk = vi.fn(() => ["secret document content"]);
    log.content(devThunk);
    expect(devThunk).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith("[test]", CONTENT_LOG_SENTINEL, "secret document content");

    debugSpy.mockClear();
    setDev(false);
    const prodThunk = vi.fn(() => ["should never be logged"]);
    log.content(prodThunk);
    expect(prodThunk).not.toHaveBeenCalled(); // the thunk itself must not even run outside dev
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("namespaces every message with the given tag", () => {
    setDev(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createLogger("retrieve").warn("no strongly relevant passages");
    expect(warnSpy).toHaveBeenCalledWith("[retrieve]", "no strongly relevant passages");
  });
});
