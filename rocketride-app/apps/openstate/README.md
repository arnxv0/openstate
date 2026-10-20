# OPENSTATE on RocketRide

The OPENSTATE frontend as a RocketRide app: a React remote on the RocketRide
shell that reads the OPENSTATE backend (the Next.js API in the repo root)
over HTTP.

Views: **Overview** (every place, what is there now, trends, shopping list),
**Company** (the six agents with their Masky faces and the live transcript
mirrored to BAND), **Ask** ("Hey World, should I buy some Pepsi?"),
**Observers** (live frames from each pair of glasses over the relay) and
**Live dashboard** (the full dashboard embedded).

One setting: **Backend URL** (Settings → OPENSTATE), the base URL of the
Next.js app, for example the cloudflared tunnel.
