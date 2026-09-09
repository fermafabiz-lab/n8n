# The visual provenance model

`platform/lib/provenance.ts` is the definition; `remotion/src/provenance.ts`
mirrors the labels and the formatters (two packages, no shared module — the same
arrangement `normalizeSpeed` already lives under). `db/009_visual_provenance.sql`
is the storage.

## `VisualOrigin`

| value | label on screen | means |
|---|---|---|
| `ai_generated` | AI GENERATED | made by the image model from this scene's prompt |
| `ai_reconstruction` | AI RECONSTRUCTION | AI, depicting a real past event — a reconstruction, not a record |
| `actual_footage` | ACTUAL FOOTAGE | real media **of this exact event**: right event, right place, right date |
| `illustrative_footage` | ILLUSTRATIVE FOOTAGE | real media, but not of this event |
| `archival_footage` | ARCHIVAL FOOTAGE | real moving footage from an archive |
| `archival_photo` | ARCHIVAL PHOTO | a real photograph from an archive |
| `real_stock` | REAL FOOTAGE | real material from a stock library or an upload |
| `unknown` | SOURCE UNVERIFIED | nothing reliable is known |

## `VisualProvenance`

```ts
{
  visualOrigin: VisualOrigin;
  provider?: string;            // free string — "wikimedia", "reuters", "producer_upload"
  sourceTitle?: string;
  sourceUrl?: string;
  sourceCreator?: string;
  originalDate?: string;        // as a PERSON stated it — never the catalogue's
  originalLocation?: string;
  eventName?: string;
  isExactEventMatch?: boolean;  // derived from visualOrigin === 'actual_footage'
  rightsStatus?: string;
  licenseName?: string;
  attributionRequired?: boolean;
  attributionText?: string;     // usually absent; composed where it is printed
  provenanceConfidence?: number; // 0–100
  manuallyVerified?: boolean;
}
```

**Nothing here is stored twice.** `provider`, `sourceTitle`, `sourceUrl`,
`sourceCreator`, `rightsStatus`, `licenseName` and `attributionRequired` come
from the `hov.stock_media` row the scene already links to (db/007). Only the
facts with nowhere to live became columns:

```sql
scene.visual_origin                 text not null default 'ai_generated'
scene.provenance_confidence         smallint  check 0..100
scene.provenance_manually_verified  boolean not null default false
scene.provenance_event_name         text
scene.provenance_location           text
scene.provenance_date               text
```

`isExactEventMatch` is **derived, never stored**: `actual_footage` *is* the
assertion that the media shows this event at this place on this date, so a
second field could only ever contradict the first.

## Confidence

`provenanceConfidence` is confidence in the **classification**, not in an event
match.

| case | score |
|---|---|
| `ai_generated` | 100 — we made the picture; it is a fact about our own pipeline |
| `ai_reconstruction` | 85 — inferred from the prompt's wording |
| an archive item | 70, +10 creator/credit, +10 source URL, +5 rights, +5 licence, **capped at 85** |
| a person's own choice | 100 (0 for a deliberate `unknown`) |
| an unrecognised source | 0 |

`ACTUAL_FOOTAGE_MIN_CONFIDENCE = 90`, and the archive cap of 85 sits **below**
it deliberately. A perfectly documented archive item is still only evidence that
it is an archive item; if anything automatic could produce a number that reads
as authority about the event, the threshold would stop being a threshold.

## Classification, and what it refuses to do

`classifyVisualOrigin({visualSource, imagePrompt, videoPrompt, stock})` reaches
six of the eight origins. It can **never** return `actual_footage` or
`illustrative_footage`: both are statements about whether the media matches the
narrated event, which is a question about the world rather than about our
records. Those two arrive only as a producer's stored override.

`ai_reconstruction` is detected from planner language — reenactment,
reconstruction, dramatisation, docudrama, "historical recreation", "recreate the
signing", Romanian *reconstituire*. The word "recreation" alone does not count:
a recreation ground is not a historical reconstruction, and a false positive
here would print AI RECONSTRUCTION over an invented scene, which is a claim
about reality nobody made.

## When the classification is written

| moment | who |
|---|---|
| every scene ever created | `db/009`'s default + one-off backfill from `visual_source` |
| an archive asset is attached | `attachStockToScene` |
| a scene goes back to AI | `detachStockFromScene` (clears the override too) |
| the picture is approved | `refreshSceneVisualOrigin` via `classifyScene` in actions.ts |
| the image prompt is edited | the same |
| the producer chooses a Footage type | `setSceneProvenance` |

A scene with `provenance_manually_verified` is never re-classified
automatically. The producer's "Automatic" button clears the pin and lets the
classifier own the scene again.
