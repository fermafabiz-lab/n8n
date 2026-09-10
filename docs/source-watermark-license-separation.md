# The watermark and the licence credit are two systems

They look alike on screen — small text, same corner, same typeface — and
conflating them would be the single most expensive mistake available here.

|  | Source watermark | Licence attribution |
|---|---|---|
| what it is | transparency about how a visual was made | a condition of the licence we are using the asset under |
| who decides | the producer, per film | the licence |
| may it be switched off? | yes | **no** |
| governed by | `Editing Options.sourceWatermark` | `stock_media.attribution_required` on the asset |
| drawn by | `SourceWatermark`'s label + source line | `SourceWatermark`'s credit line |

## What switching the watermark off actually does

It removes the **label** and the **source line**. It does not:

- stop provenance being classified — `refreshSceneVisualOrigin` and
  `attachStockToScene` write `visual_origin` regardless;
- stop provenance being stored — the columns and `hov.at_scene`'s `Provenance`
  key are untouched by the flag;
- stop provenance reaching the render — `Source Watermark` copies it either way;
- **remove a credit a licence requires.**

`planWatermarkBands(scenes, {showLabel: false})` keeps exactly the bands that
carry a credit and drops the rest. A CC BY-SA archive photo still prints
`Helmut Laux · Wikimedia Commons · CC BY-SA 3.0 de`; an AI scene, which owes
nothing, disappears entirely. Both are pinned by `npm run check:watermark`.

## Where the credit comes from

`attributionFor(provenance)`:

1. an already-composed `attributionText`, if something upstream supplied one;
2. otherwise, only when `attributionRequired` is true, `creator · provider ·
   licence` — from the `stock_media` row, with the provider's display name
   ("Wikimedia Commons", not "wikimedia") resolved by `providerLabel`.

`attributionRequired` is set by `platform/lib/archive/rights.ts` when the asset
was filed, from the licence itself. Public-domain and CC0 assets ask for
nothing, so they get nothing — the source line is where a courtesy credit lives.

The sentence is composed **where it is printed** rather than in the SQL view, so
the provider's display name has one owner per package instead of a third copy in
`db/009`.

## A detail worth keeping

Wikimedia Commons answers the author field with the wiki **template** that
renders it, so a real photographer arrives as `Template:Helmut Laux` — measured
on the Bundesarchiv photograph of Stalin and Ribbentrop, which is CC BY-SA and
therefore precisely the case where the credit has to be right. `cleanCreator`
strips the prefix on both sides. It is stripped at display rather than in the
archive adapter because the rows already in the library carry it and a new
search will not revisit them.

## Still owed

Nothing prints these credits on the **end screen**. This change puts the
obligation on screen for the duration of each scene that owes one, which is
stronger than a credits roll and does not depend on a viewer watching to the
end — but a consolidated end-screen credit list is still the conventional form,
and it remains an open item in CLAUDE.md.
