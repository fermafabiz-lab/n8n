# A model call that never returns parks a whole scripting run

Applied 2026-09-18. Claude Scripting `b9f95221`, rollback `31e37b3c`.

## What happened

A new film (`recspdd42bgzX71vB`, execution 14664) wrote its Story Bible — 8,544
characters — and then wrote nothing for an hour. No outline, no narration, no
chapters, no scenes. The execution stayed `running`, not `waiting`, so it was
inside a node rather than parked in a Wait.

Nothing is written to Postgres between `Save Story Bible` and `Save scenes To
Airtable1`, so the database cannot say WHICH node it sat in — only that it was
one of `Generate Outline`, `Write Full Narration` or `Edit Full Narration`.

The two retry loops in that stretch were the first suspects and are innocent:
`Narration Guard` and `Hook Guard` both cap at `MAX_RETRIES` and say in their own
comments that nothing there may end a scripting run.

## It is not rare, and it is not new

The fifteen full-film (`integrated`) scripting runs in n8n's history:

| | minutes |
|---|---|
| median | **6.0** |
| eleven runs | 3.0 – 8.5 |
| `13925` | 51.3 |
| `13927` | 69.9 |
| `12869` | 79.8 |

and `12303` ran **9 h 52 m** before crashing. So roughly one run in five goes
far past the median, and one has gone most of a working day.

Eight older projects sit in the database with a Story Bible and zero scenes —
`recNkpWamcuPBn2i5`, `recoBe204SRHyqBHG`, `recwlgAmgbUulvrY5` and others, all
from July and August. Same shape. They were never diagnosed.

## The fix, and a correction

The first reading was "there is no timeout anywhere". **That was wrong**: the
`lmChatOpenAi` node type declares `options.timeout` with a default of 60,000 ms
and `options.maxRetries` with a default of 2. What is true is that all eight
model nodes left `options` EMPTY, and whatever the effective default turns out to
be, it did not stop a call that ran for an hour.

So the timeout is now explicit rather than inherited:

| node | timeout | why |
|---|---|---|
| `Story Bible Model` | 600,000 (10 min) | carries `builtInTools.webSearch` |
| `Research Model` | 600,000 (10 min) | carries `builtInTools.webSearch` |
| `Outline / Narration / Segment / Hook / Motif / Editor Model` | 300,000 (5 min) | plain completion |

`maxRetries: 2` is set explicitly on all eight, matching the declared default so
it stops depending on one.

**The ceiling is the timeout TIMES THREE, not the timeout — and for four of
the agents, TIMES NINE.** `maxRetries: 2` on the model means a call that times
out is tried twice more, so 3 × 5 min = **15 minutes** per node run. On top of
that, the AGENT nodes `Generate Story Bible`, `Generate Outline`, `Segment
Chapter Into Scenes` and `Generate Hook` carry n8n's own node-level
`retryOnFail: true, maxTries: 3` (verified in the live version `c0b8e3d8` on
2026-09-20, where all eight model timeouts are also confirmed present), so an
agent that hangs every time fails only after 3 × 15 = **45 minutes** — 90 for
the Story Bible agent, whose model has the 10-minute timeout. `Write Full
Narration` and `Edit Full Narration` have no node-level retry and keep the
15-minute ceiling.

| node that hangs | ceiling |
|---|---|
| `Generate Story Bible` | 90 min |
| `Generate Outline`, `Segment Chapter Into Scenes`, `Generate Hook` | 45 min |
| `Write Full Narration`, `Edit Full Narration` | 15 min |

The table above reads as if 5 minutes were the ceiling; it is the ceiling per
ATTEMPT. This was not stated when it shipped, and it matters for reading a
stalled run: a scripting execution silent for twenty minutes after its Story
Bible is not yet evidence the guard failed — but it IS evidence the hang is not
in the two narration agents. (Found on 2026-09-20 watching exactly such a run:
bible written, then silence past the 15-minute mark, still `running`.)

**Should the node-level retry be there at all?** Retrying a hung agent three
times is what turns a 15-minute failure into a 45-minute one, and the retry
was put on for transient API errors, not for hangs. Leave the question open
until a run has actually been seen to fail on the ceiling; removing it blind
would be the same mistake as adding the timeout blind.

**Per CALL, deliberately, not per run.** A workflow-level `executionTimeout` was
the obvious alternative and is worse: a legitimately long run is many normal
calls, so any ceiling that catches a hang also kills the 51- and 69-minute runs
that DID produce films. A per-call ceiling only catches the call that stopped
returning.

What changes for the producer: a hung scripting run now FAILS instead of sitting
invisible, and `⟳ Restart writing` is the door back in — which is exactly what
that button was built for.

Diff before publishing: 110 → 110 nodes, added 0, removed 0, changed 8, and in
every one the only difference is `options`; every other parameter byte-identical,
connections identical, no dangling node references.

## Still owed

This is a guard, not a diagnosis. **Nobody knows yet WHY a call hangs** — whether
it is OpenAI, the Responses API, the structured-output parser retrying, or
something about `gpt-5.4` with high reasoning effort. The next time a run fails on
this timeout, the error will name the node, and that is the first real evidence
anyone will have had.
