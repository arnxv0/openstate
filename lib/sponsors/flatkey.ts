import { requestJson } from "@/lib/sponsors/http";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";

// Flatkey: one OpenAI-compatible key for every model, with failover. When
// FLATKEY_API_KEY is set, lib/openai.ts sends its Responses API calls to
// router.flatkey.ai instead of api.openai.com; nothing else changes.

export const FLATKEY_BASE_URL = "https://router.flatkey.ai/v1";

export const hasFlatkey = () => Boolean(process.env.FLATKEY_API_KEY);

export const sponsor: Sponsor = {
  key: "flatkey",
  name: "Flatkey",
  role: "Routes every model call (vision, answers, agents) through one key with automatic failover.",
  env: ["FLATKEY_API_KEY", "OPENAI_BASE_URL"],
  configured: hasFlatkey,
  status: async () => {
    if (!hasFlatkey()) return notConfigured("FLATKEY_API_KEY not set; model calls go straight to OpenAI");
    return checked(async () => {
      const headers = { Authorization: `Bearer ${process.env.FLATKEY_API_KEY}` };
      const [credits, models] = await Promise.all([
        requestJson<{ remaining?: number; used?: number }>(`${FLATKEY_BASE_URL}/credits`, { headers }).catch(() => null),
        requestJson<{ data?: { id: string }[] }>(`${FLATKEY_BASE_URL}/models`, { headers }),
      ]);
      const ids = (models.data ?? []).map((model) => model.id);
      const wanted = process.env.FLATKEY_MODEL ?? "gpt-5.6-terra";
      return {
        detail: `${ids.length} models${ids.includes(wanted) ? `, ${wanted} available` : `, ${wanted} NOT listed`}${
          credits ? `; credits remaining ${credits.remaining}` : ""
        }`,
      };
    });
  },
};
