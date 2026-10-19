import { connection } from "next/server";
import { usageSummary } from "@/lib/usage";

// Estimated model spend: last hour, last 24 hours and all time.
export async function GET() {
  await connection();
  try {
    return Response.json(await usageSummary());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
