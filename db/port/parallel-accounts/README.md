# Parallel generation across three Google Flow accounts

Status: **BLOCKED on account tier. Etapa 0 complete, nothing applied to production.**

The parallelization MECHANISM is proven to work. The two family accounts are on
`PAYGATE_TIER_NOT_PAID` / `G1_FREEMIUM` with 50 credits each and no access to
the free low-priority Veo model, so they cannot do the work until that changes.
See "P5" below.

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

**It took 83.9 s, not the 23.6 s recorded in `docs/lessons-pipeline.md`.**
If that is representative rather than a slow minute, an 80-scene film is about
112 minutes of image generation, not 32 — which makes the image phase a much
larger share of the run than the design assumed. Worth re-measuring before
sizing anything against it.

**`fifeUrl` came back empty.** `docs/lessons-pipeline.md` says the response
carries "BOTH the signed `fifeUrl` … and the `mediaGenerationId`". It carried
only the id. Not blocking — our own media store has the bytes, and that is
what the cross-account upload probe uses — but any design that plans to fetch
bytes from `fifeUrl` is building on something that is not always there.

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

### P2 — concurrent jobs per account

Not run, and moot until the tier question below is resolved: there is no point
measuring how many jobs a free-tier account will accept when it cannot generate
at all on the model the pipeline uses.

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
