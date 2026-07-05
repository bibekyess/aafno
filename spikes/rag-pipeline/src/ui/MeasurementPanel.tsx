// FR-10: live cold/warm load, embed throughput, retrieval latency — the on-screen half of the
// measurement requirement. The committed half is MEASUREMENTS.md (AC-10), filled in manually from
// these numbers after a real browser run.

import type { IndexStrategy, ModelLoadKind } from "../lib/messages";

export interface MeasurementPanelProps {
  modelLoadMs: number | null;
  modelLoadKind: ModelLoadKind | null;
  modelDevice: "webgpu" | "wasm" | null;
  chunksPerSecond: number | null;
  charsPerSecond: number | null;
  indexStrategy: IndexStrategy | null;
  retrievalMs: number | null;
}

function fmt(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

export function MeasurementPanel(props: MeasurementPanelProps) {
  const retrievalOk = props.retrievalMs === null || props.retrievalMs <= 500;
  const warmOk = props.modelLoadKind !== "warm" || props.modelLoadMs === null || props.modelLoadMs <= 3000;
  return (
    <section aria-label="Measurements">
      <h2>Measurements</h2>
      <dl>
        <dt>Model load</dt>
        <dd>
          {fmt(props.modelLoadMs, 0)}ms ({props.modelLoadKind ?? "—"}, {props.modelDevice ?? "—"}){" "}
          {props.modelLoadKind === "warm" && !warmOk ? "— missed ≤3s target" : ""}
        </dd>
        <dt>Embedding throughput</dt>
        <dd>
          {fmt(props.chunksPerSecond, 2)} chunks/s, {fmt(props.charsPerSecond, 0)} chars/s
        </dd>
        <dt>Index strategy</dt>
        <dd>{props.indexStrategy ?? "—"}</dd>
        <dt>Retrieval latency</dt>
        <dd>
          {fmt(props.retrievalMs, 0)}ms {!retrievalOk ? "— missed ≤500ms target" : ""}
        </dd>
      </dl>
      <p>Copy these numbers into MEASUREMENTS.md after a run (AC-10).</p>
    </section>
  );
}
