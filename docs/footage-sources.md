# Footage sources — the catalogue (2026-09-10)

The producer's ask: *find as many sources of real footage as you can, to
cover as many events as possible, new and old; implement them; and erase
NARA and the Smithsonian.* This is the report. The engine that searches them
is `docs/universal-footage-engine.md`; how a provider is written is
`docs/footage-provider-interface.md`; how one is chosen for a scene is
`docs/footage-provider-registry.md`.

Sixteen providers are registered now, fourteen of them searchable and two
local (URL import, uploads). Nine were added on 2026-09-10 and Destockd on
2026-09-14. Every one is a
file under `platform/lib/footage/providers/` — there are no placeholders —
and every keyed one is OFF until its key exists, reading as "off, needs
X" on `/admin/footage` and in the picker rather than failing.

## The sources

| Source | id | Tier | Covers | Media | Auth | State |
|---|---|---|---|---|---|---|
| Wikimedia Commons | `wikimedia` | archive | everything, all eras; museum and archive uploads, news photos | video + image | none | live since 2026-09-07 |
| EU Audiovisual Service | `eu_av` | official | EU institutions, summits, migration, European politics, 1990s→today | video + image | `EU_AV_API_BASE` | **opt-in, off** — no public API (below) |
| DVIDS | `dvids` | official | US military, humanitarian and disaster-response operations, 2000s→today | video + image | `DVIDS_API_KEY` | off until keyed |
| NASA Image & Video Library | `nasa` | official | space, science, aviation, Earth, 1950s→today | video + image | none | live since 2026-09-09 |
| **Internet Archive** | `internet_archive` | archive | Universal Newsreels 1929–1967, Prelinger (industrial, educational, amateur film), FedFlix / US government films, NASA reels — the filmed 20th century | video + image | none | **live, verified on real responses** |
| **Europeana** | `europeana` | archive | ~3,000 European libraries, archives, museums and broadcasters (EUscreen TV archives); European history before the newsroom era, WW1, WW2, cities, culture | video + image | `EUROPEANA_API_KEY` (demo key by default) | **live, verified on real responses** |
| **Library of Congress** | `loc` | archive | American history: National Screening Room, Prints & Photographs, early newsreels, presidents and Congress | video + image | `FOOTAGE_ENABLE_LOC=1` | **off by default** — Cloudflare blocks the box (below) |
| **Wellcome Collection** | `wellcome` | archive | history of medicine, science and public health: epidemics, hospitals, laboratories, campaigns | image | none | **live, verified on real responses** |
| **Flickr** | `flickr` | community | openly licensed photographs of recent events (protests, disasters, summits, cities on the day) plus The Commons (national libraries, no known restrictions) | image | `FLICKR_API_KEY` | off until keyed; written from the documented shape |
| **Openverse** | `openverse` | community | the Creative Commons catalogue across hundreds of sources | image | none needed; `OPENVERSE_CLIENT_ID` + `_SECRET` raise the quota | **live, anonymous** at 5 requests an hour — the box was Cloudflare-challenged on 09-10, the health strip will say if it still is |
| **Pexels** | `pexels` | stock | generic present-day B-roll, no event | video + image | `PEXELS_API_KEY` | off until keyed; written from the documented shape |
| **Pixabay** | `pixabay` | stock | generic present-day B-roll, no event | video + image | `PIXABAY_API_KEY` | off until keyed; written from the documented shape |
| **Unsplash** | `unsplash` | stock | generic present-day photographs | image | `UNSPLASH_ACCESS_KEY` | off until keyed; written from the documented shape |
| **Destockd** | `destockd` | archive | the FedFlix archive cut into 41,000+ individual SHOTS with CLIP visual search: US government films, 1910s–1990s | video | none | **live, verified on real responses** — paced on purpose (below) |
| URL import | `url_import` | library | any page that states its media and rights | both | — | local only |
| Manual upload | `user_upload` | library | the producer's own files | both | — | local only |

**Not used: NARA and the Smithsonian.** Removed at the producer's request
on 2026-09-10 — they had never been built or searched; their ids are gone
from the registry, the type union, the label maps, the tests and the docs.
An old library row filed under either name still reads (with a title-cased
id as its label). Their keys are read nowhere.

## Coverage, by what a scene asks for

| A scene about… | Who answers |
|---|---|
| a news event of the last twenty years | EU AV (once opted in), DVIDS, NASA on their subjects; Wikimedia and Flickr for the photographs; Openverse |
| Europe, 1900–1990 | Europeana first, the Internet Archive's newsreels, Wikimedia, LoC (once enabled) |
| the United States, 1900–1990 | **Destockd** (the same government films, cut to the shot), Internet Archive (Universal Newsreels, government films), LoC, Wikimedia |
| the two world wars | **Destockd**, Internet Archive, Europeana, Wikimedia, LoC |
| space, aviation, science | NASA, then the Internet Archive's NASA collection and Wikimedia |
| medicine, epidemics, public health, any era | Wellcome, then Wikimedia and Europeana |
| a place or a person, any era | Wikimedia, Flickr, Openverse, Europeana |
| generic present-day B-roll with no event ("a hospital corridor", "a street at dawn") | the archives' general coverage first, then Pexels / Pixabay / Unsplash — stock is asked ONLY when the scene names no event |

## What was measured, per source

Everything below was read off real responses fetched from inside n8n (the
web session has no outbound HTTP; a throwaway workflow made one request per
API, executions 11839 / 11840 / 11842, 2026-09-10) — except the four keyed
stock and community adapters, which no key was available for.

### Internet Archive — curated, never blind

- The first query, "moon landing", answered a YouTube mirror of a hoax video
  from the `altcensored` / `fringe` / `deemphasize` collections, uploaded by
  nobody in particular, with no licence. The community area is unlicensed by
  default and the Archive's own search does not rank for provenance.
- So the adapter asks only for items that sit in a collection whose POLICY
  is public domain (`PD_COLLECTIONS`: `prelinger`, `universal_newsreels`,
  `FedFlix`, `usgovfilms`, `nasa`) or that carry a `licenseurl` of their own;
  YouTube mirrors (`identifier:youtube*`) and the flagged collections are
  excluded outright. Stills come from the PD collections only: "berlin wall"
  images under uploader-declared licences were junk.
- So filtered, "berlin wall" answered a 1961 US Army film of the Brandenburg
  Gate under a public-domain mark — and a 2025 concert clip under
  CC BY-NC-ND, which the central classifier refuses.
- An uploader-declared licence outside the PD collections, by a creator
  that is not an institution, is `manual_review`: a licence somebody typed
  into a form is a claim, not a statement of the archive.
- The search answer's `downloadUrl` is a DIRECTORY (`/download/{id}`); the
  file (`h.264`, `MPEG4`, `512Kb MPEG4`… or `JPEG`/`PNG`/`TIFF`) is picked
  from `/metadata/{id}` at use time through `resolveDownload`. Thumbnail:
  `https://archive.org/services/img/{id}`.
- Item pages (`archive.org/details/{id}`) import through *Add from URL* via
  the adapter's own `importFromUrl`.

### Europeana

- `reusability=open` is load-bearing: the API then returns ONLY Public
  Domain Mark, CC0, CC BY and CC BY-SA items, and `rights[0]` is the URL the
  classifier reads. `media=true` keeps items with a file; `profile=rich`
  brings the place, timespan and concept labels the matcher scores.
- Video is `qf=TYPE:VIDEO` plus `qf=MIME_TYPE:video/mp4`. "berlin wall 1989"
  found no video, "war newsreel" did — the video corpus is the EUscreen
  television archives and is thinner than the images.
- `EUROPEANA_API_KEY` defaults to the documented demo key `api2demo`, which
  answers but is rate-limited; a real key is free (pro.europeana.eu) and is
  the thing to add before a ninety-scene film asks three hundred times.

### Wellcome Collection

- Keyless, `catalogue/v2/images`. A IIIF `info.json` is not a picture; the
  picture is `…/full/{width},/0/default.jpg` on the same base, which is how
  both the thumbnail and the download are built (verified with a HEAD).
- Licence per image (`cc-by`, `pdm`, `cc0`, `cc-by-nc`…); NC goes to the
  classifier and is refused like anywhere else.
- Gave the registry its `medicine` category.

### Library of Congress — built, off, measured

Every `?fo=json` request from the Hetzner box is answered with Cloudflare's
"Just a moment…" challenge (HTTP 403), which no header passes. The adapter
is written against the documented shape (`loc.gov/apis/json-and-yaml`) and
has NOT been verified on a live response; `FOOTAGE_ENABLE_LOC=1` switches it
on the day the block lifts, and the health strip on `/admin/footage` will
say whether the shape held. Only "no known restrictions" / "public domain" is
read as public domain; everything else is manual review with the Library's
own sentence attached.

### Openverse — two modes, never off

The official client answers anonymous requests, so the adapter does too
(the producer's call, 2026-09-10 — the first version switched it off without
a client, which was the wrong shape):

- **Anonymous** (no client in the environment): no header, and the API's own
  anonymous throttle — 5 requests an hour, 100 a day, at most 20 results a
  page (its `anon_burst` / `anon_sustained` rates; the API's 429 is the
  authority, the numbers here only keep us from asking for one — the docs
  could not be fetched from this session, so verify them at
  docs.openverse.org when adding the client). The adapter spends ONE request
  per search, on the most specific query, and keeps its own sliding hourly
  window: the fifth request in an hour is the last it sends until the window
  frees, reported as a rate limit so the health module holds it back for a
  quarter hour instead of collecting refusals. The provider carries a
  `notice` saying so, which the admin strip and the picker show.
- **Authenticated** (`OPENVERSE_CLIENT_ID` + `OPENVERSE_CLIENT_SECRET`, free
  at `/v1/auth_tokens/register/`): OAuth2 client credentials, token cached
  until it expires, the standard tier of 10,000 requests a day and up to
  three queries per search.

Measured on 2026-09-10: an anonymous request from the Hetzner IP was
answered with Cloudflare's "Just a moment…" challenge (HTTP 403), not JSON.
That is a fact about the address, not a reason to switch the mode off: the
health strip reports it, a held-back provider no longer costs a router slot,
and the client is the thing to add either way. Whether the authenticated
path passes the challenge from that address is unverified.

### Flickr, Pexels, Pixabay, Unsplash — written from the documentation

No key was available, so the normalizers are pinned by fixtures shaped from
the published API reference and must be watched on their first real run.
Flickr asks only for reusable licence ids (4 CC BY, 5 CC BY-SA, 7 no known
restrictions, 8 US Government, 9 CC0, 10 Public Domain Mark), so NC/ND never
arrive. Pexels and Pixabay content is `other_free` → `cleared` (no credit
owed; their licence text rides on every row). Unsplash is
`attribution_required` by its API guidelines ("Photo by X on Unsplash") and
`resolveDownload` calls the photo's `download_location` first, as those
guidelines require.

### Destockd — the archive cut into shots (2026-09-14)

`https://destockd.com`, an independent project by Elroddd, unaffiliated with
the Internet Archive, FedFlix or the US government. It takes the **FedFlix**
collection — the US government films Public.Resource.Org digitised with the
NTIS, which our `internet_archive` adapter already searches — **cuts every
film into individual shots** and indexes each shot with CLIP, so a search
reads the picture rather than the title. 41,000+ shots, free, no account, no
watermark, no attribution required by Destockd.

**Why it earns a slot next to the Internet Archive even though the footage is
the same.** The Archive hands back a twenty-minute reel, which `rank.ts`
penalises (over ten minutes is halved) and which the producer then has to
search by eye. Destockd hands back the three seconds. On a 1944 request the
router now picks Internet Archive, Destockd and Wikimedia; Europeana is what
the fourth slot costs.

The endpoints, read off the site's own client and verified against live
responses on 2026-09-14:

```
GET /api/search?q=&page=    → { query, results[], page, total, per_page, has_more }
GET /api/shot/{film}/{shot} → the same, plus archive_url, national_archives_url
result: { film, shot, keyframe, clip, preview, color_type, score }
```

`keyframe` is relative to the site; `clip` and `preview` are absolute on
`clips.destockd.com`; `score` is Destockd's own CLIP similarity, which decided
which 48 results came back. Our ranker re-scores them on the scene, and the
only text a shot has is its FILM TITLE — which on FedFlix is often the whole
record ("Apollo (11) Spacecraft #107, Saturn V Rocket, AS-506, Launch and
Tracking - July 16, 1969"), so the subject, the place and the year reach
`searchableText` and `yearsMentioned`. A thin title ranks thin, honestly.

**What this client owes the site, and why it is written into the code.**
Destockd's robots.txt is `Allow: /` with `Disallow: /api/`. Nothing here
defeats a password, a paywall, a signed URL or any protection — the endpoints
are public and unauthenticated and the footage is public domain — but that
line is still the operator's preference about automated traffic, and **the
producer decided on 2026-09-14 to integrate anyway, with the operator to be
told**. So the adapter is a polite client rather than a crawler, in code:

- **One request per scene.** Every other adapter runs up to three queries;
  this one takes the most specific and stops.
- **A self-imposed ceiling of 20 requests a minute**, enforced before the
  request is made. Past it the adapter refuses itself and `health.ts` holds
  it back.
- **A User-Agent that names us and how to reach us**, so a look at their logs
  is enough to ask us to stop.
- **429, or a 403 that is Destockd's own, is "stop", not "retry"** — it becomes
  a rate limit, which is a fifteen-minute hold. A Cloudflare challenge is the
  one exception, below.
- The engine's own 6-hour cache sits in front of all of it.
- `FOOTAGE_DESTOCKD=off` switches the search off in one repo Variable, and the
  import doors keep working.

**Cloudflare sits in front of it in MANAGED mode, which SAMPLES — a challenge
is a coin toss, not a verdict.** The first live search after the deploy came
back `403` with `cf-mitigated: challenge`, and the adapter called that a rate
limit and went dark for fifteen minutes. It was not a rate limit. Four
requests from the same box, in the same minute, with the same identity,
measured 2026-09-14:

| User-Agent | result |
|---|---|
| our own `HouseOfVideos/1.0 (…)` | **200**, 48 clips (×3, one sampled `403`) |
| n8n's default `axios/…` | **200**, 48 clips |
| a Chrome-like string | **403**, `cf-mitigated: challenge`, every time |

So **the honest bot User-Agent is both the polite option and the working
one**, and a browser-shaped one is what gets blocked — do not ever "fix" a
challenge by pretending to be a browser. `getJson` now retries a challenge
exactly ONCE, as ourselves, counting the retry against the same per-minute
budget; twice challenged throws a message that says *challenge* and
deliberately avoids the words "rate limit", because `health.ts` greps for
them and would apply the fifteen-minute hold instead of its ordinary five —
and because that text reaches the admin page verbatim, where "rate limit
reached" would tell the reader we had been impolite when we had not.

**Still owed: tell the operator.** `contact@destockd.com` is published on the
About page. One email saying who we are, what we fetch and at what rate is
the difference between a polite client and an uninvited one.

**Rights are `pd`, auto-approved, same as FedFlix through the Archive.** Their
legal page states the FedFlix/government-production basis, notes it has not
independently verified individual clips or embedded elements, and points out
that public-domain status clears no music, no material from other sources and
no model, property, trademark or publicity rights. That full text rides on
every asset as `rightsText` and shows on the card. Treating it as PD matches
what `internet_archive` already does with the identical films, which is the
consistency that matters: the same footage must not change rights class
because it came through a different door.

**One wording trap, already paid for once by DVIDS.** The rights text must not
contain the validator's own trigger phrases — "third-party" is one — or every
clip is flagged as somebody else's material by its own disclaimer. It says
"footage from other sources" instead, which means the same thing to a reader.

**Imports still work**, and are the way to use a shot you found by browsing:
a clip file URL is filed under `destockd` (the directory is the film, the
filename the shot), a `#/shot/<film>/<shot>` page is read from the FRAGMENT —
which never reaches a server — and resolved through `/api/shot`, and a
`#/film/<film>` page names no shot, so the FedFlix item on archive.org is
handed back instead.

### EU Audiovisual Service — opt-in, and why

The Commission publishes no developer API. Fetched from n8n, the search page
is an Angular application talking to an internal AWS API Gateway with a
bearer token embedded in the application's own JS bundle. That token is an
access control, not an offer, and the spec's URL-import rule — never bypass
DRM, paywalls, authentication, access controls, signed-URL restrictions or
platform protection — applies to an adapter as much as to a paste. **It is
not used, and must never be written into this repository or its docs.**

So `eu_av` is enabled only when `EU_AV_API_BASE` names an endpoint the
Commission actually offers; the earlier default (a path that does not exist)
is gone. The adapter's defensive reader stays for that day, and an EU AV
PAGE still comes in through *Add from URL* with the rights the page states.

## Considered and not built

| Source | Why not |
|---|---|
| DPLA (Digital Public Library of America) | an aggregator whose largest contributors are the two institutions the producer retired |
| NOAA, USGS, ESA, UN Web TV, NATO Multimedia, European Parliament Multimedia | rich material, no search API or terms that admit automated reuse; they enter through *Add from URL* page by page |
| YouTube, Vimeo, Dailymotion, social platforms | the spec forbids ripping; URL import reads their metadata only |
| AP Archive, Getty, Reuters, British Pathé, Critical Past | commercial licences; a page from them is `manual_review` by the third-party rule |

## The keys — where they go and what each unlocks

All of them are GitHub repo **Secrets** (the deploy writes `platform.env`
from them; nothing on the box is edited by hand), and every one is a
WARNING in the deploy gate, never an error — a missing key switches one
source off and touches nothing else.

| Secret | Unlocks | Sign-up |
|---|---|---|
| `EUROPEANA_API_KEY` | a rate limit worth having (the demo key works meanwhile) | pro.europeana.eu/page/get-api |
| `DVIDS_API_KEY` | DVIDS | api.dvidshub.net (request a key) |
| `FLICKR_API_KEY` | Flickr | flickr.com/services/apps/create |
| `PEXELS_API_KEY` | Pexels video + photos | pexels.com/api |
| `PIXABAY_API_KEY` | Pixabay video + photos | pixabay.com/api/docs |
| `UNSPLASH_ACCESS_KEY` | Unsplash (50 requests/hour in demo mode) | unsplash.com/developers |
| `OPENVERSE_CLIENT_ID` + `OPENVERSE_CLIENT_SECRET` | Openverse at 10,000 requests a day instead of the anonymous 5 an hour | api.openverse.org/v1/#tag/auth |

Two repo **Variables** (not secrets): `FOOTAGE_ENABLE_LOC=1` turns the
Library of Congress on; `EU_AV_API_BASE` turns the EU service on, and is
left unset.

## What changed in the engine to hold fifteen

- **Tiers** (`ProviderTier`: official | archive | community | stock |
  library) on every provider, and a tier-aware router: score = 2 ×
  category matches + a fit for the tier (official leads on its own subjects,
  archives own history and are the fallback through `general`, communities
  cover recent events and places, stock is asked only for a scene that
  names no event). Still at most four providers per request — and a
  provider the health module is holding back gives its slot to the next
  candidate instead of occupying one with a refusal.
- **A provider can be on with a caveat.** `FootageProvider.notice` is a
  line the admin strip and the picker chips show on an ENABLED provider
  (Openverse's anonymous quota); `disabledReason` stays what it was, and a
  provider with a notice is still routed.
- **`attach.ts` resolves bytes through `provider.resolveDownload`** — the
  Archive's directory URL, NASA's preview, Unsplash's download endpoint —
  instead of trusting the search-time `downloadUrl`.
- `classifyLicense()` understands `creativecommons.org/licenses/publicdomain/`
  (the old public-domain licence URL some Archive items carry).
- `PROVIDER_RELIABILITY` (how far to trust a source's metadata): LoC 0.9,
  Europeana 0.8, Wellcome 0.8, Internet Archive 0.6, Flickr 0.5, Openverse
  0.5, stock 0.4.
- Both label maps (`platform/lib/provenance.ts`, `remotion/src/provenance.ts`)
  print the new names on the source watermark and the credit line.
- `/admin/footage`'s provider chips are built from the health list, so a
  new provider needs no UI change.
- `db/011_footage_sources.sql`: the table and column comments no longer
  name retired providers; one index `(provider, media_type, created_at)`.
  Nothing to migrate — db/010 already made `provider` a free string.
- The `Archive Suggestions` prompt (n8n, active `a3278855` since
  2026-09-10) names the new sources and adds the `stockshots` footage type
  for event-less B-roll.
- `npm run check:footage`: 214 checks, the nine new normalizers pinned on
  the real responses above (fixtures for the four keyed ones from the
  documented shapes), URL import skipping a provider that is off, both
  Openverse modes with the anonymous budget, and the router's `skip`.

## Still owed

- Put the keys in. Until then the live set is Wikimedia, NASA, the Internet
  Archive, Europeana (demo key), Wellcome and Openverse (anonymous, five
  requests an hour).
- Watch the first real run of each keyed adapter; their fixtures are the
  documentation's word, not a measurement.
- Print archive credits on the end screen (Remotion, i.e. a Railway push).
