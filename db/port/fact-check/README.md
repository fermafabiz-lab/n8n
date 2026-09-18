# Deep Search — does the script say anything our sources do not?

Built 2026-09-18, live the same day. **Named "Deep Search" by the producer**
that afternoon; the n8n nodes keep their `FC *` prefix and the table is still
`hov.fact_check`, because renaming thirteen live nodes would mean rewriting
every `$('FC …')` reference between them and renaming a live table buys
nothing. Read `FC` as Deep Search everywhere below. The producer's ask: *"a system to check
whether the information from the scripting part is accurate and rewrite it if
not, so it has no factual errors"* — after ChatGPT read a Google Maps script
this pipeline had written and listed four things in it that were not true.

Three decisions were theirs, taken before any of this was written:

| Question | Their answer |
|---|---|
| Report first, or fix straight away? | **Flag and rewrite immediately** |
| Look things up for claims the pack does not cover? | **Yes — one targeted search, then decide** |
| May it hold up the script approval? | **Warn loudly, never block** |
| Which films get it? | **Documentary mode only** (added the same day) |

The third is the load-bearing one. Nothing in this chain has a button, a gate
or a veto. It corrects what it can, says what it could not, and the producer
approves the script exactly as before.

## Why this is tractable at all

Because the retrieval half already existed. `Research Tema` → `Extract Claims`
gathers a numbered pack of sourced claims (E1…E20) with a real URL each, and
the narration is WRITTEN FROM that pack. So the question is not the open-ended
and hallucination-prone *"is this true?"* but the closed-book one: **does any
claim in this numbered list say this?** A model can answer that from the text
in front of it without knowing anything about the world — which is exactly
what the judge is told to do, in as many words.

The second step is the only one that leaves the pack, and it is deliberately
narrow: one search per unsupported statement, for a primary source, producing
a URL that code checks looks like a URL.

## The chain

Inserted between `If Narration Retry`[1] and `Combine Chapters` in **Claude
Scripting** (`gkEtGMecv4TC3ZHp`) — after the narration exists and passes the
length guard, and **before segmentation**, which is the whole point: at that
moment no scene and no voice take exists, so a rewrite costs nothing and
invalidates nothing. Ten minutes later it would desynchronise every take from
its line (see CLAUDE.md, "A line and its recording drift apart silently").

```
If Narration Retry[1] → FC Prep → FC Run?
   ├─[false] ──────────────────────────────→ FC Apply   (writes WHY it skipped)
   └─[true]  → FC Judge → FC Gap?
                  ├─[true]  → FC Source ─┐
                  └─[false] ─────────────┴→ FC Resolve → FC Fix?
                                                ├─[true]  → FC Rewrite ─┐
                                                └─[false] ──────────────┴→ FC Apply
                                                     FC Apply → FC Save Report
                                                              → FC Done
                                                              → Combine Chapters
```

| Node | What it does |
|---|---|
| `FC Prep` | **Documentary mode only**, then researched, with a pack, with chapters. Renders the pack and the narration for the judge; emits `Narration Guard`'s exact shape plus `fc`. |
| `FC Run?` | What `FC Prep` decided. Otherwise straight to `Combine Chapters`. |
| `FC Judge` | `mode` (factual or story) first; then every checkable statement with a verdict against the numbered claims ONLY. `Editor Model`, gpt-5.4. |
| `FC Gap?` | Any `unsupported` findings? |
| `FC Source` | One targeted primary-source lookup per gap, one `RESULT:` line each. `Research Model`, gpt-5.4 with web search. |
| `FC Resolve` | Folds found sources back onto the findings, settles each verdict, decides what the rewrite may touch. |
| `FC Fix?` | Anything left to fix? |
| `FC Rewrite` | Attribute → soften → correct → cut, on the listed sentences only. `Editor Model` + `FC Rewrite Parser`. |
| `FC Apply` | **The safety valve.** Accepts or refuses the rewrite; always emits a usable narration. |
| `FC Save Report` | Upserts `hov.fact_check`, in-line on the spine, base64 in and decoded in Postgres. |
| `FC Done` | Puts the narration back on `$json` after the Postgres node replaced it. |

Models are REUSED, not duplicated — `Editor Model` feeds the judge and the
rewrite, `Research Model` the search, the same way `Story Bible Model` was
already shared. `FC Judge`, `FC Source`, `FC Rewrite` and `FC Save Report` all
carry `onError: continueRegularOutput`: none of them may take a script down.

## The two that got through, and cost the producer a film

Both landed in the same publish at 15:18 and were found four hours later, by
the producer, on their own documentary — which reached its script gate with a
red light, no explanation, and a script whose hook said the acquisition was in
April while its first chapter said October.

### The category was read from a node that does not carry it

`Receive Project Data` is the sub-workflow TRIGGER, and it declares typed
inputs — `Project_ID`, `Tema`, `Tonalitate`, `Pace`, `Lenght`, `Language`,
`Style`, `Lore`. n8n emits ONLY those eight. There is no `fields` on it and
there never was, so `fields['Editing Options']` was `undefined` on every film,
`modeRead` was false, and every documentary skipped as `no-mode`.

`Fetch Project Record` is the node that carries the row, and `Voice Mode` has
read the category off it since the kids styles landed. **When a workflow
already answers a question somewhere, copy THAT node's reference.**

Three things disguised it, and they are the transferable part:

- **The execution data showed the object.** `get_execution` on the trigger
  returns its stack entry, which is the INPUT the parent sent — not the output
  the node emits.
- **A sibling reference worked.** `FC Save Report` reads `Project_ID` off the
  same node and always has, because that field IS declared. One field
  resolving is not evidence the object is there.
- **The failure was caught.** The read sat inside a `try` whose `catch`
  recorded "mode could not be read" — honest, and completely invisible,
  because of the second bug.

### A skip wrote nothing, so silence meant two different things

`FC Run?`[false] went straight to `Combine Chapters`, bypassing the report
writer. So `skipCode` — the entire field the red light reads — never reached
the database on the path that sets it, and an absent row meant both "this was
a Story film" and "the chain is dead". Those are precisely the two states the
producer asked to be able to tell apart.

The false branch now goes through `FC Apply`, which finds its payload from
`FC Resolve` or falls back to `FC Prep`. **Every film gets a row. From here
on, no row means the chain genuinely did not run.**

### And the reason neither was caught before shipping

The only end-to-end run that ever verified Deep Search — execution 14771 at
15:00 — ran on `ea076103`, the version BEFORE the Documentary gate was
published at 15:18. The gate's first real film was the producer's. **A change
published after the run that verified it is unverified**, and "I verified this
feature" is not the same claim as "I verified this version of it".

## The three things that were wrong, and how each was found

None of these were found by reading the code. All three came out of running it.

### 1. The search step was silently inert

`FC Resolve`'s `RESULT:` parser anchored each line with `$` and had no `\s*`
before the pipes. A perfectly well-formed line —

```
RESULT: 1 | STATUS: confirmed | SOURCE: Jumeirah | URL: https://… | DATE: 2026 | SAYS: …
```

— matched **nothing**, because after `URL:` the greedy `\S*` stopped at the
space and the very next thing the pattern demanded was `\|`. So every lookup
would have been paid for and thrown away, and the only symptom would have been
a fact-checker that never found a source for anything.

Found by `scripts/check-fact-check.mjs`, before the node had ever run. The
fixture in that file is now the REAL response out of execution 14761, curly
quotes and all.

### 2. The outer gate is the producer's, not the model's

The first cut deliberately did NOT gate on the project's category, on the
evidence that `story` is the site's default and of eleven researched films only
three said `documentary`. The producer overruled it the same afternoon —
**Deep Search is a feature of Documentary mode** — and that settles it: a film
made in any other mode does not get checked, whatever its narration says.

The consequence is worth writing down because it is not obvious from the
screen: the Burj Al Arab, Peking to Paris and Tupac films are documentaries in
substance and `story` in the database, so they would get nothing. Asking for
Deep Search now means **choosing Documentary when the film is created**.

`FC Prep` reads the category off `Receive Project Data`'s `Editing Options` —
the project record, not the webhook payload, so it survives the form, resume
and restart alike, and it is the same reference `FC Save Report` already
depends on for the project id, so it adds no new way for the chain to break.

### 3. A story is not a film with errors in it

Run the judge on `recqbPJ7aZu0a21mt`, "The Roman slave who conquered Egypt",
and it flags **55 of its 56 statements**. Every verdict is correct — nothing in
a fifteen-claim pack about Ptolemaic Egypt backs what Lazarus did on a Tuesday
— and the whole result is worthless. Worse: `FC Fix?` would have handed the
rewrite every sentence of the film.

`FC Prep` cannot catch this. Its gate is "researched, with a pack", and that
film is both: it is fiction that was researched for its background. **Nor can
the project's category** — `story` is the site's DEFAULT, so the Burj Al Arab,
Peking to Paris and Tupac films all carry it too, and they are documentaries.
Of eleven researched films in the database, only three say `documentary`.

The only signal that separates them is the narration itself. So the judge is
asked FIRST what it is reading and answers in `mode`; a `story` returns an
empty list and the chain becomes a pass-through. The same film now answers
`{"mode":"story","findings":[]}` in 2.2 s, where it spent 46 s producing 56
useless findings.

### 4. …and a backstop, for when it gets that wrong

`FC Resolve` also refuses to rewrite when more than 60% of at least 8 checkable
statements are unsupported. A documentary written from its own pack holds up in
most of its sentences; four bad ones in twenty is a real problem, most of the
film failing is a check aimed at the wrong thing. Past that line the chain
reports and stops offering to fix — the producer sees every finding, and
nothing is changed. Rewriting most of a film is the one outcome this chain must
never produce, because at that volume the rewrite is no longer correcting the
producer's script, it is replacing it.

## What is verified, and how

| Claim | Evidence |
|---|---|
| The judge answers `story` for fiction | execution **14758**, `recqbPJ7aZu0a21mt` → `{"mode":"story","findings":[]}` in 2.2 s |
| …and `factual` for a documentary filed under the `story` category | execution **14759**, `recUHwTIqrNB6vXBl` (Burj Al Arab) → `mode: factual`, 41 statements, 28 supported, 13 flagged |
| …and catches real errors | same run: *"In 1993, Tom Wright fixes the form"* → "sources name Tom Wright and **1994**"; "documented use of 24-carat gold leaf" → no claim mentions gold leaf; "cooling pipes"; "reached by its causeway"; "asymmetrical structure" |
| …without flagging what the pack does back | same run: 321 m, 280 m offshore, 230 piles, 9,000 t of steel, 70,000 m³ of concrete, the 180 m atrium, 1 December 1999, and both suite counts (202 per Khaleej Times, 198 per Jumeirah) all read `supported` with a ref |
| `FC Source` returns parseable lines with real URLs | execution **14761**: 12 statements, 12 `RESULT:` lines, 8 with a resolvable primary source (Jumeirah's own page for the gold leaf and the causeway, Designing Buildings for Al Muntaha and the fabric façade) |
| The whole chain runs end to end and the rewrite is ACCEPTED | execution **14764**, the same film, 1m46s: 47 statements checked, 16 looked up, **8 corrected, 0 still flagged**, `refused: null`, 6 chapters in and 6 out, per-chapter words `31,385,412,348,339,357` → `33,371,414,343,340,356` |
| **The fixed gate runs on a real film** | execution at 19:32 for `recAVSS5qpc9V5DjV` ("How the Rosetta Stone was deciphered"): `{category: "documentary", checked: 15, searched: 9, flagged: 1, rewritten: 1}`. The `category` in the row is the proof — it is the field that was `undefined` all afternoon |
| **The LIVE nodes run inside a real scripting execution** | execution **14771**, a real pipeline fired at the `new-project` webhook for the disposable film `rec4ZIQVVxXZcS5no` ("How the first cash machine was installed in Enfield in 1967"): `hov.fact_check` written at 15:03:01 with `{checked: 18, flagged: 1, searched: 5, rewritten: 1}` and 18 stored findings, and the run went on to write its script and park at the approval gate — so `FC Done` handed the narration back intact |
| `FC Resolve`, `FC Apply`, `FC Done` behave | `node scripts/check-fact-check.mjs` — 60 assertions over the committed bodies, including every refusal branch |

`scripts/check-fact-check.mjs` runs the real `db/port/fact-check/paste/*.js`
bodies with a fake `$`/`$json`, so it fails the moment a body and its intent
drift apart. It does NOT prove the live node matches the file — that is
`db/port/lib/diff-workflow.mjs`.

The verification workflows were throwaways and are archived:
`PhZtGYUo5mLqd11E` (the data probes) and `eMjJ0X7RvH6PUbuT` (the chain).

## Version ids

| Version | What |
|---|---|
| `b927a298` | the skip path writes its report too — **published 19:32, and what is live** |
| (same publish) | the category read moved to `Fetch Project Record` |
| `99ad980b` | Documentary-mode gate, skip codes, the Deep Search rename — published 15:18, **broken for four hours** |
| `b9f95221` | the active version this was built on |
| `e3091e15` / `600ce4a5` / `60efa205` | the three edits that added the 13 nodes |
| `38d05de7` | read the narration by node name, not `$json` (an agent replaces the payload) — **published 14:31** |
| `20fb4e8c` | the `RESULT:` parser fix and the overwhelmed backstop |
| `ea076103` | `storyMode` / `overwhelmed` in the report — published 14:47 |

Rolling back means publishing `b9f95221`: the chain is additive, and `FC Prep`
is the only node on the old happy path's edge.

## What is owed

- **A film the producer keeps.** The live chain has now run inside a real
  scripting execution (14771, above) and the row it wrote is good: 17 of 18
  statements held up, ten against the pack by ref and the rest against sources
  a targeted search found — Historic England's listing notice for the Enfield
  branch among them, with a URL — and the one that did not (*"The problem was
  not simply to copy a teller by machine"*, an interpretation no claim covers)
  was rewritten away. What is still owed is the same run on a film somebody
  intends to keep, where the corrected sentences are READ as prose rather than
  counted.
- **Watch what the rewrite does to the prose.** Execution 14764 changed eight
  sentences and every length check passed, but nobody has read the result as
  prose. "9,000 tonnes of white steel climb skyward" losing its *white* is
  correct and also a small loss of image; that trade is the producer's call to
  see, and the panel shows the old sentence beside the new script for exactly
  that reason.
- **Watch the promotions.** In execution 14761 the search "confirmed" that Tom
  Wright had fixed the design by 1993 from a library catalogue's `1993/1999`
  creation-date range — thin, and it promoted a sentence the pack put in 1994.
  The report shows the source and the URL, so it is visible rather than
  hidden, but if this happens often the prompt's source ladder needs a rung
  about date ranges.
- The `FC Source` numbering is mapped by the model's own `RESULT: n`, not by
  position, so a skipped line is harmless. A MIS-numbered line is not, and
  nothing detects it.
