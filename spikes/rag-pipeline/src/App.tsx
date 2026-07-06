// Spike harness (plan "Overview"): wires the panels, owns the cloud toggle and the ONLY
// content-bearing network egress (the dev-cloud generate call). Never touches heavy compute —
// all of that lives in worker/pipeline.worker.ts (D3).
//
// Slice 2 (A2, plan step 8): tracks the full document corpus (not a single "current" document),
// handles the dedup warn-and-skip path, refreshes the list after ingest/delete, serializes delete
// against any in-flight job (D10), surfaces the schema-reset notice (D5/EC-1), and wires the
// measurement snapshot (A4/B).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CapabilityBanner } from "./ui/CapabilityBanner";
import { ActivityLog, type ActivityEntry } from "./ui/ActivityLog";
import { NetworkPanel } from "./ui/NetworkPanel";
import { MeasurementPanel } from "./ui/MeasurementPanel";
import { DocumentList } from "./ui/DocumentList";
import { destinationDomain, generateViaDevCloud, readDevCloudConfig } from "./lib/generate";
import { getNetworkLog, subscribeToNetworkLog, recordExternalEntry, type NetworkLogEntry } from "./lib/network";
import {
  computePersistenceSelfCheck,
  measurementStore,
  type MeasurementSnapshot,
  type PersistenceSelfCheck,
} from "./lib/measure";
import type {
  DeleteDocumentResult,
  DocumentSummary,
  GenerateResult,
  IndexStrategy,
  IngestResult,
  InitResult,
  ListDocumentsResult,
  ModelLoadKind,
  ParseResult,
  PipelineEvent,
  PipelineRequest,
  RetrievedChunk,
  RetrieveResult,
} from "./lib/messages";

const DEFAULT_K = 5;

// Only one embedding model exists in this spike — a fixed key is sufficient for the cold/warm
// localStorage comparison (measure.ts); a real multi-model product would key by the actual model id.
const MEASUREMENT_MODEL_KEY = "embedding-model";

interface CurrentDocument {
  docId: string;
  text: string;
  charLength: number;
  title: string;
}

function newJobId(): string {
  return crypto.randomUUID();
}

export function App() {
  const workerRef = useRef<Worker | null>(null);
  const jobKindsRef = useRef(new Map<string, PipelineRequest["type"]>());

  const [capabilities, setCapabilities] = useState<Pick<
    InitResult,
    "webgpuAvailable" | "opfsAvailable" | "indexedDbAvailable"
  > | null>(null);
  const [modelLoad, setModelLoad] = useState<{ ms: number; kind: ModelLoadKind; device: "webgpu" | "wasm" } | null>(
    null,
  );
  const [coldLoadMs, setColdLoadMs] = useState<number | null>(null);
  const [warmLoadMs, setWarmLoadMs] = useState<number | null>(null);
  const [restoredChunkCount, setRestoredChunkCount] = useState<number | null>(null);
  const [persistenceSelfCheck, setPersistenceSelfCheck] = useState<PersistenceSelfCheck>("no-prior-corpus");
  const [schemaResetNotice, setSchemaResetNotice] = useState(false);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [highlightedDocumentId, setHighlightedDocumentId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [networkEntries, setNetworkEntries] = useState<NetworkLogEntry[]>(() => [...getNetworkLog()]);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [currentDoc, setCurrentDoc] = useState<CurrentDocument | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [question, setQuestion] = useState("");
  const [k, setK] = useState(DEFAULT_K);
  const [retrieveResult, setRetrieveResult] = useState<RetrieveResult | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [runningJobIds, setRunningJobIds] = useState<Set<string>>(new Set());

  const busy = runningJobIds.size > 0; // D10/EC-5 — delete is disabled while any job is in flight

  const pushActivity = useCallback((text: string) => {
    setActivity((prev) => [...prev, { id: crypto.randomUUID(), text, timestamp: Date.now() }]);
  }, []);

  const send = useCallback((request: PipelineRequest) => {
    jobKindsRef.current.set(request.jobId, request.type);
    workerRef.current?.postMessage(request);
  }, []);

  const refreshDocuments = useCallback(() => {
    send({ type: "listDocuments", jobId: newJobId() });
  }, [send]);

  useEffect(() => {
    const worker = new Worker(new URL("./worker/pipeline.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.addEventListener("message", (event: MessageEvent<PipelineEvent>) => {
      const pipelineEvent = event.data;
      const kind = jobKindsRef.current.get(pipelineEvent.jobId);

      switch (pipelineEvent.type) {
        case "progress":
          pushActivity(pipelineEvent.note);
          break;
        case "network":
          recordExternalEntry({
            url: `https://${pipelineEvent.domain}/`,
            domain: pipelineEvent.domain,
            method: "GET",
            purpose: pipelineEvent.purpose,
            status: "pending",
            sentUserContent: false,
            note: pipelineEvent.note,
          });
          break;
        case "error":
          setPipelineError(`${pipelineEvent.stage}: ${pipelineEvent.message}`);
          pushActivity(`Error during ${pipelineEvent.stage}: ${pipelineEvent.message}`);
          break;
        case "status":
          setRunningJobIds((prev) => {
            const next = new Set(prev);
            if (pipelineEvent.status === "running") next.add(pipelineEvent.jobId);
            else next.delete(pipelineEvent.jobId);
            return next;
          });
          if (pipelineEvent.status === "cancelled") pushActivity("Job cancelled");
          break;
        case "result": {
          if (kind === "init" || kind === "restore") {
            const result = pipelineEvent.result as InitResult;
            setCapabilities({
              webgpuAvailable: result.webgpuAvailable,
              opfsAvailable: result.opfsAvailable,
              indexedDbAvailable: result.indexedDbAvailable,
            });
            setModelLoad({ ms: result.modelLoadMs, kind: result.modelLoadKind, device: result.modelDevice });
            if (result.modelLoadKind === "cold") {
              setColdLoadMs(result.modelLoadMs);
              measurementStore.recordColdLoadMs(MEASUREMENT_MODEL_KEY, result.modelLoadMs);
              setWarmLoadMs(measurementStore.getWarmLoadMs(MEASUREMENT_MODEL_KEY));
            } else if (result.modelLoadKind === "warm") {
              setWarmLoadMs(result.modelLoadMs);
              measurementStore.recordWarmLoadMs(MEASUREMENT_MODEL_KEY, result.modelLoadMs);
              setColdLoadMs(measurementStore.getColdLoadMs(MEASUREMENT_MODEL_KEY));
            }
            setRestoredChunkCount(result.restoredChunkCount);
            setDocuments(result.restoredDocuments);
            setPersistenceSelfCheck(
              computePersistenceSelfCheck(
                result.restoredDocuments.length,
                result.restoredChunkCount,
                measurementStore.hasPriorCorpusRecorded(),
              ),
            );
            if (result.schemaReset) {
              setSchemaResetNotice(true);
              pushActivity("Local index reset for the new schema — re-add your documents (D5).");
            }
            if (result.restoredDocuments.length > 0 && result.restoredChunkCount > 0) {
              pushActivity(
                `Restored store from browser storage: ${result.restoredChunkCount} chunks across ${result.restoredDocuments.length} document(s) (no re-parse/chunk/embed)`,
              );
            }
          } else if (kind === "parse") {
            const result = pipelineEvent.result as ParseResult;
            if (result.dedup.skipped) {
              // FR-3/FR-4/AC-1/EC-2/D6 — no re-parse/chunk/embed/store; point at the existing document.
              setHighlightedDocumentId(result.dedup.existingDocumentId);
              setPipelineError(null);
              pushActivity(`This file is already indexed as "${result.dedup.existingTitle}".`);
            } else {
              setCurrentDoc({
                docId: result.documentId,
                text: result.text,
                charLength: result.charLength,
                title: result.title,
              });
              pushActivity(`Parsed locally: ${result.title} (${result.charLength} characters)`);
              send({
                type: "ingest",
                jobId: newJobId(),
                docId: result.documentId,
                text: result.text,
                charLength: result.charLength,
                title: result.title,
                sourceKind: result.sourceKind,
                contentHash: result.contentHash,
                byteSize: result.byteSize,
              });
            }
          } else if (kind === "ingest") {
            const result = pipelineEvent.result as IngestResult;
            setIngestResult(result);
            measurementStore.recordCorpusIngested();
            pushActivity(
              `Stored vectors locally: ${result.chunkCount} chunks, index=${result.indexStrategy}, ${result.chunksPerSecond.toFixed(2)} chunks/s`,
            );
            refreshDocuments();
          } else if (kind === "listDocuments") {
            const result = pipelineEvent.result as ListDocumentsResult;
            setDocuments(result.documents);
          } else if (kind === "deleteDocument") {
            const result = pipelineEvent.result as DeleteDocumentResult;
            pushActivity(`Deleted document (${result.deletedChunkCount} chunk(s) removed).`);
            setHighlightedDocumentId((prev) => (prev === result.documentId ? null : prev));
            refreshDocuments();
          } else if (kind === "retrieve") {
            const result = pipelineEvent.result as RetrieveResult;
            setRetrieveResult(result);
            setAnswer(null);
            setAnswerError(null);
            pushActivity(
              result.belowRelevanceThreshold
                ? "Retrieved locally: no strongly relevant passages found"
                : `Retrieved locally: ${result.chunks.length} passages in ${result.retrievalMs.toFixed(0)}ms`,
            );
          } else if (kind === "generateLocal") {
            const result = pipelineEvent.result as GenerateResult;
            setAnswer(result.answer);
            pushActivity(`Answer generated via ${result.source}`);
          }
          break;
        }
      }
    });

    send({ type: "init", jobId: newJobId() });

    const unsubscribe = subscribeToNetworkLog((entry) => setNetworkEntries((prev) => [...prev, entry]));

    return () => {
      unsubscribe();
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worker setup runs once by design
  }, []);

  const loadBundledSample = useCallback(() => {
    setPipelineError(null);
    setHighlightedDocumentId(null);
    send({ type: "parse", jobId: newJobId(), source: { kind: "bundled" } });
  }, [send]);

  const onFileSelected = useCallback(
    async (file: File) => {
      setPipelineError(null);
      setHighlightedDocumentId(null);
      const bytes = await file.arrayBuffer();
      send({ type: "parse", jobId: newJobId(), source: { kind: "file", bytes, name: file.name } });
    },
    [send],
  );

  const deleteDocument = useCallback(
    (documentId: string) => {
      send({ type: "deleteDocument", jobId: newJobId(), documentId });
    },
    [send],
  );

  const runRetrieve = useCallback(() => {
    if (!question.trim()) return;
    send({ type: "retrieve", jobId: newJobId(), question, k });
  }, [question, k, send]);

  const generateAnswer = useCallback(async () => {
    if (!retrieveResult || !cloudEnabled) return;
    setGenerating(true);
    setAnswerError(null);
    try {
      const text = await generateViaDevCloud(retrieveResult.question, retrieveResult.chunks);
      setAnswer(text);
      pushActivity("Answer generated via dev-cloud");
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }, [retrieveResult, cloudEnabled, pushActivity]);

  const devCloudDomain = (() => {
    const config = readDevCloudConfig();
    return config ? destinationDomain(config) : null;
  })();

  // AC-5: retrieved chunks stay attributable to their source document by title, not just id.
  const titleForDocument = useCallback(
    (documentId: string) => documents.find((doc) => doc.documentId === documentId)?.title ?? documentId,
    [documents],
  );

  const cloudOffNoEgress = cloudEnabled
    ? null
    : !networkEntries.some((entry) => entry.purpose === "dev_cloud_inference" && entry.sentUserContent);

  const measurementSnapshot: MeasurementSnapshot = useMemo(
    () => ({
      environment: {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        webgpuAvailable: capabilities?.webgpuAvailable ?? null,
        wasmFallbackObserved: modelLoad ? modelLoad.device === "wasm" : null,
      },
      coldLoadMs,
      warmLoadMs,
      modelLoadKind: modelLoad?.kind ?? null,
      modelDevice: modelLoad?.device ?? null,
      chunksPerSecond: ingestResult?.chunksPerSecond ?? null,
      charsPerSecond: ingestResult?.charsPerSecond ?? null,
      chunkCount: ingestResult?.chunkCount ?? null,
      retrievalMs: retrieveResult?.retrievalMs ?? null,
      indexStrategy: (ingestResult?.indexStrategy as IndexStrategy | undefined) ?? null,
      persistenceSelfCheck,
      cloudOffNoEgress,
    }),
    [
      capabilities,
      modelLoad,
      coldLoadMs,
      warmLoadMs,
      ingestResult,
      retrieveResult,
      persistenceSelfCheck,
      cloudOffNoEgress,
    ],
  );

  return (
    <main>
      <h1>AAFNO — Phase 0 POC: RAG pipeline spike</h1>
      <p>
        End-to-end local RAG walking skeleton (spec: <code>specs/2026-07-05-phase0-poc-slice1.md</code>,{" "}
        <code>specs/2026-07-06-slice2-ingestion-hardening.md</code>). Spike code — typed, not production-polished.
      </p>

      {pipelineError && <p role="alert">Pipeline error: {pipelineError}</p>}
      {schemaResetNotice && (
        <p role="alert">Local index was reset for the new schema — please re-add your documents (D5/EC-1).</p>
      )}

      <CapabilityBanner
        webgpuAvailable={capabilities?.webgpuAvailable ?? null}
        opfsAvailable={capabilities?.opfsAvailable ?? null}
        indexedDbAvailable={capabilities?.indexedDbAvailable ?? null}
      />

      <section aria-label="Document input">
        <h2>Document</h2>
        {restoredChunkCount !== null && restoredChunkCount > 0 && (
          <p>
            Store restored from browser storage: {restoredChunkCount} chunks already indexed. You can ask a question
            directly.
          </p>
        )}
        <button type="button" onClick={loadBundledSample}>
          Use bundled sample document
        </button>{" "}
        <input
          type="file"
          accept="application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFileSelected(file);
          }}
        />
        {currentDoc && (
          <p>
            Current document: {currentDoc.title} ({currentDoc.charLength} characters)
            {ingestResult && ` — ${ingestResult.chunkCount} chunks stored, index=${ingestResult.indexStrategy}`}
          </p>
        )}
      </section>

      <DocumentList documents={documents} onDelete={deleteDocument} busy={busy} highlightedId={highlightedDocumentId} />

      <section aria-label="Ask a question">
        <h2>Ask</h2>
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a question about the document"
        />
        <input
          type="number"
          min={1}
          max={20}
          value={k}
          onChange={(event) => setK(Number(event.target.value) || DEFAULT_K)}
        />
        <button type="button" onClick={runRetrieve} disabled={!question.trim()}>
          Retrieve
        </button>

        {retrieveResult && (
          <div>
            <h3>Retrieved chunks</h3>
            {retrieveResult.belowRelevanceThreshold ? (
              <p>No strongly relevant passages found.</p>
            ) : (
              <ol>
                {retrieveResult.chunks.map((chunk: RetrievedChunk) => (
                  <li key={chunk.chunkId}>
                    (similarity {chunk.similarity.toFixed(3)}, chars {chunk.charStart}-{chunk.charEnd}, from "
                    {titleForDocument(chunk.documentId)}") {chunk.text}
                  </li>
                ))}
              </ol>
            )}
            <button type="button" onClick={() => void generateAnswer()} disabled={!cloudEnabled || generating}>
              {generating ? "Generating…" : "Generate answer (dev-cloud)"}
            </button>
            {!cloudEnabled && <p>Enable dev-cloud generation below to generate an answer.</p>}
            {answerError && <p role="alert">Generation error: {answerError}</p>}
            {answer && (
              <div>
                <h3>Answer</h3>
                <p>{answer}</p>
              </div>
            )}
          </div>
        )}
      </section>

      <NetworkPanel
        cloudEnabled={cloudEnabled}
        onToggleCloud={setCloudEnabled}
        destinationDomain={devCloudDomain}
        entries={networkEntries}
      />

      <MeasurementPanel snapshot={measurementSnapshot} />

      <ActivityLog entries={activity} />
    </main>
  );
}
