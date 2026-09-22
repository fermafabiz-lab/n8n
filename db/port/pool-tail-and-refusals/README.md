# Plan: fewer refusals, and no tail

Written 2026-09-22 from the first real film through the three-account pool
(`rec7U8PbMS8MUYQcW`, 54 scenes; measurement in
`db/port/parallel-accounts/etapa3.md`, "The first REAL film through the
pool"; the audio-filter diagnosis in `db/port/audio-filter/README.md`).
Nothing here is applied yet. Each step names the nodes it touches, the
evidence it rests on, and what proves it worked.

## What the film measured, in one place

| | |
|---|---|
| split across accounts | 18 / 18 / 18, zero `Email mismatch` |
| clip rate, all three accounts busy | **86 s per clip** for the first 50 min (35 clips) |
| clip rate, the tail | **14 clips in 55 min**, one account at a time |
| scenes refused by the filter at least once | **22 of 54 (41%)** |
| refused generations vs successful | **~43 vs 54** |
| refused scenes whose image prompt names a face or a person talking | **21 of 22** |
| scenes with neither cue that were refused | 1 of 7 |
| category / tone / style | `story` / Documentary / Documentary, photorealistic |

Two conclusions, both load-bearing for the plan:

1. **The refusals are the bigger cost, and they are caused by the STILL, not
   by the motion prompt.** `docs/lessons-pipeline.md` already proved this for
   `PROMINENT` ("a fully generic prompt with no names still failed on the
   same image"), and `db/port/audio-filter/` proved it for
   `AUDIO_GENERATION_FILTERED` (a blank prompt on the same still was refused;
   a different still passed first time). Yet the ladder that handles a
   refusal rewrites the MOTION prompt, four times, on the same seed. On this
   film that is ~35 generations that could never have worked.
2. **The tail is structural.** A clip can only be made on the account that
   minted its image (useapi refuses the pair with `Email mismatch`, verified
   again on 2026-09-22), and `Pool Tick` only hands an account scenes from its
   own block. So when one block finishes, its account idles. Refusals make it
   worse because they cluster by chapter, and a chapter is a block.

Fixing (1) shrinks (2) as a side effect; fixing (2) needs one new mechanism.

---

## Part 1 — refusals

### 1a. The ladder rewrites the wrong thing. Redirect it.

**Nodes:** `VP Prep`, `VP Give Up?`, `VP Rewrite AI`, `VP Apply`,
`VP Reload Scene`, `Submit Video`; plus three or four new nodes.

Today, on `Filter Failure?`[0]:

```
VP Prep → VP Give Up? →[no] VP Rewrite AI → VP Apply → VP Reload Scene → Current Scene → Submit Video
                      →[yes] Mark Video Prompt Rejected
```

four times, then give up. Every resubmit carries the identical seed
(`Current Scene`: `hash(sceneId + ':' + takes)`, and a refused clip files no
take).

Proposed:

| attempt | what | why |
|---|---|---|
| 1 | resubmit the SAME prompt with a NEW seed | tells us in one generation whether this refusal is stochastic; costs nothing else |
| 2 | regenerate the START IMAGE with a steer, then resubmit with a new seed | the still is the trigger for both refusal classes that matter |
| 3 | give up, with the advice `VP Prep` now writes | the producer decides |

**Attempt 2 reuses what exists rather than duplicating it.** The pool posts
`{scene_id, steer}` to `http://localhost:5678/webhook/scene-image-regen` —
the same webhook the site's Regenerate button fires — and `IR Build Request`
(Claude Scripting) appends `steer` to the prompt the way it appends the
producer's `Observații Scenă` today. The pool then treats the scene as
"waiting for a new image": `Pool Tick` gets a fourth action kind,
`image-wait`, that re-reads `Image Media ID` off the scene every poll
interval and resubmits the clip once it changes. The steer text, one per
refusal class:

- audio: *"Frame the same moment so that nobody in the shot is about to
  speak, take a call or sing: the desk, the object, the hands, the room, or
  the person from behind."*
- prominent person: *"The same moment with every face turned away from the
  camera or out of frame: from behind, in profile at distance, a detail
  insert."*
- minor: unchanged from today's `VP Rewrite AI` rule (adults, or off screen).

**Motion prompt:** left alone on attempts 1 and 2. The current `VP Rewrite
AI` stays for the case where the reason string names the PROMPT (a real
person's name in the direction), which is the one case where rewriting the
words is the right move.

Cost per refused scene: worst case 1 + 1 image + 1 = 3 generations, against
5 today, and the first attempt alone will settle many.

**DECISION FOR THE PRODUCER (D1).** Attempt 2 replaces an image the producer
has ALREADY APPROVED, without asking. The honest options:

- (a) do it, and clear `image_approved` on that scene so it reappears at the
  image gate for a look — the film keeps moving, the producer sees what
  changed. The site's `autoKeep(sceneId, "image")` files the old picture as
  a draft before a regeneration; confirm the webhook path (`IR Write Image`)
  does the same before relying on it.
- (b) stop after attempt 1 and hand the scene over with the advice — what is
  live now, minus the wasted rewrites.

Recommended: (a). The producer's stated goal is a film that finishes sooner,
and the alternative is a scene that waits for a human at 2 a.m.

### 1b. A seed is reproducible until it is refused

**Nodes:** `Current Scene` (batch), `Prep Video Regen` (gate + webhook).
Two copies of one rule, as everything in this workflow.

The pattern already exists: `Motion Resubmit` re-rolls with
`hash(sceneId + ':motion:' + attempt)`. Mix the refusal attempt into the
same hash: `Current Scene` reads `sd.rewrites[sceneId]` (the counter
`VP Prep` keeps) and, when it is non-zero, seeds
`hash(id + ':' + takes + ':refused:' + n)`. `Prep Video Regen` has no
counter, so it uses the note: when `Observații Scenă` starts with `REJECTED`
or `AUTO-REWRITE`, mix `Date.now()` — deliberately non-reproducible, because
reproducing a refusal is the one thing nobody wants. Everywhere else the seed
stays exactly as it is.

**Measure first, on scene 106's ORIGINAL still**
(`…-image:e09a4e10-804f-44c5-9846-7d14328b864b`, which reproduces
`AUDIO_GENERATION_FILTERED` on demand): three submits, three seeds, spaced a
minute apart, on `fermafabiz@gmail.com` (the still lives there; another
account answers `Email mismatch`), **in a quiet window with no batch on that
account** — three rapid probes during a live batch drew a 429 and then
`PUBLIC_ERROR_UNUSUAL_ACTIVITY` on 09-22. If 0 of 3 pass, the audio refusal
is deterministic for a still and attempt 1 of 1a should be dropped to save
the generation. If any pass, attempt 1 pays for itself many times over.

### 1c. Stop asking for the thing that gets refused

**Node:** `Segment Chapter Into Scenes` (Claude Scripting), the rule block
that writes image prompts. Possibly `Cast Sheet Prep` (Media Generation).

45 of this film's 54 image prompts put a face or a person mid-conversation in
frame, and those scenes were refused at 47%; the nine that did not were
refused at 14%. The prompts read *"Daniel Kim, a man in his mid-30s … light
beige skin, a long face, short black hair, dark brown eyes"* and *"Maya's hand
hesitates over the headset … as the call window is about to start"* — a
photorealistic, named cast, filmed like a documentary. That is the exact shape
`docs/lessons-pipeline.md` says Veo refuses: *"for anything photorealistic
with people, faces must never be in frame: people from behind, distant
silhouettes, crowds at distance, detail inserts. This is the only form Veo
accepts."* The open item "Codify the no-visible-faces rule into Documentary
image prompts" has been in CLAUDE.md since August.

**Two things the plan gets right that the open item does not.**

- **Gate on STYLE, not category.** This film is `category: story` with
  `tone: Documentary, style: Documentary`. A rule keyed to the Documentary
  category would never have fired on it. The trigger is *photorealistic
  people*, which is the style, and the kids styles (cel, clay, brick…) are
  exempt by the same test.
- **Speech is a cue too, since 2026-09-22.** Veo invents a soundtrack from
  the still. A still of someone about to speak, on a call, at a microphone,
  gets an audio refusal that no prompt fixes. The rule needs one more
  sentence: *a call is a screen seen from behind or over a shoulder with the
  speaker's mouth out of frame, or the desk before and after it.*

**DECISION FOR THE PRODUCER (D2).** This changes how photorealistic films
LOOK: characters from behind, in profile at distance, hands and objects and
rooms, faces only on the cast sheet. The cast-sheet system exists to keep
faces consistent, and this rule keeps faces out of frame; on a
photorealistic Story film those pull against each other. Ship it as a
per-film switch (`facesOff`, default ON for photorealistic styles), measure
the refusal rate on the next such film, and let the producer judge the look
with the number beside it. If they want faces, they get faces and the
refusal rate that comes with them — but it is then a choice, not a
surprise.

### 1d. Measure whether our own prompt tail summons speech (no change)

Every clip this pipeline submits ends
`Negative: speech, voices, dialogue, singing, narration, music, soundtrack,
…`. This repo's most expensive Veo lesson is that naming a thing in the
prompt makes the model render it. It is NOT the sole cause — a probe with no
audio clause at all was still refused on scene 106's still — but it may be
raising the rate. Ten refused stills, each submitted twice in a quiet window:
tail as is, and tail with the five speech words removed from the list. If the
second column passes more, trim the list in all three copies (`Current
Scene`, `Submit Video Regen`, and the segmenter's rule 6).

### 1e. Later: predict a refusal before paying for it

A `gpt-4o-mini` vision call per approved still — *face visible? person
mid-speech? child?* — surfaced as a badge at the image gate. Cheap per still,
but it is a site change plus a Media Generation change, and 1a–1c should move
the number first.

---

## Part 2 — the tail

### 2a. Work stealing, by copying the still

**Nodes:** `Pool Tick`, `Pool Record`, `Submit Video`; five new nodes on the
pool row. Everything else on the clip chain is untouched — which is the
point, since eleven nodes read `$('Current Scene').first()` and the pool's
one-action-per-tick shape exists to keep them unambiguous.

Why it is possible at all: the mechanism that copies an asset to another
account already runs on every film with cast sheets —
`Download Sheet → Upload Sheet To Account` (`POST /v1/google-flow/assets/{email}`,
the path form, returns an id minted on the target account) — and
`GET /v1/google-flow/assets/{mediaGenerationId}` mints a fresh signed URL for
any asset at any time (`db/port/sheet-backfill/`). A steal is those two calls
on the scene's start frame, then an ordinary submit on the idle account.

`Pool Tick`, in the branch where no queued scene fits an account with room:

```
if (queue is non-empty && some account has room && the source account still
    has >= 2 queued scenes)
  action = { kind: 'steal', id: oldest queued scene on the busiest account,
             from: its account, to: the idle account }
```

New row: `Pool Steal?` → `Steal Fresh Url` (GET assets/{imageId}) →
`Steal Download` (file) → `Steal Upload` (POST assets/{to}) →
`Steal Record` (stash `pool.stolen[id] = { image: newId, account: to }`,
move the scene's queue entry to `to`) → `Pool Tick`. The next tick submits it
like any other scene.

`Submit Video` gets one more `try {}` block in its existing chain: if
`pool.stolen[cs.id]` exists, `startImage` is the copied id, `email` is `to`,
and `endImage` is dropped (the end frame lives on the original account;
`endFrame` is opt-in and off by default anyway). `Pool Record`'s submit
branch already reads the account off the scene item.

**Nothing is written to the scene row.** `Image Media ID` stays the original;
the copy is a transient Flow asset that the film never looks at again. The
clip is downloaded and re-hosted exactly as any other. Consistency cost: none
— the n-1 palette reference is an IMAGE-phase concern, and clips only use
their own start frame.

Guards: never steal the last scene on an account (a race with that account's
own next submit); respect `per` on the target; log every steal as
`POOL steal <id> <from> → <to>`. Cost per steal: a download and an upload,
seconds. It only fires in the tail, so the first 50 minutes of a film are
unchanged.

Expected on this film: the last 14 clips spread across three accounts,
roughly 20 minutes instead of 55.

### 2b. Then, and only then, two jobs per account

`videoPoolPerAccount: 2` is still unmeasured. With the tail gone it becomes
the only lever left, and the question — does one account hold two Veo
generations at once without the second being throttled — is a single
disposable film at `per: 2` with submit-to-land timed per clip against this
film's 86 s. Do not raise it before 2a lands; on today's shape it would only
deepen the tail.

### 2c. Deliberately not changed

- **Blocks stay contiguous.** Round-robin would spread a chapter's refusals
  across accounts, but it breaks the n-1 palette reference for every scene
  (a reference from another account is dropped by `Generate Scene Image`'s
  remap), and image consistency is worth more than the tail 2a removes
  anyway.
- **Images stay serial.** `POST /images` refuses `async`, and this film
  measured images + voices at 55 min against 105 for clips, so the ceiling
  on parallelising them is a third of the machine time for the 38-node tail
  duplication `etapa3.md` prices.
- **One action per tick.** The eleven `$('Current Scene').first()` readers.

---

## Order, and what proves each step

| # | step | touches | proof |
|---|---|---|---|
| 1 | 1b seed | `Current Scene`, `Prep Video Regen` | 3 seeds on still `e09a4e10` in a quiet window; any pass → keep attempt 1 |
| 2 | 1a ladder | `VP *`, `Submit Video`, `IR Build Request`, +4 nodes | a disposable film with a still known to be refused; note reads the right advice; ≤ 3 generations per refused scene |
| 3 | 2a stealing | `Pool Tick`, `Pool Record`, `Submit Video`, +5 nodes | a disposable film with deliberately uneven blocks; `POOL steal` lines; zero `Email mismatch`; last quarter of clips no slower than the first |
| 4 | 1c faces/speech rule | `Segment Chapter Into Scenes` (+ switch in `derive.ts`) | the next photorealistic real film: refusal rate and the producer's eye, side by side |
| 5 | 1d, 1e | measurements | numbers before any change |
| 6 | 2b `per: 2` | `Editing Options` only | submit-to-land per clip vs 86 s |

Targets, re-measured with the queries in `etapa3.md` on the next real film:
refusal rate under 15% (from 41%); the last quarter of the clip phase no
slower per clip than the first; 86 s per clip held to the end.

Every node body comes from a committed file in `paste/` here, every publish
is diffed against the version it was built on with `--expect`, node settings
compared by hand, and nothing is published over a running batch's regen path
without checking `search_executions` first. The two decisions above (D1, D2)
are the producer's, and steps 2 and 4 wait on them.
