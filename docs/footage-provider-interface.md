# FootageProvider — the adapter interface

Every archive the engine can ask implements `FootageProvider`
(`platform/lib/footage/types.ts`). Nothing in the scene-matching path names
a provider; adding one is one file in `lib/footage/providers/` and one line
in the registry.

```ts
interface FootageProvider {
  id: ArchiveProvider;              // one of the fifteen ids in the registry (lib/archive/types.ts)
  displayName: string;
  enabled: boolean;                 // a getter where it depends on an env var (a key, a switch)
  disabledReason: string | null;    // names the key that is missing
  notice?: string | null;           // a caveat on an ENABLED provider (anonymous, low quota); still routed
  priority: number;                 // tie-break in the router, higher first
  tier: ProviderTier;               // official | archive | community | stock | library — see the registry doc
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
  that for every adapter).
- Resolve the file LATE where the search answer does not hold it:
  `resolveDownload` is what `lib/archive/attach.ts` calls before it
  downloads, and it is authoritative when present — the Internet Archive's
  search-time URL is a directory, NASA's a preview, and Unsplash requires a
  `download_location` call before use.

## The adapters

| id | File | Auth | Notes |
|---|---|---|---|
| `wikimedia` | `providers/wikimedia.ts` | none | wraps the existing `lib/archive/wikimedia.ts`; imports `File:` pages by URL |
| `eu_av` | `providers/euav.ts` | `EU_AV_API_BASE` (opt-in) | EU Audiovisual Service; `© European Union` is credit-required under its own licence; editorial-only items are `editorial_only`. **Off until a public endpoint exists** — the service has no developer API and the site's internal one sits behind an embedded credential this engine does not use (`footage-sources.md`) |
| `dvids` | `providers/dvids.ts` | `DVIDS_API_KEY` | `api.dvidshub.net`; DoD branches are public domain with credit; a stated restriction is `rejected`; a third-party credit line is manual review |
| `nasa` | `providers/nasa.ts` | none | `images-api.nasa.gov`; picks the largest mp4 rendition from the asset manifest at use time; third-party credits (ESA, …) go to manual review |
| `internet_archive` | `providers/internetArchive.ts` | none | `archive.org` advancedsearch + metadata; film from the public-domain collections (`PD_COLLECTIONS`) or with a `licenseurl`, stills from the PD collections only, YouTube mirrors and flagged collections excluded; uploader licences outside those collections → manual review; imports `details/` pages by URL |
| `europeana` | `providers/europeana.ts` | `EUROPEANA_API_KEY` (demo key default) | `api.europeana.eu` v2 search, `reusability=open` (PDM/CC0/BY/BY-SA only), `media=true`, `profile=rich`; video via `TYPE:VIDEO` + `MIME_TYPE:video/mp4` |
| `loc` | `providers/loc.ts` | `FOOTAGE_ENABLE_LOC` | `loc.gov` JSON API; **off by default** — Cloudflare challenges the box; only "no known restrictions" / "public domain" reads as PD, the rest manual review with the Library's own sentence |
| `wellcome` | `providers/wellcome.ts` | none | `api.wellcomecollection.org` images; IIIF `info.json` → `full/{w},/0/default.jpg`; licence per image |
| `flickr` | `providers/flickr.ts` | `FLICKR_API_KEY` | `flickr.photos.search` restricted to licence ids 4,5,7,8,9,10; images only; date window → `min/max_taken_date` |
| `openverse` | `providers/openverse.ts` | none needed; `OPENVERSE_CLIENT_ID` + `_SECRET` optional | two modes, never off: anonymous (one request per search, the API's 5/hour · 100/day · 20-a-page throttle kept locally, a `notice` on the provider) or OAuth2 client credentials (token cached, 10,000/day); images only |
| `pexels` | `providers/pexels.ts` | `PEXELS_API_KEY` | video + photos; Pexels License → `other_free`, cleared, no credit |
| `pixabay` | `providers/pixabay.ts` | `PIXABAY_API_KEY` | video + photos; Pixabay Content License → `other_free`, cleared, no credit |
| `unsplash` | `providers/unsplash.ts` | `UNSPLASH_ACCESS_KEY` | photos; `attribution_required` ("Photo by X on Unsplash"); `resolveDownload` calls `download_location` |
| `url_import` | `providers/urlImport.ts` | — | local only: searches the library rows an import created |
| `user_upload` | `providers/upload.ts` | — | local only: searches the library rows an upload created |

The two local providers carry `searchCapabilities.localOnly` and the router
never asks them — the engine's library-first pass reads their rows with
everything else, and the picker's provider filter reaches them through
`EngineOptions.providers`.

## Retired

A retired provider is absent, never disabled: not in the registry, not in
`ARCHIVE_PROVIDERS`, `providerById(id)` is `null`, the router cannot pick
it, no adapter reads its key, and neither label map names it. Its old
library rows still read, with a title-cased id as their label. Two US
institutions left this way on 2026-09-10 at the producer's request
(`footage-sources.md`).
