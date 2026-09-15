# The particles in the sunbeam (2026-09-15)

The producer, over a frame of a black-and-white conference room with white
specks hanging in the air:

> I dont understand why it generates this particles. It happens really often and
> it makes no sense. Can you investigate and aolve the problem

It is not the render. `FilmLayer.tsx` adds grain and nothing else — grain is a
flat noise field over the whole frame, not discrete specks that sit in the light
and drift. The specks were asked for, in words, by us.

That frame is scene 102 of the NASA film `recC5uy63NuUgeHD7`, and its stored
`hov.scene.motion_prompt` reads, verbatim:

> Gentle pan right across the conference table to a man as he lifts one page from
> the memorandum packet and lowers it again, his gaze staying downward, **while
> dust motes drift in window light** and the rest of the room remains still.

Veo drew what it was told. Same film, scene 1: "…in the White House room, **dust
motes drifting in still air**" — which is self-contradictory on its face. Scene
105: "a faint curtain stir and **drifting dust** give the chamber quiet motion".

## How often, measured

One query over every scene that has a motion prompt, matching a deliberately
tight alternation (`dust motes?`, `motes of`, `floating dust`, `drifting dust`,
`dust drift(s)`, `dust particles`, `particles of dust`, `airborne dust`,
`specks of dust|light`, `dust suspended`, `dust hang(s)`, `dust swirl`). The
tightness matters: an earlier sloppy pattern of mine matched "cra**sh**-zoom"
and "**dusk**y" and turned one real hit into four apparent ones.

**725 scenes across the last 40 films, 73 of them ask for airborne particulate —
10.1%.** Per film, the worst are not outliers:

| film written | scenes | motes | |
|---|---|---|---|
| 08-05 14:12 `recOTlDhDtUHOdpL4` | 17 | 5 | 29% |
| 08-05 14:01 `reczzU3rBOaem788d` | 48 | 9 | 19% |
| 08-31 18:39 `recnyQ92QsXehZ98S` | 71 | 11 | 15% |
| 09-04 14:15 `recAstqxhTrbxjaI8` | 37 | 7 | 19% |
| 09-08 23:02 `reckOhr2PZnMjn3yf` | 41 | 12 | **29%** |
| 09-10 09:43 `recC5uy63NuUgeHD7` (the NASA film) | 9 | 3 | **33%** |

"Really often" is exactly right, and on a documentary — rooms, archives, hearing
chambers — it is worse than average, because that is where a window and a shaft
of light are.

## The 09-13 rule already caught most of it, and this one case walked past it

`db/port/motion-permanence/` replaced rule 6(c) that same week. The old wording
*mandated* invented motion ("the ambient/atmospheric motion of the environment
(drifting steam, rippling water, flickering light, moving dust)"); the new one
allows motion only where something in frame causes it and adds **INDOORS THERE
IS NO WEATHER**. Measured either side of that change:

| | scenes | motes | |
|---|---|---|---|
| written before 2026-09-13 evening | 694 | 72 | 10.4% |
| written after | 31 | 1 | 3.2% |

So the weather rule works. The one that survived is the interesting one — scene
110 of the café film `recXibIyVuLvMIqy3`, written after the fix:

> Slow dolly-in on a figure standing near frame left, looking off into the
> distance past the camera. **She stays where she is.** Late afternoon sun through
> the window lies still across the empty tables, **with dust motes turning slowly
> in the shaft of light. The chairs and tables hold still.** Photorealistic,
> Motivational mood, cinematic.

Read it as a report card. The writer obeyed ONE ACTION (she stays where she is),
obeyed EVERYTHING THE SUBJECT DOES NOT TOUCH HOLDS STILL (twice — the sun lies
still, the chairs and tables hold still), and *still* put motes in the beam. Not
because it ignored the rule but because it did not think the rule was about this:
**a shaft of light reads as lighting, and the rule it had been given was about
weather.** Nothing in "in a room, a kitchen, an office or a stockroom the air is
still, and paper, cloth, curtains, hanging signs and loose sheets stay exactly as
the still shows them" names a sunbeam or names dust, and dust in a sunbeam is a
photography cliché strong enough to survive a rule it does not obviously break.

## The change

One sentence, inserted into rule (c) immediately after the INDOORS THERE IS NO
WEATHER sentence and immediately before `If nothing in the shot is causing
motion`:

> A SHAFT OF LIGHT IS NOT A CAUSE EITHER: "dust motes turning in the window
> light" is the one piece of invented air movement that survives the sentence
> above, because it reads as lighting rather than as weather — but motes only
> move if the air moves, and indoors the air is still. Light falls, lies across a
> surface and picks out an edge; it carries nothing.

Three things about how it is written, all deliberate:

- **It names the exact phrase the model keeps producing**, in quotes, because
  that is the only unambiguous way to close a gap the model does not believe is a
  gap. This is the one place the "never write a negation" rule does not apply —
  that rule is about text reaching **Veo**; this text reaches **gpt-5.4**, which
  is being asked what to write, not what to draw. The sentence never leaves the
  scripting model. Do not "fix" it by converting it into a noun list.
- **It gives the mechanism, not just the ban** ("motes only move if the air
  moves"), so it generalises to smoke, pollen, snow indoors, embers and floating
  seeds without listing them.
- **It says what light DOES do**, positively, so the writer still has a way to use
  the beam: it falls, lies across a surface, picks out an edge. A rule that only
  takes something away gets routed around.

## Five live copies, not four

The sentence lives in five nodes across three workflows. Four were already known
from `db/port/motion-permanence/`; **the fifth was found from this repo's own
`paste/` copies, after a grep of only the two workflows I had open missed it.**
That is the trap in CLAUDE.md — "a prompt fragment always lives in more copies
than the one you found" — hitting once more.

| # | workflow | node | what it writes |
|---|---|---|---|
| 1 | Claude Scripting `gkEtGMecv4TC3ZHp` | `Segment Chapter Into Scenes` (rule 6c) | every scene of every film |
| 2 | Claude Scripting | `Rewrite Scene Text` | the batch text-regen path |
| 3 | Claude Scripting | `Rewrite Scene Standalone` | the `scene-text-regen` webhook, one scene |
| 4 | Hook Regen `MDYR0J93RJDU8ftf` | `HR Shots Prompt` (rule 5) | the teaser's shots |
| 5 | Media Generation `yHG4DBCDjR3RJzav` | `VP Rewrite AI` | a prompt the Google content filter refused |

#5 matters more than its name suggests: it is the only node that *writes* a
motion prompt from the Media Generation side, and without the sentence it would
launder motes back onto a scene the segmenter had already written clean — the
same laundering documented at `../motion-permanence/README.md` for the old
negative tail.

## The apply record

Every node was built from a committed file in `paste/` (never composed inline in
the tool call), applied with `update_workflow`, then the applied parameter was
read back and byte-compared against the committed file, the whole workflow diffed
against the version it was built on to confirm the only entry that differed was
the intended node and the connections were identical, and published with an
explicit `versionId`.

| workflow | was active | now active |
|---|---|---|
| Claude Scripting `gkEtGMecv4TC3ZHp` | `66bd8b91` | **`d0f07af5-9ffe-401e-a99c-2f4a4a953197`** |
| Hook Regen `MDYR0J93RJDU8ftf` | `6dd363a7` | **`1e944f73-675b-4234-8aaf-1ce2e2607d23`** |
| Media Generation `yHG4DBCDjR3RJzav` | `8b06ee2a` | **`6412a267-5b17-4cbf-9670-bd5d3c687c9a`** |

All three had `draft == active` before the first edit, so publishing shipped this
change and nothing else. (Claude Scripting took three publishes, one per node;
`d0f07af5` is the last and carries all three.)

`paste/` holds a `.before` and an `.after` for each of the five, the `.before`
being the live parameter as it was read back immediately before the edit. The
matching files in `../motion-permanence/paste/` are updated in the same commit so
that directory keeps describing what is live.

### The size check, which is the cheap proof

The inserted text is 359 bytes including its leading and trailing space. Four of
the five files grew by exactly 359:

| file | before | after | delta |
|---|---|---|---|
| `Segment Chapter Into Scenes` | 14114 | 14473 | 359 |
| `HR Shots Prompt.js` | 11442 | 11801 | 359 |
| `Rewrite Scene Standalone.expr` | 5540 | 5899 | 359 |
| `VP Rewrite AI.expr` | 3955 | 4314 | 359 |
| `Rewrite Scene Text.expr` | 5035 | 5396 | **361** |

The odd one out is correct and is the trap worth remembering: **the two per-scene
rewriters escape quotes differently.** `Rewrite Scene Text` writes the clause
delimiters as `\"` inside its single-quoted JS string, `Rewrite Scene Standalone`
writes a bare `"`. The sentence contains one quoted phrase, so in that one node it
costs two extra bytes. The escaping was detected per node programmatically rather
than assumed — my first draft of the `Rewrite Scene Standalone` file used `\"`
and had to be regenerated. After unescaping, all five copies of the sentence are
character-identical.

## What this does and does not fix

- **It is a prompt change only.** Clips that already exist are untouched, and so
  are motion prompts already sitting in `hov.scene`. The producer's NASA film
  (09-10) keeps its three; regenerating those three scenes' text is what clears
  them, and per-scene text regen now goes through copies #2/#3, which carry the
  sentence.
- **It does not touch the image prompts.** A still image whose `image_prompt`
  asks for dust in a sunbeam still gets drawn with dust; only the motion is
  addressed. Nothing measured suggested the image side is a problem — the
  producer's complaint was about specks that *move* — but if it turns out to be,
  rule 3 is a separate owner.
- **Verification is owed on a film written after 2026-09-15.** The measurement
  above is the baseline: re-run the same query and the post-fix bucket should
  stay at zero rather than 3.2%. Until a real film has been written under it,
  this is a fix with a mechanism and no outcome.
