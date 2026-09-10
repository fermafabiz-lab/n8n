# FootageProviderRegistry and the router

`platform/lib/footage/registry.ts`. The registry knows what each provider is
GOOD FOR and what KIND of source it is; the router reads a request and asks
only the providers that fit. The spec's rule is explicit — *never search
every provider for every scene* — and the router enforces it with a cap of
**four** providers per request.

## The registry

```ts
PROVIDERS = [
  euAv, dvids, nasa,                                     // official
  internetArchive, europeana, loc, wikimedia, wellcome,  // archive
  flickr, openverse,                                     // community
  pexels, pixabay, unsplash,                             // stock
  urlImport, userUpload,                                 // library
]

allProviders()          // the fifteen, in that order
providerById(id)        // null for anything retired or unknown
searchableProviders()   // enabled, not localOnly, can search video or image
providerFilterOptions() // the picker's chips: {id, label, enabled, reason, tier}
```

`enabled` is a getter wherever it depends on the environment — a key
(`DVIDS_API_KEY`, `FLICKR_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`,
`UNSPLASH_ACCESS_KEY`, `OPENVERSE_CLIENT_ID` + `_SECRET`) or a switch
(`FOOTAGE_ENABLE_LOC`, `EU_AV_API_BASE`) — so a key added to the environment
takes effect on the next request, and a missing one makes the provider read
as off with its `disabledReason` naming the key.

## Tiers

`FootageProvider.tier` says what kind of source it is; the router turns that
into a fit for the request (`tierFit`).

| Tier | Who | What it means to the router |
|---|---|---|
| `official` | EU AV, DVIDS, NASA | a body's own footage of its own events: **+3** when one of its categories is in the request, else 0; never searched for history unless it can (`searchCapabilities.historical`) |
| `archive` | Internet Archive, Europeana, LoC, Wikimedia, Wellcome | dated material with a rights statement per item: **+2** on a historical request, **+1** on any named event, and **+2** more for claiming `general`, which makes it the fallback for everything |
| `community` | Flickr, Openverse | photographs of the day: **+1** on a recent event or a place; on history only if it has some (+0.5), else out |
| `stock` | Pexels, Pixabay, Unsplash | generic present-day B-roll: **+1** only when the scene names NO event, does not demand one, and wants pictures; **never otherwise** — a real clip of the wrong thing is not real footage of anything |
| `library` | URL import, uploads | never routed; the engine's library-first pass reads their rows |

## Categories

| Provider | Categories | Priority |
|---|---|---|
| `eu_av` | europe, politics, migration, government, eu, geopolitics, humanitarian | 90 |
| `dvids` | military, war, aviation, humanitarian, disaster, geopolitics, government | 90 |
| `nasa` | space, science, technology, earth, missions, aviation | 90 |
| `internet_archive` | general, history, war, politics, events, places, people, science, technology, aviation, space | 85 |
| `europeana` | history, europe, politics, events, places, people, war, science, eu | 85 |
| `loc` | history, politics, people, places, events, war, government, science | 80 |
| `wikimedia` | general, history, places, people, events, politics | 75 |
| `wellcome` | medicine, science, history | 70 |
| `flickr` | events, places, people, politics, disaster, humanitarian, migration, history | 70 |
| `openverse` | events, places, people, politics, history, science | 65 |
| `pexels` / `pixabay` / `unsplash` | stock | 50 / 45 / 40 |

`requestCategories(request)` derives a request's categories from its
structured fields (topic, event, place, country, people, organisations,
keywords) and the first 600 characters of narration, through the
`CATEGORY_TERMS` regex table — plain English plus the Romanian stems that
recur in this pipeline's scripts. `medicine` (epidemics, hospitals, vaccines,
surgery…) arrived with Wellcome. A `dateFrom` before 1995 adds `history`
whatever else the text says.

## Routing

```ts
routeProviders(request, { only?, max = 4, historical? }) → [{ provider, matches, score }]
```

1. An explicit `only` list (the picker's filter) is honoured as given.
2. Otherwise every searchable provider is scored: **2 × the request
   categories it claims** (`general` excluded) **+ its tier fit** from the
   table above. A fit of −∞ removes the provider.
3. Providers scoring above zero are kept, highest first, priority breaking
   ties; the list is cut at `max`.

Measured in `check-footage.mjs`: European migration → EU AV first with the
archives along; a military exercise → DVIDS first; an Artemis launch → NASA
first, over the general archives; a European Council meeting → EU AV; the
Normandy landings → no newsroom at all, Wikimedia + Internet Archive +
Europeana; an 1854 cholera outbreak reaches Wellcome; a street at dawn with
no event gets Pexels LAST, behind the archives' general coverage, while "a
quiet BORDER town" names a subject and the official sources fill the four
slots; never more than four; `only: ["nasa"]` → NASA alone.

## The engine's use of the report

`searchFootage()` lists every searchable provider in its `providers`
report: routed ones with their count and time (or the failure reason —
timeout, rate limit, held back, connection reset), unrouted ones with
`reason: "not routed for this subject"`. The picker prints that list under
the results so a producer can see which archives were asked and which
declined.

## Adding a provider

1. `providers/<id>.ts` exporting a `FootageProvider` — a pure normalizer,
   a `search` that calls it, `checkRights` = `validateRights`, a `tier`.
2. One entry in `PROVIDERS`, in its tier's block; categories and priority
   chosen from the table above.
3. `PROVIDER_RELIABILITY[id]` in `rank.ts` (how far to trust its METADATA)
   and `PROVIDER_LABELS[id]` in BOTH `platform/lib/provenance.ts` and
   `remotion/src/provenance.ts` (what the watermark and the credit print).
4. The id in `ARCHIVE_PROVIDERS` (`lib/archive/types.ts`), in registry
   order — the test asserts the two lists are equal.
5. If it needs a key: the getter pattern, a WARNING line in the deploy
   workflow's secrets gate, and the variable in the heredoc that writes
   `platform.env`.
6. A saved response and a normalizer case in `check-footage.mjs`.

Nothing else changes. The scene-matching path, the picker, the suggestion
run and the admin page all read the registry — the admin page's provider
chips are built from the health list, so a sixteenth provider needs no UI
change.
