# Who made this film — 2026-09-15

The producer's ask: "când dăm create la un proiect, înainte de toate, who is
making the project cu 4 opțiuni: Alex, Dan, David, Iustin — și după, la fiecare
video nou, jos să apară created by și numele persoanei, doar să putem ține
scorul de cine face ce."

A scoreboard, not a user system. Nobody logs in — the site has one shared
password — so the honest thing it can record is which of the four said they
were at the keyboard, and the honest thing it can do with that is count.

## What it is

| Where | What |
|---|---|
| `/new`, above section 01 | Four chips, "Who is making this". The last pick is remembered on that computer, and **Start production is disabled until one is chosen** |
| Orchestrator → `Normalize Webhook Input` | Stores `Editing Options.createdBy`, whitelisted to the four names |
| `derive.ts` | `CREATORS`, `normalizeCreatedBy()`, `Project.createdBy` |
| the project page, at the foot | "Created by David" |
| a library card, at the foot | "David · 4 min ago" |
| the index row | "96s · Dramatic · David" |
| under the library list | "Showing 1–15 of 42   Alex 12  Dan 8  David 5  Iustin 3" |

**Nothing in the pipeline reads it** — no prompt, no gate, no render. It is
inert everywhere except the four screens above.

## Three decisions worth keeping

**It is stored by n8n, not by a site write after creation.** The obvious
shortcut was `updateEditingOptions` right after the webhook answers, the way
`sourceWatermark` is written. That loses the name on any film created with a
reference photo: `Merge Ref Image` rebuilds the WHOLE Editing Options from
`Normalize Webhook Input`'s value and PATCHes it back seconds later, so
anything merged in between is overwritten. Going through Normalize puts the
name in at creation, where the rebuild carries it along.

> **This is a live defect for `sourceWatermark`**, which is written that way
> and is therefore silently restored to ON for any film that carries a
> reference photo and refused the label. Not fixed here — it needs
> `Merge Ref Image` to re-read the record rather than rebuild from
> normalize-time state, which is a change to the ref-image chain.

**The list is closed, and it is whitelisted twice.** The value crosses a
webhook body, an n8n Code node and a jsonb column before it reaches a project
card, so anything that is not one of the four reads as "nobody said" — exactly
what every film made before today reads as. `npm run check:created-by` parses
the whitelist out of `code/orch-Normalize_Webhook_Input.js` and asserts it
matches `CREATORS`, because a drift between the two copies has no loud
failure: the brief would post a name, n8n would drop it, and the project would
come back unnamed.

**Remembered, but gated.** Pre-selecting the last name makes the common case
one click already made; blocking the submit makes the score complete. A name
that can be skipped is a name that gets skipped, and the chips sit at the very
top with the current one lit, so somebody else at the same desk sees a name
that is not theirs before they type a word. The reason is printed under the
disabled button, because the chips are a screen away from it.

## Rollback

- n8n: `publish_workflow` with `40ae627e-ff07-4b9a-8179-0f65289133ac`. The node
  body that version carries is `original/orch-Normalize_Webhook_Input.js`.
- site: revert the commit. Stored names stay in the jsonb and simply stop being
  read; nothing else looks at the key.

## Apply record

| | |
|---|---|
| Orchestrator `8CienBFfG6SgbB1A` | active `008f0f47` (was `40ae627e`) |
| draft diffed against active | exactly one node differs (`Normalize Webhook Input`), connections and settings identical, both Drive nodes keep `resource`/`operation`, no dangling `$('…')` |
| node body | byte-identical to `code/orch-Normalize_Webhook_Input.js` |

Verified before the publish and after it:

- The published body run against the site's real payload: the four names store,
  `""` / absent / `"Bob"` / `"alex"` store nothing, and every other key in
  Editing Options is byte-identical to what the same payload produced before.
- `npm run check:created-by` — 25 checks over the real `derive.ts`.
- **Looked at in a real browser** (Playwright chromium, `next dev`), which is
  the house rule after two invisible CSS defects shipped: the chips render at
  38px with a real ground and border, the picked one goes accent-purple, the
  hidden input carries the name, the submit is disabled with its reason before
  a pick and enabled after, the choice survives a reload, there is no
  horizontal overflow at 390px, the card foot reads "Alex · Awaiting Image
  Approval", the tally reads "Alex 1 Dan 1 David 1 Iustin 1", and the project
  page ends on "Created by Alex".

Not yet seen: a real film created through the form. The write is one spread
into an object that already carries six keys the same way, and the published
body was exercised on the exact payload `createProject` posts.
