const ORIGIN_SECONDS = 14 * 3600 + 32 * 60;

export function formatDemoClock(elapsedMs: number): string {
  const total = ORIGIN_SECONDS + Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function demoLatency(elapsedMs: number): number {
  return Math.round(43 + Math.sin(elapsedMs / 4200) * 5);
}

export function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}

export function formatMatch(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
