// A2: the indexed-document list + per-document delete (FR-5, FR-6, FR-7, FR-8, D7, EC-5).
// Delete requires a lightweight inline two-step confirm (D7, AC-4) and is disabled while any
// pipeline job is running (D10, EC-5) so a delete can never race an in-flight ingest/retrieve.

import { useState } from "react";
import type { DocumentSummary } from "../lib/messages";

export interface DocumentListProps {
  documents: DocumentSummary[];
  onDelete: (documentId: string) => void;
  busy: boolean;
  highlightedId?: string | null;
}

export function DocumentList({ documents, onDelete, busy, highlightedId }: DocumentListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const requestDelete = (documentId: string) => setConfirmingId(documentId);
  const cancelDelete = () => setConfirmingId(null);
  const confirmDelete = (documentId: string) => {
    onDelete(documentId);
    setConfirmingId(null);
  };

  return (
    <section aria-label="Indexed documents">
      <h2>Indexed documents</h2>
      {documents.length === 0 ? (
        <p>No documents indexed yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Source</th>
              <th>Chunks</th>
              <th>Characters</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr
                key={doc.documentId}
                style={doc.documentId === highlightedId ? { outline: "2px solid orange" } : undefined}
              >
                <td>{doc.title}</td>
                <td>{doc.sourceKind}</td>
                <td>{doc.chunkCount}</td>
                <td>{doc.charLength}</td>
                <td>
                  {confirmingId === doc.documentId ? (
                    <>
                      <span>Delete this document and its {doc.chunkCount} chunk(s)? </span>
                      <button type="button" onClick={() => confirmDelete(doc.documentId)} disabled={busy}>
                        Confirm delete
                      </button>{" "}
                      <button type="button" onClick={cancelDelete}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => requestDelete(doc.documentId)} disabled={busy}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {busy && <p>Delete is disabled while a job is running.</p>}
    </section>
  );
}
