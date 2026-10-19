# OPENSTATE product spec

Rules the code must follow. Prelint reads this file on every pull request.

## What the product is

OPENSTATE is a household supply operation run by six AI agents (see
`lib/company/roster.ts`). Phones watch places (a fridge, a table, a shelf);
the agents count what is there, remember what people ask them to, research
outside the house, and act in the household's apps when asked.

## Rules

1. **Agents act only when asked.** No shopping list, alert, reminder, email,
   workflow or app action runs unless the person's utterance asked for that
   action. A question never triggers an action. Research (web lookups,
   sandbox analyses) is not an action and may run to answer a question.
2. **Counts come from the camera record.** Any number spoken about what is
   on a place comes from the stored world state produced by perception. The
   agents never estimate, round up or infer a count from memory text.
3. **Privacy pause.** "Ignore this" (and equivalent phrasings) opens a
   five-minute privacy window for that observer: the utterance is not stored,
   and camera memory is paused for the window.
4. **Every sponsor module degrades, never throws.** A module under
   `lib/sponsors/` reports `configured: false` when its env vars are missing
   and `ok: false` with an `error` when a call fails. A missing or failing
   sponsor never fails `/api/ask`; the company answers with what it has.
5. **No secrets in code.** Keys are read from env vars only. No key, token or
   webhook URL with a secret appears in source, tests, docs, logs or commit
   messages. `.env` is gitignored.
6. **Spoken answers are one or two sentences.** The Front Desk's answer is
   plain speech: no lists, no markdown, no URLs. Anything that must be seen
   (a link, a table) goes to the dashboard as an event.
7. **Attribution is by camera.** A change is reported as seen by a camera
   ("seen by Arnav's camera at 15:31"), and a person is named as the taker
   only when the record names them.
8. **One transcript.** Every message between agents is recorded in the
   company transcript (and mirrored to BAND when configured). Agents do not
   communicate outside it.
9. **Model provider is pluggable.** `lib/llm.ts` picks the provider; code
   outside `lib/openai.ts`, `lib/gemini.ts` and `lib/groq.ts` never calls a
   model endpoint directly.
10. **Tests and checks gate changes.** `npx tsc --noEmit`, `npm run lint`
    and `npm test` pass before a change is handed back; every sponsor module
    has a status check reachable from `scripts/check-sponsors.ts`.

## Decisions

- 2026-10-11: Perception runs in the dashboard tab that holds the capture
  lease; phones only stream video.
- 2026-10-19: Atlas Agent Engine replaced by in-process agents and the
  `memories` collection.
- 2026-10-19: Non-sponsor tool providers (Parallel, Composio) removed; all
  external capabilities come from hackathon sponsors, MongoDB Atlas, and the
  browser or ElevenLabs for speech-to-text.
