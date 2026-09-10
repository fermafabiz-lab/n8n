# The n8n side: `Archive Suggestions` and `universal-footage-search`

The engine lives on the site; n8n holds only what needs the OpenAI key.
Two doors:

## 1. `Archive Suggestions` (`Lo78uXXCFYoIH73r`, webhook `archive-suggest`)

Fired by the site on scene-text approval for documentary films
(`saveSceneScript` with approve, `approveAllScenes`) and by the per-scene
*✨ Look for archive footage* door. POST `{ project_id }`, answers on
receipt.

```
Suggest Webhook → Fetch Scenes (GET /api/archive/suggest?project=…, claims scenes 10 min)
  → Build Query Prompt → Query Model → Parse Queries
  → Search Archives (POST /api/archive/suggest stage=search)
  → Build Rank Prompts (batches of 8) → Rank Model → Parse Ranks
  → Store Suggestions (POST /api/archive/suggest stage=store)
```

**Active version `a3278855-7c67-4e1f-960f-5ef7168d1127` since 2026-09-10**
(before it `6b5a1417-2828-4e1d-ae0b-28ea1b6a454a`, 2026-09-09, and
`6ac5f5f1-e0b7-4f34-8fd2-b5e50af9062b`, 2026-09-07). The 09-09 publish
changed three Code nodes; the 09-10 one changed only `Build Query Prompt`.
The repo copies are in `db/port/footage-engine/nodes/` and `verify.mjs`
there diffs a fetched workflow against them.

- **`Build Query Prompt`** asks the model, per scene, for a structured
  request — `topic, event, location, country, dateFrom, dateTo, people,
  organizations, keywords, preferredMediaType, preferredFootageType,
  requireExactEvent` — plus 3–6 short catalogue queries, and tells it which
  sources exist and what each is for: the public archives (Wikimedia
  Commons, the Internet Archive's newsreels and government films, Europeana,
  the Library of Congress, the Wellcome Collection), the official services
  (EU Audiovisual Service, DVIDS, NASA), the photo communities (Flickr,
  Openverse) and, for generic present-day B-roll only, the stock libraries
  (Pexels, Pixabay, Unsplash) — that last case is the `stockshots` footage
  type, with `event` null. It forbids invention in as many words: *never
  invent a date, a place, a person or an event the narration does not
  support; leave the field null instead.* The prompt names sources, never
  keys: which of them are actually reachable is the site's registry's
  business, and a scene asking for a source that is off simply gets the
  others.
- **`Parse Queries`** sanitises the answer (types, lengths, ISO dates,
  the footage-type vocabulary) and emits `{ id, request, queries, why }`.
  It still accepts the old `years: [from, to]` as a fallback for the date
  window. Only scenes the model answered for count as processed.
- **`Search Archives`** is unchanged: `POST /api/archive/suggest` with
  `stage: "search"`. The route accepts both shapes — `queries[]` alone (the
  old prompt) and `request{}` + `queries[]` (the new one) — and rebuilds the
  request through `buildFootageRequest()`, so the prompt and the site can
  be upgraded independently.
- **`Build Rank Prompts`** now shows the ranking model each candidate's
  provider, kind of shot, filming date (or years mentioned, or catalogue
  date, marked as such), place, event, the engine's score /100, its
  provenance and its rights class, and tells it what the provenance words
  mean, to prefer B-roll under narration, and not to rank a candidate over
  a higher engine score without a concrete reason from the text.
- `Parse Ranks` and `Store Suggestions` are unchanged. A pick must name a
  candidate the batch offered; the store drops any id the library does not
  hold.

Three properties carried over from the first version and still true:
every Code node emits at least one item so `Store Suggestions` always runs
and stamps what was processed; the site never offers a review-class asset
from this run (only `cleared` / `attribution_required`, or rows a person
already approved); and a run that dies leaves the bar saying "not yet"
with a manual door, never silence.

## 2. `universal-footage-search` — the search as an HTTP door

The spec asked for an n8n workflow that searches, normalises, ranks and
stores. All of that is `GET/POST /api/footage/search` on the site, which
any n8n HTTP node can call with the `HOV Media Ingest` header credential:

```
POST http://web:3000/api/footage/search
{ "request": { "sceneId": "rec…", "narration": "…", "event": "…", "location": "…",
               "dateFrom": "2026-05-18", "dateTo": "2026-05-20",
               "preferredMediaType": "video", "preferredFootageType": "broll" },
  "providers": ["eu_av", "wikimedia"],      // optional — the router decides otherwise
  "top": 12, "localOnly": false, "fresh": false }
```

answers `{ ok, candidates: [{ asset, score, reasons, rights, provenance,
provenanceConfidence }], providers: [report…], source, queries, ms }` —
every candidate already filed in the library with an `id`, ranked and
classified. `GET …?scene=rec…&type=video&limit=16` builds the request from
the scene itself, which is what the picker uses.

No separate workflow was created for it, deliberately: a workflow that
only wraps one HTTP call adds a hop and a place for the two to drift, and
the suggestion run above already IS the n8n consumer of the search. A
future workflow that needs the search (a nightly re-index, say) is one
HTTP node against that route.

## Keys and credentials

- OpenAI: the `openAiApi` credential on `Query Model` / `Rank Model`, as
  before.
- Site: the `HOV Media Ingest` header credential (`8kpY42LmZaBYBzfY`) on
  every call into `web:3000` — `middleware.ts` opens `/api/archive/*` and
  `/api/footage/*` to that key.
- Provider keys (`DVIDS_API_KEY`, `EUROPEANA_API_KEY`, `FLICKR_API_KEY`,
  the stock keys, the Openverse client) live on the SITE (`platform.env`,
  from GitHub Secrets), not in n8n: the providers are called from the
  site's engine.

## Applying an edit here

`update_workflow` stages a draft; nothing runs until `publish_workflow`
with the explicit `versionId` from `get_workflow_history`. Before
publishing, diff the draft against the version you meant to build on and
confirm only your nodes differ — and after publishing, fetch the workflow
back and run `node db/port/footage-engine/verify.mjs <file>` so a
mis-escaped regex cannot go live unnoticed (the motif-card lesson in
CLAUDE.md).
