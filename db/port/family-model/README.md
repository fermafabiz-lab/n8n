# The free clip model left the invited accounts (2026-09-23)

The producer, on the Rome film (`recIIvYV8S6KNaw4C`), once every image was
approved: *"productia este blocata la videoclipuri, astept la scena 1 si nu
genereaza nimic"*.

## What was measured

useapi `GET /v1/google-flow/accounts/captcha-stats`, video requests from
18:02 (the batch 16563 reached the clip phase at ~18:01):

- `fermafabiz` — scene 1 submitted at 18:02:07, **200**.
- `houseofvideos01` — every clip from 18:02:14 on answered
  **`403 PUBLIC_ERROR_MODEL_ACCESS_DENIED`**, interleaved with captcha
  403/429s from the five-token retry.

useapi's docs, same day: *"Since 2026-09-23 Google no longer offers
`veo-3.1-lite-low-priority` to invited members of an Ultra $199 family plan —
only the family manager's account keeps it."* The three accounts share one
credit pool (22,015 credits on each, `G1_TIER2`), so 01 and 02 are invited
members and `fermafabiz` is the manager. Their model lists still show the
`_low_priority` keys — useapi says so too: the list follows the plan, not what
Google will actually serve — so the model list is not evidence either way.
Only a refused clip is.

Why it looked like "stuck on scene 1": the pool holds one job per account.
Scene 1 was in flight on `fermafabiz`; 01's submit failed and `Submit
Cooldown Guard` looped it through 60 s cooldowns without returning to `Pool
Tick`, so the in-flight clip was not being polled either. The film sat.

## What changed — Media Generation `b9527072` (rollback `c8e6df0c`)

`Submit Video` and `Submit Video Regen` switch the model from
`veo-3.1-lite-low-priority` to **`veo-3.1-lite`** whenever the clip is
addressed to an account other than `fermafabiz@gmail.com`. It is the same Veo
3.1 Lite model at normal priority; on an Ultra plan it costs **5 credits a
clip** from the shared pool (about 90 credits for a 26-scene film split three
ways). The primary keeps the free model. The check runs after the final
account is decided (image owner, stolen copy), so work stealing is covered.

Diff against `c8e6df0c`: changed 2, connections identical, settings identical,
bodies byte-equal to `paste/`.

## Not changed / owed

- `rescueVideoModel` and any other model override still apply as before;
  only the free model is swapped, and only off the primary.
- `Submit Cooldown Guard` still holds the pool while one account refuses.
  A `MODEL_ACCESS_DENIED` should not happen now, but any other persistent
  refusal on one account will stall the in-flight polls the same way — the
  guard should hand back to `Pool Tick` instead of looping in place.
- If the producer would rather spend no credits, the alternative is clips on
  the primary only (`videoPool`/`flowAccounts` off for the clip phase), at
  serial speed.
- The running batch (16571, 18:06) is on `c8e6df0c`: Pause and Resume.
