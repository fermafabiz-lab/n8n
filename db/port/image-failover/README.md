# A Google-flagged account stalled every image (2026-09-23)

The producer, on the Rome film (`recIIvYV8S6KNaw4C`, "How Rome fed a million
people", 26 scenes, three Flow accounts): *"imaginile dureaza o eternitate, se
blocheaza productia"*. They stopped the image phase twice (Media Generation
16430 after 38 min, 16459 after 19 min) and it was running a third time.

## What was measured

Cancelled executions keep no `runData`, so the evidence came from two other
places.

**`hov.scene`** — when each still landed. Normal is ~40 s a scene. The gaps
were 11.5 min (scene 110), 7.5 min (202, first of a new run), 6 min (205), and
206 was still waiting when the run was cancelled. All of them in the block of
`houseofvideos01@gmail.com` (the account is hex-encoded in `image_media_id`).

**useapi's `GET /v1/google-flow/accounts/captcha-stats`** — every Flow request
of the last hour, with account, status and Google's reason. This is the
endpoint worth knowing: it is read-only, it is the only place a refused request
leaves a trace outside the execution, and it answered what n8n could not.

| account | image requests | refused |
|---|---|---|
| `fermafabiz` | 26 | 1 × 403, 1 × 429, 1 × 503 |
| `houseofvideos01` | 22 | **12 × `403 PUBLIC_ERROR_UNUSUAL_ACTIVITY`**, 2 × 429 `TOO_MUCH_TRAFFIC` |
| `houseofvideos02` | 0 | (its block had not started) |

`GET /accounts` read `health: OK` on all three at the same moment: a flagged
account is not a signed-out account and `health` does not show it.

The shape on 01 repeats: one image passes, the next request 20 s later is
refused, `IMG Cooldown Guard` treats it as a throttle and holds **five
cooldowns of 60 s**, asks 01 again, and so on. Images are generated one at a
time for the whole film, so a five-minute hold on one account is a five-minute
hold on the film while the other two accounts sit idle.

useapi's docs separate the two refusals: `429 UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC`
is a captcha token scored low (per request, "wait ~60 s or raise
`captchaRetry`"), while `403 PUBLIC_ERROR_UNUSUAL_ACTIVITY` is Google flagging
the account. Neither is cured by asking the same account again after a wait.

## What changed — Media Generation `f7f03638` (rollback `c22878a1`)

- **`IMG Account`** (new, between `Flow Pace` and `Generate Scene Image`)
  picks the account per request: the scene's block account, unless static data
  `imgAvoid` marks it flagged, in which case the first account the film runs on
  that is not.
- **`IMG Cooldown Guard`**: on a throttle it marks the account it just used as
  avoided for 30 minutes (useapi's own quarantine for a throttled account) and,
  when another account is free, retries after **5 s** instead of 5 min
  (`waitSeconds`, read by `Wait IMG Cooldown`). Only when every account is
  avoided does the old five-minute hold apply.
- **The clip follows the image.** A still made on another account than its
  block's would meet `Email mismatch` at the clip. `Pool Tick` now queues each
  scene on the owner encoded in its `Image Media ID`; `Submit Video` and
  `Generate End Frame` address the owner of the start image.
  `Submit Video Regen` already did.
- `Generate Scene Image` reads the account from `IMG Account`; its reference
  remap is unchanged, so a still moved to the primary keeps the original cast
  sheets and set plates and drops only the n-1 palette reference from 01.

Diff against `c22878a1`: 246 → 247 nodes, 1 added, 6 changed, one edge moved
(`Flow Pace` → `IMG Account` → `Generate Scene Image`, read back), settings
identical on every pre-existing node, bodies byte-equal to `paste/`.

## Not changed, deliberately

- `Regenerate Scene Image` (the gate's regen) still uses the block account. A
  refusal there goes to `Mark Image Regen Rejected` with no hold, so it does
  not stall the film.
- Videos on a flagged account. The pool's `Submit Cooldown Guard` still holds
  and retries on the same account. If 01 also refuses clips, the same failover
  belongs there — measure first with the captcha-stats endpoint.
- Why Google flagged 01. It is five days old and was added the same week; the
  primary is two months old. Rest is the only known cure.

## Owed

- The running execution 16482 started at 13:43 on the old version. It has to
  be stopped (Pause on the site) and resumed to get this.
- On the resumed run: `IMG ACCOUNT … is flagged by Google … generating on …`
  in the log, the rest of 01's scenes minted on `fermafabiz` or `02`, and zero
  `Email mismatch` when their clips are made.
