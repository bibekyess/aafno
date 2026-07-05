// Timing + throughput helpers (FR-10). Deliberately simple — this is measurement plumbing for the
// spike's evidence-gathering goal, not a general perf library.

export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class Stopwatch {
  private readonly startedAt = nowMs();

  elapsedMs(): number {
    return nowMs() - this.startedAt;
  }
}

export function throughputPerSecond(count: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return count > 0 ? Infinity : 0;
  return (count / elapsedMs) * 1000;
}

export interface EmbeddingThroughput {
  chunkCount: number;
  charCount: number;
  embedMs: number;
  chunksPerSecond: number;
  charsPerSecond: number;
}

export function embeddingThroughput(chunkCount: number, charCount: number, embedMs: number): EmbeddingThroughput {
  return {
    chunkCount,
    charCount,
    embedMs,
    chunksPerSecond: throughputPerSecond(chunkCount, embedMs),
    charsPerSecond: throughputPerSecond(charCount, embedMs),
  };
}
