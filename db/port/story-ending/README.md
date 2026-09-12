# The film has to END, not just stop (2026-09-12)

The producer, after watching a finished film: *"As vrea sa avem si un fel de
concluzie la videoclip, sau sa se termine intr-un fel, acum se termina brusc
parca fara sens sau concluzie, cred ca tine de partea de scripting."*

They were right about where it lives.

## What was measured

The last sentence of the last chapter, on the six most recent finished films of
two minutes or more:

| film | last sentence ends on |
|---|---|
| Boyd | a statement — it lands |
| Ploiești | a trailing subordinate clause |
| Steam machine | a trailing subordinate clause |
| Peking to Paris | *"…while Paris gathers around him"* |
| Burger / Envoy | *"…while the shop stays open behind you"* |
| Astronaut | a trailing subordinate clause |

Five of six stop on a clause whose only content is where things came to rest.
That is a camera direction wearing narration's clothes: it says what the last
shot shows and nothing about what the story means.

## Why — and it is not the writer's fault

`Generate Outline` asked the spine for:

    - ending: the last thing the viewer sees and understands, one sentence

That is a camera position plus a feeling. And writer rule 10 (NO META) forbids
the narration from mentioning the camera, the film or the viewer — so the
planned ending was, by construction, a thing the writer was not allowed to say.
The only way it could reach the film was as a final SHOT.

Proof in the wild: the Burj Al Arab film's stored spine (execution 11663) reads
*"The last image is the completed Burj Al Arab seen from its island and then
from within its soaring atrium, and the viewer understands that…"*. The film
duly ends on *"…while hidden light fills the water."*

**The generalisation worth keeping: a field whose SPEC contradicts a rule
elsewhere in the pipeline does not fail loudly — it degrades into whatever the
model can legally do with it.** Neither prompt was wrong on its own.

## What changed — four nodes in Claude Scripting (`gkEtGMecv4TC3ZHp`)

Active version before: `5a32e43e-c1d1-43e1-95e2-5d56c024f808`.
Active version after: `8b8d7b74-c277-46ca-9063-9fbf8b36a747`.

1. **`Generate Outline`** — `ending` is now *the CLOSING EVENT and what it
   leaves behind — what is true at the end that was NOT true at the hook —
   written as something the narration can SAY out loud*, with camera positions
   and viewer feelings refused in as many words. The last chapter's `LEADS
   INTO:` line asks for the same thing, since for the final chapter there is no
   next one to lead into.
2. **`Write Full Narration`** — new rule 15, THE LAST CHAPTER LANDS: a closing
   beat of two or three sentences, the one place in the script where meaning
   may be stated aloud, and explicitly not a summary, not a moral addressed to
   the viewer, not a new fact, not a camera position.
3. **`Edit Full Narration`** — new rule 4b, directly under TRANSITIONS: if the
   draft simply stops, most often on a trailing `while…` / `as…` clause, write
   the close.
4. **`Narration Guard`** — the check, because an instruction in a prompt is not
   a constraint. `STOPS_ON_SHOT` tests the last sentence of the last chapter
   for a trailing subordinate clause and pushes a `problems` entry, which rides
   the existing `editorFeedback` path back into the editor. Same
   `MAX_RETRIES = 2`, same accept-anyway ending: a film that will not land
   still ships, it just costs at most two more editor passes.

## The guard, and its two deliberate limits

    /[,\s](?:while|as|în timp ce|in timp ce|pe când|pe cand|în vreme ce)\s+\S+(?:\s+\S+){2,}\s*[.!?…]?\s*$/i

- **Both languages the pipeline writes in.** An English-only pattern is the bug
  the motif validator already shipped once.
- **At least three words after the connector**, so *"…as planned."* and other
  short tails are not offenders — only a clause long enough to be describing a
  picture.
- **It never runs on a silent or a dialogue film**, behind the same gate as the
  fragment and commentary checks: a beat sheet legitimately ends on an image,
  and speech is not narration.

Backtested before shipping, against the six films above plus three synthetic
controls:

    passes Boyd (has a close)
    FIRES  Ploiesti / Steam machine / Peking to Paris / Burger-Envoy / Astronaut
    passes control: plain close / "as" early in the sentence / short while tail

A guard that fired on a clean draft would cost two extra model passes on every
film, which is why the controls matter as much as the hits.

## What it does not do

It reaches films written from now on. A film whose script already exists keeps
the ending it has — the door back is a script rewrite, not this change.

## Rollback

The four node bodies as they were are in `original/`; as applied, in `paste/`.
To roll back, `update_workflow` the four from `original/` and publish, or
`restore_workflow_version` to `5a32e43e-c1d1-43e1-95e2-5d56c024f808`.

The applied bodies in `paste/` were diffed byte-for-byte against the live draft
before publishing, and the draft was diffed node-by-node against the active
version: exactly those four nodes differed, 110 nodes either side, connections
identical.
