# OPENSTATE in Simplified Technical English

This document describes OPENSTATE in ASD-STE100 Simplified Technical English.
Sentences are short. Each sentence gives one instruction or one fact.

## What the system does

OPENSTATE is a company that AI agents operate. The company keeps the supplies
of a household in order.

Phones are the eyes of the company. Each phone sends video of a shelf, a
fridge or a table to a laptop. The laptop finds the place in the video. The
laptop counts the items at that place. The laptop records each change: what
was taken, who took it, and when.

A person speaks to the company. The person says "Hey World" and then asks a
question or gives an instruction. The agents answer with a voice. The agents
can also do work: they add items to a shopping list, send an alert, make a
reminder or send an email.

All records are in a MongoDB Atlas database.

## The six agents

The company has six agents. Each agent has one job, one name, one face and
one voice.

| Agent | Title | Job |
| --- | --- | --- |
| Mira | General Manager | Mira reads each request. Mira gives the work to the correct agent. Mira reports the result. |
| Iris | Inventory Coordinator | Iris knows the items at each place now. Iris knows who took an item and when. |
| Theo | Records Keeper | Theo keeps the long-term memory. Theo knows the facts that people asked the company to remember. |
| Nova | Research Analyst | Nova finds facts outside the house. Nova finds the shelf life of a food, a product recall or a price. Nova runs analyses in a sandbox computer. |
| Ravi | Procurement and Operations | Ravi does the actions. Ravi adds items to the shopping list. Ravi sends alerts, reminders and emails. |
| Sol | Front Desk | Sol speaks to the person. Sol makes one short spoken answer from the reports of the other agents. |

## The sponsors

Each agent uses sponsor services. Each service is one module in
`lib/sponsors/`. Each module works alone.

| Sponsor | Use |
| --- | --- |
| Masky | Masky gives each agent a face and a voice. The route `/api/tts` uses Masky. |
| BAND | The agents talk to each other in a BAND chat room. People can read the room. |
| Flatkey | Flatkey supplies all the language models through one OpenAI-compatible API. `lib/openai.ts` uses it. |
| n8n | n8n runs the workflows for Google Tasks, Slack, Google Calendar and Gmail. The templates are in `n8n/`. |
| RocketRide | RocketRide runs the operations pipeline `rocketride/openstate-ops.pipe`. The pipeline calls n8n. |
| Tenki | Tenki gives Nova a sandbox computer for web research and Python analysis. |
| Celesto | Celesto gives Nova a second type of sandbox computer. Set `SANDBOX_PROVIDER` to select one. |
| Kylon | Kylon gives Ravi a proxy to connected application tools. |
| Paritok | Paritok makes long tool output and memory text shorter before the model reads it. |
| Prelint | Prelint checks each pull request against `specs/product.md`. |
| Snyk | Snyk scans the code and the dependencies in the CI workflow. |

Speech-to-text runs in the browser or through ElevenLabs. These are not
sponsor services.

## How to start the system

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Write the keys in `.env`. Do not put `.env` in git.
5. Run `npm run db:setup`. This command makes the database collections and
   the search indexes.
6. Run `npm run dev`.
7. Open `http://localhost:3000` on the laptop. This page is the dashboard.
8. Start a tunnel. Phones need HTTPS. Run `cloudflared tunnel --url http://localhost:3000`.
9. Open `https://<tunnel>/observe/01` on a phone. Tap **Start observing**.
10. Say "Hey World" and then ask a question.

## How to check each sponsor

1. Run `node --env-file=.env scripts/check-sponsors.ts`. The script shows the
   status of each sponsor.
2. Run `node --env-file=.env scripts/check-sponsors.ts masky` to check one
   sponsor. Replace `masky` with the sponsor name.
3. Add `--deep` to run a real call. A deep check can use credits.
4. Open `http://localhost:3000/api/health`. The page shows the same status for
   each sponsor.
5. If a sponsor shows `configured: false`, add its key to `.env` and start
   the server again.
6. If a sponsor shows `ok: false`, read the `error` field. The company runs
   without that sponsor.

## How to see the agents at work

1. Open the dashboard.
2. Ask a question on a phone.
3. The company panel shows each agent and each message between the agents.
4. If BAND is configured, the same messages appear in the BAND chat room.

## Safety

- The agents do not act without an instruction from a person.
- The counts come from the camera record. The agents do not guess a count.
- Say "ignore this" to stop the camera memory for five minutes.
- The spoken answer is one or two sentences.
