import { runAgent, type ToolTrace } from "@/lib/agent";
import type { Part, Usage } from "@/lib/agent-types";
import { agent, SPECIALISTS, type AgentKey, type AgentProfile } from "@/lib/company/roster";
import { mirrorTo, newRequestId, record, recent, type Line } from "@/lib/company/transcript";
import { toolbox, toolsFor, type ToolContext } from "@/lib/company/tools";
import { generateJson } from "@/lib/llm";
import { errorText, log } from "@/lib/log";
import { post as bandPost, sponsor as band } from "@/lib/sponsors/band";
import { compressIfLong } from "@/lib/sponsors/paritok";

// One request through the company: the General Manager reads it and
// delegates to the specialists it needs; they work in parallel with their
// tools and report back; the Front Desk turns the reports into one spoken
// answer. Every exchange is a line in the transcript, and BAND's room gets
// a copy when it is configured.

if (band.configured()) mirrorTo((line) => bandPost(line));

export type Assignment = { agent: AgentKey; task: string };
export type Plan = { reason: string; assignments: Assignment[] };

export type CompanyRun<T> = {
  requestId: string;
  decision: T;
  transcript: Line[];
  agents: AgentKey[];
  usage: Usage;
  model: string;
  latencyMs: number;
};

const SPECIALIST_KEYS = new Set<string>(SPECIALISTS.map((profile) => profile.key));
const MAX_ASSIGNMENTS = 3;

/** The GM's plan, with anything that is not a known specialist dropped. Pure. */
export function parsePlan(raw: unknown): Plan {
  const plan = (raw && typeof raw === "object" ? raw : {}) as { reason?: unknown; assignments?: unknown };
  const assignments = (Array.isArray(plan.assignments) ? plan.assignments : [])
    .filter((item): item is { agent: string; task: string } => {
      if (!item || typeof item !== "object") return false;
      const { agent: key, task } = item as { agent?: unknown; task?: unknown };
      return typeof key === "string" && SPECIALIST_KEYS.has(key) && typeof task === "string" && task.trim().length > 0;
    })
    .map((item) => ({ agent: item.agent as AgentKey, task: item.task.trim() }));
  const seen = new Set<AgentKey>();
  return {
    reason: typeof plan.reason === "string" ? plan.reason : "",
    assignments: assignments.filter((item) => !seen.has(item.agent) && seen.add(item.agent)).slice(0, MAX_ASSIGNMENTS),
  };
}

const gmSystem = () => `You are ${agent("gm").name}, ${agent("gm").title} of OPENSTATE, an agent-run household supply operation. ${agent("gm").persona}
Your colleagues:
${SPECIALISTS.map((p) => `- ${p.key} — ${p.name}, ${p.title}: ${p.brief}`).join("\n")}
Given what a member of the household just said, decide who must work on it before ${agent("host").name} at the Front Desk answers. Rules:
- Counts, what is where right now, who took what and when: eyes.
- Facts people asked to remember, past sightings, places by name, "where did I put", "did I already take": ledger.
- Anything outside the house (how long something keeps, recalls, prices, where to buy, recipes) or an analysis over the usage data ("how fast do we go through", "when will we run out"): scout.
- Doing something: add to a list, order, remind, alert or message the household, email, run the ops pipeline: runner. Only when they clearly ask for it.
- "Remember this", "register this", "ignore this", "where am I", "what am I looking at" and small talk: nobody; the Front Desk handles these from the record and the camera.
- Several colleagues when the request needs them (e.g. runner needs the list from eyes: assign both; runner's task says to use the shopping list in the trends).
Give each colleague one sentence of instruction in your own words. Respond with JSON: {"reason": "one short sentence", "assignments": [{"agent": "eyes|ledger|scout|runner", "task": "..."}]} with 0 to ${MAX_ASSIGNMENTS} assignments.`;

const specialistSystem = (profile: AgentProfile, available: string[], missing: string[]) =>
  `You are ${profile.name}, ${profile.title} at OPENSTATE, an agent-run household supply operation. ${profile.persona}
The General Manager gave you a task. Work it out from the context you are given and from your tools; call a tool when the context does not already hold the answer. ${
    available.length ? `Tools you have: ${available.join(", ")}.` : "You have no tools right now; answer from the context."
  }${missing.length ? ` Not available today (say so if the task needs them, do not pretend): ${missing.join(", ")}.` : ""}
People, not ids: the context says who each observer is ("observer 02 = Arnav's camera"). Never write "observer 02"; write "Arnav's camera" for what a phone saw, and when a record says someone took or added a thing ("Arnav took", "probably Arnav"), name that person as the one who did it.
Report back in two to four sentences of plain prose: what you found or did, the figures, who or what it came from, and anything you could not do. No markdown. Respond with JSON: {"report": "..."}`;

export async function runCompany<T extends { answer?: string }>({
  text,
  parts,
  hostSystem,
  context,
  toolContext,
  reasoning = "low",
}: {
  /** The utterance, for the GM and for the transcript. */
  text: string;
  /** What the Front Desk sees: photo, reference photos, and the context block. */
  parts: Part[];
  /** The Front Desk's system prompt (the Decision contract lives in the caller). */
  hostSystem: string;
  /** The shared context block (world state, trends, memories) specialists read. */
  context: string;
  toolContext: ToolContext;
  reasoning?: string;
}): Promise<CompanyRun<T>> {
  const started = performance.now();
  const requestId = newRequestId();
  const usage: Usage = { input: 0, output: 0, total: 0 };
  const add = (more: Usage) => {
    usage.input += more.input;
    usage.output += more.output;
    usage.total += more.total;
  };
  const gm = agent("gm");
  const host = agent("host");

  // 1. The GM delegates.
  let plan: Plan = { reason: "", assignments: [] };
  try {
    const planned = await generateJson<unknown>({
      system: gmSystem(),
      parts: [{ text: `The household said: "${text}"\n\nFor orientation, the current record:\n${context.slice(0, 3000)}` }],
      reasoning: "none",
      timeoutMs: 10_000,
    });
    add(planned.usage);
    plan = parsePlan(planned.data);
  } catch (cause) {
    log("company", "gm plan failed, front desk answers alone", { error: errorText(cause) });
  }
  if (plan.assignments.length === 0) {
    record({ requestId, from: "gm", to: "host", text: plan.reason || "You can answer this from the record and the camera." });
  }
  for (const assignment of plan.assignments) {
    record({ requestId, from: "gm", to: assignment.agent, text: assignment.task });
  }

  // 2. Specialists work in parallel, each with its own tools.
  const box = await toolbox(toolContext);
  const reports = await Promise.all(
    plan.assignments.map(async (assignment) => {
      const profile = agent(assignment.agent);
      const { available, missing } = toolsFor(profile, box);
      const began = performance.now();
      let report: string;
      let trace: ToolTrace[] = [];
      try {
        const run = await runAgent<{ report?: string }>({
          system: specialistSystem(profile, available.map((tool) => tool.name), missing),
          parts: [{ text: `${context}\n\nTask from ${gm.name}: ${assignment.task}\nThe household's words were: "${text}"` }],
          tools: available,
          reasoning,
          maxSteps: 5,
        });
        add(run.usage);
        trace = run.tools;
        report = typeof run.data.report === "string" && run.data.report.trim() ? run.data.report.trim() : "I have nothing to add.";
      } catch (cause) {
        report = `I could not complete that: ${errorText(cause).slice(0, 160)}.`;
        log("company", "specialist failed", { agent: profile.key, error: errorText(cause) });
      }
      // Paritok keeps long reports short before they reach the Front Desk.
      report = await compressIfLong(report, text);
      const ms = Math.round(performance.now() - began);
      record({ requestId, from: profile.key, to: "gm", text: report, tools: trace.map((call) => call.name), ms });
      return { profile, report, trace, ms };
    }),
  );

  // 3. The Front Desk answers, with the colleagues' reports in hand.
  const reportsBlock = reports.length
    ? `Reports from colleagues (use them; credit the colleague when their work answers the question):\n${reports
        .map(({ profile, report }) => `- ${profile.name} (${profile.title}): ${report}`)
        .join("\n")}`
    : "No colleague was needed for this; answer from the record and the camera.";
  const answer = await generateJson<T>({
    system: hostSystem,
    parts: [...parts, { text: reportsBlock }],
    reasoning,
  });
  add(answer.usage);
  record({ requestId, from: "host", to: "user", text: typeof answer.data.answer === "string" ? answer.data.answer : "(no answer)" });

  const latencyMs = Math.round(performance.now() - started);
  log("company", "request done", {
    requestId,
    text,
    plan: plan.assignments.map((a) => a.agent),
    reports: reports.map((r) => ({ agent: r.profile.key, ms: r.ms, tools: r.trace.map((t) => t.name) })),
    tokens: usage.total,
    ms: latencyMs,
  });
  return {
    requestId,
    decision: answer.data,
    transcript: recent(50, requestId),
    agents: ["gm", ...plan.assignments.map((a) => a.agent), host.key],
    usage,
    model: answer.model,
    latencyMs,
  };
}
