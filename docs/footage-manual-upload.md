# Manual upload

`POST /api/footage/upload` (multipart) and `FootageUpload`
(components/FootageUpload.tsx). A producer's own file — a clip they shot,
a photograph they own or were given — becomes a library asset with
`provider = 'user_upload'`, searchable and usable like any archive result.

## What is stored

- **The bytes**, in the media store under `library/<video|image>/<sha>.<ext>`
  — the same content-addressed layout every scene asset uses, so a file
  uploaded twice is one file and the store's `immutable` caching holds. The
  row's `media_path` and `content_hash` point at it; the hash is the
  asset's identity (`providerAssetId = upload:<hash>`), and the partial
  unique index on `content_hash` makes the same clip twice one row.
- **A poster** for videos (frame at 1 s, via the ffmpeg already in the site's
  image for the narration bundle and the archive attach) and the
  dimensions/duration from ffprobe. A probe that fails costs those numbers,
  never the upload.
- **Exactly what the person declared**: title (defaults to the file name),
  description, filming date, location, country, event name, owner,
  attribution line, notes.

Accepted: `video/mp4`, `video/webm`, `video/quicktime`, `image/jpeg`,
`image/png`, `image/webp`; up to 800 MB. The upload streams with a progress
bar (`XMLHttpRequest`, because `fetch` cannot report upload progress).

## Rights are the uploader's statement

The form asks *What may the film do with it?* — cleared, credit required,
"I don't know" (manual review, the default), or restricted — and the row is
filed with that answer as its licence verdict. Nothing is inferred from
the file. `restricted` uploads exist so a producer can keep a reference
clip in the library without it ever being offered to a scene; the engine
filters them like any other restricted asset.

## Provenance is unknown, by default and by rule

An upload is **never** claimed as actual footage of an event on upload
(spec §25). `provenance = 'unknown'`, the Source Watermark prints SOURCE
UNVERIFIED if the scene keeps it that way, and `assessProvenance()` leaves
it at `unknown` regardless of how well the declared metadata matches a
scene. The admin page's *Change provenance* is the only door up — a person
saying what the material shows — and `actual_footage` there requires the
event, place and filming date to be filled in.

## Searching

`userUploadProvider` (lib/footage/providers/upload.ts) is a local-only
provider: it exists for the picker's provider filter and the admin
page's counts, and its `search` is the library's full-text search filtered
to `user_upload`. The router never asks it; the engine's library-first pass
reads its rows with everything else.

## UI

- Picker: *⬆ Upload* beside *+ Add from URL* on the Images step of a
  documentary scene; a finished upload is a card the producer can *Use*
  like a search result.
- Admin: *Upload footage* on `/admin/footage`; the *Manual Upload* provider
  filter lists them.
- Own stylesheet (`FootageForms.module.css`), tokens checked against
  `globals.css`, `.abtn` padding stated in every flex row.

## Tested

The route needs the media store and ffmpeg, which the check script's
in-memory doubles do not carry, so it is exercised on the live site rather
than in `check-footage.mjs`; what the script does pin is the rule that
matters — an upload's provenance stays `unknown` however well it matches
(section *provenance*), and the local-only provider is never routed
(section *engine*).
