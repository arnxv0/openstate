import { generateJson } from "@/lib/llm";
import { errorText, log } from "@/lib/log";
import { hasSandbox, provider, runPython } from "@/lib/sponsors/sandbox";
import type { AgentTool } from "@/lib/tools";

// The Research Analyst's tools. Browser-based research and the analyses the
// model writes both run inside a sponsor sandbox (Tenki or Celesto), never on
// the server: the web is fetched there, the model's Python runs there, and
// only text comes back.

const RESEARCH_TIMEOUT_MS = 90_000;
const PYTHON_TIMEOUT_MS = 60_000;
const OUTPUT_LIMIT = 6000;

/**
 * Searches DuckDuckGo's HTML endpoint for the query in query.txt, reads the
 * top three pages, and prints {"results": [{url, title, text}]} as JSON.
 * Standard library only, so it runs on a bare VM.
 */
export const SEARCH_SCRIPT = `import json, re, sys, html, urllib.request, urllib.parse
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
query = open("query.txt", encoding="utf-8").read().strip()

def fetch(url, timeout):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")

def strip(markup):
    markup = re.sub(r"(?is)<(script|style|noscript|svg|header|footer|nav).*?</\\1>", " ", markup)
    text = re.sub(r"(?s)<[^>]+>", " ", markup)
    text = html.unescape(text)
    return re.sub(r"\\s+", " ", text).strip()

results = []
try:
    page = fetch("https://html.duckduckgo.com/html/?q=" + urllib.parse.quote_plus(query), 15)
except Exception as e:
    print(json.dumps({"results": [], "error": "search failed: %s" % e}))
    sys.exit(0)

links = []
for m in re.finditer(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', page, re.S):
    href, title = html.unescape(m.group(1)), strip(m.group(2))
    if href.startswith("//"):
        href = "https:" + href
    q = urllib.parse.urlparse(href).query
    uddg = urllib.parse.parse_qs(q).get("uddg")
    if uddg:
        href = uddg[0]
    if href.startswith("http") and href not in [l[0] for l in links]:
        links.append((href, title))
    if len(links) == 3:
        break

for url, title in links:
    try:
        body = strip(fetch(url, 10))
    except Exception as e:
        body = "fetch failed: %s" % e
    results.append({"url": url, "title": title, "text": body[:2500]})

print(json.dumps({"results": results}))
`;

export const EXTRACT_PROMPT = `You read pages fetched from the web and answer one research objective for a household supply company.
Respond with JSON: {"answer": "one or two plain sentences with the figure or fact", "confidence": "high" | "medium" | "low", "sources": ["url", ...]}.
Only use what the pages say; if they do not answer the objective, say so in "answer" with confidence "low". Give one figure, not a range, and name units.`;

type Extracted = { answer: string; confidence: "high" | "medium" | "low"; sources: string[] };

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

export const researchWebTool: AgentTool = {
  name: "research_web",
  description:
    "Research on the live web, from inside a sandboxed computer: shelf life and storage advice, product recalls, prices and where to buy, recipes from what is in stock, anything outside the house. Not for what is in the house: that is in the world state.",
  parameters: {
    type: "object",
    properties: {
      objective: { type: "string", description: "The question in one self-contained sentence." },
      query: { type: "string", description: "A 3-6 word search query." },
    },
    required: ["objective", "query"],
    additionalProperties: false,
  },
  run: async (args) => {
    const objective = str(args.objective).trim();
    const query = str(args.query).trim();
    if (!objective || !query) return "Give an objective and a query.";
    const started = performance.now();
    let pages: { results: { url: string; title: string; text: string }[]; error?: string };
    let where = provider() ?? "sandbox";
    try {
      const run = await runPython(SEARCH_SCRIPT, { timeoutMs: RESEARCH_TIMEOUT_MS, files: { "query.txt": query } });
      where = run.provider;
      if (run.exitCode !== 0) return `The tool failed: sandbox exit ${run.exitCode}: ${run.stderr.slice(0, 300)}`;
      pages = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}") as typeof pages;
    } catch (cause) {
      log("sandbox", "research failed", { query, error: errorText(cause) });
      return `The tool failed: ${errorText(cause)}`;
    }
    if (!pages.results?.length) return `No pages found for "${query}"${pages.error ? ` (${pages.error})` : ""}.`;
    const { data } = await generateJson<Extracted>({
      system: EXTRACT_PROMPT,
      parts: [
        {
          text: [
            `Objective: ${objective}`,
            ...pages.results.map((page, index) => `--- Page ${index + 1}: ${page.title} (${page.url})\n${page.text}`),
          ].join("\n\n"),
        },
      ],
      timeoutMs: 20_000,
    });
    const ms = Math.round(performance.now() - started);
    log("sandbox", "researched", { query, provider: where, confidence: data.confidence, ms });
    const sources = Array.isArray(data.sources) && data.sources.length ? data.sources.join(", ") : pages.results.map((p) => p.url).join(", ");
    return `${data.answer} (${data.confidence} confidence) — sources: ${sources} (researched in a ${where} sandbox in ${ms} ms)`;
  },
};

/** The Research Analyst's tools; empty when no sandbox key is set. */
export function tools(context: { worldState: string; trends: unknown }): AgentTool[] {
  if (!hasSandbox()) return [];
  const runPythonTool: AgentTool = {
    name: "run_python",
    description:
      "Run Python 3 (standard library only, 60 s) in a sandboxed computer. The file data.json beside the script holds {\"worldState\": text of what is in every place right now, \"trends\": the 14-day usage trends as JSON (per item: inStock, used, added, perDay, runsOutInMs, buy, freshness)}. Print what you want to read back. Use for sums, paces, forecasts and comparisons that need real arithmetic.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "The Python program. Read data.json with json.load(open('data.json')). Print results." },
        purpose: { type: "string", description: "What the program works out, in a few words." },
      },
      required: ["code", "purpose"],
      additionalProperties: false,
    },
    run: async (args) => {
      const code = str(args.code);
      if (!code.trim()) return "Give some code to run.";
      try {
        const run = await runPython(code, {
          timeoutMs: PYTHON_TIMEOUT_MS,
          files: { "data.json": JSON.stringify({ worldState: context.worldState, trends: context.trends }) },
        });
        log("sandbox", "python ran", { purpose: str(args.purpose), provider: run.provider, exitCode: run.exitCode, ms: run.ms });
        if (run.exitCode !== 0) return `Exit ${run.exitCode} after ${run.ms} ms:\n${run.stderr.slice(0, OUTPUT_LIMIT)}`;
        const out = run.stdout.trim();
        return `${out.length > OUTPUT_LIMIT ? `${out.slice(0, OUTPUT_LIMIT)}… (truncated)` : out || "(no output)"}\n(ran in a ${run.provider} sandbox in ${run.ms} ms)`;
      } catch (cause) {
        log("sandbox", "python failed", { error: errorText(cause) });
        return `The tool failed: ${errorText(cause)}`;
      }
    },
  };
  return [researchWebTool, runPythonTool];
}
