# The free tier is the product — make it good

**APPLIED 2026-09-03.** Live and published:

| workflow | nodes | live version |
|---|---|---|
| 3. Media Generation (`yHG4DBCDjR3RJzav`) | `Current Scene`, `Submit Video`, `Prep Video Regen`, `Submit Video Regen` | `095a0ce9` |
| Claude Scripting (`gkEtGMecv4TC3ZHp`) | `Segment Chapter Into Scenes` | `a4f7260f` |

Diffed after publishing; no other node changed. `*.before.*` is the rollback.

## The arithmetic that decides everything here

The target is three films a day of eighty scenes — **7,200 clips a month**.

| model | credits per 8s clip | 7,200 clips |
|---|---|---|
| `veo-3.1-lite-low-priority` | **0** | **0** |
| `veo-3.1-lite` | 5 | 36,000 |
| `veo-3.1-fast` | 10 | 72,000 |
| `veo-3.1-quality` | 100 | 720,000 |

The allowance is **25,050 credits a month** (measured on the account, not
quoted: `GET /accounts/{email}` returns `credits` and the per-model
`creditCost`). So no paid tier can be the default at this scale — the free
lower-priority tier is not a saving, it is the business model, and it is why
the Ultra $199 plan was bought. **Quality has to come from the inputs**, and
credits buy only the exceptions that do not grow with the number of scenes.

## What went in

**Model chosen per scene instead of hardcoded** (`Current Scene`, which is
where three edges into `Submit Video` converge, so no rewiring):

- default **free**, overridable per project with `Editing Options.videoModel`;
- the **hook** (Ordine Scenă 1) on Quality — one clip per film, the one that
  decides whether the film is watched at all, and the only paid cost that does
  not scale with scene count (`hookVideoModel` to change or disable);
- a **rescue** on Quality for a shot the producer has already refused twice
  (`rescueVideoModel`). It fires in `Prep Video Regen`, not on the main path:
  the main path only submits scenes with no clip, so a third attempt can only
  arrive through the regen. The counter is the scene's own draft list —
  `Versiuni Media` — because every regeneration files the outgoing clip there,
  so its length IS the number of takes already tried. Nothing new to store.

**Seeds.** Every submission carries `seed = hash(sceneId + ':' + takes)`. A
re-roll is now a different take by construction rather than another coin flip,
and a first take is reproducible. Derived rather than stored, so no schema
change.

**A rule about what the cheap model can actually do**, in the segmenter: it
renders ONE thing moving convincingly and invents when several must move at
once, which is exactly how a pack of racing cars produced a car driving the
wrong way. On a beat whose subject is many things in motion, choose a framing
where one thing moves and put the energy in the camera and the sound. Written
as what a crew with one camera would shoot anyway, because a rule that reads
as a compromise gets ignored.

## Deliberately NOT done, with reasons

- **`count: 2` (two takes per submission) is wired to 1.** Two takes are free
  on the low-priority tier, so the temptation is obvious — but at three films a
  day the scarce resource is QUEUE TIME, not credits: asking for a second take
  of every scene halves the throughput ceiling to save a click on the tenth of
  scenes that need it. It also has nowhere to live yet: a Flow URL dies in
  about six hours, so take B would have to go through the same Drive re-host
  the live clip does before the site could file it as a draft. Turn it on
  deliberately, per project, once that path exists.
- **No live credit guard yet.** Paid generations are now rare by construction
  (one hook per film plus rescues), but at ninety films a month the hooks alone
  are 9,000 credits. The API returns `remainingCredits` on every generation, so
  the guard is cheap to add: below a reserve, force the free model.
- **Upscale cannot be applied to a finished film.** `POST /videos/upscale`
  takes the `mediaGenerationId` of a Flow-generated video. Our final film is
  assembled by ffmpeg from the clips — it is not a Flow video and has no id. So
  an upscale button can only mean "upscale every CLIP and re-assemble":
  1080p is free per clip, 4K is 50, which on an eighty-scene film is 4,000
  credits. That is a product decision, not a code one.
