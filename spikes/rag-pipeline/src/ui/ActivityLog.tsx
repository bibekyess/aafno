// FR-12: minimal local activity log — a precursor to the Privacy Console (PROJECT_ANALYSIS.md §9),
// not the full organism. Plain-language events only; no raw postMessage payloads.

export interface ActivityEntry {
  id: string;
  text: string;
  timestamp: number;
}

export interface ActivityLogProps {
  entries: ActivityEntry[];
}

export function ActivityLog({ entries }: ActivityLogProps) {
  return (
    <section aria-label="Local activity log">
      <h2>Local activity</h2>
      {entries.length === 0 ? (
        <p>No local activity yet.</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <time>{new Date(entry.timestamp).toLocaleTimeString()}</time> — {entry.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
