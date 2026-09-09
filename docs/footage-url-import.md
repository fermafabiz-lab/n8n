# Universal URL import

`POST /api/footage/import` and `platform/lib/footage/urlImport.ts`. A
producer pastes the address of a page (or a bare media file) on a
government, institutional or archive site; the site reads what the page
STATES about its media and files it in the library as a `url_import` asset.

## What it is not

**This is not a downloader.** It does not bypass DRM, paywalls, logins,
access controls, signed-URL restrictions or platform protection, and it
does not rip video from news or social platforms. Concretely
(`urlImport.ts`):

- **Platform hosts are never fetched for media.** YouTube, Vimeo, TikTok,
  Facebook, Instagram, X/Twitter, Dailymotion, Twitch, Reddit, Snapchat and
  their short-link domains (`NO_RIP_HOSTS`) yield the page's TITLE and
  metadata only, no media URL, and rights `manual_review` with the reason
  *the platform's terms decide, not a licence on the page*.
- **An HLS or DASH manifest is never a media file** (`.m3u8`, `.mpd`) —
  those are how protected streams are delivered.
- **A page that answers 401 or 403 is refused**, not fetched around; the
  message says the page is behind an access control.
- **Only `http(s)`**, never `file:`, `ftp:` or `data:`; never a URL with
  embedded credentials; never an address inside the box (`web`, `n8n`,
  `postgres`, `localhost`, private ranges) — the same guard every
  server-side fetch here needs.
- 20-second read, 8 MB page cap, no JavaScript execution.

## What it reads

`readPage(url, html)` is pure — the whole reader is testable on a saved
page — and takes, in order of trust:

| Field | From |
|---|---|
| title, description | `og:title`, `og:description`, JSON-LD `name`, `<title>` |
| media file | `og:video` / `og:video:secure_url`, JSON-LD `contentUrl`, a `<video src>` or `<source>`, `og:image` for stills; a bare `.mp4/.webm/.mov/.jpg/.png` URL is imported as itself |
| thumbnail | `og:image`, JSON-LD `thumbnailUrl`, resolved against the page |
| filming vs publication date | JSON-LD `dateCreated` vs `uploadDate`/`datePublished`, Dublin Core `created`, `article:published_time` — kept apart, and never "today" |
| creator, publisher | JSON-LD `author`/`publisher`, `og:site_name`, `author`/`DC.creator` metas |
| location, country | JSON-LD `contentLocation` |
| duration | ISO 8601 `duration` (`PT1M30S` → 90) or `video:duration` |
| rights | `rel="license"` link, JSON-LD `license` (creativecommons.org URLs are understood), `copyrightNotice`/`copyright` metas, `copyrightHolder`; then the host's published policy (`DOMAIN_RIGHTS`: europa.eu, nasa.gov, defense.gov/mil sites); else *No licence stated on the page* |

A Wikimedia Commons `File:` page is routed to the Commons adapter instead
(`matchesUrl` / `importFromUrl` on the provider), so it arrives as a
`wikimedia` asset with the template's licence.

## Rights

- A licence the page states is classified by `classifyLicense()` like any
  provider's.
- A host policy default (europa.eu → CC BY; nasa.gov, .mil → public domain)
  is applied as **`manual_review`**, never auto-cleared: a policy is not a
  statement about this file.
- No licence at all → **`manual_review`** (spec: "If rights cannot be
  determined: manual_review"), with the reason on the warnings list.
- Platform pages → `manual_review` by the platform's terms.

## Two steps, on purpose

1. `{ url }` → the extracted asset, unsaved, with `rights` and `warnings`.
   The producer sees what the page actually stated — title, dates, whether
   a media file was even exposed, and *Rights status: Manual Review* — before
   anything is filed.
2. `{ url, confirm: true, …overrides }` → filed. Overrides are limited to
   what a person may set: title, description, event, location, country,
   filming date, attribution, notes, and `rights` — a downgrade is honoured,
   an upgrade over a licence the page marked restricted is not. A person
   who confirms `cleared` / `attribution_required` records their act: the
   row is `approved`, `rightsText` gains *Rights confirmed by the producer
   at import*, and `verified_note` says who.

## Provenance

**An import is never authentic by import** (spec §25). `provenance` is
`unknown` and `assessProvenance()` keeps it there however well the metadata
matches; the admin page's *Change provenance* is the only way up, and it
requires the event, place and date to be filled in for `actual_footage`.

## Identity

`providerAssetId` is a hash of the canonical URL (`canonicalUrl()` drops
tracking parameters, fragments and mobile hosts), so the same page pasted
twice is one row; a downloaded file's `content_hash` is a second identity
with a partial unique index.

## UI

`FootageImport` (components/FootageImport.tsx) — reachable from the
picker's *+ Add from URL* and the admin page's *Add footage from URL*: paste,
*Read the page*, review the preview (thumbnail, title, dates, rights chip,
warnings), fill or correct the fields, confirm. Own stylesheet
(`FootageForms.module.css`).

## Tested

`check-footage.mjs`, section *url import*: OpenGraph title and media,
relative thumbnail, shot-vs-published dates, ISO duration, creator and
place, a CC BY licence URL read as `attribution_required`, `unknown`
provenance, `url_import` provider, no licence → manual review with the
reason listed, a platform page yields no media URL and manual review, a
europa.eu page without a licence takes the policy as manual review, an HLS
manifest is never a media file, an in-box address / a non-http scheme / an
access-controlled page are refused, and a Commons page goes through the
Commons adapter.
