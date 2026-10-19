# RocketRide: the ops pipeline

`openstate-ops.pipe` is the company's operations pipeline. The Procurement
agent (`run_ops_pipeline` in `lib/sponsors/rocketride.ts`) sends a request
through it from the app with the `rocketride` SDK; RocketRide runs the n8n
`openstate-ops` workflow (`n8n/openstate-ops.workflow.json`) and the reply
comes back along the `text` lane.

```
webhook_1 ──text──▶ tool_n8n_1 (openstate-ops) ──text──▶ response_text_1
```

## Open it on the canvas

1. Install the RocketRide VS Code extension and open this folder; `.pipe` files
   open on the visual canvas.
2. Set the two substitution variables the `tool_n8n` node reads, in the IDE's
   environment or in `.env` (the SDK copies `ROCKETRIDE_*` from `process.env`):
   - `ROCKETRIDE_N8N_URL`: your n8n base URL, e.g. `https://you.app.n8n.cloud`
   - `ROCKETRIDE_N8N_KEY`: an n8n API key (needed for `async` mode; `sync` works without one, leave it empty)
3. Press Run. The webhook source publishes an interface URL; POST text to it
   to test outside the app.

## Run it from the app

```bash
ROCKETRIDE_APIKEY=…           # from the RocketRide Cloud editor
ROCKETRIDE_URI=https://api.rocketride.ai   # or ws://localhost:5565 for a local runtime
ROCKETRIDE_PIPE=rocketride/openstate-ops.pipe   # default
npm run check -- rocketride          # connect only
npm run check -- rocketride --deep   # sends "ping" through the pipeline
```

## Add Masky to the pipeline

RocketRide ships a Masky.AI node. On the canvas, drop it after `tool_n8n_1`,
give it the avatar of Ravi (Procurement) and wire the `text` lane into it so
the ops reply is rendered as a spoken clip; then point `response_text_1` at
its output. The node's config fields are shown on the canvas; this repo does
not pin them because the node reference was not available when the pipe was
written.
