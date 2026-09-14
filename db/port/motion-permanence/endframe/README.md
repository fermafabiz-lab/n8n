# When does an end frame help? Measured, 2026-09-14

The end frame went live on 2026-09-13 and was never measured. CLAUDE.md's own
open-work section says so in as many words: *"None of that is a measurement."*
The producer's very next clip carried two of its signature artefacts — a prep
table that vanishes and returns in a slightly different place (a cross-dissolve
between two independently drawn keyframes whose camera position differs) and a
subject who walks away and turns back (an interpolator obeying a terminal
constraint whose end pose sits at or near the start pose).

A diagnosis fan-out proposed a shot-aware rule: draw the end frame only for
shots whose failure mode is ambiguous DIRECTION over a clear A→B path, and skip
it when the brief chains actions, names a camera move, ends on a return or exit,
or involves a held object.

**Measured against the 16 real prompts of the café film — the ones rewritten
under the new rule 6, i.e. what the pipeline produces from now on — that rule
draws an end frame on 0 of 16 shots.** `measure-rule.py` is the script,
`measurement.txt` its output.

| sub-rule, alone | would skip |
|---|---|
| held object | 16 / 16 |
| two or more action verbs | 15 / 16 |
| names a camera move | 14 / 16 |
| ends on a return or exit | 0 / 16 |

Two things follow.

**The heuristic is a global off switch wearing a heuristic's clothes.** Shipping
it as a nuanced per-shot rule would have been dishonest about what it does.

**It is also not measuring what it claims.** The action counter matches the
stillness clauses rule 6 now MANDATES — "the trays stay in her hands", "the
cups hold still" — as if they were actions. Scene 1 scores "4 actions" for a
prompt that contains exactly one. A rule tuned on that number would be tuned on
noise.

The structural reason the rule collapses is worth stating on its own, because it
outlives this particular heuristic: **rule 6 requires a named camera move on
every single shot, and a moving camera guarantees that two independently drawn
keyframes disagree about where the static set is.** The end frame and rule 6 are
not compatible for this pipeline's shot vocabulary. Anything that reconciles
them has to change one of the two, not arbitrate between them per shot.

## What would turn the end frame back on

A measured A/B on one real film: the same scenes generated with and without an
end frame, watched side by side. Not an argument — a comparison. The machinery
stays in place and `endFrame: true` in `Editing Options` still enables it, so
that trial costs one project setting.
