// The contract every sponsor integration follows, so each one can be checked
// and debugged on its own: `npm run check -- <sponsor>` runs status(), and
// /api/health lists them all. A module that is not configured must say so
// and never throw; the company runs with whatever is present.

export type SponsorStatus = {
  configured: boolean;
  /** Reachability when checked; undefined when not configured or not checked. */
  ok?: boolean;
  /** One line a person can read: what is set up, counts, ids. */
  detail?: string;
  error?: string;
  latencyMs?: number;
};

export type Sponsor = {
  /** Short handle used in env, logs and `npm run check`. */
  key: string;
  name: string;
  /** What it does in OPENSTATE, one line. */
  role: string;
  /** Env vars it reads, for the check script and .env.example. */
  env: string[];
  configured: () => boolean;
  /** `deep` may spend credits (render speech, boot a VM); plain status is cheap. */
  status: (deep?: boolean) => Promise<SponsorStatus>;
};

export const notConfigured = (detail: string): SponsorStatus => ({ configured: false, detail });

/** Runs a check and turns any failure into a status instead of an exception. */
export async function checked(run: () => Promise<Omit<SponsorStatus, "configured" | "latencyMs">>): Promise<SponsorStatus> {
  const started = performance.now();
  try {
    const result = await run();
    return { configured: true, ok: true, ...result, latencyMs: Math.round(performance.now() - started) };
  } catch (cause) {
    return {
      configured: true,
      ok: false,
      error: cause instanceof Error ? cause.message.slice(0, 300) : String(cause),
      latencyMs: Math.round(performance.now() - started),
    };
  }
}
