# The second café clip: every fix was live, and none of them applied

2026-09-14. The producer regenerated scene 3 of the café film
(`recXibIyVuLvMIqy3`) after a night of fixes and reported the clip was "la fel
de prost". It was not as bad — half the reported faults were gone — but the
half that remained were the ones the fixes were supposed to remove, and the
reason is not the prompts.

**A running execution is version-pinned. The producer's batch has been running
since before the first fix was published, so it is still executing the node
bodies from 2026-09-13 17:05.**

## The timeline, from the API rather than from memory

| when (UTC) | what |
|---|---|
| 09-13 17:05:20 | Media Generation version `69c992f9` published — end frames default ON, 3-signal judge, the negation-stuffed submit tail |
| **09-13 21:35:54** | **execution `13033` starts** and snapshots that version |
| 09-13 22:32:17 | `d5a713ad` — positive tail, legacy `Negative:` block stripped everywhere |
| 09-13 23:01–23:29 | permanence / untouched / loop signals, carve-outs, machine-note filter, VP rewriter |
| 09-14 03:10–03:41 | counter reset, sheet at 0.5s, re-roll correction, **end frames made opt-in** |
| 09-14 09:42:15 | scene 3's row updated — the clip the producer sent |
| 09-14 09:56 | producer uploads it |

`search_executions` over 08:30–10:00 on 09-14 returns only a 5-minute cron and
this session's own throwaways. **Nothing but `13033` touched that row**, and
video regeneration has no webhook of its own — it is the batch's job
(`If Video Regen Pending` → `Fetch Approved Scenes` → … → `Submit Video Regen`),
so it could not have run anywhere else.

## What the pinned version actually contains

Read out of `get_workflow_version` for `69c992f9`, not inferred:

- `RG End Frame Prompt` — `const wanted = opts.endFrame !== false && !off;`
  The project's `editing_options` has **no `endFrame` key at all**, so under the
  pinned node the end frame is **ON** and the clip went to
  `veo_3_1_interpolation_lite_low_priority`. Under the live node
  (`optedIn = opts.endFrame === true`) the same project resolves to **OFF**.
- `Submit Video Regen` — its tail still contains, verbatim,
  `nobody and nothing … appears … disappears … duplicates … morphs`.
  That is the negation list Google's own guidance says summons what it names,
  and it is exactly the text removed at 22:32.

## What DID reach the clip, and what it bought

The stored prompt is read fresh from Postgres on every submit, so the 16 rows
repaired at **09-13 22:47** were live for this generation even though the nodes
were not. Comparing the two clips frame by frame at the same timestamps:

| complaint | first clip (09-13) | second clip (09-14) |
|---|---|---|
| wind on the papers taped to the fridge | papers change count and position between 0.0s and 4.0s | papers identical start to finish |
| fridge door / room door opening by themselves | door state changes mid-shot | both hold still |
| the set morphing | sink, corkboard and fridge handle all shift at 4.0s | room geometry consistent; the table moving is the camera tracking left→right, which is what the brief asks for |
| the held object vanishing | vanishes | **does not vanish** — occluded by her body at 5.0s, visible again at 5.3s |
| walks away then turns back | yes | **yes, still**: turns away 4.3–5.0s, turns back 5.3–6.0s, then walks right |

So the **database half** of the repair worked and is measurable. The **node
half** — the one that removes the turn-back — never ran.

## The trap, stated plainly

While `13033` lives, **every "regenerate" the producer clicks is executed by
12-hour-old code**. Nothing in the site or in n8n says so. A fix published
during a batch is invisible to that batch, and the person clicking the button
has no way to know which version answered them. This is the version-pinning
lesson in `docs/lessons-n8n.md` meeting the regenerate button, and the
combination is worse than either: it looks exactly like "the fix did not work".

## The way out is cheap

All 16 scenes have a `scene_final_url`, and the batch's `Needs Clip?` gate
(`Scene Final URL === ''`) skips any scene that has one. So ending `13033` and
re-entering through `resume-project` **regenerates nothing** — it walks the
cast sheet, set plates, audio and images (all skipped, all present), and parks
at the video approval gate again, this time on the live version. From that
point a regenerate click gets: end frame off, the positive tail, the six-signal
judge, and a re-roll that carries a correction.

Ending it also releases the held Railway deploy (task #21), which is what gets
the judge's contact sheet from 8 frames to 16.
