# n8n workflows: the company's hands

Each file here is one workflow the Procurement agent can trigger
(`lib/sponsors/n8n.ts`). Every workflow starts with a **Webhook** node
(`POST`, `responseMode: responseNode`) and ends with **Respond to Webhook**, so
the app gets a reply in the same request.

| File | Path | What it does | Credential |
| --- | --- | --- | --- |
| `openstate-shopping-list.workflow.json` | `openstate-shopping-list` | one Google Task per item in `body.items` | Google Tasks OAuth2 |
| `openstate-alert.workflow.json` | `openstate-alert` | posts `body.message` to Slack (`body.channel` or `#household`) | Slack OAuth2 |
| `openstate-reminder.workflow.json` | `openstate-reminder` | calendar event `body.title` at `body.when_iso` | Google Calendar OAuth2 |
| `openstate-email.workflow.json` | `openstate-email` | Gmail to `body.to` with `body.subject` / `body.body` | Gmail OAuth2 |
| `openstate-ops.workflow.json` | `openstate-ops` | Slack message `ops: …` and a text reply; called by the RocketRide pipeline | Slack OAuth2 |
| `openstate-health.workflow.json` | `openstate-health` | echoes `{ok:true}`; `npm run check -- n8n --deep` | none |

## Import

1. In n8n (cloud trial is quickest): **Workflows → Import from file**, one file
   at a time.
2. Open each imported workflow, click the app node (Google Tasks, Slack, …)
   and pick or create its credential. Credentials never leave n8n.
3. **Activate** the workflow (toggle, top right). The production
   `/webhook/<path>` route 404s until the workflow is active.
4. In `.env`: `N8N_WEBHOOK_BASE=https://<you>.app.n8n.cloud` (with or without
   `/webhook`). Optional `N8N_WEBHOOK_SECRET` is sent as
   `Authorization: Bearer …`; add a Header Auth credential on the Webhook node
   if you set it. `N8N_WORKFLOWS="shopping=https://…,alert=https://…"`
   overrides individual URLs.

Check from the app: `npm run check -- n8n` lists what is configured;
`--deep` POSTs to the health workflow.

## Payloads the app sends

```json
{ "items": ["milk", "protein bars"], "note": "running low" }   // shopping
{ "message": "The milk is off", "channel": "#household" }      // alert
{ "title": "Take pills", "when_iso": "2026-10-20T09:00:00-07:00", "notes": "…" }   // reminder
{ "to": "a@b.com", "subject": "Shopping list", "body": "…" }   // email
{ "text": "…" }  // ops (from RocketRide's tool_n8n node; `data` in simple payload shape)
{ "ping": true } // health
```

## Node parameters

The Webhook and Respond to Webhook nodes use their documented parameters. The
app-node parameters (`googleTasks`, `slack`, `googleCalendar`, `gmail`) are
kept to the fields shown in n8n's UI as of 2026 and may need a click to
re-select the resource/operation after import; the expressions (`={{
$json.body.… }}`) are the part that matters. If a node shows a red field,
set it in the UI once and save: n8n keeps the mapping with the workflow.
