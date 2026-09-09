# Footage provenance

Two questions, answered separately because they have different evidence
(`platform/lib/footage/provenance.ts`):

1. **What is the asset on its own?** — `baseProvenance(asset)`. Real moving
   footage from an archive (`archival_footage`), a real photograph
   (`archival_photo`), generic real stock (`real_stock`), or something
   nobody has vouched for (`unknown`). Decided from the media type, the
   provider and the origin. Capped at confidence 85: a well-catalogued item
   is evidence that it is a catalogued item, nothing more.
2. **Is it footage OF the event this scene narrates?** —
   `assessProvenance(request, asset)`. A match between the request and the
   asset's METADATA — event name, filming date, place, people — never its
   appearance. This is the only code in the platform that can say
   `actual_footage`.

## The score

Spec weights, out of 100:

| Signal | Weight | Source |
|---|---|---|
| exact event | 30 | the asset's `eventName` shares ≥ 60 % of the request's event words, or its title + description ≥ 75 % |
| date | 20 | the asset's **filming** date (else its publication date, else the years its text mentions) inside the request's window ± 1 year — `dateOriginal`, the catalogue's upload date, is never read |
| location | 20 | the request's place or country as a whole word anywhere the asset describes itself |
| people / organisations | 10 | any of the request's names on the asset |
| topic | 10 | share of the request's vocabulary in the asset's text |
| metadata quality | 10 | how much the provider actually said: date, place, creator, description, event or names |

A signal the request cannot ask for is not held against the asset: a scene
naming no person or organisation has no people/org evidence to find, so
those ten points leave the denominator instead of silently failing. Event,
date and place are never waived.

## The rule

```
actual_footage        request names an event
                      AND event = yes AND date = yes AND location = yes
                      AND score ≥ ACTUAL_FOOTAGE_MIN_CONFIDENCE (90)
illustrative_footage  request names an event and the asset is real but not proven to be it
base provenance       request names no event
unknown               the asset is an upload or a URL import — always, however well it matches
```

Every signal is **tri-valued** (`match.ts`): matched, mismatched, or
unknown. An asset with no date is not "the wrong date"; it is an asset
whose date nobody stated. That is why a mismatch can carry a ranking
penalty while an absence cannot, and why an undated asset can never be
`actual_footage`.

**Uploads and imports stay `unknown` until a person says otherwise** (spec
§25): matching metadata cannot promote something nobody has vouched for.
The admin page's *Change provenance* is the door, and it refuses
`actual_footage` unless the event, place and filming date are all filled in.

## What the scene stores

On *Use* (`lib/archive/attach.ts`), the scene's provenance columns from
db/009 receive either the library row's verified provenance (a person's
answer survives) or `assessProvenance()` for that scene's request, plus the
event name, location and filming date that support it. The Source Watermark
then prints what the scene carries: ACTUAL FOOTAGE with its source line
only when the row says so; ILLUSTRATIVE FOOTAGE for the rest; SOURCE
UNVERIFIED for `unknown`. The media-only classifier that existed before
(`classifyVisualOrigin` in `lib/provenance.ts`) still never reaches
`actual_footage` — it has no request to match against.

No second toggle was added: `sourceWatermarkEnabled` governs the watermark
as before, and the legally required credit is drawn independently of it.

## Tested

`check-footage.mjs`, sections *provenance* and *source watermark*: event +
date + place from the provider reaches ACTUAL FOOTAGE at or past 90; a
different event, or no stated date, is illustrative; no request gives the
archival base; uploads and imports stay unknown; the weights sum to 100; a
title that merely looks like the event is not the event; and the watermark
formats "ACTUAL FOOTAGE — Source: EU Audiovisual Service · Ceuta, Spain ·
2026-05-18" for the matching case.
