# Upscaling a finished film

**APPLIED 2026-09-04.** Live:

| piece | where | id / version |
|---|---|---|
| the job | n8n workflow **6. Upscale Film** | `QBb1a3UpTyJi8ybk`, active `11805a58` |
| the buttons | `platform/components/UpscaleFilm.tsx` + `upscaleFilm()` in `app/actions.ts` | deployed |
| the column it needs | `db/006_video_media_id.sql` | applied |

## What it does

`POST /webhook/upscale-film` with `{Project_ID, resolution: "1080p" | "4K",
reassemble: true | false}`. The workflow reads every scene of that project
whose `video_media_id` is set, upscales each clip through
`POST /google-flow/videos/upscale`, re-hosts the result through
`/api/media/ingest`, points `Scene Final URL` at the stored copy, and — unless
`reassemble` is false — fires the assemble webhook so the film is rebuilt.

The upscaled clip is a NEW Flow generation with its own id, and that id
replaces the old one on the scene. Otherwise a second upscale would ask Google
to redo the *first* generation rather than the picture the film currently has.

## The three facts the buttons print

They are on screen because each one changes which button is right:

- **Only clips generated from 2026-09-04 can be upscaled.** The API needs a
  Flow `mediaGenerationId`; until `db/006` we extracted it and threw it away.
  An older film takes the `Nothing To Upscale` branch and says so — verified on
  the Boyd film, which parsed, queried, found none and reported cleanly.
- **1080p is free; 4K is 50 credits per clip.** Eighty scenes is 4,000 of the
  25,050 a month, which do not roll over. The 4K button prints that film's own
  number and asks a second time.
- **Rebuilding costs about twice the render time** — measured, 0.107 s/frame at
  720p against 0.224 s at 1080p. So "upscale the clips only" is its own button:
  free in credits AND minutes, and the picture still improves because the
  canvas has less scaling left to do.

## Two things that bit, worth keeping

- **The webhook answers on the PLAIN path only.** n8n's own trigger info
  prints `…/webhook/<uuid>/upscale-film`, which **404s**; `…/webhook/upscale-film`
  answers 200. The site derives its URL by swapping the last segment of the
  new-project webhook, so the plain form is the one that matters — exactly what
  CLAUDE.md already said about adding any new webhook.
- **The SDK create skips credential assignment on HTTP nodes.** Both calls into
  the site came out authenticated by nothing and had to be fixed with
  `setNodeCredential`. Check credentials after any `create_workflow_from_code`.

## Not done

The film is still assembled and rendered on a 1280x720 canvas. "Upscale film to
1080p" therefore means *the clips are 1080p and the cut is rebuilt from them* —
better source, same output size. A true 1080p output needs `resolution` plumbed
through `/assemble` (W/H) and `/render` (Remotion `scale`), **and the graphics
poll ceiling raised**: at 2.09x, an eight-minute film lands past the three-hour
cap raised on 2 September.

## The real 1080p output — added the same day

The first version upscaled the clips and rebuilt the film on the same
1280x720 canvas: better source, same size. `resolution` now runs the whole
way through.

| piece | change |
|---|---|
| `remotion/server/assemble.mjs` | canvas from `resolution`: 1920x1080 / 1080x1920, else the old 1280x720 / 720x1280 |
| `remotion/server/index.mjs` | `/render` strips `resolution` like it strips `speed` and turns it into a Remotion **scale of 1.5** |
| `Build Timeline` | reads `Editing Options.resolution`, sends it to `/assemble`, **and emits it at the top level** |
| `Submit Graphics` | takes that same top-level value rather than deriving its own |
| `Graphics Guard` | `MAX_POLLS` 2160 → **4320 when 1080p** |
| `Set Output Resolution` (upscale job) | writes `resolution: 1080p` before re-assembling |

Three decisions worth keeping:

- **Scale, not a bigger composition.** The composition stays 1280x720 and
  Remotion draws it at 1.5x device pixels, so type stays vector-crisp and the
  footage is read at its own resolution instead of being upscaled from a 720p
  raster. That is also why upscaling the clips and rendering at 1080p belong
  together: at 1.5x over 720p clips there is no extra detail to draw.
- **One value, read twice, never derived twice.** The montage and the graphics
  drawn over it must agree on the canvas, so `Submit Graphics` and
  `Graphics Guard` both read `Build Timeline`'s output rather than re-reading
  the project.
- **The ceiling had to move with it.** At 2.09x an eight-minute film is ~3.3
  hours, past the three-hour cap raised on 2 September — it would have failed
  AT the ceiling, which reads as a hang, the exact failure that cap exists to
  prevent.

**4K clips still render to a 1080p film.** A 4K canvas is a Remotion scale of
3 — nine times the pixels, most of a day for a ten-minute film on this box.
What 4K buys is more detail for the 1080p canvas to draw from.
