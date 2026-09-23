# The top-up — sourced running time back after Deep Search

Live since 2026-09-23, Claude Scripting `a2d2328d` (rollback `8186ec33`). The
producer's request, in their words:

> *"daca scoate prea multe cuvinte din text dupa deepsearch, sa mai adauge
> informatie in script ca sa fie ca timp aproximativ la cerinta selectata a
> clientului, dar daca nu mai exista informatii utile nu as vrea sa adauge
> filler asa cum facea inainte si sa stea sa descrie scena."*

Deep Search's corrections are allowed to shorten a film since the same morning
(`db/port/fact-check/README.md` §10: the length band is one-sided). This gives
the running time back with **new, sourced facts**, and gives nothing back when
there are none. Three decisions were the producer's, asked before any of it was
built:

| Question | Answer |
|---|---|
| Restore to what length? | **What the narration weighed before Deep Search touched it** — not the ordered length. The draft already cleared `Narration Guard` at the length ordered; filling to an abstract target would lengthen films that were short for reasons of their own |
| From where? | **The film's own research pack first, then a live web search** when the pack has nothing new left |
| Where? | **Both** — the first pass (`FC *`, inside scripting) and the ⟳ Re-check button (`DS *`) |

## Where it sits

```
FC Apply → FC Top Up? ─[0 true]→ FC Fill → FC Fill Check → FC Fill Apply → FC Save Report → FC Done
                      └[1 false]──────────────────────────────────────────↗

DS Apply → DS Top Up? ─[0 true]→ DS Fill → DS Fill Check → DS Fill Apply → DS Write → DS Save
                      └[1 false]──────────────────────────────────────────↗
```

| Node | Model | What it does |
|---|---|---|
| `FC Apply` / `DS Apply` | — | The valve, unchanged in what it accepts. Now also measures the gap and builds `fill` (below). `FC Apply` records `preCheckWords` in the report |
| `FC Top Up?` / `DS Top Up?` | — | `fill.run` — true only for a gap of **25 words or more** (`FILL_MIN_GAP`), on a documentary the judge read as factual, and for the re-check only while `mayRewrite` (no scenes yet) |
| `FC Fill` / `DS Fill` | `Research Model` (gpt-5.4, web search) | Proposes sentences as text lines, `ADD: … \| REF: E7 or LIVE \| SOURCE \| URL \| SENTENCE`, then `DONE: enough\|exhausted`. One prompt file, both nodes: `paste/FC Fill.txt` |
| `FC Fill Check` / `DS Fill Check` | `Editor Model` (gpt-5.4, no tools) | Rules `keep / repeat / minor / overreach` on each numbered proposal. One prompt file, both nodes: `paste/FC Fill Check.txt`; it finds its script by `$('DS Apply').isExecuted` |
| `FC Fill Apply` / `DS Fill Apply` | — | The guard. The block between the `SHARED GUARD` markers is byte-identical in the two, and the harness asserts it |

All four agents are `onError: continueRegularOutput`. **A failed proposer is an
empty top-up and a failed editor is "not checked" — both add nothing, and the
film keeps its corrected script.** No failure in this step can cost a film.

`FC Done` reads `FC Fill Apply` when it ran and `FC Apply` otherwise, and strips
`fill` before `Combine Chapters`. `DS Save` reads the report off
`$("DS Fill Apply")` when `.isExecuted`, else `DS Apply`.

## The target, and why it has to be recorded

`preCheckWords` is the BODY (hook excluded) the narration weighed when it
reached Deep Search. The first pass knows it for free — it is what `Narration
Guard` handed over — and writes it into the report. **The re-check cannot
recompute it**: it rewrites `hov.script` in place, so after one press the
original length is gone from everywhere but that report. So `DS Load` reads it
off the report it is about to replace, `DS Prep` and `DS Apply` carry it, and
`DS Apply` writes it forward. A report written before 2026-09-23 has none; the
re-check then measures against what THIS press started with, which can never
lengthen a film past a length it actually had.

The name is deliberate: `fc.originalWords` already existed and counts the
rendered text, chapter markers included — a different quantity, read by nothing.

## What keeps filler out

The producer's condition is the whole design. Each proposed sentence stands or
falls alone, in this order, and the report counts every drop by reason:

1. **`Narration Guard`'s own detectors, byte for byte** — `TEXTURE`, `CAMERA`,
   `SCENERY`, `COMMENTARY`, `DEFINITION`, `META`. The harness pins each regex
   to `db/port/story-close/paste/cs-Narration_Guard.js`, so "what filler is"
   has one owner. Over a whole narration they are ratios; over one added
   sentence any hit drops it.
2. **A source**: a pack claim that exists, or `LIVE` with an http URL and a
   named source. One claim may not be stretched into two sentences.
3. **A handle**: a number, a year or a name. A sentence about the light on the
   water has none. For a pack claim, the handle must be one the claim also
   carries — a sentence that cites E7 and shares nothing with E7 is not E7's.
4. **Not the script again**: 60% of its content words in one existing sentence.
5. **Not rejected before** — see "the ping-pong" below.
6. **The editor says `keep`.** Only `keep`; no verdict at all is `not checked`.
7. **Placement**: after the sentence it names, never after the film's closing
   line, never in front of a sentence opening on a pronoun it would steal
   (`It`, `This`, `They`…), never out of date order (a definite contradiction
   only: a bare year spans its whole year).
8. **The budget is a ceiling**, cut from the LAST proposal — which the prompt
   tells the model, so the facts it wrote first survive.

## Why there is an editor

Five probes on the producer's Google Maps film, read as prose, showed where
code stops. The rules above reliably stop what the producer banned —
description of the picture, commentary, anything unsourced. But of the
sentences they would have KEPT, one was a real milestone and two were the
script again:

- *"In 2004, Google said, two Aussies and two Danes in Sydney created the
  technology…"* — the four founders the script had already named, re-described;
- *"An Australian National University research repository document states that
  Google acquired Where 2 Technologies in October 2004 and launched Google Maps
  in February 2005"* — two dates the viewer had heard, behind an attribution.
  Word overlap reads it as 41% new.

Only a reader can tell. **The editor then had to be calibrated in the other
direction.** Fed all eight real proposals at once (`probe/Pinned Fill
(probe).js`), its first prompt ruled every new fact `minor` — Keyhole's
satellite imagery included, twice (16452, 16453). With "a detail the story does
not turn on" as `minor` and a blanket "unsure → not keep", a model reading the
story as the five sentences it now has finds that the story turns on none of
them, and the top-up can never add anything. Doubt now resolves by KIND: about
novelty → `repeat`; about relevance → `minor`; and **a step of the subject's own
story is `keep` even when the script could be told without it**, because the
script is short precisely because steps were taken out. Three runs after the
change (16454-16456), 8 of 8 each time:

| # | Proposal | Verdict |
|---|---|---|
| 1 | "not until mid-2005 … announced the API" | repeat (the date is in the script) |
| 2 | "API launched a few months after the website" | repeat (two dates in the script imply it) |
| 3 | Toolbar beta turned addresses into map links | minor (another product) |
| 4 | Google Maps API Blog created, November 2005 | minor (administrative) |
| 5 | **Keyhole satellite and aerial imagery added, April 3, 2005** | **keep** |
| 6 | "two Aussies and two Danes" | repeat (same people) |
| 7 | ANU document states the two known dates | repeat (attributed restatement) |
| 8 | **The API let people post draggable, zoomable maps with satellite imagery** | **keep** |

## What the first live press found

Execution **16463**, a real `deep-search-rerun` on `recSFjNpnuA0ylZAi` right
after `a2d2328d` went live, with `preCheckWords: 178` written into its report
first (the number the old valve logged that morning — *"chapter 1 went from 178
to 128 words"* — because the report predated the field). Mechanically, every
piece worked: the judge corrected two sentences, the gap was 59, one sentence
was proposed, kept and placed after the sentence it named, `DS Save` saved the
top-up's report through `.isExecuted`, `preCheckWords` was carried forward, and
the added words lifted the film back over its floor (119 + 15 = 134 ≥ 133, so
`short` cleared).

**Read as prose, two things were wrong, and both are fixed:**

1. **The proposer never searched.** One leftover pack claim, then
   `DONE: exhausted` in **5.3 seconds** — on the film whose probes had found
   Keyhole's satellite imagery on the web the same morning. The very first
   probe had done exactly the same thing; "search is expected, not a last
   resort" had not been enough. Believed, it would have told the producer that
   nothing more exists. Now: the prompt makes the search mandatory unless the
   pack's leftovers fill the whole budget, and the proposer must name the
   searches it ran (`SEARCHED: …`). **The guard believes `exhausted` only with
   a search named** (`looked`), and the panel says "the web was not searched
   for more this time, so ⟳ Re-check may find some" when none was.
2. **The editor kept an aim.** *"When Google Maps first launched in 2005, the
   team was focused on 'mapping the world'"* — sourced (E11), and a statement
   of what someone meant rather than what happened. `minor` now names aims,
   focuses, visions and mottos. Re-calibrated on nine proposals (the eight plus
   this one), three runs, **9 of 9 each** (16466-16468): the aim is `minor`
   ("a vision statement, not an action or milestone") and the other eight
   verdicts did not move.

**A third thing is not the top-up's, and is reported rather than fixed here.**
The same press's REWRITE (`DS Rewrite`, the pre-existing correction step) was
asked to fix *"The prototype proved the idea."* and replaced it together with
the sentence after it — *"In October 2004, Google acquired Where 2 Technologies
to create Google Maps."*, which the judge had ruled `supported` — with *"The
prototype became part of Google Maps."*, a near-copy of the sentence two lines
later. `DS Apply` accepted it: its refusals check chapter counts, emptiness,
growth, halving and untouched chapters, and **none of them checks that a
`supported` sentence survives**. The acquisition is still in the hook, so the
film does not lose the fact, but its body does. The obvious guard — refuse a
rewrite that drops a sentence the judge found fully supported — changes what
the valve accepts on every documentary, so it was put to the producer rather
than slipped in.

## The ping-pong

Without memory the re-check button would oscillate: one press adds a sourced
sentence, the next press's judge rules it redundant and cuts it, the gap
reopens, and the press after adds it back. So `DS Apply` compares what the last
top-up added (`report.filled.added`, read by `DS Load`) against this press's
non-`supported` findings; any match joins `report.rejected`, carried forward
forever, shown to the proposer as "never propose these again" and refused by
the guard at 60% overlap.

## What the report and the panel say

`report.filled = {sentences, words, live, exhausted, shortBy, proposed,
dropped, added: [{chapter, sentence, ref, source, url}]}`. `short` (the floor
note from §10) may be lifted by the top-up and is never invented by it.

The panel (`platform/lib/deep-search.ts`, `DeepSearchPanel.tsx`):

- a report whose only change is an addition is `corrected` with the chip
  **"N added"**, never "All checked";
- the added sentences are listed one by one with where each came from — "from
  this film's research, E7" or "found by a web search" — and a link;
- the all-clear says the additions came AFTER the check, because the judge has
  not read them; the next re-check does;
- **"still about N words shorter than before Deep Search"** from the MEASURED
  gap (`shortBy`), with "there was nothing more to add that its sources back"
  only when the model said `DONE: exhausted`. The probes had a model say
  `enough` with two thirds of the gap still open, so the claim is never taken
  for the measurement.

The ⟳ Re-check button now reloads on ANY change to the text
(`scriptChangesIn` = rewritten + deduped + added). It used to read `rewritten`
alone, so a press that only cut a repeat left the old wording in the box under
"Nothing needed changing" — a bug older than this feature.

## What is verified, and how

| Claim | Evidence |
|---|---|
| The guard does what it says | `node scripts/check-fact-check.mjs` — every rule, every drop reason, the shared block identical in both nodes, the six regexes equal to `Narration Guard`'s, the prompt pins, and the renumbering case (a malformed line cannot shift the verdicts after it) |
| The editor tells a new step from a repeat and a side detail | the eight real proposals, 16454-16456, table above |
| The live draft is the committed files | all twelve node bodies byte-compared against `paste/` before publish; `diff-workflow.mjs` — only the expected nodes differ, no dangling `$('…')`; every one of the 16 edge changes read back by hand with its output index |
| The site half | `npm run check:deepsearch` (the chip, the notes, the reload sum, the panel wiring), `tsc` clean |

## Version ids

| Version | What |
|---|---|
| `a2d2328d` | the top-up with its editor — **published 2026-09-23, live** |
| `94643a37` … `cecd24de` | the four drafts that built the first iteration (no editor); never published |
| `8186ec33` | the version this was built on (another session's motif-card change) — **the rollback** |

The chain is additive: publishing `8186ec33` removes it entirely and nothing
else moves.

## The probe

`zz probe top-up` (`R913CsV2sXEavLwd`) ran the real prompts against the real
film without writing anywhere: `probe/DS Apply (probe).js` stands in for the
live valve, `probe/Pinned Fill (probe).js` feeds the editor the eight real
proposals. Archive it when nothing more is owed.

## What is owed

- **The first pass has not run on a new film.** The re-check path is the one
  exercised live; `FC Fill` → `FC Fill Apply` → `FC Done` has only run in the
  harness. The next documentary written after `a2d2328d` is the proof — read its
  `hov.fact_check.report.filled`, and read the added sentences as prose.
- **`minor` vs `keep` was calibrated on one film.** Eight proposals about one
  subject. Watch the first few reports' `dropped` counts: a film where
  everything is `judged minor` is the old failure back.
