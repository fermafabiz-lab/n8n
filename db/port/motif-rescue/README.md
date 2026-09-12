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
