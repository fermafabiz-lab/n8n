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
