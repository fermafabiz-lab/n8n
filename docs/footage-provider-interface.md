# FootageProvider — the adapter interface

Every archive the engine can ask implements `FootageProvider`
(`platform/lib/footage/types.ts`). Nothing in the scene-matching path names
a provider; adding one is one file in `lib/footage/providers/` and one line
in the registry.

```ts
interface FootageProvider {
  id: ArchiveProvider;              // "eu_av" | "dvids" | "nasa" | "wikimedia" | "url_import" | "user_upload"
  displayName: string;
  enabled: boolean;                 // a getter where it depends on an env var (DVIDS)
  disabledReason: string | null;    // names the key that is missing
  priority: number;                 // tie-break in the router, higher first
  categories: string[];             // what it is GOOD FOR — see the registry doc
  searchCapabilities: {
    video: boolean; image: boolean;
    recentNews: boolean; historical: boolean;
    directDownload: boolean;
    localOnly?: boolean;            // answers from the library only; never routed
  };
  search(request: FootageSearchRequest, opts: { limit; signal? }): Promise<NormalizedFootageAsset[]>;
  getAssetDetails?(id: string): Promise<NormalizedFootageAsset | null>;
  checkRights(asset: NormalizedFootageAsset): Promise<RightsResult>;
  resolveDownload?(asset): Promise<ResolvedMedia | null>;   // the file URL, resolved late
  matchesUrl?(url: string): boolean;                        // for URL import routing
  importFromUrl?(url: string): Promise<NormalizedFootageAsset | null>;
}
```

## The normalized asset

`NormalizedFootageAsset` is the existing `NormalizedArchiveAsset` from
`lib/archive/types.ts`, extended — one type, so the library, the picker, the
attach path and the Source Watermark all keep reading the shape they always
read. The additions:

| Field | Meaning |
|---|---|
| `footageFormat` | `broll · stockshots · speech · press_conference · interview · news_package · live_stream · documentary · unknown` — the KIND of shot, which the B-roll rule reads |
| `origin` | `recent_news · official_media · historical · generic · user_upload` |
| `filmingDate` / `publicationDate` | kept apart on purpose: the catalogue date is usually the upload date, and only the filming date may match a scene's window |
| `location`, `country`, `eventName`, `people`, `organizations` | what the provider STATES — the provenance engine matches against these and never against appearance |
| `previewUrl` | a playable proxy where the provider has one |
| `rightsText` | the provider's own rights words, verbatim, for the validator and the admin page |
| `provenance`, `provenanceConfidence` | the asset on its own (`archival_footage`, `archival_photo`, `real_stock`, `unknown`) — the per-scene answer is computed at search time |

The fields that were already there (`provider`, `providerAssetId`,
`mediaType`, `title`, `description`, `sourceUrl`, `downloadUrl`,
`thumbnailUrl`, dimensions, `durationSeconds`, `dateOriginal`,
`yearsMentioned`, `creator`, `credit`, `licenseOriginal`, `licenseCode`,
`licenseUrl`, `rightsStatus`, `reviewStatus`, `attributionRequired`,
`categories`, `searchableText`, `qualityScore`) are unchanged.

## What a normalizer must and must not do

- Map the provider's dialect to the shape above; keep the provider's own
  words in `rightsText` and `licenseOriginal`.
- Classify the licence with `classifyLicense()` from `lib/archive/rights.ts`
  — the only code that reads a licence string — and leave the six-way usage
  class to `validateRights()`.
- Say what it KNOWS: an absent date is `null`, not today; a place is what
  the record states, not what the title suggests.
- Never download. A normalizer returns metadata and URLs; bytes move only
  when a scene uses the asset.
- Be a pure function of the provider's response, so it can be tested on a
  saved response with no network (`scripts/check-footage.mjs` does exactly
  that for all four).

## The adapters

| id | File | Auth | Notes |
|---|---|---|---|
| `wikimedia` | `providers/wikimedia.ts` | none | wraps the existing `lib/archive/wikimedia.ts`; imports `File:` pages by URL |
| `nasa` | `providers/nasa.ts` | none | `images-api.nasa.gov`; picks the largest mp4 rendition from the asset manifest; third-party credits (ESA, …) go to manual review |
| `dvids` | `providers/dvids.ts` | `DVIDS_API_KEY` | `api.dvidshub.net`; DoD branches are public domain with credit; a stated restriction is `rejected`; a third-party credit line is manual review |
| `eu_av` | `providers/euav.ts` | none (`EU_AV_API_BASE`) | EU Audiovisual Service; `© European Union` is credit-required under its own licence; editorial-only items are `editorial_only`. **Response shape read defensively and not yet verified against the live API** — see known limitations |
| `url_import` | `providers/urlImport.ts` | — | local only: searches the library rows an import created |
| `user_upload` | `providers/upload.ts` | — | local only: searches the library rows an upload created |

The two local providers carry `searchCapabilities.localOnly` and the router
never asks them — the engine's library-first pass reads their rows with
everything else, and the picker's provider filter reaches them through
`EngineOptions.providers`.

## Retired

`nara` and `smithsonian` are not providers. They are not "disabled"
placeholders either — `providerById("nara")` is `null`, the router cannot
pick them, and no adapter names their keys. Their old library rows still
read and still print their real names (`nara-smithsonian-deprecation.md`).
