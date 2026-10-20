# OPENSTATE

**Shared spatial memory, run by a company of AI agents.**

Meta AI glasses (or any phone camera) become the eyes. They stream what they
see to a dashboard. Six AI agents watch, remember what is where, who moved it
and when, and answer out loud when someone asks "Hey World, …".

Built in one day for the **AI Workforce 2026 hackathon** (AWS Builder Loft,
19 October 2026). **Demo video:** https://youtu.be/t_A60ZG4jn8
Deck: [`/deck.html`](public/deck.html). Simplified Technical English
description: [`ASD-STE100.md`](ASD-STE100.md). Session history:
`llm-turn-history.jsonl` under the [Open Session License](OPEN-SESSION-LICENSE.md).

## The problem

Things move, people forget, and nobody keeps the record. Did someone take the
last water bottle? How fast do we go through Pepsi? When should we buy more?
Today that lives in nobody's head. Every shared space has this problem: a
kitchen, a warehouse shelf, a hospital supply room, a lab bench.

## How OPENSTATE solves it

1. **Register a place.** Look at a table or fridge and say "Hey World,
   remember this table". The camera's reference frames are stored as a visual
   anchor.
2. **Watch it.** Every live frame from every camera is matched against the
   saved places. When a place is in view and something changes, the keyframes
   go to a vision model, which reports the new contents and what changed.
3. **Record it.** Every change becomes an event in MongoDB Atlas: the place,
   the item, the count, the time, and the person whose camera saw it.
4. **Ask.** "Hey World, should I buy some Pepsi?" The question goes through
   the company (below). The answer comes back spoken, with the reasoning
   visible on the dashboard.

OPENSTATE is a **geospatial endpoint**: ask about a place and you get
everything every camera has seen there.

## The company

| Agent | Role | What they do |
| --- | --- | --- |
| Mira | General Manager | Reads each request and delegates |
| Iris | Inventory Coordinator | Counts what is at every place right now, who took what |
| Theo | Records Keeper | Long-term memory: facts, past sightings, trends |
| Nova | Research Analyst | Outside the house: recalls, shelf life, prices, in a sandbox |
| Ravi | Procurement & Operations | Shopping list, alerts, reminders, the ops pipeline |
| Sol | Front Desk | Turns the reports into one spoken answer |

Mira delegates, the specialists work in parallel with their own tools, Sol
answers. Every message between agents is posted to a BAND room and shown on
the dashboard. The roster is `lib/company/roster.ts`.

## What each technology is used for

| Technology | Used for |
| --- | --- |
| **Masky** | A face and a voice for every agent. Sol speaks each answer through her Masky avatar (`/api/tts`). |
| **BAND** | The room where the agents talk to each other. Every hand-off is a message there. |
| **Flatkey** | Model router and fallback when OpenAI is slow or out of credit. |
| **Tenki** | A fresh sandboxed VM for Nova's research and Python analyses. |
| **Paritok** | Compresses long agent reports before they reach the Front Desk. |
| **RocketRide** | Ravi's ops pipeline (`rocketride/openstate-ops.pipe`), and the frontend as a RocketRide App Builder app (`rocketride-app/`). |
| **n8n** | Alerts, reminders and emails through webhooks (`n8n/*.workflow.json`). |
| **Celesto, Kylon** | Extra tools for the scout and the runner. |
| **Prelint** | Reviews every pull request against `specs/product.md`. |
| **Snyk** | Security scan on every push (`.github/workflows/ci.yml`). |
| **MCP bridge** | Agents call the Masky, Tenki and RocketRide MCP servers directly (`lib/sponsors/mcp.ts`). |
| **MongoDB Atlas** | Events, places, episodes and long-term memory, with vector + text hybrid search. |
| **OpenAI** | Vision on keyframes and the agents' reasoning. Groq is a secondary provider. |
| **ElevenLabs** | Speech-to-text on the glasses; fallback voice. |
| **Next.js 16, React 19** | Dashboard, observer pages and every API route. |
| **Remotion, Kokoro** | The demo video and its local narration. |

Every sponsor is an independent module in `lib/sponsors/`. Each reads its own
environment variables, reports `configured: false` when they are missing, and
never throws into the company. Check them with:

```bash
npm run check            # all sponsors
npm run check -- masky   # one sponsor
curl localhost:3000/api/health?deep=1
```

## How this transfers to other places

The system knows nothing about kitchens. A place is anything someone pointed a
camera at and named. The same code runs unchanged for:

- **Warehouse.** Every shelf is a place, every pick is an event. Ask "how many
  of part 7 are left on bay 3" from anywhere.
- **Hospital supply room.** Who took the last kit and when, without a barcode.
- **Shared lab or makerspace.** Tools wander. The camera remembers where they went.
- **Retail shelf.** Restock alerts from trend, not from a manual count.

Swap the roster in `lib/company/roster.ts` to change the agents' jobs, and the
tools in `lib/company/tools.ts` to change what they can do.

## Run it

```bash
cp .env.example .env     # add MONGODB_URI, OPENAI_API_KEY and any sponsor keys
npm install
npm run db:setup         # creates the Atlas collections and search indexes
npm run dev              # dashboard on http://localhost:3000
```

Open the dashboard on the laptop and `/observe/01` and `/observe/02` on two
phones or glasses (a `cloudflared tunnel --url http://localhost:3000` gives
them an HTTPS URL). Say "Hey World, remember this table", then ask questions.

Before handing work back: `npx tsc --noEmit`, `npm run lint`, `npm test`.

## For the judges

- **Public repo:** this one.
- **Masky avatars:** six, one per agent, shown on the dashboard's company panel.
- **Deck:** [`/deck.html`](public/deck.html), which embeds the SIP calculator at [`/sip.html`](public/sip.html).
- **Agents talking to each other:** the BAND room and the dashboard transcript.
- **Code review and security:** Prelint and Snyk run on every pull request.
- **Sandboxed code:** Nova's Python runs in Tenki.
- **Deeper technical notes:** [`HANDOFF.md`](HANDOFF.md).
