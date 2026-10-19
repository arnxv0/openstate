// One small fetch wrapper for the sponsor clients: timeout, JSON in and out,
// and an error that carries the status and the start of the body.

// Plain fields rather than parameter properties: Node's type stripping
// (npm run check) does not support the shorthand.
export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, url: string) {
    super(`${url} ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export async function requestJson<T>(
  url: string,
  {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 10_000,
  }: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, text, url);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Env var that may hold "a=b,c=d" pairs. */
export function envMap(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (process.env[name] ?? "").split(",")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}
