# Parallel generation across three Google Flow accounts

Status: **Etapa 1 and 2 are APPLIED and LIVE and still a NO-OP at
`flowAccounts: 1`. The table bug the first real run exposed is FIXED
(`4bb6847c`), but the fix has not itself been run on a film yet — see "The first
real run" and "The fix" at the bottom.**

| Applied | version | built on |
|---|---|---|
| Etapa 1 — per-scene account assignment | `4ecc8330` (2026-09-17 ~15:55) | `6735a96a` |
| Regen paths derive their account from the start frame | `62ebd784` (~16:45) | `549d982d` |
| Etapa 2 — replicate reference sheets per account | `ad877d02` (~17:05) | `62ebd784` |
| Etapa 2 consumer — scenes use their own account's copies | `649aca23` (~17:10) | `ad877d02` |
| Image regen from the gate uses the scene's account | `008ad2bc` (~17:15) | `649aca23` |

**Every submitter is now account-correct.** The three that looked hardcoded and
are NOT a gap: `Generate Cast Sheet`, `Generate Set Plate` and
`Upload Asset To Flow` create the PRIMARY copies, the ones replication copies
out, so staying on the primary account is the design rather than an oversight.
The only real gap was `Regenerate Scene Image`, which built its request from the
project's primary-account reference ids; it now takes the block account from
`Assign Accounts` and runs the same `flowRefs` swap, drop and renumber as
`Generate Scene Image`.

Rollback is `restore_workflow_version` to the "built on" id.

**A second author works on this workflow.** Between the two entries above, Dan's
session published eight versions (16:28-16:36) including a whole new standalone
`Video Regen Webhook` chain — `VRW Load Scene`, `VRW Build Regen`,
`VRW Can Regen?`, `VRW Refuse?`, `VRW Video Done?`, `VRW Filtered Done?`,
`VRW Refuse`, `VRW End`. Etapa 1 survived intact (checked node by node), because
MCP operations apply to the current draft rather than replacing it. Always
re-fetch the baseline before editing; the snapshot in this folder goes stale
within the hour.

All three accounts read `PAYGATE_TIER_TWO` / `G1_TIER2` with 89 video models and
all 11 `_low_priority` (cost 0) keys — see "P5 follow-up".

## The regen-path fix (version `62ebd784`)

Dan's new `Video Regen Webhook` made this urgent. `Submit Video Regen` hardcoded
`email: 'fermafabiz@gmail.com'` while taking `startImage: $json.imageId` — so
once a film is split across accounts, regenerating a scene whose image lives on
account B would send account A's email with account B's reference and die on
`Email mismatch`.

It cannot be fixed the way Etapa 1 fixed the batch path, because **the webhook
path never runs `Assign Accounts`**, so a `$('Assign Accounts')` lookup would
throw there. Instead both regen submitters now decode the account out of the
media id they are already referencing — it is hex-encoded between `-email:` and
`-image:`:

- `Submit Video Regen` reads it from `r.startImage`
- `RG Generate End Frame` reads it from `r.reference_1` (the scene's start frame)

Verified against real ids before shipping: `6665726d…` → `fermafabiz@gmail.com`,
`686f7573…` → `houseofvideos01@gmail.com`, and an empty / malformed / odd-length
id leaves the email untouched rather than throwing. The diff was `changed 2`,
only the expected nodes, connections identical, and the long motion prompt inside
`Submit Video Regen` is character-identical on both sides — the only textual
difference is the inserted derivation.

**Still hardcoded, and therefore still to do in Etapa 2:** `Regenerate Scene
Image` (its body comes from `Evaluate Image Approval`) and the per-film sheet
generators (`Generate Cast Sheet`, `Generate Set Plate`, `Upload Asset To Flow`).
Those all carry `reference_N` ids from `Editing Options`, so they need the
translation table rather than a decode.

## Etapa 2 — what was applied

A ten-node chain between the sheet generators and `Find Audio Folder`:

```
Set Plate? (no plates) ─┐
Plate Ingest? (skipped) ─┼→ Load Sheet Media → Replicate Prep → Replicate Any?
Ingest Plates ──────────┘                                        ├ skip → Find Audio Folder
                                                                 └ work → Loop Replicate
    Loop Replicate ─ each → Download Sheet → Upload Sheet To Account → Collect Replicated ─┐
                   └ done → Build Flow Refs → Refs To Save? → Save Flow Refs → Find Audio Folder
```

- **The bytes come from `hov.sheet_media`, not Flow's `fifeUrl`.** That was the
  design's worst constraint and it turned out not to exist: the sheet ingest
  chain (`Sheet Ingest Prep` → `Ingest Sheets`, and the plate pair) already
  keeps a durable copy of every sheet keyed by its Flow id. So replication works
  on any pass, including one that draws no sheets at all. The site route that
  accepts that shape lives on the trunk, not on this branch.
- **`Editing Options.flowRefs[account][primaryId] = thatAccountId`** is the
  translation table, merged in with jsonb `||` under DEFAULT query batching —
  transaction batching would read every `$` followed by a digit as a positional
  parameter.
- **`Generate Scene Image` swaps each `reference_N`** for the block account's
  copy, drops any reference minted on a different account that has no copy, and
  **renumbers what survives** so there are no gaps in the sequence. Tested
  offline first: the primary block passes all three references through, and a
  block-B scene keeps its remapped cast and place while losing only the
  cross-account palette reference.
- **`Assign Accounts`' guard became a coverage check.** Instead of refusing to
  split any project that has account-scoped references, it now uses as many
  accounts as `flowRefs` fully covers and logs which one fell short.
- **`Replicate Prep` skips images already copied**, so a second pass does not
  mint duplicate assets.

The trap that shaped the wiring: **a node returning zero items stops everything
downstream of it**, and the whole rest of the batch hangs off this chain. So
`Replicate Prep` and `Build Flow Refs` always emit exactly one item, and IF
nodes route past the loop — the same shape as the existing `Plate Ingest?`.
Before publishing, every node in the new chain was checked for reachability to
`Find Audio Folder` by walking the graph, not by eye.

## Etapa 1 — what was applied

One node added and three changed, all in Media Generation:

- **`Assign Accounts`** (new, between `Sort & Cap Scenes` and
  `Refetch Scenes For Audio`) cuts the sorted scene list into contiguous blocks,
  one per account, and tags each scene with `flowEmail` / `flowBlock`.
- **`Generate Scene Image`**, **`Generate End Frame`**, **`Submit Video`** now
  look the scene up in `$('Assign Accounts')` and override `email` with its
  block's account.

The override deliberately lives in those three HTTP nodes (24-633 chars) rather
than in the Code nodes that build the requests (`Build Image Request` 12,370
chars, `End Frame Prompt` 13,122), because `CLAUDE.md` is explicit that a body
that size cannot be rewritten from a web session without transcribing it.

**It changes nothing until switched on**, twice over: `flowAccounts` defaults to
1, and even at 2 or 3 the node refuses to split a project that carries
account-scoped references (`castRefs`, `objectRefs`, `locationRefs`,
`refImageMediaId`) because those media ids belong to the account that minted
them — sending them with a different `email` would fail every scene outside
block 0 on `Email mismatch`. That guard is what makes it safe to ship ahead of
Etapa 2.

How it was verified before publishing: the draft was diffed node-by-node against
the live baseline (`added 1, changed 3`, only the expected names, connection
delta limited to `Sort & Cap Scenes`' outgoing edge plus the new source, 12
Google Drive nodes still carrying `resource`/`operation`, no dangling `$('…')`
references), and all four bodies were byte-compared against their files in
`paste/`. `publish_workflow` was then called with the draft's explicit
`versionId`.

**Note the diff tool needs a normalised snapshot.** Fed the raw
`get_workflow_details` envelope it reports `before 0 nodes (?) → after 0 nodes`
and then prints `RESULT: OK` — a false pass. Extract `{nodes, connections}`
first.

Two Google family accounts were connected to useapi on 2026-09-17
(`houseofvideos01@gmail.com` 14:06, `houseofvideos02@gmail.com` 14:16), beside
the original `fermafabiz@gmail.com`. All three answered `health: OK` on
`GET /v1/google-flow/accounts`, each with its own `nextRefresh` — they are not
synchronised, so a health check must read all three rather than one
representative.

The goal the producer stated is **one film finishing sooner**, not three films
at once. Design decisions taken before the probes:

- **Contiguous scene blocks per account** — the n-1 image chain survives inside
  a block; the 2 seams start like scene 1 of any film.
- **One film takes all accounts**; a second film waits.
- **One in-flight job per account** to start (3 total), the number configurable.

The full design is in the session plan; this file records what was measured.

## Why the fan-out design was abandoned before it was built

The obvious shape — three concurrent Media Generation executions, one per
account — is blocked by two things already in the repo's own lessons:

- `$getWorkflowStaticData('global')` is **per workflow, not per execution**.
  Three concurrent executions of `yHG4DBCDjR3RJzav` share one `sd` object, and
  each one's `Sort & Cap Scenes` wipes the others' in-flight counters
  (`sd.polls`, `sd.imgCooldowns`, `sd.submitCooldowns`, …).
- `docs/lessons-n8n.md:41` measured that two branches of one execution never
  overlap: "inside one execution every arrangement is a different ORDER, never
  an overlap."

But the second point does not actually bind here, because **the concurrency
wanted is at Google, not in n8n**. `Submit Video` already sends `async: true`
and gets a `jobid` back in about a second; the generation itself takes minutes
on Google's queue. Today's loop wastes that by waiting for each clip before
submitting the next. A pool that keeps K jobs in flight and polls them in turn
gets K clips generating simultaneously inside **one** execution — no static
data collision, no Postgres barrier, no new webhooks, and no change to
`getAliveProduction()`, which is instance-wide and would otherwise have read
three executions as "alive" and refused every producer action.

## Probe results

### P1a — image generation on the primary account (execution 14267, 2026-09-17)

`POST /v1/google-flow/images`, `model: nano-banana-2`, `count: 1`,
`captchaRetry: 1`. Succeeded. Three findings:

**The account is encoded in the media id.**

```
user:2923-email:6665726d61666162697a40676d61696c2e636f6d-image:b92f7803-…
```

`6665726d…636f6d` is hex for `fermafabiz@gmail.com`. This is the strongest
possible confirmation that `mediaGenerationId` is account-scoped: the account
is literally part of the identifier. It follows that `castRefs`,
`locationRefs`, `refImageMediaId` and every `reference_N` stored in
`Editing Options` belong to whichever account minted them, and a block running
on another account cannot use them.

**It took 83.9 s against the 23.6 s recorded in `docs/lessons-pipeline.md`** —
but see the retraction below; this was probably the refusal path, so do not size
anything against it yet.

**`fifeUrl` came back empty — and this was almost certainly a silent refusal,
not a documentation error.** Retracted as a finding. Another session published
two fixes to this very workflow at 14:14 the same day
(`db/port/regen-unstick/`, versions `90eb723e` and `6735a96a`) whose stated
subject is exactly this: "Flow refuses an image in two ways: an HTTP error and
an HTTP 200 whose generatedImage carries a prompt and a seed but no fifeUrl."
That is the response P1a got. So the probe image was likely refused rather than
generated, `docs/lessons-pipeline.md` is probably right that a real generation
carries the `fifeUrl`, and **the 83.9 s timing above is suspect for the same
reason** — it may be the refusal path, not a normal generation. Both need
re-measuring with a prompt that is known to pass before either is treated as
fact.

Each image also costs a CapSolver captcha solve (5.6 s, one attempt, on this
request).

### P1b — `async` on image generation (execution 14267)

```
400 - {"error":"Parameter async not supported","code":400}
```

**Images cannot be pooled.** `POST /images` is synchronous and blocks the n8n
execution for its whole duration, so the pool pattern that works for video has
no equivalent here. Within a single execution the image phase stays serial;
parallelising it would need separate executions, with the static-data problem
above.

### P2 — concurrent jobs per account (execution 14298, 2026-09-17)

Three `veo-3.1-lite-low-priority` i2v submissions to `fermafabiz@gmail.com`,
back to back with no wait between them, from one real start image.

**One of three was accepted. The other two came back HTTP 429.**

| job | started | took | result |
|---|---|---|---|
| 1 | 16:09:15 | 7.2 s | `429` — "Try spacing your requests out" |
| 2 | 16:09:22 | 12.5 s | accepted, `jobid j0917160923…` |
| 3 | 16:09:35 | 7.7 s | `429` |

Note the spacing was not tight: n8n ran them serially, so submits were already
7-13 s apart, and two still bounced. The accepted one echoed
`videoModelName: veo_3_1_i2v_lite_low_priority`, `tier: PAYGATE_TIER_TWO`,
`remainingCredits: 23330` — unchanged from before the run, confirming the
low-priority model really is free — and burned one CapSolver captcha (5.4 s).

**What this settles:** the SUBMIT path is rate-limited per account, hard enough
that a pool cannot fill its window from one account. Spreading submissions
across accounts is not an optimisation, it is the way past the 429 — which is
exactly what the contiguous-block design provides. Etapa 1's account assignment
and Etapa 2's per-account reference sets are therefore both required, not
optional.

**What this does NOT settle:** whether one account can have two or more clips
*generating* at once when the submissions are spaced far enough apart. The
probe never got that far, because two of them never reached Google. That needs
a slower probe — submit, wait 60 s, submit again, then compare completion
times — before the pool's per-account window is set above 1.

### P3 — is account A's media id refused on account B? (execution 14274)

**Yes, explicitly.** `POST /videos` with `email: houseofvideos01@gmail.com` and
a `startImage` minted on the primary account:

```
400 - {"error":"Email mismatch: body has 'houseofvideos01@gmail.com',
                references have 'fermafabiz@gmail.com'","code":400}
```

useapi validates the pairing itself rather than letting Google fail later. So a
scene's image and its clip must live on one account, which makes the
contiguous-block design necessary rather than merely tidy. It also means
`email` can be omitted on `Submit Video` — useapi routes by the reference —
though sending it explicitly keeps the intent visible.

### P4 — does a Flow-born image survive re-upload to another account? (execution 14274)

**Yes.** A 873 KB jpeg from our own media store (`recxm9EqoX05Y857m`, Flow-born
and re-hosted) uploaded to `houseofvideos01@gmail.com` in 15.4 s and came back
as a usable asset:

```
mediaGenerationId: user:2923-email:686f7573656f66766964656f73303140676d61696c2e636f6d-image:41692108-…
image.userUploadedImage.aspectRatio: IMAGE_ASPECT_RATIO_UNSPECIFIED
dimensions: 1376x768
```

`686f757365…` is hex for `houseofvideos01@gmail.com`, so the id is genuinely
minted against the second account. **The upload filter that refused fal images
accepts a Flow image**, which was the one finding that could have invalidated
the per-account reference sets. Note the upload lands in that account's own
Flow project (`b0aa12b6-…`, created by useapi at setup) and is marked
`userUploadedImage` rather than a generated one — a distinction that may matter
to the generation filter later.

### P5 — the account tier (execution 14276) — THE BLOCKER

`GET /accounts/{email}` on all three:

| | `fermafabiz@` | `houseofvideos01@` | `houseofvideos02@` |
|---|---|---|---|
| `userPaygateTier` | `PAYGATE_TIER_TWO` | `PAYGATE_TIER_NOT_PAID` | `PAYGATE_TIER_NOT_PAID` |
| `sku` | `G1_TIER2` | `G1_FREEMIUM` | `G1_FREEMIUM` |
| `serviceTier` | `SERVICE_TIER_ADVANCED` | `SERVICE_TIER_ENTRY` | `SERVICE_TIER_ENTRY` |
| `credits` | 23,630 | 50 | 50 |
| Veo Fast key | `veo_3_1_t2v_fast_ultra`, cost 10 | `veo_3_1_t2v_fast`, cost 20 | same |

As far as Flow is concerned the two family accounts are ordinary free Google
accounts. Submitting the pipeline's default model to one is refused:

```
400 - {"error":"Tier 'PAYGATE_TIER_NOT_PAID' does not have access to
       'veo-3.1-lite-low-priority' model for I2V mode with
       'landscape' aspect ratio","code":400}
```

Three consequences:

1. **No free tier.** `veo-3.1-lite-low-priority` — the model the whole credit
   strategy rests on (`docs/lessons-pipeline.md`, "The credit strategy: free is
   the default, forever") — is not available to them at all.
2. **50 credits each**, which is two clips on Fast and then nothing.
3. **Twice the price even if paid.** They are offered the non-`_ultra` model
   keys at `creditCost: 20` where the primary account pays 10.

Whether this is because the accounts were never added to the Google AI Ultra
family group, have not accepted the invitation, have not propagated yet (both
were created the same day), or because Ultra family sharing simply does not
extend Flow benefits, cannot be told from the API. **`userPaygateTier` is the
one field that answers it**, and re-running this probe after any change in
Google One takes seconds.

## Where this leaves the design

Unchanged and still correct, but unusable until P5 is resolved:

- The pool-in-one-execution shape avoids every n8n obstacle (static data,
  no intra-execution parallelism, instance-wide "alive" detection).
- Contiguous blocks per account are *required*, not a preference — P3 proves a
  scene's image and clip cannot be split across accounts.
- Per-account reference sets are buildable — P4 proves cast sheets and set
  plates can be generated once and re-uploaded to the other accounts.
- The image phase stays serial within an execution — P1b proves `/images` has
  no async mode.

If the family accounts cannot be put on a paid tier, the remaining honest
options are: pay for two more Ultra subscriptions (the scaling lever
`docs/lessons-pipeline.md` actually names), accept today's speed, or spend
credits on the primary account rather than wall-clock — none of which is a code
change.

## P5 follow-up — unblocked (execution 14291, 2026-09-17 ~15:30)

After the producer activated family sharing in Google One, all three accounts
read identically:

| | `fermafabiz@` | `houseofvideos01@` | `houseofvideos02@` |
|---|---|---|---|
| `userPaygateTier` | `PAYGATE_TIER_TWO` | `PAYGATE_TIER_TWO` | `PAYGATE_TIER_TWO` |
| `sku` | `G1_TIER2` | `G1_TIER2` | `G1_TIER2` |
| video models | 89 | 89 | 89 |
| `_low_priority` keys | 11 | 11 | 11 |
| credits | 23,330 | 23,380 | 23,380 |

Two things worth recording:

- **No re-linking was needed.** The accounts' `updated` timestamps are unchanged
  (14:06 and 14:16), so useapi is serving the same stored session it captured at
  setup. The earlier hypothesis here — that the session predated the sharing and
  had to be re-captured — was wrong. What was missing was the entitlement at
  Google's end, and it reached Flow through the existing session.
- **Credits are pooled, not multiplied.** All three read ~23.3k rather than three
  separate 25k allowances, which matches Google's documentation that Flow credits
  are shared across the family group while feature and model limits are per
  member. This costs us nothing, because the default model is `creditCost: 0`;
  it only bounds the paid exceptions (the Quality hook, rescues), which do not
  grow with scene count.

## The edit surface for Etapa 1

The account override must NOT go in the Code nodes that build the requests.
Those are 7-13 kB (`Build Image Request` 12,370; `End Frame Prompt` 13,122;
`Evaluate Image Approval` 12,418; `Current Scene` 7,774) and `CLAUDE.md` is
explicit that a body that size cannot be rewritten from a web session without
transcribing it, which is a real risk rather than a nuisance.

The HTTP nodes that SEND those requests are tiny, and that is where the override
belongs:

| node | body today |
|---|---|
| `Generate Scene Image` | 56 chars — `={{ $('Build Image Request').first().json.requestBody }}` |
| `Generate End Frame` | 53 chars |
| `RG Generate End Frame` | 54 chars |
| `Regenerate Scene Image` | 24 chars |
| `Generate Cast Sheet` / `Generate Set Plate` | 24 chars each |
| `Submit Video` | 633 chars |
| `Upload Asset To Flow` | email is in the URL query string only |

For video, the override may not even be needed: P3 showed useapi routes by the
reference, so dropping `email` from `Submit Video` / `Submit Video Regen` lets
the clip follow its own `startImage` automatically.

## ⚠ Another session is editing this workflow

`get_workflow_history` on `yHG4DBCDjR3RJzav` shows two versions published at
14:14 on 2026-09-17 by a different session, under a feature folder
(`db/port/regen-unstick/`) that **does not exist in this working tree**. The
live workflow is therefore ahead of every snapshot in `db/port/`, including
`motion-permanence/Media Generation.after.json` (2026-09-14), which must not be
used as a diff baseline any more.

Staging a draft while another session is mid-change is the "whatever is parked
goes live with your change" trap in its most dangerous form, with two authors.
Agree who owns the workflow before applying Etapa 1.

## Notes for whoever picks this up

- Throwaway probe workflows, all archived after use: `pi7RVHsmGFNEUih7`
  (P1a/P1b), `c5zdq14okE9uJHwU` (redundant control), `dpjLJ0tG7sSYsVX7`
  (P3/P4), `TtvvQDIPp9Wl838a` (P5).
- The useapi bearer token is hardcoded in all 11 useapi nodes across Media
  Generation and Claude Scripting, and is committed in the snapshots under
  `db/port/`. Adding accounts widens the blast radius — one token now reaches
  three Google accounts. Rotating it and moving it into an n8n credential was
  already on the open-work list and should happen before the rest of this.
- `scripts/check-n8n.mjs` does not touch useapi at all. A block 7 checking all
  three accounts' `health` belongs there, modelled on the existing Railway
  block (warning-only, since a throttle is transient).


## The first real run (2026-09-17 evening) — replication works, the table is wrong

A disposable film was created for this: `rec1rkfxvBeMCFDRj`, "TEST disposable
(multi-account) — Mira and the three lanterns", 40 s, hands-off, one NAMED
character so a cast sheet would actually be drawn. `flowAccounts: 3` was merged
into its Editing Options straight from the id the `new-project` webhook returns,
because the flag cannot ride the brief — `Normalize Webhook Input` builds Editing
Options from a fixed list of keys.

### What worked

Scripting produced 9 scenes, all approved, and **Dan's sheet ingest populated
`hov.sheet_media` for the first time** — six rows for this film:

| kind | name | bytes |
|---|---|---|
| cast | Mira | 609,463 |
| location | Canal path — first lantern stretch | 974,935 |
| location | Canal path — second lantern stretch | 1,046,114 |
| location | Canal path — third lantern stretch | 956,503 |
| object | Canal lanterns | 625,426 |
| object | Lamplighter's pole | 404,877 |

all keyed by a primary-account `flow_id`. So the durable-copy premise Etapa 2
rests on is real, not assumed.

**The replication chain then ran and wrote `Editing Options.flowRefs`** — eleven
ids mapped across two accounts, on a real film, before the execution was stopped.
That is Etapa 2 working end to end.

### The bug

Auditing what it wrote, by decoding the account out of each mapped id:

| account entry | ids mapped | ids actually minted on that account |
|---|---|---|
| `houseofvideos01@gmail.com` | 5 | **0** |
| `houseofvideos02@gmail.com` | 6 | 6 |

Every key is a primary-account id, which is right. But **all five values filed
under account 01 are ids belonging to account 02.** Account 02's six are correct.

Turned on, that means block 1 would be handed references minted on account 02
while submitting as account 01, and every scene in that block would die on
`Email mismatch` — the exact failure the whole design exists to avoid.

**The guard does not catch this**, and that is a second finding:
`Assign Accounts` only checks that each scoped id is PRESENT in
`flowRefs[account]`, never that the mapped value belongs to that account. It
should verify ownership by decoding the hex, the same way `Submit Video Regen`
does. Presence is not correctness.

Cause not yet established. The suspects, in order: `Collect Replicated` reads the
account with `$('Loop Replicate').first().json.account` and `.first()` is a
node's LATEST run, which is the documented trap in this codebase; or
`Upload Sheet To Account` resolved its `?email=` from a different iteration than
the one `Collect Replicated` recorded. Both are reachable by a controlled re-run
with the loop logging its own iteration.

### Why there is no execution log

Three runs were stopped mid-flight (17:22, 17:24, 17:29) and **a CANCELLED
execution keeps no `runData` at all** — unlike an ERRORED one, which keeps the
lot. `14340` (error) gave the full node-by-node trace; `14344` (canceled, 3m40s
of real work) returned `runData: {}`. Everything above was reconstructed from
what the run left in Postgres instead.

The stop came through `POST /executions/{id}/stop` on the public REST API —
`executionHandlers.stopExecution` in the stack — which in this system is the
SITE (`stopExecution` in `platform/lib/n8n.ts`, used by `pauseProduction` and
`restartProduction`). The producer says it was not them. A cancel followed ~6 s
later by a fresh run is the exact signature of `restartProduction()`. Worth
finding out what is calling it before running another timed test.


## The fix (version `4bb6847c`)

Three changes, and the important one is a change of principle rather than of
index arithmetic.

**`Collect Replicated` files each copy under the account decoded from the id
Flow actually returned**, not the account the upload asked for. The account is
hex-encoded between `-email:` and `-image:`, so the returned id is the authority
on where the copy landed; when the two disagree it logs
`REPLICATE MISROUTED … asked for X, Flow answered an id on Y` and files it under
Y. A table that lies here cannot be detected until scenes start failing hours
later, so it is made correct by construction instead.

**Both loop nodes take their work item by `$runIndex`** into
`$('Replicate Prep').all()` rather than `$('Loop Replicate').first()`.
`.first()` is a node's LATEST run, which is not the same as the current loop
item — the documented trap in this codebase, and the only thing that explains an
inversion where the account processed FIRST ended up with FEWER correct entries.

**`Assign Accounts`' guard verifies ownership, not presence.** Each mapped id is
decoded and counted as missing unless it really belongs to the account it is
filed under. Tested against the exact shape the broken run produced: a correct
table reports 0 missing, the mis-filed one reports all of them, an absent entry
reports all of them.

The broken `flowRefs` was dropped from `rec1rkfxvBeMCFDRj` so the next pass
rebuilds it from scratch — `Replicate Prep` skips what is already recorded, so a
partial table would otherwise have preserved its own error.

**Still owed:** a run of the fixed chain on a film. Everything above is
reasoning plus offline tests; none of it has been exercised end to end. Watch
for `REPLICATE MISROUTED` — if it appears, the uploads really are being routed
somewhere other than the requested account and the cause is on useapi's side
rather than in the indexing, which would be worth knowing before trusting the
window at more than one job per account.

## The fixed chain, run on a film (2026-09-17 21:31, execution 14421)

`rec1rkfxvBeMCFDRj`, 9 approved scenes, 0 images, 6 sheets in `hov.sheet_media`,
`flowAccounts: 3`, `flowRefs` deleted beforehand so the table was rebuilt from
nothing.

**The table came out truthful: 8 ids, 8 correctly owned.** The previous run's
signature failure — 5 ids filed under an account that owned none of them — is
gone.

| filed under | ids | correctly owned | identity maps |
|---|---|---|---|
| `fermafabiz@gmail.com` | 5 | 5 | 0 |
| `houseofvideos02@gmail.com` | 3 | 3 | 0 |

**And it immediately earned its keep, because those five entries should not
exist.** `Replicate Prep` builds `targets = ACCOUNTS.slice(1, n)` — the primary
is deliberately never a target, so nothing was ever requested for
`fermafabiz@gmail.com`. Those five are uploads addressed to
`houseofvideos01@gmail.com` that Flow answered with ids minted on the PRIMARY,
and `Collect Replicated` filed them under their real owner instead of lying
that 01 held them.

**The cause, from `GET /v1/google-flow/accounts`:**

```
houseofvideos01@gmail.com
  error:  "Google has signed your account out. Reconnect at
           https://useapi.net/docs/start-here/setup-google-flow"
  health: same
  (no nextRefresh, unlike the two healthy accounts)
```

`fermafabiz@gmail.com` and `houseofvideos02@gmail.com` both read `health: OK`
with a `nextRefresh` scheduled. So **a signed-out account is silent**: the tier,
the credits and the model list all still read fine (that is what P5 measured),
useapi keeps answering 2xx, and the only place the truth appears is `health`.
An upload addressed to it lands somewhere else and comes back looking ordinary.

**What the guard then did, correctly.** With 01 at 0 copies and 02 at 3 of 6, no
account is fully covered, so `Assign Accounts` fell back to one account and the
film generated on the primary — all 7 images so far are `fermafabiz` ids. No
crash, no `Email mismatch`, no speedup. Honest degradation, which is what the
coverage check was built for.

**A correction to the previous entry.** The 5/6 inversion was attributed to the
`.first()`-versus-`$runIndex` indexing bug. That bug is real and worth fixing on
its own — `.first()` is a node's LATEST run, not the current loop item — but the
"0 of 5 correctly owned" figure is far better explained by 01 being signed out,
and the sign-out cannot be dated from the API (01's `updated` never moved past
its creation at 14:06). So which of the two produced those numbers is not
established, and this entry should not be read as proof that the indexing fix
was what repaired the table.

**What is owed now:**

1. **Reconnect `houseofvideos01@gmail.com` at useapi** — a manual step, and
   nothing multi-account can be measured until it is done.
2. Then clear `flowRefs` on the film again and re-run, so the table is built
   with all three accounts live. Expect 6 x 2 = 12 copies and three accounts in
   the table.
3. `houseofvideos02@gmail.com` took only 3 of its 6 — worth reading the finished
   execution's log for `REPLICATE MISROUTED` and for upload failures, since a
   partially-covered account is what keeps the guard at one account even after
   01 is healthy. (`runData` is empty while an execution runs, and a CANCELLED
   one keeps none at all, so this has to wait for 14421 to finish on its own.)
4. `scripts/check-n8n.mjs` now has a block 7 that fails on any account whose
   `health` is not `OK`. It needs `USEAPI_TOKEN` in the environment and a
   machine that can reach useapi — not a Claude Code web session.

## The real blocker: `POST /assets?email=` does not route (2026-09-17 22:21)

All three accounts healthy, film reset, `flowRefs` rebuilt from nothing
(execution 14446). The table came out **11 entries, 11 correctly owned, three
accounts** — the ownership-based filing is sound. But the coverage was not:

| source sheet | 01 | 02 | landed on the primary instead |
|---|---|---|---|
| location 1 | — | ✓ | ✓ |
| location 3 | ✓ | ✓ | — |
| lanterns | — | ✓ | ✓ |
| Mira | — | ✓ | ✓ |
| pole | ✓ | — | ✓ |
| location 2 | ✓ | — | — |

Six references x two targets = twelve uploads; **four landed on the primary**,
which is never a target (`targets = ACCOUNTS.slice(1, n)`), and one produced
nothing.

**The probe that settles it.** Three uploads of the same file with the address
written LITERALLY into the URL — no expression, no `$runIndex`, nothing of ours
between the constant and the request:

| asked for | the returned id belongs to |
|---|---|
| `houseofvideos01@gmail.com` | `houseofvideos01@gmail.com` |
| `houseofvideos01@gmail.com` | **`houseofvideos02@gmail.com`** |
| `houseofvideos02@gmail.com` | **`houseofvideos01@gmail.com`** |

**`POST /v1/google-flow/assets?email=<x>` does not reliably upload to `<x>`.**
Two of three went to the wrong account with the parameter spelled out by hand.
Note the wrong landings here went to the OTHER SECONDARY, not to the primary, so
this is not "falls back to the default account" — it looks like an arbitrary
pick from the linked set.

**Two corrections to earlier entries in this file.**

1. The sign-out of `houseofvideos01` does NOT explain the misrouted copies. The
   same misrouting happens with every account healthy. The sign-out was real and
   worth fixing, but it was a second fault sitting on top of this one.
2. The `.first()`-versus-`$runIndex` indexing is NOT the cause either. The probe
   used no expression at all.

**What this does and does not break.** It is the ASSET UPLOAD that will not
route. Generation still routes: `email` travels in the BODY of `/videos` and
`/images`, and useapi rejects a mismatched pair with `Email mismatch`, which is
proof the body field is honoured. So Etapa 1 (a scene block generating on its
own account) is unaffected; only Etapa 2's replication is.

**The shape of the fix, and why the current design cannot work.** Replication is
written as "one upload per (sheet, target account)" and trusts the address. It
has to become **coverage-driven**: upload a sheet, read from the RETURNED id
which account actually received it, record that, and repeat until every target
account holds a copy. The returned id is already the authority — `Collect
Replicated` files by it — so what is missing is the repeat, not the bookkeeping.
With an arbitrary pick among three accounts, covering two specific targets costs
roughly four to five uploads per sheet rather than two, so about 30 uploads for
a six-reference film. Uploads are seconds each; this is affordable.

Worth checking first, because it would make the loop unnecessary: whether useapi
exposes an upload that DOES bind to an account (a different endpoint, a body
field rather than a query parameter, or a per-account token). The current bearer
is one token covering all three accounts, which is consistent with the server
picking whichever account it likes.

**Until then `flowAccounts` above 1 buys nothing**, and it fails safely: no
target ever reaches full coverage, so `Assign Accounts` drops back to a single
account and films generate exactly as before.

## It was our URL: `email` is a path segment (fixed, Media Generation `8c4ef1bf`)

The section above blamed useapi. That was wrong, and the correction matters more
than the finding did.

useapi's machine-readable spec — reachable only through n8n, since this
environment's proxy blocks `useapi.net` — documents the endpoint as:

> **`POST https://api.useapi.net/v1/google-flow/assets/{email}`**
>
> ### Path Parameters
> `email` is optional. […] With multiple accounts configured, **omitting the
> email parameter triggers automatic load balancing** based on image generation
> job statistics to select the healthiest account.

Both of our callers sent `assets?email=…`. That endpoint has no `email` QUERY
parameter, so every one of our uploads read as "no email given" and was
load-balanced. The arbitrary-looking account assignment was the balancer doing
exactly what it documents.

**How to find a spec from inside a blocked session:** ask the API for a path it
does not have. `GET /v1/google-flow` answers `Endpoint not found` and hands back
`hint.llm_docs` — `https://useapi.net/assets/aibot/api-google-flow-v1.txt`, the
whole API as one 453 kB text file. Fetch it with a throwaway HTTP node and slice
out the section between its `=== URL: … ===` markers; returning the whole thing
through `get_execution` exceeds the token limit.

**Measured both ways, same file, same minute:**

| URL form | landed on the account asked for |
|---|---|
| `assets?email=<x>` | 1 of 3 |
| `assets/<x>` | **3 of 3** |

**The blast radius was never limited to replication.** `Upload Asset To Flow`
carries the producer's own reference picture and has used the query form since it
was written. It worked for months because **only one account was linked**, so the
balancer had a single choice; it started misrouting the moment the second and
third accounts were added, which is the same day this was found. An ordinary film
whose reference lands on the wrong account loses that reference — the scene
generates without it rather than failing loudly.

**Applied:** `Upload Asset To Flow` → `assets/fermafabiz%40gmail.com`,
`Upload Sheet To Account` → `assets/{{ encodeURIComponent(…account) }}`. Diff was
225 → 225 nodes, connections identical, added 0, removed 0, changed exactly 2,
both only their `url`, both byte-identical to their `paste/` files. Neither
Media Generation nor Claude Scripting had a parked draft, so the publish carried
nothing else. Claude Scripting has no `/assets` caller left at all.

**The lesson worth keeping: a REST parameter in the wrong position does not
error, it defaults.** Nothing in any response said `email` was being ignored —
the uploads succeeded, returned well-formed ids, and only the hex-encoded owner
inside `mediaGenerationId` disagreed. That is why `Collect Replicated` files
every copy by the returned id rather than by the one it asked for, and that guard
should stay even now that the address works.

**Still owed:** a film run with the path form live, to see `flowRefs` reach
6 x 2 = 12 copies with full coverage and `Assign Accounts` actually split into
three blocks. Everything above is an endpoint measurement, not a film.

## Confirmed on a film (2026-09-17 23:34, execution 14479, Media Generation `8c4ef1bf`)

Same film, `flowRefs` and all nine images cleared first, three accounts healthy.

**Replication: 12 of 12, full coverage, nothing misrouted.**

| account | ids | correctly owned |
|---|---|---|
| `houseofvideos01@gmail.com` | 6 | 6 |
| `houseofvideos02@gmail.com` | 6 | 6 |

No entry under `fermafabiz@gmail.com` at all — which is the point, since the
primary is never a target. Compare the run before the fix: 11 entries, four of
them filed under the primary, and 3/6 and 4/6 coverage.

**The block split is real.** `Assign Accounts` kept `flowAccounts` at 3 instead
of falling back, and the scenes came out in contiguous blocks, each image minted
on its block's account:

| account | scenes |
|---|---|
| `fermafabiz@gmail.com` | 1-3 |
| `houseofvideos01@gmail.com` | 4-6 |
| `houseofvideos02@gmail.com` | 7-9 (last still generating at the time of the audit) |

So Etapa 1 and Etapa 2 are both verified end to end, and the single change that
made the difference was `assets?email=` → `assets/{email}`.

**What this does NOT yet show.** Images are serial by necessity (`POST /images`
refuses `async`), so a three-way split of the IMAGE phase buys nothing in wall
clock; it only puts each scene's reference on the account that will generate its
clip. The speedup is Etapa 3 — the pool that keeps several Veo jobs in flight —
and it remains unbuilt and unmeasured. What is now true is that the ground it
needs is correct: every scene's start frame lives on the account its clip will be
submitted to.

## The regression Etapa 2 shipped, and what it cost (2026-09-18, `98e7b4b0`)

**`Load Sheet Media` returning zero rows stopped the entire batch.** A node that
emits nothing stops everything downstream of it — the trap this README already
names, and the reason `Replicate Prep` and `Build Flow Refs` were written to
always emit one item. The Postgres node in FRONT of them was left unguarded, so a
project with no rows in `hov.sheet_media` never reached `Replicate Prep` at all.

The batch did not fail. It ended, `status: success`, in 160 milliseconds, with
`lastNodeExecuted: Load Sheet Media` and no audio, no images and no clips
generated. From the site it looks like production simply refusing to start.

**Ten of twelve active projects were in that state**, including a real film —
"How ww2 started", 16 scenes, 0 clips. It shipped with Etapa 2 on 2026-09-17
around 17:05 and was live for roughly seventeen hours.

The fix is `alwaysOutputData: true` on `Load Sheet Media`. `Replicate Prep` then
runs, finds no sources, and returns its `{skip: true}` item, which
`Replicate Any?` already routes past the loop to `Find Audio Folder`. This is the
one case the n8n guidance allows it: the empty result has a dedicated branch, and
the node downstream reads no fields off the synthetic item.

Diff before publishing: 234 → 234 nodes, added 0, removed 0, changed 1, and that
one change is the setting — parameters byte-identical, connections identical.

**How it was found matters more than the fix.** It was not found by a check; it
surfaced because an unrelated execution of ANOTHER project appeared in the list
while a pool test was being watched, and it had finished suspiciously fast. The
lesson: **a node added in front of an existing chain inherits responsibility for
that chain's liveness**, and the zero-item rule has to be applied to the node that
FEEDS the guarded one, not only to the guard. Nothing in the Etapa 2 verification
covered a project with no sheets, because the test film always had six.
