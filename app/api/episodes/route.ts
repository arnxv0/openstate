import { holdsLease } from "@/lib/capture-lease";
import { hasModel, MISSING_KEY_MESSAGE } from "@/lib/llm";
import { errorText, log } from "@/lib/log";
import { perceiveEpisode, type EpisodeFrame, type EpisodeStats } from "@/lib/perception";
import { isObserverId } from "@/lib/signal-store";

const MAX_FRAMES = 6;
const AUTO_REGISTER = /^(1|true|on)$/i.test(process.env.AUTO_REGISTER ?? "");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    observerId?: string;
    viewer?: string;
    trigger?: string;
    anchor?: { key?: string; name?: string; container?: string };
    /** Kind of site the on-device detector saw ("fridge", "table") when no anchor matched. */
    site?: string;
    /** Sent by motion alone, with no detector or anchor match: only update a place that is already registered. */
    knownOnly?: boolean;
    /** Started by movement alone: nothing on the dashboard recognised the place. */
    passive?: boolean;
    frames?: EpisodeFrame[];
    stats?: EpisodeStats;
  };
  if (!body.observerId || !isObserverId(body.observerId)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }
  if (body.viewer && !holdsLease(body.viewer)) {
    log("episode", "rejected: not the capture leader", { observer: body.observerId, viewer: body.viewer });
    return Response.json({ error: "not the capture leader" }, { status: 409 });
  }
  const frames = (body.frames ?? [])
    .filter((frame) => typeof frame.image === "string" && frame.image.length > 0)
    .slice(-MAX_FRAMES)
    .map((frame) => ({ ...frame, image: frame.image.replace(/^data:image\/\w+;base64,/, "") }));
  if (frames.length === 0) return Response.json({ error: "frames required" }, { status: 400 });
  if (!hasModel()) return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
  const container = (body.anchor?.container ?? body.anchor?.name ?? body.site ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .slice(0, 40);

  const started = performance.now();
  log("episode", "received", {
    observer: body.observerId,
    trigger: body.trigger,
    frames: frames.length,
    site: body.site,
    knownOnly: body.knownOnly === true,
    anchor: body.anchor?.name,
    stats: body.stats,
  });
  try {
    const result = await perceiveEpisode({
      observerId: body.observerId,
      trigger: body.trigger ?? "refrigerator",
      frames,
      stats: body.stats,
      container: container || (body.knownOnly ? "place" : undefined),
      anchorKey: typeof body.anchor?.key === "string" ? body.anchor.key.slice(0, 80) : undefined,
      anchorName: typeof body.anchor?.name === "string" ? body.anchor.name.slice(0, 40) : undefined,
      // Places are created only when someone says "remember this". The
      // detector sees a table in almost every room; letting it register one
      // filled the memory with tables nobody asked for and their clutter.
      // AUTO_REGISTER=1 restores registering whatever the detector finds.
      knownOnly: body.knownOnly === true || !AUTO_REGISTER,
      passive: body.passive === true && !body.anchor,
    });
    log("episode", "done", {
      observer: body.observerId,
      site: result.container,
      identity: result.identity,
      skipped: result.skipped,
      coverage: result.coverage,
      contentsVisible: result.contentsVisible,
      changes: result.changes,
      inventory: result.inventory,
      cached: result.cached,
      tokens: result.tokens,
      ms: Math.round(performance.now() - started),
    });
    return Response.json(result);
  } catch (cause) {
    log("episode", "failed", { observer: body.observerId, error: errorText(cause), ms: Math.round(performance.now() - started) });
    return Response.json(
      { error: cause instanceof Error ? cause.message : "perception failed" },
      { status: 502 },
    );
  }
}
