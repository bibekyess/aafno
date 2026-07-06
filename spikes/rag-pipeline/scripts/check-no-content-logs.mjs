#!/usr/bin/env node
// AC-8/EC-8 production-build content-logging check (plan step 11; ADR:
// dev-logger-content-privacy-gate). Runs a real production `vite build`, then asserts the
// CONTENT_LOG_SENTINEL string — the only marker `lib/log.ts`'s DEV-gated `content()` channel ever
// emits — is absent from the built output. In a production build Vite replaces
// `import.meta.env.DEV` with the literal `false`, so `content()`'s body (its guard, the sentinel
// reference, and the content thunk call) is dead-code-eliminated; this check makes that guarantee
// structural and verified, not assumed or left to reviewer vigilance alone.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const distDir = join(root, "dist");
const logSourcePath = join(root, "src", "lib", "log.ts");

/** Read the sentinel directly from `lib/log.ts` so this check can never silently drift from it. */
function readSentinel() {
  const source = readFileSync(logSourcePath, "utf8");
  const match = source.match(/CONTENT_LOG_SENTINEL\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`Could not find CONTENT_LOG_SENTINEL constant in ${logSourcePath}`);
  }
  return match[1];
}

function listJsAssets(dir) {
  const assetsDir = join(dir, "assets");
  return readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(assetsDir, name));
}

function main() {
  const sentinel = readSentinel();

  // Fresh build every run so this check always reflects current source, never a stale dist/.
  rmSync(distDir, { recursive: true, force: true });
  console.log("[check-no-content-logs] Running production build (vite build)...");
  execFileSync(join(root, "node_modules", ".bin", "vite"), ["build"], { cwd: root, stdio: "inherit" });

  const jsFiles = listJsAssets(distDir);
  if (jsFiles.length === 0) {
    throw new Error(`No built JS assets found under ${join(distDir, "assets")} — build may have failed silently.`);
  }

  const offenders = jsFiles.filter((file) => readFileSync(file, "utf8").includes(sentinel));

  if (offenders.length > 0) {
    console.error(
      `[check-no-content-logs] FAIL: CONTENT_LOG_SENTINEL ("${sentinel}") found in production build output:\n` +
        offenders.map((file) => `  - ${file}`).join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `[check-no-content-logs] PASS: CONTENT_LOG_SENTINEL absent from ${jsFiles.length} built JS asset(s) (AC-8).`,
  );
}

main();
