// Dev-gated, leveled, namespaced logger (A3, FR-12..FR-16). Thread-agnostic: uses only `console`
// and `import.meta.env.DEV`, both available on the main thread and inside the worker (plan "New
// modules"). This is NOT an egress path — it only ever calls `console.*`, never `classifiedFetch`
// (ADR: central-network-client-network-purpose; the logger must not become a new egress point).
//
// Privacy gate (FR-16, hard requirement): `debug`/`info`/`warn`/`error` may only ever carry
// metadata (sizes, counts, dims, timings, similarity scores, filenames) — never document/prompt
// content. The ONLY channel for content is `content()`, whose body is wrapped in a direct
// `import.meta.env.DEV` check. In a production build Vite replaces `import.meta.env.DEV` with the
// literal `false`, so the branch — the `CONTENT_LOG_SENTINEL` reference and the thunk call inside
// it — is dead-code-eliminated (ADR: dev-logger-content-privacy-gate; same `define`/tree-shaking
// mechanism as ADR: dev-cloud-compile-time-exclusion). `scripts/check-no-content-logs.mjs`
// verifies this by asserting the sentinel is absent from the built output (AC-8, EC-8).

/** Unique marker string that exists nowhere else — gives the AC-8 build check a precise, greppable
 * absence assertion instead of relying on developer discipline alone. */
export const CONTENT_LOG_SENTINEL = "__AAFNO_CONTENT_LOG__";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** The only channel for document/prompt content (FR-16). `thunk` is only invoked in dev. */
  content(thunk: () => unknown[]): void;
}

/** Default active level (D8): `debug` in dev (everything fires), `warn` otherwise (metadata only). */
function activeLevel(): LogLevel {
  return import.meta.env.DEV ? "debug" : "warn";
}

/** Namespaces used verbatim per FR-12: `[parse] [chunk] [embed] [db] [retrieve] [generate]`. */
export function createLogger(namespace: string): Logger {
  const tag = `[${namespace}]`;

  function emit(level: LogLevel, method: (...args: unknown[]) => void, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel()]) return;
    method(tag, ...args);
  }

  return {
    debug: (...args) => emit("debug", console.debug, args),
    info: (...args) => emit("info", console.info, args),
    warn: (...args) => emit("warn", console.warn, args),
    error: (...args) => emit("error", console.error, args),
    content: (thunk) => {
      if (import.meta.env.DEV) {
        console.debug(tag, CONTENT_LOG_SENTINEL, ...thunk());
      }
    },
  };
}
