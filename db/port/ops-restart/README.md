# Restarting a film from a session (2026-09-23)

The producer asked, twice in one afternoon, for the same thing after a deploy:
*"dupa ce dai deploy, da restart la proiectele care ruleaza"* — restart the
films that are being worked on. The first time a session could not: stopping
an n8n execution needs the n8n public API key, which only the SITE holds
(GitHub Secret `N8N_API_KEY`, written into `platform.env` on every deploy).
The n8n MCP connector has no stop tool, and n8n keeps no `n8nApi` credential of
its own, so there was no door a session could reach. The press went back to
the producer.

## The door

`POST /api/ops/restart` (`platform/app/api/ops/restart/route.ts`), body
`{"projectId": "rec…"}`, header `x-hov-key: $MEDIA_INGEST_KEY` — runs the
**same `restartProduction`** the ⟳ Restart button runs and answers its message.
Nothing new is decided there; it is the button, without the browser.

- **Auth**: the shared secret n8n already uses for `/api/media/ingest` and
  `/api/at` (the `HOV Media Ingest` credential). n8n can already write the
  whole database, so this hands it nothing new. `middleware.ts` lets the path
  past the password gate ONLY with the right key (the door, in the key-gated
  group, never beside the unconditional exemptions); the route checks the key
  again (the lock), refuses with 500 if no key is configured, and takes only a
  record id. A logged-in browser without the key is refused too — this is not
  a second Restart button for people.
- **Answers**: 200 when restarted; 409 with the button's own message when it
  could not (already running, nothing configured); 400/401/500 for the request.

## Using it

`restart.workflow.js` is the throwaway: create it with
`create_workflow_from_code`, then once per film

    execute_workflow(<id>, "manual",
      { type: "webhook", webhookData: { method: "POST", body: { projectId: "rec…" } } })

and archive it afterwards. It posts to `http://web:3000/api/ops/restart` from
inside the compose network, like every other n8n → site call.

**Judge it by the executions it starts, not by its own result.** Pause stops
EVERY running execution on the instance except a single scene's re-shoot — the
button has always done that — and that includes the throwaway still waiting
for its answer. So the throwaway may come back `canceled` while the restart
finishes on the site regardless: look for a new orchestrator (`webhook`) and a
new Media Generation (`integrated`) execution a few seconds later.

**One film per call, and in practice one film at a time.** `resumeProject`
refuses while ANY production is alive, and Pause stops everything — so a
second film's restart would stop the first film's fresh run. The site's own
buttons have always worked this way; restarting two films at once would need
a per-film stop, which neither the button nor this door has.

## Verified

Through the real middleware and route on the production build, in Chromium's
network stack against a local engine (`db/port/category-lists/browser/drive.mjs`,
the last five checks): no key → the password gate's 307 to /login; wrong key →
the same; a logged-in browser without the key → 401 from the route; the right
key with a bad id → 400; the right key with a real film → 409 with the
button's own "not configured" (no n8n there). The handler's 500/401/400 paths
are also pinned in `npm run check:routes`, and the door's placement in
`npm run check:category-lists`. The live use is recorded below.

## Used live: the Rome film, 14:21:54 UTC

Shipped in deploy #182 (merge `11be573`; build 14:18:13 → 14:20:33, job
success 14:21:00). The producer's instruction was "deploy, then restart the
projects being worked on"; the one film in production was "How Rome fed a
million people" (`recIIvYV8S6KNaw4C`), on Media Generation `16497` — started
13:54 on `f7f03638`, two versions behind the `c8e6df0c` another session had
published at 14:10.

The throwaway (`zn5Eh1QgV8KYhXDU`, execution 16515) posted at 14:21:54.115 and
was itself canceled at 14:21:54.353 by the site's own Pause — exactly as this
file says it will be, and the proof the route ran (only the site calls the
public stop API). The old run went at 14:21:54.43 (`16497` canceled, its
orchestrator `16496` erroring with it), and the new one started 0.4 s later:
orchestrator `16516` (webhook) and Media Generation `16517` (integrated), on
the current version. A route that did not exist before this deploy answering
at all is also the plainest proof the deploy was live.
