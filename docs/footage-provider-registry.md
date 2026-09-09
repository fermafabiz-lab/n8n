# FootageProviderRegistry and the router

`platform/lib/footage/registry.ts`. The registry knows what each provider is
GOOD FOR; the router reads a request and asks only the providers that fit.
The spec's rule is explicit — *never search every provider for every scene* —
and the router enforces it with a cap of **four** providers per request.

## The registry

```ts
PROVIDERS = [euAvProvider, dvidsProvider, nasaProvider, wikimediaProvider, urlImportProvider, userUploadProvider]

allProviders()          // the six, in priority order
providerById(id)        // null for anything retired or unknown
searchableProviders()   // enabled, not localOnly, can search video or image
providerFilterOptions() // what the picker's provider chips show: {id, label, enabled, reason}
```

`enabled` is read at call time (DVIDS's is a getter over `DVIDS_API_KEY`),
so a key added to the environment takes effect on the next request, and a
missing one makes the provider read as off with its `disabledReason`
naming the key.

## Categories

A provider declares the categories it is strong in:

| Provider | Categories | Priority |
|---|---|---|
| `eu_av` | europe, politics, migration, government, eu, geopolitics, humanitarian | 90 |
| `dvids` | military, war, aviation, humanitarian, disaster, geopolitics, government | 90 |
| `nasa` | space, science, technology, earth, missions, aviation | 90 |
| `wikimedia` | general, history, places, people, events, politics | 75 |

`requestCategories(request)` derives a request's categories from its
structured fields (topic, event, place, country, people, organisations,
keywords) and the first 600 characters of narration, through the
`CATEGORY_TERMS` regex table — plain English plus the Romanian stems that
recur in this pipeline's scripts. A `dateFrom` before 1995 adds `history`
whatever else the text says.

## Routing

```ts
routeProviders(request, { only?, max = 4, historical? }) → [{ provider, matches }]
```

1. An explicit `only` list (the picker's filter) is honoured as given.
2. Otherwise every searchable provider is scored by how many of the
   request's categories it claims.
3. A **historical** request (category `history`, or the option) zeroes the
   matches of any provider without `searchCapabilities.historical` — the
   newsrooms (EU AV, DVIDS) cannot search 1944, and the archive can.
4. Providers with at least one match are kept, most matches first, priority
   breaking ties; a provider that claims `general` (Wikimedia) rides along
   at the end so an unusual subject is never met with silence.
5. The list is cut at `max`.

Measured in `check-footage.mjs`: European migration → EU AV first with
Wikimedia along; a military exercise → DVIDS first; an Artemis launch → NASA
first; a European Council meeting → EU AV; the Normandy landings → Wikimedia
only; never more than four; `only: ["nasa"]` → NASA alone.

## The engine's use of the report

`searchFootage()` lists every searchable provider in its `providers`
report: routed ones with their count and time (or the failure reason —
timeout, rate limit, held back, connection reset), unrouted ones with
`reason: "not routed for this subject"`. The picker prints that list under
the results so a producer can see which archives were asked and which
declined.

## Adding a provider

1. `providers/<id>.ts` exporting a `FootageProvider` — a pure normalizer,
   a `search` that calls it, `checkRights` = `validateRights`.
2. One entry in `PROVIDERS`, categories and priority chosen from the table
   above.
3. `PROVIDER_RELIABILITY[id]` in `rank.ts` (how far to trust its METADATA)
   and `PROVIDER_LABELS[id]` in `lib/provenance.ts` (what the watermark
   prints).
4. If it needs a key: the getter pattern from DVIDS, a WARNING line in the
   deploy workflow's secrets gate, and the variable in the heredoc that
   writes `platform.env`.
5. A saved response and a normalizer case in `check-footage.mjs`.

Nothing else changes. The scene-matching path, the picker, the suggestion
run and the admin page all read the registry.
