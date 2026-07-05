// FR-11, AC-8: cloud generation is off by default; when enabled and used, the UI must visibly
// state that prompt + retrieved content is leaving the device and name the destination domain.
// Also reflects every lib/network.ts entry (§9 Network section).

import type { NetworkLogEntry } from "../lib/network";

export interface NetworkPanelProps {
  cloudEnabled: boolean;
  onToggleCloud: (enabled: boolean) => void;
  destinationDomain: string | null;
  entries: NetworkLogEntry[];
}

export function NetworkPanel({ cloudEnabled, onToggleCloud, destinationDomain, entries }: NetworkPanelProps) {
  return (
    <section aria-label="Network / privacy">
      <h2>Network &amp; privacy</h2>
      <label>
        <input type="checkbox" checked={cloudEnabled} onChange={(event) => onToggleCloud(event.target.checked)} />
        Enable dev-cloud generation (off by default)
      </label>
      {cloudEnabled ? (
        <p role="status">
          Cloud generation is ON. When you generate an answer, the question and retrieved passages will be sent to{" "}
          <strong>{destinationDomain ?? "(no dev-cloud endpoint configured)"}</strong>.
        </p>
      ) : (
        <p>No document content has left this device. No prompt content has left this device.</p>
      )}
      <h3>Network log</h3>
      {entries.length === 0 ? (
        <p>No network requests recorded yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Domain</th>
              <th>Purpose</th>
              <th>Status</th>
              <th>Sent user content</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={`${entry.timestamp}-${i}`}>
                <td>{new Date(entry.timestamp).toLocaleTimeString()}</td>
                <td>{entry.domain}</td>
                <td>{entry.purpose}</td>
                <td>{entry.status}</td>
                <td>{entry.sentUserContent ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
