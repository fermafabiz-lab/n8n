# The story ends on a resolution, not on its climax (2026-09-16)

Status: **APPLIED and LIVE** — Claude Scripting `gkEtGMecv4TC3ZHp` active
`31e37b3c-bae4-4564-bd90-1a2720b60ffd` (was `6e21cddc-7c4a-45d6-a915-bdf0f24d1304`),
Final Assembly `BY22Vlhh20Xdkr5Z` active `450fa910-fbac-43f9-8c45-f897f4259976`
(was `559cde3c-271c-4dd1-9511-04d089b8ff0e`). Published 14:03 UTC, nothing running.

The producer, four days after the 09-12 ending fix: *"la noi nu prea au
concluzie, mai ales povestile se termina brusc — poti sa repari si aia pt
story si kids story?"*

## What was measured

`probe-endings.sql`, run through a throwaway workflow (`a9HzPzlUdaFkKpqX`,
archived): the live `genre_profile` rows and the tail of the last chapter of
every film since 09-05. Of the four Story / Kids films written AFTER the
09-12 fix, two land (the coffee shop and the law-firm IT desk — both
Motivational/Corporate, whose beat 5 asks for a stated payoff) and **two end
ON the climax**:

| film | last sentence |
|---|---|
| Lego chase (`recfpdoAt59JtXTNc`, Dramatic) | *"The cuffs click shut under police lights. The Ferrari stays at the shattered gate, and Marco's road out of Brick City ends under the barrier Jack dropped."* |
| Clay builders (`recYQ21DPmAyChlA7`, **kids**, tone Dark) | *"Bramble and Wisp answer from behind the clay. The homes are finished, and Moss is the only one left outside."* |

The first is the arrest; the second leaves two of three children's characters
shut inside a house. Both pass the 09-12 guard, because that guard tests the
SHAPE of the last sentence (a trailing camera clause) and these are
statements. Nothing in the pipeline asked for what comes AFTER the last
turning point — the deznodământ of the structure the producer had just asked
me to verify — and the writer's rule 15 lets "the last event and its
consequence" be one clause glued to the climax.

Two more findings from the same probe:

- **Both kids films so far were made under the Dark profile**, whose beat 5
  is *"Aftermath, not resolution. Something remains."* That beat shapes the
  outline; kids rule (e) ("a warm ending with a gentle lesson") only reaches
  the writer, so the structure won. Same class as the 09-12 lesson: two
  prompts that are each right on their own, contradicting each other.
- **The last scene ended 0.35 s after the last word**, then the flash and the
  end screen — the montage's between-scenes breath, wrong after the last one.

## What changed

Six nodes, all built by `build-paste.mjs` from `original/` so the diff is
exactly the insertion, and exercised by `check.mjs` (62 checks) before the
apply.

Claude Scripting:

- **`Voice Mode`** — one owner for the resolution rules, four consumers.
  `closing: { wanted, kids }` is true for `category` story, kids or absent
  (the site's default) and never for cinematic or documentary. It composes
  `closingOutline` (the beat and, for kids, *"this REPLACES beat 5 of the
  dramatic structure above whatever it says"*), `closingOutlineLine` (a
  third `RESOLVES WITH:` line on the last chapter), writer rule 17 appended
  to `narrationRules`, editor rule 4c, and a resolution-scene rule appended
  to `segmentRules`. Every other category renders byte-identical prompts
  (`check.mjs` asserts it).
- **`Generate Outline`** — two injection lines: after the DRAMATIC STRUCTURE
  block, and after the `LEADS INTO:` spec.
- **`Edit Full Narration`** — one injection line after rule 4b.
- **`Narration Guard`** — inside the same gate as the ending check: the last
  chapter must end on a SEPARATE final paragraph of 2–3 sentences, 18–45
  words, naming the protagonist (the head of the spine's `protagonist`
  field, before any comma). Feedback into the existing editor retry, never a
  hard failure; skipped for silent and dialogue films like every other check.
- **`Plan Scene Splits`** — for the last chapter of a story, the final
  paragraph is cut off BEFORE chunking and becomes the film's last scene
  (one scene up to 32 words, `planChunks` above that). No paragraph break,
  a runt tail, or a non-story film → exactly the old chunking.

Final Assembly:

- **`Build Timeline`** — `gapSeconds` on the LAST VOICED scene: 1.5 s for a
  Story (or an absent category), 2 s for a Kids story, untouched otherwise.
  Through the per-scene override `/assemble` already clamps to [0, 2] — no
  Railway push.

## Decisions

- **45 words in the guard, 32 in the scene.** A resolution of 33–45 words
  becomes two shots (the story test film below did exactly that: 34 words →
  scenes 107 + 108). Tightening the guard to 32 would cost an editor pass on
  what the models naturally write (both test films came in at 33–34), and a
  34-word single scene is 13.6 s of voice over an 8-second clip — the frozen
  frame the ceiling exists to prevent. Two settled shots beat either.
- **Warmth is asked, not measured.** The kids override lives in the outline
  and writer prompts; the guard checks shape and the protagonist's name
  only. A regex for "warm" would be the kind of check that fires on a clean
  draft.
- **Documentary keeps its open question, cinematic its last shot.** The
  producer named story and kids; those two genres' structures end that way
  on purpose.

## Verified — two disposable films, 2026-09-16 14:04 UTC

Created through the real `new-project` webhook (runner `IBEpkVXcVCy1To2w`,
archived), 60 s each, `auto_approve: no`; scripts approved by SQL so the
segmenter would run (runner `s4OlDTpfFOECIVaN`, archived); scenes read back
(runner `TgMjqETdwmA9afGE`, archived). Nothing past segmentation was spent.

**Story** — `recZHr8go7vcYiQZp`, Dramatic, *"A lighthouse keeper's dog runs
off in a storm…"*, scripting `13925`, script at 14:05:56 (82 s). The plan's
last chapter carries `RESOLVES WITH:` and the narration ends:

> Before they can clear it, the sea takes the crossing.
>
> That night at the lighthouse, Tomas reports Mara and Bran alive on the
> island and cut off until morning. Bran is back with her. The way out is
> gone until the sea gives it back.

Scenes 101–106 are the story, 107–108 the resolution paragraph (34 words,
two chunks); the segmenter wrote 108 as *"A wider, settled final shot lands
the resolution inside the lighthouse kitchen."*

**Kids** — `rec78haMNefc8xaWs`, **tone Dark on purpose** (the clay-builders
case), clay style, scripting `13927`, script at 14:06:09 (95 s). Under the
profile whose beat 5 is "Aftermath, not resolution", the film ends:

> The patch holds long enough for all three to crawl inside the only roof
> left.
>
> A little later, the cold has settled, but Marn, Pip, and Tilla are safe in
> the same shelter. Marn leaves his trowel in the wall, and next build they
> will start together.

Scene 107 is that paragraph verbatim, its own scene — *"A calmer wider shot
looks in through the doorway of the surviving shelter, where all three
builders sit close beneath the single roof."* Nobody left behind.

Both scripting executions sit in `Wait For Scene Approval`, as every
unapproved film does; the two projects are disposable and can be deleted.

## What is owed

- **The hold has not been heard.** No render was made; the 1.5 s / 2 s is a
  number chosen, not tuned. Watch the first real Story film's last two
  seconds and the end-screen flash after it.
- **A real film through the producer's own approval.** The test scripts were
  approved by SQL; the site's approve path keeps paragraphs (`Save Script`
  joins with `\n\n`, `Parse Approved` trims only), but a producer who edits
  the script in the textarea and joins the last paragraph onto the climax
  gets the old chunking, silently. Worth one look.
- **The `Rewrite Script` path (producer rejects the script with feedback)
  still receives neither the spine nor these rules** — a rejected-and-
  rewritten story can lose its resolution. Same gap as before this change.

## Rollback

`restore_workflow_version` to `6e21cddc-7c4a-45d6-a915-bdf0f24d1304`
(Claude Scripting) and `559cde3c-271c-4dd1-9511-04d089b8ff0e` (Final
Assembly), or `update_workflow` the six bodies from `original/` and publish.
`Claude Scripting.before.json` / `Final Assembly.before.json` are the exact
drafts built on (both had no parked draft: `versionId == activeVersionId`);
`*.after.json` are the drafts as published, every body byte-identical to
`paste/` (checked with `node-body.mjs` + `cmp`), node-by-node diff with
`diff-workflow.mjs --expect` OK on both.
