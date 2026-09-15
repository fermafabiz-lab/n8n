# Why every film had the same year card, and why the hook read too fast (2026-09-12)

The producer, on a finished film:

> hook-ul este facut prost. Vocea este data prea rapid si nu se intelege nimic.
> Ecranele cu animatii […] au ramas fix la fel. Este doar un cacat de an cu un
> text animat, TU ai facut animatii cu linii cu locatie cu ora, si acum pe
> absolut fiecare videoclip este aceeasi animatie de cacat. […] vreau animatii
> cum ai facut inainte, cu linii si elemente animate bazate pe script
> individualizat

Two separate defects. Both were measured before anything was changed.

## 1. The hook read too fast

`Build Timeline` gave a SPOKEN teaser beat `gapSeconds: 0.12` — the breath
after its last word before the cut. An ordinary scene gets `0.35`. And the
breath trim (`tightenTake` in assemble.mjs) has already cut the take's own
lead-in and tail silence off, so 0.12 is all the air there is.

A teaser is three to five beats, each a whole statement. At 0.12 they arrive
butted together with **less space between them than the same narrator leaves
between two clauses of one sentence**. That is what "data prea rapid" was: not
a playback rate, a missing breath.

The 0.12 was chosen so the PICTURE cuts hard on the last word, which is right
for a trailer. The mistake was giving the picture and the voice one number.
Now `0.45` — deliberately more than an ordinary scene's 0.35, because a teaser
line has to land on its own, which is the whole reason it is a separate shot.
Silent shots are untouched: they are held for `holdSeconds` and have no voice.

Cost: about 1.3s added to a four-beat hook.

## 2. The same year card on every film

Measured across the **18 most recent films**: exactly ONE carried a motif card
(`compare`, on "how nasa was created"). Seventeen had `motifCards: []`.

With no motif cards, `Attach Motif Cards` leaves `body.textCards` unset, and
the render falls through to DERIVING figure cards from the narration — a year,
set large, in the middle of the frame. That derivation is identical on every
film, which is precisely the "aceeasi animatie de cacat".

Three causes, each found in a real execution rather than by reading code.

### (a) The validator refused truthful cards over bookkeeping

**Peking to Paris, 1907** (scripting execution 9952) is the canonical route
film. The model proposed a four-stop route — Peking → steppe → river → Paris —
and the validator dropped it whole with:

    stops[0] cites undefined, which is not in the research pack

The model had filed its research ref as `{"kind":"evidence","from":"E3"}`. The
validator reads `src.ref`. The prose in the prompt does say `ref` — but the
**structured example the model is shown contains no `evidence` source at all**,
only `quote` sources, whose text lives in `from`. A model copies the example it
can see; prose that contradicts the example loses. Same lesson as 2026-09-03,
when a route's only source arrived under `rows[0].value`.

Fixed on both sides: the validator reads `src.ref ?? src.from`, and the
example now carries an evidence stop.

### (b) A route could never satisfy the no-spoiler rule

With (a) fixed, the same card then died on:

    stops[1] quotes scene 8, which the film has not reached at scene 7

The rule — no card may print a word the film has not spoken yet — is right for
every other motif. For a route it is unsatisfiable by construction: a route is
a **map of the whole journey**, so anchored anywhere before its destination it
cites forward, and anchored after it, it is a summary of a trip the viewer has
just watched. Naming the destination on a map is not a spoiler; this film's own
title is "Peking to Paris".

Lifted for `route` only. **Provenance is not relaxed**: every stop must still
be verbatim in a real scene of this film. Only the ordering is.

### (c) The "drawn cards" switch silenced half of what it names

Six of the eighteen films had `Editing Options.drawnCards: false`. That gates
the motif chain in Scripting (`Draw Cards?`) and `Attach Motif Cards` in the
render path — but **not** the render's own derivation, which nothing gated.
So a producer who switched the animations off still got the year card.

`Build Remotion Props` now sends `showTextCards: opts.drawnCards !== false`.
Off means no cards of any kind. This is the one fix here that reaches **films
already made**, with no re-scripting: switch it off in Final touches and
re-render.

Worth knowing: the **Burj Al Arab** film (execution 11663) had the switch off
at scripting time and reads `true` in the database today — it was turned on
later, in Final touches. That cannot work. Scripting stored no cards, so there
is nothing for the later switch to un-hide. CLAUDE.md's claim that "switching
back on restores the list exactly" is true only if the brief left it ON.

## What was NOT changed, and why

- **The timeline's strictly-increasing-years rule.** The Peking film's timeline
  was also refused, with three marks all at `1907`. That refusal is correct: a
  timeline places marks at their real distance apart, and three identical years
  would stack on top of each other. The right motif for that film was the
  route, and the route is what (a) and (b) unblock. Allowing sub-year dates
  would mean teaching `TimelineCard.yearOf` to read them too, or "10 August
  1907" would be positioned at year 10.
- **The Aston Martin failures** (execution 8970: a row label with no source, a
  label with digits) looked like more of the same, and reading the model's
  actual payload showed they are not: that run predates the 2026-09-03
  per-item provenance fix and used the old path-keyed `sources` map. Fixing
  rules on that evidence would have been fixing the past.

## Verify

    node motif/check-motif.mjs ../../db/port/motif-rescue/peking-props.json \
                               ../../db/port/motif-rescue/candidate-peking-route.json

is the real refused card, reduced to a fixture. It now passes as `review`
(its E3 source is real but the phrasing is not a substring question) and draws
`Peking → steppe → river → Paris`. The repo's own three fixtures are unchanged.

## Applied

| Workflow | before | after |
|---|---|---|
| Claude Scripting `gkEtGMecv4TC3ZHp` | `8b8d7b74` | `05bf7412` |
| 4. Final Assembly `BY22Vlhh20Xdkr5Z` | `ebf193c5` | `559cde3c` |

Scripting: `Validate Motif Cards` (regenerated from `remotion/motif/validate.mjs`
via `db/port/motif-cards/add-motif-nodes.mjs`), `Motif Parser` (the example),
`Choose Motif Cards` (the route-quotes-forward clause). Final Assembly:
`Build Timeline`, `Build Remotion Props` — both bodies in this directory.

Each draft was diffed node-by-node against its active version before publish:
exactly the intended nodes differed, node counts unchanged, connections
identical, Drive nodes keeping `resource`/`operation`.

## Still owed

- **Store `motifReport` beside `motifCards`.** Today only the accepted cards
  are persisted; the reasons a card was refused live in the execution log and
  prune after 14 days. That is why this investigation needed three execution
  digs. One extra key in `Save Motif Cards` turns "why did this film get no
  cards" into one SQL query.
- **The next film is the test.** These fixes reach films written from now on
  (a and b) — the ones already made keep their empty `motifCards`. Watch the
  first new documentary's `motifReport` for what still gets refused.

---

# The cards never reached the validator (2026-09-13)

The producer, on the LEGO chase film: *"nu a facut nicio animatie cu remotion,
de ce?"* — and they are right. Measured on the delivered cut: **18 of 20
sampled frames carry subtitles, and there is no title card, no end screen and
no drawn card anywhere.** Remotion ran for eight minutes (execution 12908, 93
polls, `progress: 1`) to add captions and nothing else.

Six reasons, five of them boring and one of them a real bug.

| | Why nothing was drawn |
|---|---|
| End screen | `endScreen: false` in the project's own Editing Options |
| Chapter cards | `chapterCards: false`, same place |
| Opening title | retired 2026-09-11; every film opens on the teaser |
| Montage movement | no `montageIntensity` key → the deliberate default of 0 |
| Figure cards | derived only from a percentage, a year 1000-2029, a scaled quantity or a number of 3+ digits. A LEGO chase has none — "unit 27" is two digits, below the bar on purpose |
| **Motif cards** | **the model wrote two good ones and the parser threw them away** |

## The bug: one unusable card kills every card

`Choose Motif Cards` did its job. Scripting execution 12869 shows it proposing
a `route` (Downtown Brick City → Riverside Overpass → dock gate) and a `steps`
card (five turning beats of the chase), every stop and step quoted verbatim
from a real scene. Exactly the animation the producer keeps asking for.

`Motif Parser` then threw:

    Model output doesn't fit required format
    outputParserFailReason: Model output does not match the expected schema

`Choose Motif Cards` emitted `{error: "Model output doesn't fit required
format"}`, and `Validate Motif Cards` — handed no cards — returned
`{motifCards: [], motifReport: []}`.

**That empty report is the fingerprint.** A refused card produces a report
entry saying why. An EMPTY report means the cards never reached the validator
at all. The 2026-09-12 investigation above read `motifCards: []` and went
looking for validator refusals; this is the other way for that array to be
empty, and it is invisible from the database.

**Why, corrected.** The first reading of this was that the parser's example
only showed three variants. It shows all five — the 2026-09-09 change added
`compare` and `steps` to both the example and the writer's prompt, and the
live prompt describes them in full. The example was never the problem.

`jsonSchemaExample` **infers an array's item shape from the FIRST element
only.** The example's `cards[0]` is a `timeline` card, so the schema handed to
the model allowed exactly `{sceneIndex, variant, priority, why, label, marks,
note, noteSource}` — and `stops`, `rows`, `sides` and `steps` were not in it
at all, *even though the example's own later cards use them*. Every card is
one of five shapes, and `fromJson` cannot express a union.

So the 09-09 change appended the two new variants to the end of an example
where the schema generator never looks. It has been dead since the day it
shipped, and it took the other three variants down with it: any answer
carrying a route, compare or steps card was refused **whole**, which is how a
perfectly good route card died beside the steps card here.

## The fix, applied 2026-09-13 — Claude Scripting `39c35589`

`Motif Parser` no longer infers a schema from an example. It carries an
explicit, permissive JSON Schema (`schemaType: manual`): the four fields every
card has are required, every variant's own list is allowed, and
`additionalProperties` is open everywhere so a sixth motif never breaks
parsing again. `$ref` is deliberately not used — the node's own hint says
refs are unsupported, so the source object is inlined at each site.

**The parser stops doing validation work that `Validate Motif Cards` already
does properly**, card by card, with a reason for each refusal. That is the
real lesson: a strict schema at the parser turns one unusable card into zero
cards, while the validator turns it into one refusal and a report.

Verified before publishing, in this order:

1. The exact payload the parser rejected (`motif-fiction/original/rejected-payload.json`,
   lifted from scripting execution 12869) validates against the new schema.
2. Both its cards pass the REAL validator with the film's real 23 scenes —
   `route @5 ok`, `steps @22 ok`. The LEGO film should have had two drawn
   cards.
3. A live agent on the new schema returned a `route` card with `stops` and,
   on a second run, a `steps` card with four steps — both parsed, no error.
   `stops` and `steps` are precisely the keys the old inferred schema lacked.
4. `diff-workflow.mjs` against the pre-change version: only `Motif Parser` and
   `Save Motif Cards` differ, connections identical, no dangling references.

`Save Motif Cards` now writes `motifReport` beside `motifCards`, so "why did
this film get nothing" is answerable from the database instead of by reading
an execution — which is what both of these investigations had to do.

### Staged in the generator, NOT live

`db/port/motif-cards/add-motif-nodes.mjs` also gained a glue change for
`Validate Motif Cards`: it now tells a parser failure apart from an empty
answer (`{error: …}` arrives instead of cards and every read yields `[]`, so
the two are indistinguishable) and records a `parser-error` entry in the
report. **That node was not updated live.** Editing it through MCP means
sending its whole 18 KB body in the call, 14.6 KB of which is `validate.mjs`
inlined verbatim, and hand-transcribing a generated validator that gates every
card on every film is a worse risk than the diagnostic is worth. It applies
the next time that node is regenerated and re-applied from a machine that can
reach `wf7`. The schema fix above removes the failure it reports.

