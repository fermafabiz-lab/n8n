# FootageRightsValidator

`platform/lib/footage/rights.ts`. One answer to "may this be rendered", for
every provider, in the six-way class the spec asks for:

| `RightsResult.status` | Meaning | Automatic render | Human may use |
|---|---|---|---|
| `cleared` | use freely, no credit owed | yes | yes |
| `attribution_required` | use freely, credit owed | yes (credit drawn by the render whatever the watermark switch says) | yes |
| `editorial_only` | the provider allows editorial use only | **no** | yes, after confirming |
| `manual_review` | nobody can tell yet | **no** | yes, after confirming |
| `unknown` | nothing stated at all | **no** | yes, after confirming |
| `restricted` | the licence says no | **never** | **never** |

```ts
validateRights(asset)            → RightsResult { status, license?, attribution?, originalRightsText?, reason? }
usableAutomatically(result)      → cleared | attribution_required
usableWithReview(result)         → anything but restricted
renderable(result, libraryStatus)→ automatic classes, or a review class the row records as approved/used
attributionLine(asset)           → "<creator> · <provider> · <licence>" as the render prints it
```

## The two hard rules

- **`restricted` never reaches a render.** The engine removes it before
  ranking (`engine.ts` step 4) — it is not a low score, it is absent. The
  attach path refuses it, the admin page cannot raise a rejected licence,
  and `renderable()` answers false whatever the row says.
- **Review classes reach a render only through a human act.** The
  producer's own "Use — I accept the rights" in the picker, or *Verify* on
  the admin page, both of which write `stock_media.status = 'approved'` on
  the row. The suggestion run (`/api/archive/suggest`) never offers a review
  class at all — an automatic path cannot pass one.

## How the class is decided

The library already stores a licence verdict per asset (`rightsStatus`,
`reviewStatus`, `attributionRequired`) from `classifyLicense()` in
`lib/archive/rights.ts`, the only code that reads a licence string. The
validator layers the provider's own rights words on top, in this order:

1. `reviewStatus === "rejected"` (an NC/ND licence, a stated DVIDS
   restriction) → `restricted`.
2. The rights text or licence says *editorial use only* → `editorial_only`,
   even over an otherwise free licence: the provider's own words are the
   stricter of the two.
3. A **third party** is named as the owner → `manual_review`. Words that can
   only mean somebody else (*courtesy of*, *third party*, *used with
   permission*, Getty, Reuters, AP, AFP, Shutterstock) always do; a
   copyright claim (`©`, *all rights reserved*) does only when it names
   someone other than the provider's own organisation — "© European Union"
   on an EU AV item is the provider asserting its own licence, "© ESA" on
   a NASA page is not. Commons rows are exempt: the uploader chose the
   licence and the template records it.
4. `reviewStatus === "manual_review"` → `manual_review`, or `unknown` when
   nothing at all was stated (no licence, no text). A URL import whose page
   states nothing is `manual_review`, not `unknown` — the page WAS read.
5. Otherwise `attribution_required` when the licence asks for credit, else
   `cleared`.

## Licence URLs

`classifyLicense()` understands a licence given as its creativecommons.org
URL (`/licenses/by-nc-sa/4.0/`, `/publicdomain/zero/1.0/`,
`/publicdomain/mark/1.0/`, and the old `/licenses/publicdomain/` some
Internet Archive items carry), which is how a web page's `rel="license"`
link, JSON-LD `license`, an Archive `licenseurl` or a Europeana `rights[0]`
states it. The NC/ND tests still come first, so `by-nc-sa` is refused
before `by` is seen.

## What each source's rights look like

| Source | How the class is reached |
|---|---|
| Internet Archive | an item from a public-domain collection is PD; a `licenseurl` is classified like any CC URL; an uploader-declared licence outside those collections by a non-institutional creator is `manual_review` — a licence typed into an upload form is a claim, not the archive's statement |
| Europeana | `reusability=open` means only PDM / CC0 / BY / BY-SA ever arrive; `rights[0]` is the URL |
| Library of Congress | rights are prose per item; only "no known restrictions" / "public domain" reads as PD, everything else `manual_review` with the Library's sentence as `rightsText` |
| Wellcome | licence id per image (`cc-by`, `pdm`, `cc0`, `cc-by-nc`…) |
| Flickr | only licence ids 4 (BY), 5 (BY-SA), 7 (no known restrictions), 8 (US Government), 9 (CC0), 10 (PDM) are requested, so NC/ND never come back |
| Openverse | `license` + `license_version` codes on every row |
| Pexels, Pixabay | their own free licences → `rightsStatus: other_free`, `cleared`, no credit; the licence text (no unaltered resale, no implied endorsement) rides on the row as `rightsText` |
| Unsplash | `attribution_required` by the API guidelines: the render prints "Photo by <name> on Unsplash" |

## Attribution versus the watermark

`attributionLine()` is the legally required credit, composed from the
creator, the provider's display name and the licence. It is drawn by the
render for every `attribution_required` asset regardless of
`sourceWatermarkEnabled`. The Source Watermark is a different thing — a
statement about what the picture IS (`footage-provenance.md`) — and one
does not switch the other off.

## Tested

`check-footage.mjs`, section *rights*: each class from each normalizer,
the editorial override, the third-party rule on NASA and DVIDS and its
exemption on Commons, `renderable()` before and after approval, and the
restricted asset absent from an engine result rather than ranked low.
