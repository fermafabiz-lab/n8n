# Motif cards — the authoring prompt

What this is: the model call that decides **where a drawn card goes and what it
says**, plus the contract its output has to satisfy. It belongs in **Claude
Scripting** (`gkEtGMecv4TC3ZHp`), after the scenes exist and before the run
ends — the only workflow that knows the whole story, and the only one that runs
once per film. Media Generation runs in batches of 8 and would re-ask three
times for a 15-scene film; Final Assembly is the render path and must not grow
a model call.

Its output is validated by `validate.mjs` in this directory (a Code node, not a
second model — an invented value cannot survive code, and survives any judge),
stored on the project, and passed through by `Build Remotion Props` into the
render's `textCards` prop. Remotion already accepts that prop and it already
bypasses every derivation gate; nothing on the render side needs building.

**This is not an "AI Agent" node.** One structured call with a JSON schema. The
output is at most three objects; tools and a scratchpad buy nothing here and
cost reproducibility.

---

## System prompt

> You choose the **drawn cards** for a short film that has already been
> written. A drawn card replaces the picture for two to four seconds with a
> graphic: it is a cut to different material, not an overlay.
>
> **A card must show what neither the voice nor the shot is showing.** This is
> the whole test, and it fails in two directions:
>
> - The narration already says it. The captions are already printing the
>   spoken line, so a card that repeats it puts the same sentence on screen
>   three times.
> - The shot already shows it. You are given each scene's image prompt and
>   motion prompt, so you know what will be on screen. A map unfolding over
>   footage of someone unfolding a map is the same fact twice, however well
>   drawn.
>
> What a card CAN add: the shape of a journey, the size of a gap between two
> times, a quantity a listener cannot hold in their head. If a scene has none
> of those, it gets no card.
>
> **You may only choose from the motifs that exist.** They are listed below
> with their exact fields. You cannot invent a motif; asking for one that is
> not on the list produces nothing.
>
> **Everything you put on screen must already be in the film.** For every
> string you write, you name the scene and quote the exact words it comes
> from. You may render a quoted thing differently — "cinci și douăzeci" may
> become "05:20" — but you may not introduce a fact the film does not contain.
> A distance, a date, a statistic that is nowhere in the script is not yours to
> add; if the film needs one, it belongs in the research pack with a source,
> not on a card.
>
> **A card may not use a word the film has not spoken yet.** Quote only from
> the card's own scene or an earlier one.
>
> **Aim for one to three cards on every film.** This pipeline wants animations
> in its videos, so look hard: a journey with named legs, two times set against
> each other, a quantity a listener cannot hold. Take the best one or two even
> when neither is spectacular. Three is the maximum for a film of any length —
> a card every twenty seconds is a slideshow with a voice over it.
>
> **But never force one.** If the script genuinely offers nothing either motif
> can draw truthfully, return an empty array and say so in `none_because`: one
> line naming what the film DID offer that you had no motif for. On such a film
> that line is the most useful thing you can return — it is how the next motif
> gets chosen and built. Padding the answer with a card that repeats the
> narration is worse than an empty array, because a bad card ships and an empty
> array only asks a question.
>
> Answer with JSON only, matching the schema exactly.

## The motifs that exist

### `route` — a chart unfolds and the journey draws itself across it

For a film whose subject travels somewhere, when the film names the legs of the
trip but can never show the whole shape of it at once.

| field | rule |
|---|---|
| `stops` | 2–4 `{name, source}`, in travel order. The last one is the destination and is drawn larger. |
| `label` | optional; the small tracked word naming the graphic ("Ruta"). Furniture, not a claim: no digits, ≤ 12 characters. |
| `note` / `noteSource` | optional; the one line the picture cannot say. Needs provenance like everything else. |

### `schedule` — a departure board flaps two times into place

For a film where two moments are set against each other and the gap between
them is the tension. The gap is computed by code from the times you give, so
you never write it yourself unless you want it phrased.

| field | rule |
|---|---|
| `rows` | 2–3 `{label, value, source}`. `value` is a CLOCK TIME as `HH:MM`. |
| `label` | optional; same rule as above ("Orar"). |
| `note` / `noteSource` | optional; if it states the gap, mark the source `arithmetic` and the code will check your subtraction. |

**A year is not a time.** The first film to reach this node had no journey and
no timetable — it had a life, told in dates — and what came back was a schedule
card rendering 1893 and 1896 as `18:93` and `18:96`. The validator rejected it,
correctly, and there was nothing left to draw. That film is why the third motif
exists.

### `timeline` — a dimension line is measured out and the years mark themselves along it

For a film that states three or more dates minutes apart. The card places each
mark at its REAL distance from the others, so what it shows is the SHAPE of the
span — that 1941 and 1962 are twenty-one years apart while 1975 and 1977 are
two. A listener cannot hold four dates, and nobody can hear a proportion.

| field | rule |
|---|---|
| `marks` | 3–5 `{at, label, source}`, in increasing order. `at` is a year the film states; `label` is at most four words saying what happened there. Two marks would be a gap, and a gap is a schedule. |
| `label` | optional; same rule as above ("Anii"). |
| `note` / `noteSource` | optional; if it states the length of the whole span, mark the source `arithmetic` and the code recomputes it in years. |

Marks are drawn proportionally, so the card concedes toward even spacing by the
SMALLEST amount that keeps two labels from touching — proportion is the point,
so it is given up by the minimum rather than abandoned at the first collision.

## Output schema

```json
[
  {
    "sceneIndex": 7,
    "variant": "timeline",
    "priority": 1,
    "why": "one line: what this shows that the voice and the shot do not",
    "label": "Anii",
    "marks": [
      {
        "at": "1941",
        "label": "as a dealer",
        "source": {"kind": "quote", "sceneIndex": 2, "from": "He arrives in Las Vegas in 1941 as a dealer"}
      },
      {
        "at": "1952",
        "label": "all the savings",
        "source": {"kind": "quote", "sceneIndex": 3, "from": "In 1952, he puts in all the savings"}
      },
      {
        "at": "1975",
        "label": "co-found Boyd Gaming",
        "source": {"kind": "quote", "sceneIndex": 7, "from": "By 1975, Sam Boyd and Bill Boyd co-found Boyd Gaming Corporation"}
      }
    ],
    "note": "34 de ani",
    "noteSource": {"kind": "arithmetic"}
  }
]
```

**Provenance travels with the thing it proves.** Every stop, row and mark
carries its own `source`; a note is justified by `noteSource` beside it. It was
a map keyed by path — `stops[2]`, `rows[1].value`, `note` — until the first real
film came back with a route card whose only source sat under `rows[0].value`, a
key belonging to a different motif. Every string on that card was true and the
card was dropped for having no source: the bookkeeping failed, not the model. An
item that carries its own source cannot be filed under the wrong key, so the
class of error is gone rather than warned about. The old map is still READ, as a
fallback, so a card written the old way still validates.

One source justifies a whole row or mark. A row's label and its value come out
of the same spoken line; asking for that line twice only creates a second chance
to mis-key it.

Three kinds are accepted:

- `quote` — `from` must appear verbatim in that scene's narration. Diacritics,
  case and punctuation are ignored when checking; the words are not, and neither
  is their order: `"as a dealer"` is proved by "arrives in Las Vegas in 1941 as
  a dealer" and `"dealer in Vegas"` is not, because the film never puts those
  words together.
- `arithmetic` — a `schedule` note stating the gap, or a `timeline` note stating
  the span. The code recomputes it and checks your number.
- `evidence` — `ref` must name a row in the research pack (`E1`, `E2`, …), and
  that row must carry a source. This is the only door for a fact from outside
  the script, and it is the same door the claim cards use.

Anything else, or a missing entry, drops the card. Durations are not yours:
`seconds` and `minSeconds` are computed from the content by the validator.

## Input the node supplies

```
FILM: {{ $json.projectTitle }}   TONE: {{ $json.tone }}

SCENES (index · narration · what the shot will show)
{{ scenes.map((s,i) => `${i} · ${s.narration}\n    SHOT: ${s.imagePrompt}\n    MOTION: ${s.motionPrompt}`).join('\n') }}

RESEARCH PACK (may be empty)
{{ $('Extract Claims').first().json.output }}
```

The image and motion prompts are the load-bearing half of that input: they are
what lets the model see that a scene is already showing the thing it was about
to draw. Scripting writes both itself, so they cost nothing to include.

## What the code checks, and what it cannot

The validator proves three things: that the quote exists, that it belongs to a
scene at or before the card, and — where it can parse both sides — that a time
on screen matches the words it came from. It cannot prove that a card is a good
idea, that the shot does not already show it, or that a rendered phrase reads
well. Those are the prompt's job and the producer's, which is why accepted
cards are `ok` or `review`, and why `review` ones should reach the Final
touches panel before a render rather than going straight to screen.

---

## Trying it without n8n and without a model

```
npm run check:motif -- trigger/studio-props.local.json motif/candidate-model.json
```

Three fixtures sit beside this file. Two are against the Tahiti film:

- `candidate-mine.json` — the two cards I authored by hand before any of this
  existed. The schedule passes with every value proved; **the route is
  rejected**, because it puts the word "Feribot" on screen at 23s and what the
  film has actually said by then is "ferry". That is the rule working: not a
  factual error, a word the film does not use, which is the same class of wrong
  and just as visible to a viewer who is reading the captions.
- `candidate-model.json` — a compliant pair plus five failures worth having a
  name for: a distance cited to a research row that does not exist, a card on a
  scene the chapter card already owns, a quote taken from a LATER scene, a
  motif that was never built, and a stated gap that is not what the two times
  subtract to.

Run them before changing any rule in `validate.mjs`; both are cheap, and the
second one is the regression test.

- `candidate-timeline.json`, against `boyd-props.json` — nine scenes trimmed
  from the 71-scene Boyd film, which is the film that had no motif. One card
  passes with all four years proved and its span recomputed; five fail, one per
  rule the new motif adds: marks out of order, a quote from a later scene, a
  year its own quote does not state, a span the subtraction does not support,
  and two marks where three is the minimum.

Run all three after changing any rule in `validate.mjs`. And note the label
rule bites here exactly as "Feribot" did on the Tahiti film: the first draft of
this fixture labelled 1941 "dealer in Vegas", which the film never says as a
phrase, and every card was rejected until the labels were lifted from their own
quotes.
