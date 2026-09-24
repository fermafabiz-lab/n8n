# The approved script is the film — 2026-09-24

**What the producer saw**: *"On the last project I changed the script
completely and it built the scenes from the old script."* They were exactly
right, and the pipeline gave no sign of it.

## What happened, measured

Film `recCrWO2ummZA4Ba4` ("De ce motorul are limitator de turație?"),
2026-09-24:

| | |
|---|---|
| 08:51:51 | the pipeline wrote its script and parked at the gate |
| 08:54:42 | the producer **replaced** the script text and approved it |
| 08:55:55 | 12 scenes were written — **from the old script** |

The proof is in one row. `hov.script.content` (the approved text) says
**7.000 RPM** and carries no `[CHAPTER n: title]` lines. `hov.script.chapters`
(the JSON the pipeline built earlier) says **5.000 RPM**. Every one of the 12
scenes says 5.000, and scene 1 is chapter 0's `narrator_script` word for word:
*"Turația motorului: 5.000 RPM controlat."*

## Why

`Parse Approved From Airtable` (Claude Scripting) is the node that turns the
approved text back into chapters. It split the text on `[CHAPTER n: title]`
marker lines, and:

```js
for (const block of blocks) {
  const h = block.match(/^\[CHAPTER\s+(\d+)\s*:\s*([^\]]*)\]\s*\n?/i);
  if (!h) continue;                    // a block with no header is dropped
  …
}
if (chapters.length === 0) {
  chapters = original.map(…);          // ← the OLD chapters, words and all
}
```

A producer who REPLACES the script — pastes their own text, rewrites it by
hand — does not reproduce the marker lines. Every block then fails the header
match, `chapters` comes out empty, and the node answers with the previous
chapters. From there the whole pipeline is consistent and wrong: scenes,
image prompts, narration, clips and the final film all tell the old story,
while the script on screen shows the new one.

**Three doors lead into it**, which is why the fix belongs in this node and
not at the doors: the producer's own edit, an AI rewrite that drops the
markers (`Rewrite Script` asked for them but an instruction is not a
guarantee), and any future writer of `Script Content`.

## The fix — Claude Scripting `191f8d41` and `fb126663`, live 2026-09-24

**The rule this node now keeps: the approved TEXT is the film. The stored
`script chapters` JSON is a skeleton — numbers, titles, relative lengths —
and its words may never reach the screen.**

1. Markers present → parsed exactly as before. Nothing about the happy path
   changed.
2. Markers absent, text present → the chapters are rebuilt **from that text**,
   cut into the old skeleton's shape: same chapter numbers, the same relative
   lengths (a two-line hook stays a two-line hook), every summary dropped
   because the beats describe a story that no longer exists, and **the titles
   dropped too** — `chapterTitles` is passed into the render and printed on the
   chapter cards (`remotion/src/FinalVideo.tsx`), so a kept title is old words
   ON SCREEN over the new film. Empty is safe because the render already has a
   fallback: a key line taken from the scene's own narration.
   The cut only falls between the producer's own paragraphs — never inside a
   sentence — falling back to lines, then to sentences, for prose with no
   blank lines. `scriptChanged` is forced true, so the Story Bible is rebuilt
   and the pictures follow the new story.
3. Text empty → the stored chapters are kept. This is the only legitimate
   fallback left, and it says so in the log.

Every path logs. `SCRIPT PARSE <script id>: markers|plain|stored, N chapters,
N words, scriptChanged=…` on each run, plus a loud `SCRIPT NO MARKERS …` line
whenever case 2 fires.

`Rewrite Script`'s prompt got the second half: the markers are stated as a
rule, the model is asked to count them in its draft before answering, and the
consequence is named — the shape measured on 2026-09-19 to be the difference
between a cap that is obeyed and one that is not (`docs/lessons-pipeline.md`,
"A word cap is obeyed or ignored according to how it is PHRASED").

And the site says it before the producer presses anything: `ScriptReview`
warns when the stored text had markers and the text in the box no longer
does — a warning, not a refusal, because approving is now safe.

## Verified

- `node db/port/script-headers/check.mjs` — 23 assertions over the committed
  body, including the real film's shape: no old words survive, every word is
  the producer's, the skeleton's numbers and titles are kept, no chapter is
  cut mid-sentence, and the happy path is unchanged.
- The committed body run against the REAL row of `rechCbevToUf5KL86`: 2
  chapters, 156 words, `7.000` present, `5.000` gone, `scriptChanged=true`,
  both log lines printed.
- The node body was byte-identical in all six committed dumps of Claude
  Scripting from 09-08 to 09-16, and execution 16426 (09-23) shows the live
  node emitting exactly that code's shape — so the version this was written
  against is the version that was live.

## What is owed

- One real film that replaces its script end to end, with the finished video
  watched. The fixtures prove the chapters; nobody has yet heard the result.
- The damaged film itself: 12 wrong scenes, but **0 images, 0 voice, 0 clips**
  — it was caught at the scene gate before anything expensive ran. The route
  back is Pause, then "⟳ Restart writing", then paste the script again at the
  gate. Keep a copy of the text first: a restart rewrites `script.content`.
