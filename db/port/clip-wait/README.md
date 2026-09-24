# A clip waits ten measured minutes, not an unmeasured hour — 2026-09-24

**The producer**: *"ultimele 2 scene nu se generează. Sta deja de ore mult
timp"* — and then, the question that produced this: *"as vrea sa imi zici de
la ce se cauzeaza aceasta problema pe termen lung si eventual sa si rezolvi."*

## What was actually happening

Film `rec12cTeCE6R6tjMY`, scenes 107 and 108 of 10. Eight clips existed; two
did not, for hours.

| time | |
|---|---|
| 11:39 → 12:21 | production pass, **stopped by the producer** |
| 12:28 → 13:13 | another pass, **stopped** (13:13:04) |
| 13:13:11 | a third pass starts, seven seconds later |
| 13:38 | scene 107 has said "Generare Video" for 25 minutes; the batch is alive and has written nothing |

Nothing was broken. `Check Job Status` polls every 30 s and gave up only after
`MAX_POLLS = 120` — **one hour per attempt**, and with five resubmits allowed
per scene, up to **five hours on one scene** before the run admits defeat.
Scene 108 was queued behind 107 and never started.

Flow itself was healthy: a video regeneration fired at 13:15 on the same film
returned a clip in **2 minutes**. The job the batch was waiting on was simply
dead, and nothing distinguishes a dead job from a slow one except time.

## Why it had become permanent

Three things, and the third is the one that turned a hiccup into an afternoon.

1. **The number was never measured.** The node's own comment said the hour was
   "sized for the low-priority Veo queue" — an assumption from before the
   pipeline had three accounts and a pool, never checked against a clip.
2. **The cost of being wrong is asymmetric, and the number was set as if it
   were not.** Waiting too long costs the producer their day; resubmitting too
   early costs one clip generation. An hour "to be safe" is only safe for the
   side that is cheap.
3. **Nothing on screen said how long.** The scene showed a `Rendering` chip
   that read identically in second one and in minute forty. The only available
   move is then Stop, then Resume — which resets the poll counter and starts
   the hour over. Three passes in one afternoon, each reset. **The loop, not
   the dead job, is what cost the hours**, and it is the same failure
   `db/port/regen-unstick/` documented for regenerations one level down.

## The measurements

Every legitimate clip this project has ever timed:

| seconds | where |
|---|---|
| 68, 85, 94, 233, 246, 345 | batch cadence, engine film, 2026-09-24 |
| 71, 149 | two regens on that film, same day |
| 177 | the 2026-09-17 regen measurement |
| 88 steady / 130 pooled | the 2026-09-18 A/B |
| **391 (6m31)** | the worst legitimate clip ever recorded |

## The fix

**n8n — Media Generation `527c67b7`, live 2026-09-24.** `MAX_POLLS` 120 → 20
in `Check Job Status` AND `Check Video Regen` (30 s a poll = **10 minutes**,
half again as long as the worst clip ever measured). The resubmit machinery is
unchanged and was already sound: `Resubmit Guard` resets the per-scene counter
and caps at five attempts, so the worst case on one scene is now 50 minutes
rather than five hours.

**The site — `ClipWait`.** A scene whose images and voice are approved, with
no clip and nothing flagged, now shows *"Making the clip · 12 min"* and says
that past ten minutes n8n re-shoots the job by itself, ending with **don't
stop production to hurry it**. The wait becomes a fact instead of a guess, and
the one move that made it worse is named as the one not to make.
`lib/use-waited.ts` owns the age string for both this and `RegenBadge`, and
`CLIP_RESHOOT_MINUTES` is the site's copy of the ceiling.

`node db/port/clip-wait/check.mjs` (in `npm run check`) holds 21 assertions:
the ceiling clears the worst measured clip with margin, both poll nodes carry
the same number, a completed job is still completed, an explicit failure still
short-circuits, the timeout fires one poll past the ceiling and not before,
the site draws the clock only while a clip is being made, and **the number the
site quotes equals the number the pipeline uses**.

## What is still owed

- **A stuck scene still blocks the ones behind it.** 108 waited on 107 for no
  reason of its own. The pass is serial; a scene that fails its five attempts
  could be set aside and retried at the end instead of holding the queue.
- **Nobody has watched the new ceiling fire on a real film.** The fixtures
  prove the branch; a dead job in production is what proves the recovery.
- The poll interval itself (30 s) is untouched and costs on average 15 s per
  clip in pure latency — measurable, worth revisiting, not urgent.
