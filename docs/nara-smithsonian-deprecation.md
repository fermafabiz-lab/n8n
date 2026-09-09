# NARA and Smithsonian: removed from the footage architecture

Decision, 2026-09-09, as the spec for the Universal Footage Engine
required: **the platform does not implement, call, or depend on the US
National Archives (NARA) or Smithsonian Open Access.** The active providers
are the EU Audiovisual Service, DVIDS, NASA and Wikimedia Commons, plus
URL import and manual upload.

## What existed before

Neither was ever built. `lib/archive/index.ts` declared them on 2026-09-07
as *disabled adapters that name the key they need* (`NARA_API_KEY` from
catalog.archives.gov, `SMITHSONIAN_API_KEY` from api.data.gov) so the gap
would be visible in the picker; `db/007_stock_media.sql` allowed the two
strings in the `provider` CHECK; the `Archive Suggestions` prompt named
them as example archives. No search was ever sent to either, and no
library row carries either provider (the library held 178 rows on the day
of the change, all `wikimedia`).

## What was removed

| Where | Change |
|---|---|
| `platform/lib/archive/index.ts` | the two `notBuilt` entries; `adapterFor("nara")` / `adapterFor("smithsonian")` answer `null` |
| `platform/lib/archive/types.ts` | `ARCHIVE_PROVIDERS` is the six active ids; `ArchiveProvider` is an open string union so old rows still type-check |
| `platform/lib/footage/registry.ts` | not in `PROVIDERS`; `providerById()` is `null`; the router cannot pick them |
| n8n `Archive Suggestions` → `Build Query Prompt` | the prompt no longer names them (version `6b5a1417`) |
| `.github/workflows/deploy-platform.yml` | never carried the two keys, so nothing to remove; `DVIDS_API_KEY` and `EU_AV_API_BASE` were added |
| `CLAUDE.md` | the Documentary section and Open work no longer ask for the keys |

`NARA_API_KEY` and `SMITHSONIAN_API_KEY` are read **nowhere** in the
repository (`grep -r NARA_API_KEY` finds only this file and history in
CLAUDE.md). They need not be set, and setting them does nothing.

## What was kept, deliberately

- **Historical rows remain readable.** `db/010_universal_footage.sql` drops
  the `stock_media_provider_check` constraint rather than rewriting it, so
  any row that carried `nara` or `smithsonian` stays valid, is returned by
  the library search, and can still be attached to a scene by a person.
  Verified in `check-footage.mjs`: an old `nara` row is found by the
  engine's library pass while no provider named `nara` is asked.
- **Their names still print.** `providerLabel("nara")` is *US National
  Archives* and `providerLabel("smithsonian")` is *Smithsonian* in both
  copies of the label map (`platform/lib/provenance.ts`,
  `remotion/src/provenance.ts`), so a Source Watermark or a credit line on
  a film made from such a row would read correctly. The `check-provenance`
  and `check-watermark` cases that pin this are unchanged.
- **No migration rewrites data.** Nothing was renamed or nulled; there was
  nothing to migrate.

## New searches

Cannot reach them by construction: the registry is the only list the
router reads, `searchableProviders()` filters from it, and a request naming
`providers: ["nara"]` explicitly yields an empty routed list (the library
pass still answers from old rows). There is no feature flag to turn them
back on; bringing either back would be a new provider under
`lib/footage/providers/`, following `footage-provider-registry.md`.
