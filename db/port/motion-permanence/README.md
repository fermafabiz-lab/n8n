# The clip that fills eight seconds with things nobody asked for (2026-09-13, evening)

The producer, on a clip from the café film `recXibIyVuLvMIqy3`:

> personajul ia ceva in mana apoi dispare, usa la frigider se deschide singura,
> bate vantul peste acele foi lipite ce nu are sens ca nu bate vantul in cafenea,
> usa de la camera se inchide singura, personajul ia acel teanc de foi pleaca cu
> el apoi se intoarce nenatural

Every one of those is real. I pulled the 8-second clip apart at 4 fps and watched
all 34 frames.

| t | what happens |
|---|---|
| 0.25s | she reaches for a stack of cup sleeves on the LOW shelf |
| 0.75s | her hand closes on it — **and the stack is gone**, hand empty, she turns away |
| 2.25s | she reaches again, this time for the MIDDLE shelf: **the same action, performed twice** |
| 3.25s | **the sheets taped to the fridge detach and flutter in mid-air**; the left fridge door stands open |
| 4.25s | she has the stack, walks right; papers back on the fridge, door shut |
| 5.25s | she walks away from camera toward the door — **the stainless prep table has vanished** |
| 6.25s | **the table is back**, in a slightly different place; the back door has swung |
| 7.25s | **she has turned round and is facing camera again**, holding the stack; the bib of her apron is gone |
| 8.00s | bib apron back on |

So: one held object vanishing, one action performed twice, phantom wind indoors, a
fridge door and a room door moving with nobody near them, a table popping out and
back, a wardrobe flicker, and a walk-away-and-return. In eight seconds.

## None of it was the model being random. The prompt asked for most of it.

This is the scene's stored `hov.scene.motion_prompt`, verbatim:

> Hard tracking shot left to right as Maya Ortiz **reaches to the shelf, strips off
> the last sleeve stack, and pivots back toward the swinging door**. Fluorescent
> prep-room light stays cold and static while **loose paper edges quiver from her
> movement**, photorealistic, Motivational mood, cinematic. Negative: no on-screen
> text, …; **nothing travels against the flow — no oncoming vehicles, nobody walking
> or driving the wrong way, no reversed motion; no subject appears, disappears,
> duplicates or changes identity.**

Read against the frame table that is not a coincidence:

- **"loose paper edges quiver from her movement"** → the papers taped to the fridge
  fly off. The producer is right that no wind blows in a café. The prompt asked for
  the wind.
- **"the swinging door"** → the door swings. Veo animates the adjective.
- **three actions chained into eight seconds** ("reaches … strips off … pivots back
  toward the door") → the model has more to do than fits, so it does the first one
  twice, loses the object in between, and walks out and back.
- **"no subject appears, disappears, duplicates"** → the subject's object disappears,
  the table disappears and duplicates in time. Naming a failure in a negative is the
  documented way to summon it (see below).

## Three prompt copies, and my afternoon fix only reached one

At 16:42 the same day I removed the contradictory continuity clause from Media
Generation's `Current Scene` and `Submit Video Regen` (see `../veo-direction/`).
That was one of **three** places the text lives. The other two are both inside the
segmenter's rule 6 in Claude Scripting, which writes `motion_prompt` into Postgres
when the scene is first created:

```
(c) Context: the ambient/atmospheric motion of the environment (drifting steam,
rippling water, flickering light, moving crowd, blowing dust). Everything else that
moves travels the SAME way as the subject unless the narration says otherwise …
Then append this exact negative clause at the end: "Negative: … nothing travels
against the flow — no oncoming vehicles, nobody walking or driving the wrong way,
no reversed motion; no subject appears, disappears, duplicates or changes identity."
```

So a clip generated after 16:42 carries **my new positive clause AND the old
contradictory one**, because the old one was baked into the database row hours
earlier. The fix was half a fix, and this is the "several copies in lockstep" trap
CLAUDE.md warns about, in the concrete.

Measured across this one 16-scene film:

| | scenes |
|---|---|
| carry the old contradictory negative tail | **16 / 16** |
| ask for invented ambient motion (quiver, flutter, drift, ripple, blowing…) | **9 / 16** |
| label a prop with a motion word (swinging, sliding, flapping) | **3 / 16** |

It is not one bad scene. Rule 6 mandates ambient motion on *every* shot, and in a
room with nothing to move the model invents something — usually paper.

## The negations were making it worse, mine included

Google's own Veo prompting guidance is explicit: **do not use instructive language
like "no" or "don't"** ("no walls", "don't show walls") — describe what you *don't*
want as a bare noun list instead, because naming a thing in a negative makes the
model more likely to render it.

Our prompts were almost entirely that anti-pattern. Worse, so was the clause I added
that same afternoon:

> nothing floats, melts or morphs; **nobody and nothing appears, disappears or
> duplicates**

We were writing "disappears" and "duplicates" into the positive prompt and then
getting exactly that. Both tails are now positive world-statements plus a single
trailing noun list.

## 2026-09-13 — the fourth copy: `VP Rewrite AI` was laundering the old tail back in

Three copies of the prompt text were fixed above. There is a **fourth**, and it is
the one that writes to the database rather than reading from it.

`VP Rewrite AI` (Media Generation) is the automatic repair for a scene the Google
video filter refuses: `VP Prep` reads the stored `Video Scenă URL`, the model
rewrites it, and `VP Apply` **writes the rewrite back onto the scene row**. Its
system prompt said, verbatim:

> Keep the camera move, scene intent, location, mood **and the trailing Negative
> clause EXACTLY**; change only what triggers the refusal.

So every content-filter refusal took the old contradictory tail and re-committed it
to Postgres, under a fresh `AUTO-REWRITE-VIDEO` note — the one path that could
re-introduce the tail after a strip. It fired on scenes 1, 2 and 4 of the café film,
which is why those three rows carry it with a rewrite note attached.

Worse, it preserved the tail while being blind to everything that actually broke the
clip: a prompt chaining three actions came back still chaining three actions, because
the only instruction was "change only what triggers the refusal".

What changed, in `paste/VP Rewrite AI.txt` (original kept at
`original/VP Rewrite AI.txt`):

- The Negative-clause preservation instruction is **gone**. The rewrite must now be
  the ACTION ONLY, and the prompt says so twice: drop any trailing `Negative: …`
  clause it is handed, and never write one. The guardrails are composed at submit
  time by `Current Scene` / `Submit Video Regen`, so a stored tail is duplicated at
  best and contradictory at worst.
- The four shot rules from rule 6 are now in the rewrite prompt in the same wording:
  ONE ACTION not a sequence, held objects stay in the hands to the end of the shot,
  no invented ambient motion and no weather indoors, and no motion adjective on a
  prop ("the door", never "the swinging door").
- Untouched: `gpt-4o-mini`, `temperature: 0.4`, the two-message shape, the
  attempt >= 2 escalation block, the user message, every `$('VP Prep')` reference,
  `options.timeout`. Verified byte-identical from the escalation ternary to the end
  of the expression (733 chars either side).

Note the one path this does NOT reach: if the model returns an empty choice,
`VP Apply` falls back to `$('VP Prep').first().json.prompt` — the stored prompt,
legacy tail and all. Harmless now only because `Current Scene` strips the tail at
submit time; if that strip is ever removed, fix the fallback first.

## 2026-09-13 — the fifth and sixth copies: the two per-scene text rewriters

`Rewrite Scene Text` and `Rewrite Scene Standalone` (both Claude Scripting,
both `httpRequest` → `api.openai.com/v1/chat/completions`) held the **third
literal copy** of the old negative tail — a shorter one than the segmenter's,
which is why a grep for the segmenter's exact wording missed them.

Read the name and you would guess they only touch narration. They do not.
Both ask for **all four** scene fields and both write `video_motion_prompt`:

- `Rewrite Scene Text` → `Parse Scene Rewrite` (the batch text-regen path,
  fed by `Split Text Regens`), which emits `video_motion_prompt`;
- `Rewrite Scene Standalone` → `Write Scene Rewrite` (the `scene-text-regen`
  webhook, one scene), which PATCHes `Video Scenă URL` — the motion prompt
  field — with it.

So a producer clicking "regenerate this scene's text" was silently rewriting
the motion prompt as well, and rewriting it **with the old rules**: the spec
read

> video_motion_prompt: 25-45 words Veo prose (one named camera move, subject
> performing a small natural motion, **ambient environmental motion**, style)
> ending with this exact clause: "Negative: **no** on-screen text, **no**
> subtitles, … characters do not speak — **no** lip movement, **no** dialogue;
> **ambient/atmospheric motion only**."

which is root cause #1 (ambient motion MANDATED, twice) and root cause #2 (an
all-instructive negative) in twenty-eight words. Every per-scene text regen
undid the segmenter fix for that scene.

What changed: in both nodes the `video_motion_prompt:` spec is replaced with
rule 6 (a)-(d) in **rule6.txt's own wording**, lifted verbatim — ONE ACTION
not a sequence, direction is not optional, held objects stay in the hands,
context only when something in the shot causes it and no weather indoors,
nothing untouched moves, no motion adjective on a prop — closing with the
canonical trailing NOUN LIST. Eleven canonical fragments were checked
byte-for-byte against `paste/rule6.txt`.

Three deliberate deviations from rule 6, all forced by where these nodes sit:

1. **"the still" → "the image_prompt".** Rule 6 writes a motion prompt for an
   image that already exists. These two nodes rewrite the image_prompt in the
   SAME call (`Write Scene Rewrite` sets `Status Producție Scenă` back to
   `Generare Script`, so the picture is regenerated), so the referent has to
   be the prompt being written, not a frame that is about to be replaced.
2. **(d) Style & ambiance does not interpolate `Style` / `Tonalitate`.**
   Rule 6 can, because the segmenter runs downstream of
   `$('Receive Project Data')`. Neither rewriter has that node in scope, and
   adding a new `$(…)` reference to a live expression is exactly the kind of
   edit that dies at runtime, so (d) says to keep the style and mood words the
   current motion prompt already ends with. `Rewrite Scene Standalone` is also
   handed `TONE:` in its user message already.
3. **"vary the move across consecutive scenes" is dropped** — there are no
   consecutive scenes here, only one. The move still has to be one named
   cinematographic move from the bible's camera style.

Untouched in both: `model: 'gpt-5.4'`, `response_format: { type: 'json_object' }`,
the two-message shape, the entire user message with every `$('Choose Bible')` /
`$('Load Project Bible')` / `$('Load Scene')` reference and every `\n` escape,
the `image_prompt` and `visual_scene_description` specs, the
`narrator_text`/`visual_scene_description`/`image_prompt`/`video_motion_prompt`
key contract that `Parse Scene Rewrite` and `Write Scene Rewrite` destructure,
and `options.timeout: 120000`. Verified: byte-identical prefix (847 / 843
chars) and suffix (520 / 1048 chars) either side of the one replaced span.

**The two nodes escape quotes differently and that was preserved.**
`Rewrite Scene Text` writes the clause delimiters as `\"` inside its
single-quoted JS string; `Rewrite Scene Standalone` writes a bare `"`. Both
evaluate to the same character. The new text follows each node's own house
style, so the two files are NOT interchangeable — after unescaping, the two
specs are identical (3423 chars each), which is the check to re-run if either
is ever edited again.

Both files carry NO trailing newline, unlike `paste/Submit Video Regen.txt`.
Strip any trailing whitespace before the PUT either way.

Each was verified by evaluating the `{{ … }}` body with stubbed `$` / `$json`,
`JSON.stringify`-ing the result and parsing it back: two messages, the
`json_object` response format intact, real newlines still present in the user
content.

**Still writes a trailing `Negative:` clause, unlike `VP Rewrite AI` above,
and that is on purpose.** rule6.txt tells the segmenter to append it, so a
rewritten scene now reads the same as its neighbours in the site's textarea.
It is inert either way: `Current Scene`, `Submit Video Regen`, `Motion Prep`,
`End Frame Prompt` and `RG Motion Prep` all split on `/\s*Negative:\s*/i` and
keep only the head. If that strip is ever removed, these two and rule 6 have
to drop the append in the same commit.

## 2026-09-13 — the wardrobe flicker: an under-specified apron is two aprons

The same clip carried a seventh fault the frame table above records but the prompt
fix does not touch: at 7.25s **the bib of the barista's apron is gone**, and at 8.00s
it is back. Nothing in the motion prompt caused that one — the wardrobe description
itself was ambiguous.

The scene's `image_prompt` said, of the apron, only:

> forest-green short-sleeve coffee shop apron

A colour and a sleeve length. Nothing about whether the apron has a **bib** or is a
**waist** apron, which are two different garments. That string came from the story
bible's `characters[].visual_description`, and it satisfies the old rule 3 completely
("exact clothing (colors, materials)") while leaving the cut entirely open.

### The look IS stored once and reused — that part was never broken

| step | node | what it does with the wardrobe string |
|---|---|---|
| authored | `Generate Story Bible` / `Rebuild Story Bible` (Claude Scripting) | writes `characters[].visual_description` — the ONLY place a garment is described |
| stored | `Save Story Bible` / `Save Rebuilt Bible` | `hov.project.story_bible` |
| drawn once | `Cast Sheet Prep` (Media Gen) | turnaround/portrait sheet from `desc` verbatim |
| pasted per scene | `Segment Chapter Into Scenes` rule 2, `HR Shots Prompt` rule 2, both scene rewriters | "PASTE its full visual_description into that prompt" |
| attached per scene | `Build Image Request`, `IR Build Request`, `Evaluate Image Approval` | the sheet as `reference_*`, "EXACTLY that … wardrobe" |
| checked | `Judge Prep` / `Judge Verdict` | scores `wardrobe`, rerolls under 0.6 |
| carried to the end frame | `End Frame Prompt`, `RG End Frame Prompt` | "same wardrobe" as the start frame |

So this is the GOOD shape — one string, reused everywhere — and that is exactly why an
ambiguity in it is expensive: **every consumer resolves it independently.** The cast
sheet settles on one reading, the scene still settles on another, the end frame on a
third, and Veo, handed a start frame and an end frame that disagree, interpolates
between a bib apron and a waist apron. The flicker lands at the END of the shot, which
is where the end frame lands.

### What changed

Rule 3 of both bible prompts, and nothing else in either node:

- head list `exact clothing (colors, materials)` → `(colors, materials, cut and fastenings)`;
- a new clause after the existing "Same for wardrobe" sentence: NAME EVERY GARMENT DOWN
  TO ITS CUT AND ITS FASTENING, with the concrete axes (bib vs waist apron; buttoned,
  zipped or open; collar; sleeves rolled or not; trousers/skirt; laced or slip-on; hair
  up or loose and how it is tied; what is worn over what), the reason stated as the
  mechanism ("every model that reads this line settles the difference again on its
  own"), the café apron as the worked example, and the operational test — two
  illustrators given only this sentence draw the same clothes — plus the reminder that
  the sentence is pasted VERBATIM into every scene the character appears in, "so it has
  to be worth repeating".

`paste/Generate Story Bible.txt` and `paste/Rebuild Story Bible.txt` are the full `text`
parameters (leading `=` included, no trailing newline), originals in `original/`.

**They are a LOCKSTEP PAIR, not two owners — publish both or neither.** Rule 3 was
byte-identical in the two nodes before this change (1236 chars) and is byte-identical
after it (2320 chars); `Rebuild Story Bible` is the same author reached by a different
door (the producer rewrote the script), so a fix applied to one door only means a
rebuilt bible quietly goes back to under-specified wardrobe. Verified per node: every
`{{ }}` expression preserved and in the same order (13 and 5), prefix and suffix
byte-identical either side of the single replaced span (4415/1306 and 2356/1194 chars),
rules 1-6 still numbered 1-6.

**This fixes new films only.** A bible already in `hov.project.story_bible` keeps its
ambiguous string, and nothing re-reads the rule for it. The café film's own apron stays
ambiguous unless its bible row is edited by hand.

## 2026-09-14 — a re-roll was a new seed against a byte-identical brief

The judge scored six signals, `Motion Verdict` wrote its prose under
`sd.motionNotes` — and **nothing in either workflow has ever read that key.**
It was not reset by `Sort & Cap Scenes` either, unlike `sd.consistencyNotes`,
so it accumulated across films purely as dead weight. (That half is fixed as of
2026-09-14: `Sort & Cap Scenes` now prunes both `sd.motionRerolls` and
`sd.motionNotes` on every pass, batch keys only. The key is still write-only —
the correction below is built from the GATE list in `problems`, never from the
judge's prose.) A clip rejected because
a held object left the subject's hands was sent back to Veo with the exact
sentence that produced it, differing in `seed` and — on a `morph` verdict —
in the absence of `endImage`. Nothing the judge learned reached the model.

### The correction is restated as a positive requirement, by a literal map

The judge writes **faults**: *"the sleeve stack disappears from her hands"*.
Quoting that into a Veo prompt is the anti-pattern the whole of 2026-09-13 was
spent removing — our own tail saying *"nothing appears, disappears or
duplicates"* is what produced a disappearing object. Two shapes were on the
table and **(a), the fixed map, was chosen**:

- **(b) a second model call** rewriting each fault into a positive requirement
  is more faithful to the specific fault, and it puts a generative step between
  the judge and Veo exactly where a leaked negation is invisible until a
  producer watches the film, adds a call that can time out inside what is
  already a retry, and spends latency saying what the fault CATEGORY implies.
- **(a) SIGNAL → positive clause.** The signals are a closed set of six written
  by `Motion Verdict` two nodes upstream, and each names a failure MODE, not an
  incident: `permanence` is always "something stopped being there", whatever the
  thing was. So the clause is authored once, by hand, in WORLD_RULES' own
  positive voice — and **being a literal it cannot smuggle a negation**, which
  is the only property that matters here. It gives up specificity ("whatever the
  subject is holding" rather than "the sleeve stack"); Veo is handed the start
  frame, so the thing is in front of it anyway.

A runtime `UNSAFE` regex withholds and logs any clause carrying an instructive
negation or a fault noun, so the rule is executable rather than a promise in a
comment — the next session adding a seventh signal edits a plain object literal.
All six clauses pass today, 26–39 words each (permanence 39, untouched 33, direction 32, coherence 29, morph 29, loop 26), capped at **3 per re-roll**
(~107 words; the café clip's own count was three: permanence, untouched, loop).
The cap is the knob if re-rolls come back worse.

**The key names lie, and that matters here.** `Motion Verdict` sends
`problems: bad` — the GATE list (`['permanence 0.3', 'untouched 0.4']`), not the
judge's prose. Both resubmit nodes read the FIRST WORD of each entry and nothing
else, and re-check `morph`/`loop` off their own booleans so a partial or older
verdict payload still corrects what it can.

### Four nodes, and the two paths compose the prompt in different places

| node | file | what changed |
|---|---|---|
| `Motion Resubmit` | `paste/Motion Resubmit.js` | composes the whole replacement prompt; emits `prompt`, `basePrompt`, `correction` |
| `Submit Video` | `paste/Submit Video.txt` | one added clause inside the existing `$('Motion Resubmit')` try-block |
| `RG Motion Resubmit` | `paste/RG Motion Resubmit.js` | overrides `motionPrompt` on the payload; emits `baseMotion`, `correction` |
| `Submit Video Regen` | `paste/Submit Video Regen.txt` | the motion-prompt source becomes a resolver |

`Current Scene` composes the batch prompt ONCE into `videoRequest.prompt` and
freezes it, and `Submit Video` copies that object wholesale and has never read a
prompt from anywhere else — so the batch correction has to be a whole
replacement prompt plus a one-line override there. **Without the `Submit Video`
edit, `Motion Resubmit` is a no-op**: the seed and the end-frame drop still work,
the correction is composed, logged and thrown away.

`Submit Video Regen` composes its guardrails itself on every submit around
`$json.motionPrompt`, so the regen correction only joins the ACTION — landing in
the same slot the producer's `ADJUSTMENT REQUEST — the new video MUST follow
this: …` lands in from `Evaluate Video Approval`, which it preserves. **No fourth
copy of WORLD_RULES appears anywhere.**

**The correction is INSERTED at the first `Negative:` boundary, never appended.**
Appending would put it inside the trailing noun list — the same mistake
`Evaluate Video Approval` made with the producer's note. The boundary is read as
an index so everything from that token on survives byte for byte. It sits after
WORLD_RULES rather than beside the action deliberately: the action/WORLD_RULES
seam is only findable by matching `Current Scene`'s literal wording, a silent
coupling to a string that changes, while `Negative:` is a token every composer
here already agrees on. A head of nothing (a bare legacy tail) falls back to
today's behaviour — new seed, prompt untouched — rather than submitting a
correction with no shot attached.

### Two staleness guards, because both submit nodes read with `.first()`

`.first()` returns a node's LATEST run, not the run belonging to the item in
hand, and the scene id alone is not enough to tell those apart:

- **batch** — `Current Scene` runs a SECOND time for the same scene when
  `VP Reload Scene` re-enters it after the video filter refuses a prompt. Scene-id
  matching alone would resurrect a correction built on the REFUSED prompt and undo
  the rewrite that exists to get past the filter. `Submit Video` therefore applies
  the override only when `m.basePrompt === r.prompt`.
- **regen** — `Regen Resubmit Guard` and `Regen Cooldown Guard` both re-feed
  `Prep Video Regen`'s payload, so a filter refusal or a 429 after the re-roll
  arrives carrying the UNCORRECTED prompt while still picking the new seed out of
  `RG Motion Resubmit`. The resolver prefers the corrected prompt when
  `$json.motionPrompt` still equals the base it was built from — which is also
  what stops a LATER, separate regeneration of the same scene (a fresh producer
  note) from being overwritten by the stale correction.

`m.seed` and `m.dropEndFrame` keep their existing scene-id-only guards; that
pre-existing looseness is untouched on purpose.

### Kept exactly as they were

`MAX_REROLLS = 1` (it lives in `Motion Prep`/`Motion Verdict`, not here), both
seed derivations, `dropEndFrame` on `morph` only, `sd.polls[sceneId] = 0` /
`sd.regenPolls[p.id] = 0`, the `Object.assign({}, p, …)` passthrough, every
`$('Prep Video Regen')` reference, and both `resubmitting with seed …` log lines
byte for byte. One log line is ADDED per path — `MOTION <ord>: correction
(permanence, untouched, loop), 1131 chars` / `RG MOTION <id>: correction …` —
printed on EVERY re-roll, empty correction included, for the same reason
`Motion Verdict` prints all six signals on every path: the open-work item is to
watch one real film and count, and one `grep 'MOTION '` has to answer "did the
correction ride along, and which clauses" without re-running anything.

`sd.motionNotes` stays write-only and is deliberately still not read: its content
is prose faults, which is the one thing that must not reach a prompt.

**`CLAUSES` / `SIGNAL_ORDER` / `MAX_CLAUSES` / `LEAD_IN` / `UNSAFE` are a
LOCKSTEP PAIR** — byte-identical in the two Code nodes (1,563 chars), verified.
n8n has no shared module; publish both or neither, or a rescued clip obeys a
different director from its neighbours.

### Verification (no network; snapshot `255ef29c` is the live version)

- `node --check` passes on both `.js`.
- `check-expression.mjs` on both `.txt` reports the same shape as the live body
  (`Submit Video`: `seed`; `Submit Video Regen`: the same nine keys and the same
  1,244-char prompt under stubs).
- Prefix/suffix byte-identical either side of the single replaced span in each
  `.txt`. Measured as the maximal common prefix and suffix against the live
  parameter, so a future session can reproduce them: `Submit Video` 533 / 36
  chars (569 -> 633, +64); `Submit Video Regen` 281 / 1697 chars
  (1996 -> 2202, +206).
- Both Code bodies executed in a sandbox with stubbed `$`, `$json` and
  `$getWorkflowStaticData`: the action, WORLD_RULES and the `Negative:` tail all
  survive byte for byte, the correction lands before `Negative:`, the producer's
  `ADJUSTMENT REQUEST` is preserved, the guard re-feed recovers the correction, a
  later regen of the same scene is not overwritten, a post-VP-rewrite prompt
  rejects the stale correction, and the three degenerate inputs (no signals,
  tail-only stored prompt, `$('Current Scene')` unavailable) all fall back to
  seed-only.
- No node reference is dangling; no new node name is referenced by
  `Submit Video`/`Submit Video Regen`, and `Motion Resubmit`'s new
  `$('Current Scene')` is the node `Motion Prep` two steps upstream already reads.

Both `.txt` files carry NO trailing newline (the parameter value verbatim,
leading `=` included) — `paste/Submit Video Regen.txt` used to carry one and no
longer does. Originals for the three nodes that had none are now in `original/`;
`original/Submit Video Regen.txt` is still the PRE-2026-09-13 body, so diff that
node against the snapshot, not against `original/`.

**Not measured.** No film has been re-rolled with a correction attached. What is
owed is the same debt as the judge itself: watch one real film, `grep 'MOTION '`
the execution, and see which clauses ride along and whether the second take is
better than the first. If corrections make re-rolls WORSE, `MAX_CLAUSES` is the
first knob and the clause wording is the second — the threshold lesson from
2026-09-13 applies here too: the wording is the first line of defence.
