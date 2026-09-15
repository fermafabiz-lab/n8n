# Repairing the café film `recXibIyVuLvMIqy3` (2026-09-13)

The submit-time strip published today removes the trailing `Negative:` block from
every stored prompt before it reaches Veo, so all 368 legacy scenes across 18
projects are repaired **for free**, with no database backfill.

What the strip cannot reach is the ACTION half, and that is where three of the
producer's five complaints actually come from:

| in the stored prompt | what the producer saw |
|---|---|
| `loose paper edges quiver from her movement` (sc. 3), `loose sleeves quiver` (105), `A faint tremble of hanging tickets` (102), `ticket corners flutter` (103) | the papers taped to the fridge flying off |
| `the swinging door` (3), `a swinging door settles gently` (105), `The swinging door sways faintly` (106) | the fridge door and the room door moving by themselves |
| `reaches to the shelf, strips off the last sleeve stack, and pivots back toward the swinging door` (3) — three actions in an 8s clip | the same reach performed twice, the stack vanishing, the walk-away-and-return |

So this film's 16 rows are rewritten by hand under the new rule 6: **one action**,
**whatever is picked up stays in the hands**, **ambient motion only where something
in frame causes it** (steam from a machine, dust in a sunbeam, a clock's second
hand — never wind indoors), **everything untouched holds still**, and **no motion
adjective on a prop**.

Two deliberate deviations beyond the letter of rule 6:

- **Character names are replaced by role descriptions** ("the barista in the green
  apron" rather than "Maya Ortiz"). A test generation earlier today was refused with
  `PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED` / `PROMINENT_PERSON` on a prompt
  naming a character, and accepted verbatim once the name became a description.
  The film did generate with names, so the filter is not deterministic — but the
  name buys nothing: identity comes from the approved start frame, not the text.
- **The `Negative:` tail is removed from the stored text entirely**, rather than
  left for the submit-time strip. The stored prompt is now the action only, which is
  also what `End Frame Prompt` and the motion judge need to see.

`before.json` is the verbatim 16 rows as they stood before this change (from
execution 13065), so the film can be put back exactly as it was.
