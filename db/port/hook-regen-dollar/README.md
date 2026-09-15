# The hook rewrite died on `$321` — and the render panel lied about it

2026-09-12. Two unrelated defects reported in one sentence by the producer:
*"nu trece de primul pas, nu arata nici cat dureaza render-ul, am dat sa
refaca hook-ul si se incarca la infinit inainte sa dau render"*.

## 1. `hook-regen` could not commit (n8n, live)

Execution **12490** (project `recUHwTIqrNB6vXBl`, the Burj Al Arab film)
failed at `HR Commit`:

    Variable $321 out of range. Parameters array length: 0
    Failed query: update hov.chapter set chapter_script = $hr$321 metres, ...

`HR Commit` runs `options.queryBatching: transaction`. In that mode — and
only that mode — n8n passes the query to pg-promise with an empty values
array, so any `$` followed by a digit is read as a positional parameter.
Dollar-quoting *creates* the hazard: the closing `$` of `$hr$` in front of
a beat beginning "321 metres" is literally `$321`.

Measured, execution **12511**, four queries against the live database:

| query text | default batching | `transaction` |
|---|---|---|
| `$hov$321 metres, standing$hov$` | ok | **refused** |
| `$hov$It cost $1B to build$hov$` | ok | **refused** |
| `$hov$It cost $5 million total$hov$` | ok | ok (not retested under tx) |
| `convert_from(decode('…','base64'),'UTF8')` | ok | **ok** |

So the 44 other Postgres nodes (all default batching) are unaffected.

**Fix** — `hr_apply.js` here is the live body of `HR Apply`: every literal is
now `convert_from(decode('<base64>','base64'),'UTF8')`. Base64's alphabet has
no `$`, so no data can form a placeholder. The transaction stays, and on the
day it failed it is what saved the film — the delete of the chapter-0 scenes
rolled back and the stored hook was untouched.

**Second fix** — `HR Commit` is now `continueErrorOutput` into a new
`HR Release Flag` (postgres, `executeOnce`, default batching, onError
continueRegularOutput) that clears `editing_options.hookRegen`. The site sets
that flag before firing and only the run can clear it, so a dead run left the
producer watching a spinner with nothing behind it.

Workflow `Hook Regen` (`MDYR0J93RJDU8ftf`), active version
`fde136f7-b7f5-4bae-bfdb-e51271a277db` (was `af17bba6`).

**Verified live**, execution **12517** on the disposable cutover film
`recaW2aLFFD06FpoN`: 15s, three silent `action` shots written as orders 1-3
with empty narration and `Aprobare Voce` already true, `hookPlan` stored with
`chosenBy: producer`, `hookRegen` cleared, `HR Release Flag` correctly not
reached. The stranded flag on the producer's own film was cleared by hand.

## 2. The assembly panel drew a step list with no clock

The same project sat at status `Asamblare` with a production pass alive and no
render running — `getAssemblyState()`'s deliberate third answer, "no verdict".
`AssemblyStatus` had no branch for it, so it rendered the healthy layout with
`startedAt: null`: chip "Running" with no timer, step one highlighted forever,
and `slow` unreachable, which is the only condition that offers Restart.

`AssemblyState` gained `upstream`; the panel now says what is actually
happening and hides the estimate when it has no clock to derive it from.
`HookPanel` also follows a rewrite in flight onto whatever step is open, so
its two exits are reachable from the render screen.

Both lessons are written up in CLAUDE.md.
