import { existsSync } from "node:fs";
import path from "node:path";
import { sponsor as band } from "@/lib/sponsors/band";
import { sponsor as celesto } from "@/lib/sponsors/celesto";
import { sponsor as flatkey } from "@/lib/sponsors/flatkey";
import { sponsor as kylon } from "@/lib/sponsors/kylon";
import { sponsor as masky } from "@/lib/sponsors/masky";
import { sponsor as mcp } from "@/lib/sponsors/mcp";
import { sponsor as n8n } from "@/lib/sponsors/n8n";
import { sponsor as paritok } from "@/lib/sponsors/paritok";
import type { Sponsor, SponsorStatus } from "@/lib/sponsors/registry";
import { sponsor as rocketride } from "@/lib/sponsors/rocketride";
import { sponsor as tenki } from "@/lib/sponsors/tenki";

// Every sponsor the company can use, in the order the check script and
// /api/health report them. Prelint and Snyk run on the repository rather
// than in the app, so their "status" is whether their config is in place.

const repoFile = (file: string) => existsSync(path.join(process.cwd(), file));

const prelint: Sponsor = {
  key: "prelint",
  name: "Prelint",
  role: "Reviews every pull request against specs/product.md (product drift, not code style).",
  env: [],
  configured: () => repoFile("prelint.json") && repoFile("specs/product.md"),
  status: async () => ({
    configured: repoFile("prelint.json"),
    ok: repoFile("prelint.json") && repoFile("specs/product.md"),
    detail: "prelint.json + specs/product.md in the repo; install the GitHub App on the public repo to activate",
  }),
};

const snyk: Sponsor = {
  key: "snyk",
  name: "Snyk",
  role: "Scans dependencies and code on every push (CI), fixes land as PRs.",
  env: ["SNYK_TOKEN (GitHub secret)"],
  configured: () => repoFile(".github/workflows/ci.yml"),
  status: async () => ({
    configured: repoFile(".github/workflows/ci.yml"),
    ok: repoFile(".github/workflows/ci.yml"),
    detail: "Snyk step in .github/workflows/ci.yml; add SNYK_TOKEN to the repo secrets",
  }),
};

export const SPONSORS: Sponsor[] = [flatkey, masky, band, n8n, rocketride, tenki, celesto, kylon, paritok, mcp, prelint, snyk];

export const sponsorByKey = (key: string) => SPONSORS.find((sponsor) => sponsor.key === key.toLowerCase());

/** Status of some or all sponsors, run concurrently. */
export async function sponsorStatuses(keys?: string[], deep = false) {
  const wanted = keys?.length ? SPONSORS.filter((sponsor) => keys.includes(sponsor.key)) : SPONSORS;
  const entries = await Promise.all(
    wanted.map(async (sponsor): Promise<[string, SponsorStatus & { name: string; role: string }]> => {
      let status: SponsorStatus;
      try {
        status = await sponsor.status(deep);
      } catch (cause) {
        status = { configured: sponsor.configured(), ok: false, error: cause instanceof Error ? cause.message : String(cause) };
      }
      return [sponsor.key, { name: sponsor.name, role: sponsor.role, ...status }];
    }),
  );
  return Object.fromEntries(entries);
}
