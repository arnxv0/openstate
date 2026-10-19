import { runCompany } from "@/lib/company/dispatch";
import { episodesSettled, outstanding } from "@/lib/episode-queue";
import { insertEvent } from "@/lib/events-repo";
import { hasModel, maxImages, MISSING_KEY_MESSAGE } from "@/lib/llm";
import { errorText, log } from "@/lib/log";
import { recallContext, recordTurn, rememberFact } from "@/lib/long-term-memory";
import { retrieveMemories } from "@/lib/memory";
import { listContainers, openPrivacyWindow, perceiveEpisode, siteReferences } from "@/lib/perception";
import { cameraLabel, OBSERVER_KEY } from "@/lib/observers";
import { isObserverId } from "@/lib/signal-store";
import type { ObserverId } from "@/lib/types";
import { isAboutTheView } from "@/lib/utterance";
import { hasWords } from "@/lib/wake";
import { formatTrends } from "@/lib/trends";
import { loadTrends } from "@/lib/trends-repo";
import { formatWorldState } from "@/lib/world-state";

type AskBody = {
  observerId?: string;
  text?: string;
  image?: string;
};

type Decision = {
  view?: string | null;
  matchedPlace?: string | null;
  intent: "question" | "remember" | "ignore";
  answer: string;
  memory?: string;
  anchor?: string | null;
};

// The Front Desk's brief. The company (lib/company/dispatch.ts) runs the GM
// and the specialists first; their reports arrive as the last part.
const SYSTEM = `You are Sol, Front Desk of OPENSTATE, an agent-run household supply operation watched through phone cameras. You speak for the company.
The user spoke to you after saying the wake phrase "Hey World".
You receive: their utterance, an optional photo of what their camera sees right now, memories retrieved from earlier observations, and reports from your colleagues (Mira the General Manager, Iris on inventory, Theo on records, Nova on research, Ravi on procurement and operations).

Classify the utterance:
- "remember": they ask you to remember/note something. Put a clean standalone fact in "memory" (include objects, places, people; resolve "this"/"here" using the photo). "answer" is a short confirmation.
  If what they want remembered is a place, landmark, container or fixed object the camera is looking at right now ("register this", "register this fridge", "remember this fridge", "remember this place", "remember this spot", "remember where I am", "remember my wardrobe", "this is the garage fridge", "this is Thilak's desk"), also set "anchor" to a short lowercase name for it, using their words when they give one ("garage fridge") and otherwise what the photo shows ("fridge", "wardrobe", "pantry shelf", "front door", "whiteboard corner", "sofa"); otherwise "anchor" is null. "remember this place" with no name gets the most recognisable fixed thing in the photo as its name, never "place". "register this" always counts as "remember". A bare "remember this" while the camera looks at a table, desk, shelf, counter or fridge is such a request: name it from the photo ("table").
  If what they want remembered is a movable thing the photo shows resting somewhere ("remember my laptop", "remember where I put my keys", or a bare "remember this" while the camera looks at a laptop on a chair), the place it rests on is what must be watched: set "anchor" to that place ("chair", "sofa", "side table"), so that it is tracked and its being taken is noticed. "memory" then says whose thing it is and where it is ("Thilak's laptop is on the chair in the lounge"). Whenever a photo is attached to a "remember" request, "anchor" is null only if nothing in the photo is a place or a thing resting on one (a pure fact such as "remember the wifi password is …").
  When "anchor" is set and the request was about the place itself, "memory" says what the site is and where ("There is a wooden table in the office that OPENSTATE watches"), never what is on or in it right now: contents change and are tracked separately.
- "ignore": they ask you not to record / forget / go private. "answer" is a short confirmation.
- "question": anything else, including requests to do something. When REGISTERED PLACES photos are attached, first compare the current photo with each reference photo. Only if the current photo is mainly a view of that same physical place or object, say its name ("You're at the whiteboard corner") for "where am I", "what place is this" or "what am I looking at". Being in the same room, or having only an edge of it in frame, is not a match: then say what the photo actually shows, that it is not a place you were asked to remember, and, if a remembered place is partly visible, that it is next to it. Never name a remembered place just because it is the only one you know. Answer using the current world state, the photo, memories and your colleagues' reports. For what is in or on a site (table, fridge, shelf) the world state is the truth, wherever the person is standing now: "coke can ×2" means two; an item not listed is not there now, so "how many" is zero, even if memories mention it; a "taken" or "gone from" event means it left. Answer "how many … are left" with the number from the world state and, when the last change explains it, who was seen taking one and when. If you do not know, say so briefly.

  Match what they ask about loosely to what is recorded: "a snack" covers a candy bar, a snack packet or a bag of chips; "a drink" covers a coke can. A recorded removal answers "who took …". When the record names a person ("Arnav took …"), say that person took it. When it only says which camera saw it, say "someone took it, seen by Arnav's camera at …" rather than naming the camera's owner as the taker.
  Only food, drink and household supplies are things to buy or to call "running low"; never suggest buying or replacing a laptop, a bag or other belongings.
  When asked what changed last, compare the dates as well as the times.
  For "what should I buy", "what are we running low on", "how fast do we go through …" or "is anything going off", use the usage trends: lines marked BUY are the shopping list; give the pace in plain words ("about two a day"). Freshness is an estimate, so say "probably".
  For "did I already take …", "where did I put …", "when did I last …", answer calmly and concretely from the last recorded change. If nothing was recorded, say you did not see it rather than guessing.

Colleagues' reports: when a colleague did the work (Nova looked something up, Ravi added items to the list, Iris or Theo checked the record), build the answer on their report and credit them by name in passing ("Ravi has added…", "Nova checked: …"). When a colleague says an action could not be done, say so plainly and do not claim it happened. Never invent a report.

Every registered place keeps its own state in the world state. Work out which place the question is about; never mix one place's contents into another's. Call observers by whose camera it is (the key is given below), never "observer 02"; if a colleague's report says "observer 02", rewrite it as that person's camera. When the record says "Arnav took" or "probably Arnav took" something, say Arnav took it (keep the "probably"). For "where is my X", answer with where X is now and, when it moved, who moved it and when.

The answer is spoken aloud: one or two short sentences, no markdown, no lists, no URLs.
When a photo is attached, fill "view" before anything else: a few words naming the main thing the photo shows. Then "matchedPlace": the name of the registered place whose reference photo shows that same main thing, or null. An answer may only say the person is at a remembered place when "matchedPlace" is not null.
Respond with JSON: {"view": "..." | null, "matchedPlace": "..." | null, "intent": "...", "answer": "...", "memory": "...", "anchor": "..." | null}`;

/** The newest recorded change across all places, spelled out so no model has to compare timestamps. */
function latestChange(sites: Awaited<ReturnType<typeof listContainers>>) {
  const latest = sites
    .filter((site) => site.lastChange)
    .sort((a, b) => new Date(b.lastChange!.at).getTime() - new Date(a.lastChange!.at).getTime())[0];
  if (!latest?.lastChange) return "none recorded";
  const { summary, by, at } = latest.lastChange;
  return `${latest.name}: ${summary}, seen by ${cameraLabel(by)} at ${new Date(at).toLocaleString("en-GB")}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as AskBody;
  const text = body.text?.trim();
  if (!text || !hasWords(text)) {
    return Response.json({ error: "Say a full question after “Hey World”." }, { status: 400 });
  }
  if (!body.observerId || !isObserverId(body.observerId)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }
  if (!hasModel()) {
    return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
  }

  const observerId = body.observerId;
  const started = performance.now();
  try {
    return await answer(observerId, text, body.image, started);
  } catch (cause) {
    // Return JSON rather than the framework's HTML 500 so the phone can speak
    // a short failure message instead of "couldn't reach OPENSTATE".
    console.error("/api/ask failed", cause);
    log("ask", "failed", { observer: observerId, text, error: errorText(cause) });
    return Response.json(
      {
        error: "I couldn't think that through just now. Please try again.",
        detail: cause instanceof Error ? cause.message : String(cause),
      },
      { status: 502 },
    );
  }
}

async function answer(observerId: ObserverId, text: string, rawImage: string | undefined, started: number) {
  // Someone may have just taken the thing being asked about: let an episode
  // that is being captured or read finish before looking at the state.
  const pending = outstanding();
  if (pending.inFlight || pending.expected) {
    const waited = await episodesSettled(5000);
    log("ask", "held for an episode in progress", { observer: observerId, text, ...pending, waitedMs: waited });
  }

  const [{ mode, memories }, containers, trends, longTerm] = await Promise.all([
    retrieveMemories(text),
    listContainers(),
    loadTrends().catch(() => []),
    recallContext(text, observerId),
  ]);
  const image = rawImage?.replace(/^data:image\/\w+;base64,/, "");
  // Recognising a remembered place needs its photo next to the current one.
  const places =
    image && isAboutTheView(text)
      ? await siteReferences(Math.min(4, maxImages() - 1)).catch(() => [])
      : [];
  const worldState = formatWorldState(containers);

  const context = [
    `Now: ${new Date().toString()}`,
    `Observer asking: ${observerId}. Who is who: ${OBSERVER_KEY}.`,
    `Current world state (shared across all observers, authoritative for container contents):`,
    worldState,
    `Most recent change anywhere: ${latestChange(containers)}`,
    `Usage trends over the last 14 days (pace, time left, what to buy, freshness guesses):`,
    formatTrends(trends, (date) => date.toLocaleString("en-GB")),
    `Memories and events (most relevant first):`,
    memories.length
      ? memories.map((m) => `- [${m.when}, observer ${m.observerId ?? "?"}, ${m.type}] ${m.text}`).join("\n")
      : "- none yet",
    `Long-term memory (facts, past sightings, places, earlier today):`,
    longTerm?.text ?? "- none",
    `Utterance: "${text}"`,
  ].join("\n");

  const run = await runCompany<Decision>({
    text,
    hostSystem: SYSTEM,
    context,
    toolContext: { worldState, trends },
    // Reasoning off misreads "no longer in the fridge" events as presence.
    reasoning: "low",
    parts: [
      ...(image ? [{ inline_data: { mime_type: "image/jpeg", data: image } }] : []),
      ...places.flatMap((place, index) => [
        { text: `REGISTERED PLACE ${index + 1}: "${place.name}"${place.place ? ` (${place.place})` : ""}. Reference photo, taken earlier:` },
        { inline_data: { mime_type: "image/jpeg", data: place.image.replace(/^data:image\/\w+;base64,/, "") } },
      ]),
      { text: context },
    ],
  });

  const decision = run.decision;
  const latencyMs = Math.round(performance.now() - started);
  const colleagues = run.agents.filter((key) => key !== "gm" && key !== "host");

  if (decision.intent === "ignore") {
    await openPrivacyWindow(observerId);
    await insertEvent({
      type: "privacy",
      observerId,
      title: "Privacy request",
      message: "Utterance not recorded. Camera memory paused for 5 minutes.",
      summary: "Privacy request (content withheld)",
    });
  } else {
    await insertEvent({
      type: "voice",
      observerId,
      title: "Voice",
      message: text,
      intent: decision.intent === "remember" ? "remember" : "neutral",
    });
    const anchor = decision.anchor?.trim().toLowerCase().slice(0, 40) || undefined;
    void recordTurn({ observerId, role: "user", content: text });
    if (decision.intent === "remember" && image && anchor) {
      const registration = await perceiveEpisode({
        observerId,
        trigger: "register",
        frames: [{ image, at: Date.now(), phase: "during" }],
        container: anchor,
        anchorName: anchor,
        register: anchor,
      }).catch(() => null);
      log("ask", "registration", {
        observer: observerId,
        anchor,
        site: registration?.container,
        identity: registration?.identity,
        skipped: registration?.skipped,
        failed: registration === null,
      });
      if (registration?.skipped === "unsure") {
        decision.answer = "I couldn't tell whether that's already registered. Try again with the whole front in view.";
      } else if (registration?.container) {
        decision.answer =
          registration.identity === "known"
            ? `That's already registered as the ${registration.container}.`
            : `Registered as the ${registration.container}. I'll recognise it from now on.`;
      }
    }
    if (decision.intent === "remember" && decision.memory) {
      void rememberFact({
        label: anchor ?? decision.memory.slice(0, 60),
        text: decision.memory,
        observerId,
        metadata: anchor ? { anchor } : undefined,
      });
      await insertEvent({
        type: "memory",
        observerId,
        title: "Memory saved",
        message: decision.memory,
        // The dashboard holding the capture lease sees this on the event
        // stream and embeds reference views of the observer's feed into a
        // visual anchor, so later sightings of the same place start capture.
        metadata: anchor ? { object: anchor, detail: "anchor-request" } : undefined,
      });
    } else if (decision.intent === "remember" && anchor) {
      await insertEvent({
        type: "memory",
        observerId,
        title: "Place remembered",
        message: decision.answer,
        metadata: { object: anchor, detail: "anchor-request" },
      });
    } else {
      await insertEvent({
        type: "answer",
        observerId,
        title: colleagues.length ? "Answer (with colleagues)" : "Answer",
        message: decision.answer,
        summary: `Q: ${text} A: ${decision.answer}`,
        metadata: { question: text, latencyMs, ...(colleagues.length ? { detail: colleagues.join(", ") } : {}) },
      });
    }
    void recordTurn({ observerId, role: "assistant", content: decision.answer, modelName: run.model });
  }

  log("ask", "answered", {
    observer: observerId,
    text,
    via: "company",
    requestId: run.requestId,
    hasImage: Boolean(image),
    intent: decision.intent,
    anchor: decision.anchor ?? null,
    view: decision.view ?? null,
    matchedPlace: decision.matchedPlace ?? null,
    places: places.map((place) => place.name),
    agents: run.agents,
    answer: decision.answer,
    model: run.model,
    tokens: run.usage.total,
    ms: latencyMs,
  });

  return Response.json({
    intent: decision.intent,
    answer: decision.answer,
    memory: decision.memory,
    anchor: decision.anchor ?? null,
    view: image ? (decision.view ?? null) : null,
    matchedPlace: image ? (decision.matchedPlace ?? null) : null,
    retrieval: { mode, count: memories.length },
    longTerm: longTerm ? { tokens: longTerm.tokens, counts: longTerm.counts, mode: longTerm.mode } : null,
    company: {
      requestId: run.requestId,
      agents: run.agents,
      transcript: run.transcript.map(({ from, to, text: line, tools, ms }) => ({ from, to, text: line, tools, ms })),
    },
    via: "company",
    model: run.model,
    tokens: run.usage,
    latencyMs,
  });
}
