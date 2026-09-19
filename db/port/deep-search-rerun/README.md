# Re-run Deep Search — the button that checks the FINISHED script

**Live 2026-09-19.** Claude Scripting `6d7e0079`, webhook `deep-search-rerun`,
thirteen `DS *` nodes on their own canvas row. The site half is
`platform/components/DeepSearchRerun.tsx` and `rerunDeepSearch` in
`platform/app/actions.ts`.

> **IT CORRECTS WHAT IT FINDS, since `decf5edb` the same evening.** It shipped
> as report-only, by a design decision written up at length below; the producer
> read it and overruled it in one sentence — *"cand da recheck ar trebui sa si
> schimbe ce e gresit/unsupported"*. A check that hands back a list and leaves
> the fixing to the producer is not what the button was wanted for. The
> reasoning that argued for report-only was not wrong about the HAZARD — it was
> wrong about who gets to price it — and what it correctly identified is now
> enforced mechanically instead of by abstention: see "What stops it editing".

## Versions

| Version | What it is |
|---|---|
| `2497c18b` | The chain as first built: reads the finished script, reports, never edits |
| `decf5edb` | **+ the rewrite**: `DS Fix?`, `DS Rewrite`, `DS Apply`, `DS Write` |
| `356aef90` | `DS Write` casts the rebuilt Editing Options back to `jsonb` |
| `6d7e0079` | `DS Save` reads the report off `DS Apply` rather than `$json` |

The last two are both one-line repairs of the same class of mistake, and both
were caught by running it rather than by reading it — see "Two ways it broke".

## Why it exists, which is not "a re-check is nice"

The first pass **physically cannot see two things**, and both were found on
2026-09-19 (`db/port/fact-check/README.md` §7 and §8):

1. **The hook.** `Generate Hook` runs AFTER the whole Deep Search chain —
   `FC Done → Combine Chapters → Generate Hook` — so the hook does not exist
   when `FC Prep` builds the narration. The two sentences a viewer is most
   likely to watch have never been fact-checked on any film.
2. **The rewrite's output.** `FC Apply` validates the rewrite's STRUCTURE
   (chapter count, emptiness, length, untouched chapters) and never re-reads
   its prose, so a correction can introduce a new unsourced claim, half-fix a
   contradiction, or create a fresh internal inconsistency.

Both are one shape: **what the producer reads is not what was checked.** The
re-run reads `hov.script.content`, which is the finished text with the hook in
it and the corrections already applied, so one press closes both.

## The chain

```
DS Webhook (POST deep-search-rerun, onReceived)
  → DS Load    (Postgres: project + newest hov.script + hov.evidence + scene count)
  → DS Prep    (build fc.narration and fc.packList; parse chapters; decide run/skip)
  → DS Run? ──true──→ DS Judge → DS Gap? ──true──→ DS Source ─┐
       │                              └──false───────────────→ DS Resolve
       └──false─────────────────────────────────────────────→ ┘
                                                                   │
  DS Resolve → DS Fix? ──true──→ DS Rewrite ─┐
                    └──false────────────────→ DS Apply → DS Write → DS Save
```

**It reuses four subnodes rather than adding its own**: `Editor Model` feeds
`DS Judge` and `DS Rewrite`, `Research Model` (the one with
`builtInTools.webSearch`) feeds `DS Source`, and `FC Judge Parser` /
`FC Rewrite Parser` parse them. A subnode fans out to as many agents as you
like, so the whole chain costs thirteen nodes and no new models.

**`DS Prep` emits under `fc`, deliberately.** That is what lets `DS Judge` and
`DS Source` take the committed prompts from `db/port/fact-check/paste/` BYTE
FOR BYTE — those prompts read `$json.fc.packList` and `$json.fc.narration`.

> **TWO LIVE NODES, ONE PROMPT FILE.** `FC Judge` and `DS Judge` must carry
> identical text, and so must `FC Source` and `DS Source`. When the judge
> prompt changes, **re-paste both**. This is the `KIDS_STYLES` rule again and
> it is in CLAUDE.md's cross-cutting list for the same reason.

## What stops it editing

The hazard the report-only design was built around is real, and it is this:
**the producer is looking at the script when they press the button.** Changing
text under someone who is reading it is the silent edit the whole panel exists
to prevent. Abstaining is one way to honour that. It is not the only one, and
it was the wrong one — a producer who has to hand-copy fourteen corrections
out of a report will not do it, and the unsupported sentence ships. So the
rewrite is on, and four separate things stand between it and a damaged script:

1. **`supported` is never touched.** `DS Resolve` marks only `unsupported` and
   `contradicted` findings `rewrite`. Rewriting correct prose is how a
   fact-checker starts damaging scripts.
2. **The overwhelmed backstop** (0.6 of sentences, floor 8). Most of a film
   failing is a check aimed at the wrong thing, not a film that is mostly
   wrong, and rewriting at that volume replaces the producer's script rather
   than correcting it. Measured in SENTENCES — `db/port/fact-check/README.md` §5.
3. **`DS Apply`'s refusals.** Wrong chapter count, a missing or renumbered
   chapter, an emptied chapter, a chapter that moved more than a fifth in
   length, a chapter that changed with nothing flagged in it — and one that is
   new here: **the hook is cut one shot per line, so a correction that merges
   two of its lines is refused outright.** Any refusal keeps the whole existing
   script; a script with an unsourced sentence in it is a far smaller problem
   than a script quietly turned into something else.
4. **The script gate.** `DS Load` counts the film's scenes and `DS Prep` turns
   any non-zero count into report-only (`frozen: true`). Past approval the
   scenes carry their own copy of every line AND their own recordings, so
   editing the script under them is the "a line and its recording drift apart
   silently" fault wearing a new hat. The findings still reach the producer in
   full; only the edit is withheld, and the panel says so in as many words.

**And the page reloads onto the correction.** `DeepSearchRerun` polls for the
new report and, when `rewritten > 0`, does a FULL reload rather than a soft
refresh — because `ScriptReview` seeds its textarea from `content` once, on
mount, and restores any sessionStorage draft over it. A soft refresh would
leave the old wording in the box under a report announcing the correction,
which is this project's oldest fault in a new costume. The button arms first
when an unsaved draft exists, for the same reason Pause does.

## The hook lives twice, so `DS Write` writes twice

`hov.script.content` carries `[CHAPTER 0: HOOK]` as text and
`project.editing_options -> hookPlan -> beats` carries the same lines again —
and **the beats are the copy the render speaks.** Fixing one and not the other
would show a corrected hook on the panel while the film still said the old
line. `DS Write` does both in ONE statement, so it is both or neither.

It is guarded so that a clean re-run writes nothing at all: the script update
carries `is distinct from`, and the hook update additionally requires
`hookChanged`, because `new_editing` is the whole Editing Options object
re-serialised and key order alone would make it "distinct" every single time.
That guarantee rests on `DS Apply` reassembling the script to **identical
bytes** when no sentence changed, which is asserted by the check harness and
was measured on a real film (below).

## What it still does the same as before

**The live source lookup runs even on a re-check.** Skipping it would be
simpler and wrong: statements the pack does not cover but which the first pass
sourced live would come back `unsupported` on a re-run of identical text, the
producer would see MORE red after pressing the button, and it would read as
broken.

**`DS Rewrite` is `FC Rewrite.txt` plus exactly one line** — the rule that
chapter 0 is the hook and its lines are spoken shot by shot. The harness
asserts the two files differ by that line and nothing else, so the two rewrites
cannot drift apart the way two copies of a prompt otherwise do here.

## Where the report goes

Into `hov.fact_check`, replacing the row. That is the point, not a compromise:
the re-run describes the text on screen and the first pass describes a draft
that no longer exists. Two fields say which kind it is — `rerun: true` and
`scope: "final"` — and the panel prints **"Re-checked at HH:MM"** plus a line
saying the hook was included.

**The timestamp is load-bearing.** The webhook answers `onReceived` because
the run takes 30 s to 2 min and every other webhook here has a 15-second
budget, so pressing the button does NOT change the numbers on screen — the new
report lands a minute later. Without a visible time the producer cannot tell
the old report from the new one and the button reads as dead.

## Verified

| Claim | Evidence |
|---|---|
| The chain runs end to end from the webhook | execution **15097**, fired at 11:45:38 for `recxsFvSEv3g6blYn`, `DS Save` returned `{project_id, checked_at: 11:46:12}` — **34 seconds** |
| **It reads the hook, which nothing else ever has** | `DS Prep`'s `fc.narration` in that run begins `[CHAPTER 0: HOOK]\nLars Rasmussen faced a deadline in 2003.` |
| **It catches the invented hook line** | `DS Source` returned `RESULT: 1 \| STATUS: not-found \| SAYS: …no adequate source specifically stating that Lars Rasmussen "faced a deadline in 2003."` and the stored finding reads `unsupported`. This is the exact line the producer's reader rejected |
| …without flagging the hook's good half | same run: *"The Sydney team had four members."* → `supported`, confirmed live against the Australian Museum |
| The report is marked and complete | `{rerun: true, scope: "final", checked: 21, sentences: 13, flagged: 3, searched: 8, rewritten: 0}` — against the first pass's 9 sentences, the extra four are the hook |
| Purely additive to the workflow | `diff-workflow.mjs` against `a9ecfbb4`: **added 9, removed 0, changed 0**, no dangling references, and every branch index read back (`DS Run?` `[0]→DS Judge [1]→DS Resolve`, `DS Gap?` `[0]→DS Source [1]→DS Resolve`) |
| The Code nodes behave | `node scripts/check-fact-check.mjs` — **179 assertions**, the `DS *` sections included |

**The blast radius was nil by construction** while it was report-only, which
is why it was publishable on a day the producer was making films: the only way
in is its own webhook, `changed 0` meant no existing node was touched, and the
only thing it wrote was `hov.fact_check`. **That is no longer true** — it now
writes `hov.script.content` and `project.editing_options` as well, which is
what "What stops it editing" above is for.

### The rewrite half, on the producer's own film

All on `recxsFvSEv3g6blYn` (parked at its script gate, 0 scenes), pressed four
times in a row so each pass read what the one before it wrote:

| Pass | Execution | checked | flagged | searched | rewritten | `DS Write` |
|---|---|---|---|---|---|---|
| 1 | 15202 | 22 | 3 | 7 | **3** | `script_rows 1, hook_rows 1` |
| 2 | 15206 | 24 | 2 | 5 | **2** | `script_rows 1, hook_rows 0` |
| 3 | 15209 | 22 | 1 | 3 | **1** | `script_rows 1, hook_rows 0` |
| 4 | 15212 | 22 | **0** | 3 | 0 | **`script_rows 0, hook_rows 0`** |

**It corrected exactly the three things the producer's reader had rejected**,
and it did so on the first press:

- *"Lars Rasmussen faced a deadline in 2003."* — the invented hook line, §7 —
  became *"In 2003, Google Labs launched 'Search by Location.'"*, which the
  pack backs. **Both copies moved**: `hov.script.content` and
  `hookPlan.beats[0]` read identically afterwards.
- *"Separate-page behavior slowed EVERY search for streets, addresses and
  routes"* — the over-universal scope claim.
- *"If it stayed there, users kept the slower system the early web had
  normalized"* — the counterfactual.

**It converges rather than churning**, which was the open question: 3 → 2 → 1
→ **0** flagged, each pass finding only what the previous pass's own rewrite
introduced. That is §8 closed in the concrete — nothing before this re-read
what the rewrite produced, and the fourth press is the first time any film
here has come back with nothing standing against its own sources, hook
included.

**And the fourth pass wrote NOTHING**, which is the guarantee the whole design
rests on: `DS Apply` reassembled the script from chapters it had parsed back
out of that same script, byte for byte, so both guarded updates matched zero
rows. `Editor Model` ran once in that execution rather than twice, which is
`DS Fix?` correctly branching past `DS Rewrite`. A clean re-check costs one
judge call, one lookup and no writes.

### Two ways it broke, both worth keeping

Neither was visible by reading the diff; both took a real run.

1. **`editing_options` is `jsonb`, and the decode yields `text`.** Postgres
   refused the whole statement — and because the script update is a CTE in the
   same statement, **the refusal took the corrected script down with it**
   (15199). One `::jsonb` fixed it. The lesson is about the shape, not the
   cast: *one statement means one failure*, which is the guarantee you want for
   "both or neither" and the cost you pay for it.
2. **Inserting `DS Write` between `DS Apply` and `DS Save` replaced the
   payload.** `DS Write` emits `{script_rows, hook_rows}`, so `DS Save`'s
   `$json.fcReport64` became `undefined` and it died with *"invalid base64 end
   sequence"* — an error naming nothing that would lead you to the cause
   (15202). **The correction was written and the report describing it was
   not**, which is the worst half to lose. A Postgres node in the middle of a
   chain replaces `$json` exactly as an agent does; this codebase already knew
   that about agents and had not generalised it. `DS Save` now reads
   `$('DS Apply')` by name, and the harness asserts it never reads `$json`.

## What is owed

- **One press from the browser.** Everything above was fired by an HTTP node
  inside n8n. The action, the button, the polling reload and the panel copy are
  verified by types and checks, not by a click. **The auto-reload in particular
  has never been seen work** — it is the one piece whose failure mode is
  invisible from here.
- **The corrected sentences READ as prose.** Every number above is a count. The
  three corrections on pass 1 are good BY THE SOURCES; whether they read as
  well as the sentences they replaced is a judgement only the producer can
  make, and it is the same debt the first pass has carried since 09-18.
- **It converges, but nothing MAKES it converge.** Each press can find what the
  last press's rewrite introduced, which is the feature — but there is no
  ceiling, and a film that oscillated between two wordings would do so forever,
  one press at a time. Nobody has seen that happen; if it does, the fix is a
  pass counter in the report, not a smarter rewrite.
- **The hook's own retry loop is untouched.** `Hook Guard` / `If Hook Retry`
  re-draw a hook that fails its structural checks; neither knows anything about
  facts. The `Generate Hook` rule 3b constraint (§7) is what stands between an
  invented hook and the film, and this button is what catches it afterwards.
