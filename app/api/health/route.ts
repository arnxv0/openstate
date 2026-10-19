import { connection } from "next/server";
import { groqKeyCount } from "@/lib/groq";
import { hasModel, provider, supportsTools } from "@/lib/llm";
import { COLLECTIONS, type SearchIndexInfo } from "@/lib/db-schema";
import { memoryStatus } from "@/lib/long-term-memory";
import { db } from "@/lib/mongo";
import { activeRoute } from "@/lib/openai";
import { hasFlatkey } from "@/lib/sponsors/flatkey";
import { sponsorStatuses } from "@/lib/sponsors";

// GET /api/health            — Atlas, model, memory and every sponsor (cheap checks)
// GET /api/health?deep=1     — sponsor checks that spend credits (speak, boot a VM, compress)
// GET /api/health?sponsor=masky,band — only those sponsors

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";
  const only = url.searchParams.get("sponsor")?.split(",").map((key) => key.trim()).filter(Boolean);
  try {
    const database = await db();
    const started = performance.now();
    await database.command({ ping: 1 });
    const pingMs = Math.round(performance.now() - started);

    const [searchIndexes, memory, sponsors] = await Promise.all([
      Promise.all(
        [COLLECTIONS.entities, COLLECTIONS.events, COLLECTIONS.memories].map(async (name) => [
          name,
          ((await database.collection(name).listSearchIndexes().toArray()) as SearchIndexInfo[]).map((index) => ({
            name: index.name,
            status: index.status,
          })),
        ]),
      ).then(Object.fromEntries),
      memoryStatus(),
      sponsorStatuses(only, deep),
    ]);

    return Response.json({
      ok: true,
      database: database.databaseName,
      pingMs,
      searchIndexes,
      model: hasModel()
        ? {
            provider: provider(),
            route: activeRoute(),
            viaFlatkey: activeRoute() === "flatkey",
            fallback: hasFlatkey() && process.env.OPENAI_API_KEY ? (activeRoute() === "openai" ? "flatkey" : "openai") : null,
            tools: supportsTools(),
          }
        : null,
      memory,
      sponsors,
      groqKeys: groqKeyCount(),
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
