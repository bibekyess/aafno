// A4/B: live cold/warm load, embed throughput, retrieval latency, index outcome, and the
// persistence self-check — plus a one-click copyable Markdown export (D9, FR-20) matching
// MEASUREMENTS.md's structure (AC-10). The committed half is MEASUREMENTS.md itself, filled in
// manually from a real browser run by pasting this export (NFR "measurement numbers require a
// real run").

import { useState } from "react";
import { buildMeasurementMarkdown, type MeasurementSnapshot } from "../lib/measure";

export interface MeasurementPanelProps {
  snapshot: MeasurementSnapshot;
}

function fmtMs(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}ms`;
}

export function MeasurementPanel({ snapshot }: MeasurementPanelProps) {
  const [copied, setCopied] = useState(false);
  const markdown = buildMeasurementMarkdown(snapshot);

  const retrievalOk = snapshot.retrievalMs === null || snapshot.retrievalMs <= 500;
  const warmOk = snapshot.modelLoadKind !== "warm" || snapshot.warmLoadMs === null || snapshot.warmLoadMs <= 3000;

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable/denied — the on-screen textarea below is the fallback (D9).
    }
  };

  return (
    <section aria-label="Measurements">
      <h2>Measurements</h2>
      <dl>
        <dt>Cold load</dt>
        <dd>{fmtMs(snapshot.coldLoadMs)}</dd>
        <dt>Warm load</dt>
        <dd>
          {fmtMs(snapshot.warmLoadMs)} {snapshot.modelLoadKind === "warm" && !warmOk ? "— missed ≤3s target" : ""}
        </dd>
        <dt>Model device</dt>
        <dd>{snapshot.modelDevice ?? "—"}</dd>
        <dt>Embedding throughput</dt>
        <dd>
          {snapshot.chunksPerSecond === null ? "—" : snapshot.chunksPerSecond.toFixed(2)} chunks/s,{" "}
          {snapshot.charsPerSecond === null ? "—" : snapshot.charsPerSecond.toFixed(0)} chars/s
        </dd>
        <dt>Index strategy</dt>
        <dd>{snapshot.indexStrategy ?? "—"}</dd>
        <dt>Retrieval latency</dt>
        <dd>
          {fmtMs(snapshot.retrievalMs)} {!retrievalOk ? "— missed ≤500ms target" : ""}
        </dd>
        <dt>Persistence self-check</dt>
        <dd>{snapshot.persistenceSelfCheck}</dd>
      </dl>
      <button type="button" onClick={() => void copyMarkdown()}>
        Copy as Markdown
      </button>{" "}
      {copied && <span role="status">Copied.</span>}
      <p>
        <label htmlFor="measurement-export">Export (paste into MEASUREMENTS.md, AC-10):</label>
      </p>
      <textarea id="measurement-export" readOnly value={markdown} rows={16} style={{ width: "100%" }} />
    </section>
  );
}
