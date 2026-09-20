# The accounts reach the site

Three Google Flow accounts have been linked, replicated to, measured and
documented since 2026-09-17. Until today **nothing on the website could turn
them on**: `flowAccounts` and `videoPool` existed only inside Media Generation,
and the only way to set either was to type it into a project's
`Editing Options` JSON by hand.

```
$ grep -rn "flowAccounts\|videoPool" platform/
$                     # nothing, before this change
```

So the work was finished and unreachable, which is the same as unfinished. The
brief now has a **Clip generation** control, next to Video quality, and it
writes both keys.

## One control, two keys, and why they are not one key

They stay separate in the data because they are separate mechanisms:

| key | what it alone does |
|---|---|
| `flowAccounts` | cuts the film's scenes into one consecutive block per account. By itself this buys NO speed — the serial loop still makes one clip at a time. What it buys is the end of useapi's per-account `429 "Try spacing your requests out"`. |
| `videoPool` | the in-flight pool: one Veo job kept running on each account at once. This is the half that makes a film finish sooner. |

Only together do they mean what the producer asked for, so one switch writes
both and the UI never mentions either name. A future session that wants to
spread the IMAGES over three accounts without pooling the clips still can —
the keys are independent where it matters, in the pipeline.

## Refuse, do not clamp — and refuse DOWNWARDS

`normalizeFlowAccounts` sends anything outside 1..3 to **1**, not to 3.

That is the opposite of what a clamp would do, and it is deliberate. The number
decides how scenes are cut into blocks; a block addressed to an account that is
not linked produces clips minted somewhere unexpected, and the failure is
silent (`db/port/parallel-accounts/README.md`, "The real blocker"). 1 is what
every film had before the accounts existed, so the refusal is always to the
known-good state.

The same rule is written twice, and the two must agree:

| where | what it guards |
|---|---|
| `platform/lib/data/derive.ts` — `normalizeFlowAccounts` / `FLOW_ACCOUNTS_MAX` | the form and the server action |
| the orchestrator's `Normalize Webhook Input` | the webhook, which the site is not the only caller of |

`FLOW_ACCOUNTS_MAX` must also agree with the `ACCOUNTS` list in Media
Generation's `Assign Accounts`, including its ORDER — block 0 is the first
account in that list. Fixtures: `npm run check:normalize`.

`videoPool` is strict (`'yes'` or `true`), the same rule as `endFrame`: a flag
that changes how a film is produced must not be switched on by a stray truthy
value.

## The ceiling that lowers itself

`flowAccounts` is a CEILING, never a promise. `Assign Accounts` reduces it on
its own when the film's cast sheets and set plates have not been replicated
onto every account, because a clip built from a reference its own account does
not own comes back `Email mismatch`. A film whose sheets are from an earlier
pass therefore asks for 3 and quietly runs on 1 — and says so in the log. The
form's help text says this out loud rather than letting it look like a bug.

## Default OFF, and what would change that

The control starts on **One at a time**.

The pool has been measured on ONE disposable film — 9 of 9 clips, right
accounts, 10m05 against 13m12 serial (`db/port/parallel-accounts/etapa3.md`).
That is a real number and it is not a track record. It also changes the SHAPE
of a bad day: with three accounts running together the slowest account is the
film, where the serial loop spreads one bad clip's cost out and keeps going.

Flip the default once a real film has been produced through it end to end.

## Applied

| what | where |
|---|---|
| `normalizeFlowAccounts`, `FLOW_ACCOUNTS_MAX` | `platform/lib/data/derive.ts` |
| eleven fixtures | `platform/scripts/check-normalize.mjs` |
| `flow_accounts` + `video_pool` in the webhook payload | `platform/app/actions.ts` |
| the Clip generation control | `platform/app/new/NewVideoForm.tsx` |
| `flowAccounts` + `videoPool` into Editing Options | orchestrator `8CienBFfG6SgbB1A`, version **`4f022248`** (rollback **`fec6369c`**), body from `paste/orch-Normalize_Webhook_Input.js` |

**Verified end to end**, because this node is on the critical path for every
new film and a corrupted body would break project creation for everyone.
A project fired through the live `new-project` webhook with
`flow_accounts: 3, video_pool: "yes"` came back with

```
flowAccounts 3 · videoPool true · createdBy Dan · watermarkScale 1
· category story · speed 1 · 18 keys
```

— the two new keys correct, and every neighbouring key, including the
`watermarkScale` another session added the day before, still present and
unchanged.

**Before editing that node, re-read its live body.** The copy committed under
`db/port/series/` was four days stale: `Normalize Webhook Input` had been
changed on 2026-09-19 by the watermark work, and publishing the older copy with
a new key appended would have silently reverted `watermarkScale` and
`watermarkOpenOnce`. `get_workflow_history` is what caught it — it names the
file each version was built from.
