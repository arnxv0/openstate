# OPENSTATE handoff

Written 2026-10-11, at the end of the MongoDB "Harness Engineering & Model
Wrangling" hackathon (SF Tech Week). The project is finished as a hackathon
entry; nothing is running. This file says where everything is, what is real,
what was staged for the demo, and what to clean up.

`README.md` explains how the system works. `DEMO.md` (on the demo branch)
is the stage script. This file does not repeat either.

Updated 2026-10-19 (morning): Atlas Agent Engine is gone. Long-term memory is
the `memories` collection in Atlas (`lib/long-term-memory.ts`) and the answer
agent is an in-process tool-calling loop (`lib/agent.ts`). Run
`npm run db:setup` once after pulling to create `memories` and `lookups`.

Updated 2026-10-19 (afternoon): rebuilt for the AI Workforce 2026 hackathon
(AWS Builder Loft; rules in `hackathon.md`). Parallel and Composio were
removed; every external capability now comes from a hackathon sponsor, each
as an independent module under `lib/sponsors/` with a status check
(`node --env-file=.env scripts/check-sponsors.ts [sponsor] [--deep]`). The
answer path is a six-agent company (`lib/company/roster.ts`: Mira GM, Iris
inventory, Theo records, Nova research, Ravi procurement/ops, Sol front desk)
whose inter-agent transcript shows on the dashboard. What each sponsor needs
to be live:

| Sponsor | To be live |
| --- | --- |
| Masky | `MASKY_API_KEY` and one avatar per agent (named after the agent, or `MASKY_AVATARS`); `/api/tts` then speaks in the agent's voice |
| BAND | Six External Agents in app.band.ai (`BAND_AGENTS=key=uuid:apikey,…`) and one room with all six (`BAND_ROOM_ID`) |
| Flatkey | `FLATKEY_API_KEY`; `lib/openai.ts` routes through router.flatkey.ai |
| n8n | Workflows from `n8n/` imported, credentials attached, activated; `N8N_WEBHOOK_BASE` |
| RocketRide | `ROCKETRIDE_APIKEY` (+ `ROCKETRIDE_URI`), `ROCKETRIDE_N8N_URL`/`_KEY` for the pipe's n8n node |
| Tenki / Celesto | `TENKI_API_KEY` or `CELESTO_API_KEY`; `SANDBOX_PROVIDER` picks when both exist |
| Kylon | `KYLON_API_KEY` with apps connected in the workspace |
| Paritok | `PARITOK_API_KEY` |
| Prelint | GitHub App installed on the public repo; reads `specs/product.md` |
| Snyk | `SNYK_TOKEN` repository secret for the CI workflow |

Hackathon requirements still on the human: make the repository public, create
the Masky avatars, post the deck URL (`/deck.html`) in the chat at
https://twitch.tv/aijudge, and submit at https://hackathons.crewbasecollective.com
by 5:30 PM PDT. `llm-turn-history.jsonl` is append-only under
`OPEN-SESSION-LICENSE.md`; add turns, never rewrite.

## State at handoff

- All local servers and tunnels are stopped. The Cloudflare and ngrok URLs
  used on the day are dead; a new tunnel gives a new URL.
- Still live in the cloud: the Atlas cluster (database `openstate`). The
  Agent Engine project memory and the deployed answer agent (workspace
  `ws-6acbfbbef638d6502445e4fa`, in Thilak's sandbox project in the hackathon
  org) are no longer used by the code and can be torn down.
- Checks at the last commit: `tsc`, `eslint` and `npm test` pass.

## Branches

| Branch | What it is |
| --- | --- |
| `main` | The product. Every general fix from the day is here. No demo-specific behaviour. |
| `demo/protein-bars` | `main` plus the protein bar demo (12 files, off unless `DEMO_PROTEIN=1`). This is what ran on stage. |
| `feat/*` | Merged into `main` earlier; safe to delete. |

## Run it again

```bash
npm install
cp .env.example .env          # fill in; see below
npm run db:setup              # idempotent
npm run dev -- -p 3001
cloudflared tunnel --url http://localhost:3001   # phones need HTTPS
```

Dashboard at `http://localhost:3001` (one visible tab only: it holds the
capture lease). Phones at `https://<tunnel>/observe/01` and `/observe/02`.
`/places` is the per-place timeline and log.

For the demo: `git checkout demo/protein-bars`, set `DEMO_PROTEIN=1`,
`npm run demo:seed -- reset`, then follow `DEMO.md`.

Things that cost time on the day:

- Venue wifi blocked WebRTC. Phones fall back to posting JPEG frames over
  HTTPS (`lib/frame-relay.ts`), about 10 fps. It works without any setting.
- ngrok's free plan has a 1 GB monthly cap, which video relay eats quickly.
  Use Cloudflare for the phones.
- SSE did not arrive through the Cloudflare tunnel, so the dashboard also
  polls. Open the dashboard on localhost, not through the tunnel.
- Only one `next dev` per checkout. After switching branches or running
  `next build`, `rm -rf .next/dev` before starting the dev server again, or
  the page reloads in a loop.
- When something fails, read `logs/openstate.log` first
  (`scripts/logs.sh -f`, or `scripts/logs.sh episode`).

## Environment

`.env` is not in git. Each person needs their own. Required: `MONGODB_URI`,
`ELEVENLABS_API_KEY`, and `OPENAI_API_KEY` (or `GEMINI_API_KEY`).

| Variable | Effect |
| --- | --- |
| `GROQ_API_KEYS` (comma separated), `LLM_PROVIDER=groq` | Text-only answers on Groq, keys rotated. Photos stay on OpenAI. |
| `PARALLEL_API_KEY` | Web search tool and shelf-life lookups. Without it the agent answers from Atlas alone. |
| `COMPOSIO_API_KEY` | App actions (Google Tasks, Slack, Gmail, Google Calendar). Each observer signs in once; see README. |
| `AGENT_MAX_STEPS` | Model calls per question, tools included (default 6). |
| `DEMO_PROTEIN=1` | Protein bar demo (demo branch only). |
| `AUTO_REGISTER=1` | Let the detector create places by itself. Off by default: only "remember this" creates a place. |
| `GROQ_VISION=1` | Send photos to Groq too. The free tier refuses multi-photo episodes. |
| `MONGODB_DB` | Database name; use `openstate_e2e` for tests. |

The demo ran with Groq and `DEMO_PROTEIN=1`; every answer came from the
in-process path, which is now the only one.

## What was real and what was staged

Real, on `main`: counting what is on a saved place, noticing a removal,
crediting it to the person whose hand took it, answering from stored state
from any phone, snapshots, timeline, trends, long-term memory writes, the
deployed answer agent.

Staged, on `demo/protein-bars` only:

- Three weeks of purchase history (15 events, 4 bars a week) written by
  `npm run demo:seed` and marked `metadata.state: "seeded"`.
- The wording of the stock-up answer, composed in `lib/demo-protein.ts` from
  recorded state (`via: "demo-protein"` in the `/api/ask` response).
- Any wrapped bar is named "protein bar", and an unattributed removal is
  credited to Arnav.
- A looser rule for when a bar counts as removed (`lib/perception.ts`).

The answer is not forced: if the cameras did not record the bars leaving, it
says they are still there.

## Known limits

- An update takes 6 to 10 seconds, almost all of it the vision model.
- Names for similar small items are unstable between looks ("candy bar",
  "snack bar"); synonym matching covers some of it.
- Never checked on real phones: the microphone prompt appearing together with
  the camera prompt, and the "probably <other person>" attribution.
- The exact stage answer ("took the last 2") was confirmed only in live runs,
  not by an automated test against video.
- Tool calling is wired for OpenAI and Groq only; on Gemini the agent answers
  from the prompt without web search or actions.
- Composio sessions carry meta tools by default, so an action is usually two
  extra model calls (search, then execute). `COMPOSIO_TOOLS` with known slugs
  preloads them and saves one.
- The cost counter in the header assumes gpt-5.4-mini at $0.75 in / $4.50 out
  per million tokens. That figure was not checked against OpenAI billing;
  override with `LLM_PRICE_INPUT` and `LLM_PRICE_OUTPUT`.
- With reasoning set to "none" the vision model copies known contents back
  as what it sees. Episodes and answers use "low"; do not lower it without
  replaying the fixture videos.

## Clean up

- [ ] Rotate the OpenAI key, the Voyage key and the four Groq keys. They were
      pasted into a chat during the day.
- [ ] Database `openstate` still holds rehearsal data: places `chair` and
      `fridge`, old facts, the seeded bar history (`npm run demo:seed -- clear`
      removes that last part).
- [ ] Tear down the Agent Engine project memory and the deployed answer
      agent; nothing reads them any more. Decide whether to keep the Atlas
      cluster running; the hackathon org may be removed by the organisers.
- [ ] Delete merged `feat/*` branches.

## Testing without phones

`tests/fixtures/videos/` has two recordings (register a place; recognise it
and take a snack). `scripts/replay-video.sh <video> <01|02> [hold] [base]`
posts their frames as if a phone were streaming. Detection runs in the
dashboard tab, so one must be open on the server being tested. Use a separate
database:

```bash
npx next build
MONGODB_DB=openstate_e2e npm run db:setup
MONGODB_DB=openstate_e2e npx next start -p 3002
```

Drop `openstate_e2e` afterwards.

## If this continues

1. Cut update latency: a smaller or local vision model for the "did anything
   change" step, the large model only for naming.
2. Stable item identity across looks (embedding per item, not a name).
3. Replace the seeded history with real history by leaving it running for a
   few weeks; `lib/trends.ts` already computes pace and a shopping list.
4. Preload the Composio tools the household actually uses (`COMPOSIO_TOOLS`)
   once the slugs are known, so an action costs one model call, not three.
