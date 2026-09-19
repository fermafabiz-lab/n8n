# Re-run Deep Search — the button that checks the FINISHED script

**Live 2026-09-19.** Claude Scripting `2497c18b`, webhook `deep-search-rerun`,
nine `DS *` nodes on their own canvas row. The site half is
`platform/components/DeepSearchRerun.tsx` and `rerunDeepSearch` in
`platform/app/actions.ts`.

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
  → DS Load    (Postgres: project + newest hov.script + hov.evidence)
  → DS Prep    (build fc.narration and fc.packList; decide run/skip)
  → DS Run? ──true──→ DS Judge → DS Gap? ──true──→ DS Source ─┐
       │                              └──false───────────────→ DS Resolve → DS Save
       └──false─────────────────────────────────────────────→ ┘
```

**It reuses three subnodes rather than adding its own**: `Editor Model` feeds
`DS Judge`, `Research Model` (the one with `builtInTools.webSearch`) feeds
`DS Source`, and `FC Judge Parser` parses the judge. A subnode fans out to as
many agents as you like, so the re-run costs nine nodes, not thirteen.

**`DS Prep` emits under `fc`, deliberately.** That is what lets `DS Judge` and
`DS Source` take the committed prompts from `db/port/fact-check/paste/` BYTE
FOR BYTE — those prompts read `$json.fc.packList` and `$json.fc.narration`.

> **TWO LIVE NODES, ONE PROMPT FILE.** `FC Judge` and `DS Judge` must carry
> identical text, and so must `FC Source` and `DS Source`. When the judge
> prompt changes, **re-paste both**. This is the `KIDS_STYLES` rule again and
> it is in CLAUDE.md's cross-cutting list for the same reason.

## What it does NOT do

**It never rewrites.** The producer is looking at the script when they press
the button and may have hand-edited it in the box; changing text under someone
who is reading it is the silent edit the whole panel exists to prevent. So
`DS Resolve` is `FC Resolve` with the rewrite half removed — no fix list, no
`needsRewrite`, and no overwhelmed backstop, because that backstop exists to
stop a runaway REWRITE and with nothing to rewrite it would only suppress
information the producer asked for.

`rewritten` is therefore always `0`, and it is present rather than omitted on
purpose: the panel prints *"the script below already contains the
corrections"* off that number, and a re-run must never make that claim. Every
finding's `action` is `kept` or `flagged`; `rewritten` cannot occur.

**It does the live source lookup anyway.** Skipping it would be simpler and
wrong: statements the pack does not cover but which the first pass sourced
live would come back `unsupported` on a re-run of identical text, the producer
would see MORE red after pressing the button, and it would read as broken.

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
| The two Code nodes behave | `node scripts/check-fact-check.mjs` — the `DS Prep` / `DS Resolve` / `DS Save` / `DS Load` sections, including that the narration keeps `[CHAPTER 0: HOOK]` and that no finding can read as `rewritten` |

**The blast radius is nil by construction**, which is why this was publishable
on a day the producer was making films: the only way into the chain is its own
webhook, `changed 0` means no existing node was touched, and the only thing it
writes is `hov.fact_check`. A broken `DS *` node cannot reach a film.

## What is owed

- **One press from the browser.** Everything above was fired by an HTTP node
  inside n8n. The action, the button and the panel copy are verified by types
  and checks, not by a click.
- **The rewrite gap is only half closed.** The re-run REPORTS what the rewrite
  broke; it does not offer to fix it. If that turns out to matter, the honest
  next step is a "correct these too" button that runs `FC Rewrite` over the
  re-run's fix list — deliberately a separate press, because a rewrite is an
  edit and the first one already happened without being asked for.
- **The hook's own retry loop is untouched.** `Hook Guard` / `If Hook Retry`
  re-draw a hook that fails its structural checks; neither knows anything about
  facts. The `Generate Hook` rule 3b constraint (§7) is what stands between an
  invented hook and the film, and this button is what catches it afterwards.
