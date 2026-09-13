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
