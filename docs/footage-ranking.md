# Footage ranking

`platform/lib/footage/rank.ts`. One score per candidate, 0–100.

## Weights

| Component | Max | From |
|---|---|---|
| semantic relevance | 25 | share of the request's vocabulary in the asset's text |
| exact event match | 20 | `matchSignals().event === "yes"` |
| date match | 15 | filming date inside the window ± 1 year |
| location match | 15 | place or country named |
| people / organisations | 10 | any request name on the asset |
| visual usefulness | 5 | `visualUsefulness()` — the KIND of shot against the kind the scene wants |
| media quality | 5 | the asset's `qualityScore` (resolution, duration) |
| provider metadata reliability | 5 | `PROVIDER_RELIABILITY`: DVIDS 1, NASA 1, EU AV 0.9, Wikimedia 0.6, upload 0.4, URL import 0.3 |

## Penalties — only on a mismatch the asset itself states

| Penalty | Points | When |
|---|---|---|
| wrong event | −35 | the asset's own `eventName` shares no word with the request's |
| wrong location | −30 | the asset names a different COUNTRY |
| wrong date | −25 | the asset's stated date is outside the window |
| poor visual match | −15 | a talking head where the scene wants pictures, or the wrong media |
| recently reused | −10 | the same provider asset attached to a scene in the last 30 days |

An absence is never a penalty. An undated asset earns no date points and
loses none.

**Rights are not a penalty.** A restricted asset is not "a bit less
relevant"; it is removed before anything is scored (`engine.ts`), and a
review class is returned flagged, not marked down.

## B-roll first

`visualUsefulness(asset, wantedType, wantedMedia)` is the spec's B-roll
prioritisation (§22). Under narration (`broll`, the default) a B-roll or
stockshots clip scores 1.0, an unclassified clip 0.65, and a speech, press
conference or interview 0.15 — which trips the −15 "poor visual" penalty
with the reason *a talking head where the scene wants pictures*. A reel
over ten minutes is halved (a scene is eight seconds; the producer would
have to find the shot in it); under three seconds is cut to 0.4. When the
scene quotes a statement (`speech` / `interview`), the ladder inverts: the
speaker scores 1.0 and pictures 0.35.

`orderByScore()` sorts best first and breaks ties on the same ladder:
pictures, then unclassified video, then a still, then a talking head — a
real photograph of the event beats a press conference about it, because
the still can carry the scene and the speaker cannot.

## Reasons

Every `RankedFootage` carries `reasons: string[]` — *names the event*,
*dated inside the scene's window*, *names a different country*, *already
used in a film recently*… — which the picker shows under each card and the
suggestion run passes to the ranking model.

## Where the ranking model fits

The engine's score is computed before the n8n `Archive Suggestions` run
calls its ranking model; the model sees `score`, `provenance` and the
rights class on every candidate and is told not to rank one above a higher
engine score without a concrete reason from the text. The stored
`relevance` on a suggestion is the model's, the `score` the engine's.

## Tested

`check-footage.mjs`, section *ranking*: the weights sum to 100; B-roll beats
a 24-minute press conference for narration and the presser is told why;
the presser wins when the scene quotes a statement; wrong country and wrong
date are penalised; reuse is penalised; an absent date is not a wrong date;
ties break pictures > still > speech; an image is a fallback, not a match,
when video was wanted.
