# Lessons — the site

Part of the split of the old monolithic `CLAUDE.md` (2026-09-13). Read the
root `CLAUDE.md` first. This file is `platform/` (Next.js): review UI,
keyboard shortcuts, mobile/Daylight layout, the language/voice pickers,
hands-off auto-approve, documentary mode and the footage engine, the source
watermark, and everything else a producer clicks.

These each cost hours. Do not rediscover them.

### Hands-off mode (auto-approve) — the site's hand, not n8n's

`Editing Options.autoApprove` (brief section 08, off by default and strictly
`=== true`) makes the film run end to end with nobody clicking: script, scene
texts, takes, images, clips, and the final render press. Three design points
carry the whole feature:

- **n8n is untouched.** The gates keep polling the same checkboxes; only WHO
  ticks them changes. `Normalize Webhook Input` stores the flag and nothing
  in any workflow reads it — which means every gate behaviour documented in
  this file (batch scoping, asset-existence requirements, regen dispatch)
  holds under hands-off exactly as under a human.
- **The tick approves through the SAME server actions the buttons call**
  (`autoApproveTick` in `actions.ts` → `approveScript`, `approveAllScenes`,
  `approveVoices`, `approveAllOfKind`, `confirmFinalSettings`), never through
  writes of its own. That is the safety argument: the stale-clip rule, the
  regen-flag respect and the save-and-approve semantics ride along, and
  anything those actions learn later, hands-off learns with them. It skips
  scenes with a regen flag in flight and a rejected script (a rewrite is
  coming; the thing to approve does not exist yet).
- **The page IS the scheduler — via AutoPilot's OWN setInterval, never via
  AutoRefresh.** `router.refresh()` re-renders server components and
  RECONCILES client ones — it does not remount them — so the first version's
  mount-only tick ran exactly once per real page load. Found on the first
  live hands-off film (rec8K76f498HJ0GNr): the script approved on a reload,
  then nine scene texts landed 45s later and sat unapproved for minutes with
  the banner up. Any client component that must act every cycle needs its
  own interval; a mount is not a schedule. (Note the same fact the other way
  round: a comment claiming "AutoRefresh remounts this" is wrong — client
  component state SURVIVES refresh; it is drafts fed from server-rendered
  props that reset.) The gap guard is localStorage (shared across tabs, so
  two open tabs alternate rather than race the render press); ticks continue
  in a hidden tab on purpose — "open somewhere" includes a background tab,
  which is exactly where a hands-off page lives. So it works while a tab
  with the project page is open SOMEWHERE, and pauses at the next gate when
  none is — said on the banner in as many words. Nothing server-side
  schedules it; making it survive a closed tab means teaching the n8n gates
  to self-approve, a different feature.

The banner is always visible while the mode is on, because an automation that
approves things unseen must never itself be invisible; Turn off is one click
and every already-given approval stays.

### Who made this film (2026-09-15)

`Editing Options.createdBy` — one of **Alex, Dan, David, Iustin**, chosen on
the brief above section 01 and shown at the foot of the project page, on every
library card, in the index row, and as a per-person count under the library
list. A scoreboard, not a user system: nobody logs in, the site has one shared
password. **Nothing in the pipeline reads it** — no prompt, no gate, no render.
Full account: `db/port/created-by/README.md`.

- **It is stored by `Normalize Webhook Input`, NOT by a site write after
  creation — and the reason is a live defect.** `Merge Ref Image` rebuilds the
  WHOLE Editing Options from normalize-time state and PATCHes it back seconds
  after the webhook answers, so anything the site merges in between is
  overwritten. That is why `createdBy` rides the webhook body.
  **`sourceWatermark` IS written the site way, so a film created with a
  reference photo silently loses a refused watermark.** Not fixed: the cure is
  making that node re-read the record instead of rebuilding. Any new key the
  site merges right after creation has the same hole.
  **`watermarkOpenOnce` is the worked example of taking the other road**
  (2026-09-19, `db/port/watermark-open-once/README.md`): it sits in the SAME
  row as `sourceWatermark` on both screens and rides the webhook body instead,
  because a key added today has no history to protect and need not inherit the
  defect. The two travelling differently is deliberate, and
  `node db/port/watermark-open-once/check.mjs` pins the crossing — it runs the
  orchestrator's real node body against fixtures and then checks the site's two
  spellings against it, because a drift there has no loud failure anywhere and
  looks exactly like "the feature does not work".
  **Publish the n8n half before the site deploys**, or the brief posts a choice
  nothing reads.
- **The four names are whitelisted TWICE** — `CREATORS` in
  `platform/lib/data/derive.ts` and the same array in the orchestrator's
  Normalize node — because the value crosses a webhook body, a Code node and a
  jsonb column before it reaches a card. Absent or unrecognised reads as
  "nobody said", which is what every film made before today is.
  **A drift between the two copies fails silently** (the brief posts a name,
  n8n drops it, the project comes back unnamed), so
  `npm run check:created-by` parses the whitelist out of
  `db/port/created-by/code/orch-Normalize_Webhook_Input.js` and asserts it
  equals `CREATORS`. 25 checks over the real derive.ts.
- **Remembered on the computer, and the submit is GATED on it.** The last pick
  comes back pre-selected (localStorage, read after mount — never in the state
  initializer, or the server render and the hydration disagree), so the common
  case is one click already made; Start production stays disabled until a name
  is chosen, with the reason printed under the button, because a name that can
  be skipped is a name that gets skipped and a scoreboard with holes is not
  one.

### The site

- The project page auto-refreshes every 10s, which remounts components. Drafts
  in progress must be backed by `sessionStorage` to survive it.
- **The phone is a place of WORK, not of reading, and a layout switcher was
  the wrong tool for it** (2026-09-11). The producer approves, starts films,
  checks renders and regenerates from the phone, and asked for a
  desktop / mobile / tablet button in the bar. Declined, with the reason
  measured: the site already adapts by width (14 `@media` blocks at the
  time), it just adapted THINLY — landing, brief and library had Daylight
  phone rules, the project workspace (`.stage`) had exactly one, at 900px.
  A named-layout toggle would duplicate the browser's own "request desktop
  site", cost three copies of every future component (the multi-copy trap
  this file already pays for), and nobody picks "tablet" on a continuum of
  widths. The answer is real phone rules per screen, verified by rendering
  at 390px, never a switch. The library pass, from the producer's own
  screenshots:
  - **A pill radius is right for one row and an OVAL for four.** The library
    toolbar (`.eyebrow.prow`) wrapped to four lines on a phone inside
    `border-radius: 999px`, which squeezed the tabs into the round ends —
    "foarte prost încadrate". Under 720px it is a `--r-lg` rectangle with a
    deliberate order (label + Select, tabs, search, Grid | Index; the
    `.sp` spacer hidden). The tabs WRAP rather than scroll sideways: every
    tab stays visible. `.ptools` and `.plabel` exist so CSS can order them —
    they were inline styles before.
  - **…and a sticky toolbar 245px tall is a curtain.** It rode down the
    screen over the cards ("îți obturează vederea"). Static on the phone;
    still sticky on a laptop, where it is one 64px row.
  - **The lit arc is aimed for a 1200px shell.** On a 334px one its ring ran
    horizontally along the whole top edge and the shell's clip cut it flat —
    a hard purple line under the nav, which the producer read as the nav's
    blur "covering the purple edge". Re-aimed under 720px (`right:-300px;
    top:-560px; 640×700`) so the ring crosses the top-right corner
    diagonally, like desktop. `.navfade` also shrank 84→66px there: it
    reached 14px INTO the shell. Same shape as the Footage header fix.
  - **`.stats` flows COLUMN-wise** (`grid-auto-flow: column`, so the row grows
    a tile per bucket). A phone rule that only sets a two-column template
    still gets five columns — the three overflow tiles become implicit
    COLUMNS. `grid-auto-flow: row` beside it, or "two columns" means nothing.
    Found by `getComputedStyle().gridTemplateColumns` reading
    `66.8px ×5`, not by eye.
  - **Paging must scroll back to the head of the list** (`goPage` +
    `scroll-margin-top` on the toolbar). Without it the new page renders into
    the OLD scroll position — the bottom — and "Next" reads as jumping to the
    end of something. Only the pager sets the flag: filter and search also
    reset to page 1, and yanking the viewport under someone typing is worse.
    The phone shows "Page 2 of 5" (`.pgcur`) where the numbers are hidden.
  - **The bar folds its sections behind one button under 720px**
    (`NavMenu`, own module CSS): brand + "New video" already fill the pill at
    390 (measured 368 in 368), so Projects / Footage / Settings had simply
    been `display: none` — "seacă". The panel is `position: absolute`
    against `.nav`, which is sticky and therefore a containing block, so it
    sits under the pill at any scroll and detaches from nothing on the
    brief, where the bar scrolls away. Closes on tap-outside, Escape and the
    route change it caused.
  The project workspace is the next pass and the bigger one.
- **The app and the render share one type system.** **Outfit** / Inter / IBM
  Plex Mono are loaded in `platform/app/layout.tsx` via `next/font` and mirror
  `remotion/src/style.ts`, so the site looks like the films it makes.
  `latin-ext` is required here for the same reason as in the render — Romanian
  project names carry ș and ț. Review and approval surfaces deliberately kept
  their density — only the chrome changed.

  **This bullet used to say Fraunces / Inter Tight and "editorial", and it was
  wrong from 2026-08-15 to 2026-08-17** — the Daylight refresh (below) moved
  both the site and the render to Outfit on the 15th and nobody corrected the
  memory. A stale line here is worse than a missing one: it is read as current
  and reasoned from. Anything that names a face or a direction gets corrected
  in the same commit that changes it.
- **The design system is "Daylight" (2026-08-15), and the token layer at the
  top of `globals.css` is its single owner.** Light grey ground `#ececed`, one
  purple accent `#7a4fd6` with a deep `#4d3484` and a lift `#b299e7` derived by
  a fixed mix rule, pill buttons (`999px`), cushioned cards (24–28px radius,
  soft shadows), near-black radial panels for anything that must feel like a
  gate, and `cubic-bezier(.2,.8,.2,1)` at ~0.38s as the one ease. The
  reference prototypes and the full token list live in
  `design/handoff-visual-refresh/README.md` — **that file, not this section, is
  the spec**; what belongs here is only where the rebuild stands and what bit.
  It replaced the previous dark "editorial" direction wholesale, so a component
  that draws its own colours instead of reading tokens had to be found by hand
  (`721215f`) — the token layer cannot invert what does not ask it.
- **The Daylight rebuild is three screens, and only two and a half are done.**
  Landing (`platform/app/landing`, and it is now the site's front door),
  the brief (`platform/app/new`, including the genre pole), and the projects
  library (hero, cards, toolbar with search + segmented view + count,
  pagination at 15/page) have all landed. **The per-project workspace —
  screen 3, the stage stepper and the approval panels in
  `platform/app/projects/[id]` — has NOT been rebuilt**: it still wears the
  token layer and nothing more. That is the largest open piece of site work,
  and it is the screen every approval gate lives on, so restyle it rather than
  rewriting it: `SceneBoard`, `AssemblyStatus`, `ProductionActivity`,
  `AudioReview`, `ScriptReview` and `StageNav` each carry hard-won behaviour
  documented above, and the handoff's own rule is "keep every existing
  control; restyle, don't remove".
- `platform/lib/tone-type.ts`'s comments still describe the empty case as
  "inherit Fraunces". It inherits **Outfit** now. The behaviour is correct —
  an empty class means "inherit the display face" — only the name in the
  comment is stale.
- **New components carry their own stylesheet; `globals.css` is closed to
  them.** It is 5659 lines with no scoping, and the collision it caused is on
  record two bullets down — a modifier named `empty` inheriting an app-wide
  `.empty { padding: 80px 0 }`. Every generic word is already taken (card,
  field, chip, empty, left, on, full) and nothing tells you which. A
  `*.module.css` beside the component gets its names hashed at build
  (`ReviewKeys_hint__tZCK8`), so it can neither reach anything nor be reached.
  **The token layer stays global on purpose** — colours and spacing SHOULD be
  shared, and that is the part of globals.css doing its job. This is a rule
  going forward, not a migration: move a block only when you are editing it
  anyway. `SceneBoard.module.css` is the first one and the pattern to copy.
- **Generic class names are already taken.** `globals.css` has app-wide
  blocks like `.empty` (an empty-state with `padding: 80px 0`), `.card`,
  `.field`, `.chip`. Using one as a local modifier silently inherits it: the
  /new call sheet's "no title yet" state was `sprev empty` and picked up 80px
  of phantom padding, dropping the title into the middle of a hole. Modifiers
  get their own word (`sprev blank`). Measure the computed box before blaming
  the rule you just wrote — `getComputedStyle` plus a walk over
  `document.styleSheets` naming every rule that matches the element finds this
  in seconds, guessing does not.
- **A panel-scoped button restyle must exclude the ACCENT variant, or state a
  colour of its own.** `.btn.gold` and `.abtn.ok` carry the purple gradient
  *and* a near-white label; a later rule like `.reviewpanel .btn` has the same
  specificity and wins on `background` while never mentioning `color`, so the
  ground goes back to `--card2` (#fdfdfe) and the label stays #f7f7f8. That is
  a **1.05:1** button — a white word on a white pill. It has now happened three
  times in `globals.css`; `.reviewpanel .take .abtn:not(.ok)` and
  `.stage .insp .abtn:not(.ok)` are the two that were already guarded, and
  `.reviewpanel .btn` was found on 2026-08-30 with "Approve all N" invisible on
  BOTH review gates at once — the primary action of each. The producer's word
  for it was "șters", which is exactly what it looks like: present, greyed,
  apparently disabled. Grep for a button rule that sets `background` without
  `color` — that pairing is the whole signature — and measure the contrast
  rather than judging it by eye, since the failure looks like a legitimate
  disabled state.
- **Project titles wear the film's own typeface.** `platform/lib/tone-type.ts`
  mirrors `presetForTone()` from the render (Bodoni for dark, Anton for
  motivational, etc. — keep the two maps in lockstep) and dresses the project
  page title and the /new call-sheet preview. Anton is single-weight: nothing
  may force a font-weight onto `.ptitle` (the old `.roomhead h1` rule did
  exactly that and was deleted for it). Titles in the LISTS are Poppins
  (`--f-title`) instead — at 17px a high-contrast serif costs legibility on a
  line that is scanned, not read.
- **The language belongs to the FORM, not to the voice picker.** Putting the
  selector inside `VoicePicker` looked right and was wrong twice over: a
  silent (`cinematic`) film renders no voice picker at all and still needs a
  language for its script, and a multi-voice project renders TWO voice pickers
  — narrator plus cast — so the control appeared twice. `LanguagePicker` now
  sits once in section 01 and drives a hidden `language` input; the voice
  pickers only read it, and their sole control is "show every language" (a
  local widening, not a change to the film). The posted value is the ENGLISH
  name, which is safe because n8n only ever interpolates `Language` into
  prompts and never compares it — checked across all twelve nodes that touch
  it in Claude Scripting. The free-text field it replaced was also `required`
  with no default, so clearing it blocked submission with a browser tooltip.
- **English is not filtered, on purpose.** Most of the library is English and
  most of it never says so in its metadata, so narrowing on the label drops
  far more than it finds and hands back an odd subset instead of the familiar
  default list. `narrowsUsefully()` in `lib/languages.ts` owns that rule — the
  picker sends no `lang` at all for a baseline language, and the route guards
  the same thing for direct callers. One owner, two readers.
- **A list that is still loading must not be clickable.** During the fetch the
  rows on screen belong to the PREVIOUS language, and they look exactly like
  valid choices — so a click picked a voice that does not speak the film's
  language, silently. The box is dimmed and `pointer-events: none` while busy,
  the row handler checks `loading` as well, and once a language-filtered list
  lands, a selection that is not in it moves to the first voice that is. That
  last part is deliberately narrow: never in controlled mode (it would change
  a project's saved voice behind the producer's back) and never on the
  unfiltered English list, which keeps its historical default voice.
- **The provider selector is gone, and it had been LYING rather than merely
  idle** (2026-08-28, spotted by the producer). ai33 was an aggregator, so
  `VoicePicker` offered ElevenLabs / Minimax / Edge / Kokoro; going direct left
  one provider, and `/api/voices` stopped reading the `provider` parameter
  altogether — it survives only in a comment. So choosing Minimax returned an
  ElevenLabs list, and the label claimed the voice was something it was not,
  with that claim following the id into the film. This is the Captions-toggle
  rule again — a control that cannot change the outcome reads as a decision —
  except one step worse, because this one asserted a falsehood instead of
  doing nothing. **The database was audited before assuming it was cosmetic**:
  22 project narrator voices and 6 cast voices, every one `elevenlabs_`, so
  nobody ever picked one and there is nothing to repair. Worth knowing why
  that check mattered — a stored `minimax_…` id would pass the
  `voice_id.includes('_')` validity test in all five places that use it and
  then fail at ElevenLabs, which is a silent break, not a loud one.
- **`/v2/voices` is the ACCOUNT's own voices — 21 English premades — and
  pointing the language filter at it killed the feature** (2026-08-28). The
  ElevenLabs migration replaced ai33's aggregated catalogue with that endpoint,
  so the filter was searching a set that could not contain the answer:
  `has_more: false`, every label `en`, zero Romanian voices reachable by any
  scan or search. It then fell through to its own "nothing mentions Romanian,
  so every voice is shown" branch, and the producer correctly read that as the
  selector not working. **The library is `/v1/shared-voices`**, which takes
  `language` as an ISO code natively — 4811 Romanian voices, Mihai
  (transylvanian), Cornel, Roxana. Its rows are FLAT where `/v2/voices` nests
  under `labels`, which `shape()` already tolerates (`labels[k] ?? v[k]`), so
  no second shaper was needed.
  Two things were verified against the live API before the rewrite, because
  each could have failed at the take rather than at the click: a shared voice
  id **synthesizes directly**, no "add to library" step (HTTP 200, audio/mpeg,
  billed), and `/v1/voices/{id}` **resolves** it, which is what the audio
  panel's name labels need.
  **And upstream's language filter is FUZZY, which is measured, not assumed**:
  `language=ro` returned 68 Romanian out of 100, and `language=ro&search=warm`
  only 33 — a multilingual voice labelled `en` is offered for `ro` because it
  is verified to read it. Right as a SET, wrong as an ORDER, so
  `voiceMatchesLanguage`/`voiceMentionsLanguage` still rank the result exactly
  as they did pre-migration. Deleting them because "upstream already filtered"
  would also have made the picker's "N labelled with the language, the rest
  matched by name or description" line a lie.
- **Using a shared voice COPIES it into the account, so the "English" list
  grows a language every time the pipeline speaks a new one.** The baseline
  list is `/v2/voices`, the account's own voices — and that set is not static.
  Auditioning one Romanian voice took it from 21 English premades to 22, with
  Mihai sorted to the TOP, which is how it was found: the producer went back to
  English and a Romanian voice was sitting at the head of the list. One
  Romanian film would do the same permanently, and a German one after it.
  The picker now sends `lang` even for a baseline language, and the route drops
  a voice only when it NAMES a different one — an unlabelled voice stays, which
  is the safe direction and the original reason English was never narrowed on
  metadata. `asked` is what that test reads, never `lang`: `lang` is null for a
  baseline language BY DESIGN and null is also what "show me every language"
  sends, so only `asked` tells those two apart. Verified on the real 22: an
  English film keeps the premades and the unlabelled rows, drops Mihai, and
  "Show every language" still filters nothing.
- **A metadata-only filter is not the search a human does.** The first
  language filter scanned pages with an empty query and kept only voices whose
  `language`/`accent` named the language — it surfaced TWO Romanian voices on
  a library that visibly holds many, while typing "romanian" into the box
  found them all. Lesson: **ai33's own `q` search reaches deeper than any
  bounded scan and reads fields we cannot see**, so the route now runs BOTH
  (`q=<language name>` plus the scan), merges, and ranks metadata-confirmed
  voices above ones that only matched by name or description — without
  discarding the latter, which is precisely what threw away the ones the
  producer could see. The language is chosen by ISO code from a searchable
  list of the 32 ElevenLabs multilingual languages (`LANGUAGES` in
  `lib/languages.ts`); the code is what ElevenLabs itself thinks in, so "ro"
  plus Enter is the whole interaction. Note that list is the MODEL's coverage,
  not a promise the library holds a natively-labelled voice for each.
- **Voice pickers narrow to the film's language, and two vocabularies had to
  be reconciled to do it.** The form's Language field is a free-text input
  whose datalist offers ENDONYMS ("Română", "Deutsch"), while ai33 relays each
  provider's own labels — "Romanian", "ro", "ro-RO", "Romanian (Romania)", or
  nothing at all in `language` with the useful word in `accent` instead.
  `platform/lib/languages.ts` is the single place that maps both sides, and it
  matches on whole words: a naive substring test made "ro" match *Roger* and
  "Rock ballad voice", which is exactly the bug the feature exists to fix.
  Unknown languages still filter — the input becomes its own alias — because
  the datalist is a suggestion, not a closed list. Three rules hold it up:
  **filtering must scan pages**, since one page of 24 in a mostly-English
  library can hold zero Romanian voices while the library holds a dozen (the
  route walks 6×100, cached an hour, exactly like `resolveNames`); **a filter
  must never empty the picker**, so no match falls back to the full list with
  a line saying so; and the narrowing is threaded to EVERY picker — the
  creation form via `CategoryPicker`/`CastPicker`, and `AudioReview` via the
  new `Project.language`, or swapping a narrator later would offer the English
  library again. **Whether native voices actually appear is unverified**: a
  Claude Code web session gets a 403 for `api.ai33.pro` like every other
  house-of-videos host, so the metadata's real coverage per provider could not
  be checked here — the "no voice is labelled X" branch exists precisely
  because it may be common.
- **Enter must not start a film.** An HTML form with a submit button submits
  on Enter from any text field, and here submitting writes a project to
  Airtable, starts scripting and spends model credits. Typing a title and
  pressing Enter — or pressing it to accept a voice search — started a real
  production run. The form's `onKeyDown` now blocks Enter, but **only when the
  target is an `INPUT`**: a textarea's Enter is a newline and never submitted
  anyway, and a button's Enter is that button's own activation, so blocking it
  wholesale would break "Start production" from the keyboard along with every
  `type="button"` chip and toggle. `isComposing` is checked too, or IME entry
  loses its commit key. Verified in a real Chromium (playwright-core against
  `/opt/pw-browsers`, installed with `--no-save`): Enter in the title, the
  language field and the voice search do nothing, while both clicking the
  button and pressing Enter on it still start the project.
- **The subject field's cap was UI-only, and it contradicted the rest of the
  stack.** It sat at 140 characters — a tweet — while `project.name` is `text`
  in Postgres with no server-side cap, `createProject` passes the value through
  untouched, and `ExpandableTitle` exists in so many words "because people
  paste whole prompts into the Tema field". Every layer below the form already
  handled long subjects; only the textarea refused them. Raised to
  `SUBJECT_MAX` (1000) with a count that appears in the last 150 characters —
  the complaint was not the limit itself but hitting it in silence, with the
  field simply ceasing to accept letters. Still bounded, because this field is
  also the project's NAME in every list; past 1000 it is a script, and Lore is
  where a script belongs. Note a long subject is not a defect: `isTitleLike()`
  in the render draws the opening title card only for something title-shaped
  (≤7 words, ≤46 chars), so a brief simply opens the film clean.
- **The /new form's field names are a frozen contract.** `createProject()`
  posts `name, category, cat_*, cast_voices, language, length, tone, pace,
  speed, created_by,
  style, voice_id, aspect, captions/hook_title/chapter_cards/end_screen/sfx
  (yes|no)` to the n8n webhook. Any redesign keeps those names and value
  vocabularies byte-identical — the 2026-08 editorial rebuild moved them into
  hidden inputs bound to React state, nothing more. Every non-submit button
  inside the form must carry `type="button"`.
- **The filmstrip splits by chapter, and the chapter rule has ONE owner.**
  Paging the strip by 8 fixed the crowding a 44-scene film caused but not the
  navigation — "page 3 of 6" says nothing about where you are in a film. The
  strip is now cut by chapter on the Images and Video steps, with a tab per
  chapter carrying `approved/total` **for the step being reviewed**, so the
  row answers the question it is looked at for: which chapter still needs me.
  Paging survives *inside* a chapter for the rare one over 8 scenes.
  Three things are load-bearing:
  - **The current chapter is DERIVED from the selected scene, never held as
    state.** A tab and a selection that can disagree is a strip showing one
    chapter while the monitor below reviews a scene from another. Clicking a
    tab selects a scene (the first still owing a decision for this step, else
    the first of the chapter); selecting from anywhere else moves the tab.
  - **A film with one chapter keeps the plain paging.** Orders are not always
    chapter-encoded — a short film numbers its scenes 1, 2, 3, which all fall
    in the hook, and `ceil(Lenght / 120)` makes anything under two minutes one
    chapter by construction. `groupsByChapter()` owns that test; a row holding
    a single "Hook" button is noise.
  - **`lib/chapters.ts` is the single owner of `floor(order / 100)`.** It had
    been written by hand in three places (the voice panel, the narration-bundle
    route, `castIndexFor`) and n8n's `AB Pick Voice` / `VR Pick Voice` derive
    it the same way. A fourth copy is how "Chapter 2" comes to label one set of
    scenes while the download named "chapter 2" produces another. Note the
    numbered chapters sort NUMERICALLY — a lexical sort puts 10 before 9.
- **A `<video>` cannot be given a corner its own controls respect, so the clip
  has to be masked by its holder.** The Images/Video monitor drew the asset
  edge-to-edge, which was invisible while it held a picture and obvious the
  moment it held a clip: the black 16:9 rectangle squared off the card's
  rounded corners, and the bubble stopped being a bubble at exactly the frame
  the producer is judging. The radius belongs on `.scr` with `overflow:
  hidden`, not on the media — `MediaPlayer` fills its parent absolutely, and
  the same mask then also serves the fallback art, the drafts preview and the
  scrim.
- **A grid item's `min-width: auto` outranks every overflow rule inside it.**
  `.stage`'s two columns kept their desktop width on a phone and the monitor
  ran a full screen past the right edge — while the filmstrip's own
  `overflow-x: auto` sat there doing nothing, because nothing was ever
  narrower than its contents for it to scroll. `min-width: 0` on the items is
  the whole fix, and the symptom to recognise is a child that *can* scroll
  and doesn't. Measure the item against its track (`getBoundingClientRect`),
  not the page: the page-level scrollWidth blamed the stepper, which was only
  being dragged along.
- **A step you stepped back to must show ITS OWN asset.** `SceneBoard`'s
  monitor played the clip whenever one existed, so revisiting Images put a
  video player over the picture being judged — the wrong asset for the
  decision. `focus` (from the `?stage=` param) keeps the image in the monitor
  on the Images step; everywhere else the clip still wins, because there it is
  the fuller answer.
- **…and ONLY its own controls.** The same board carried every control whose
  asset happened to be unapproved, so the Video step asked you to approve the
  clip while also offering to re-record the line, rewrite it with AI and
  re-roll the picture — four buttons for three unrelated decisions under one
  heading. That was defensible while a step was a one-way door; once the
  stepper made every step its own page, it was just clutter, and the producer
  said so. `SceneBoard` now derives a single `step` — `focus` when the
  producer navigated to one, otherwise the first thing the active scene still
  owes (image → voice → clip, the pipeline's own order) — and renders that
  step's block alone. The three status rows stay, because the state of the
  whole scene is worth seeing from anywhere; only the row for the current step
  carries its "Make changes". **Removing a control means checking it has a
  home, not just a replacement**: the take belongs to `AudioReview` (which is
  strictly richer — duration flags, fit-vs-shot warnings, per-scene voice pin)
  and the line to `SceneReview`'s "↻ Regenerate scene", so nothing was lost.
  The one coupling this creates: the board may route a scene to the audio step
  only when `AudioReview` is actually rendered, hence the `audioPanel` prop —
  routing to a step that isn't on the page shows no controls at all.
- **A step-scoped panel needs step-scoped EVERYTHING**, and three things were
  missed the first time. (a) The bulk-review card fell through one chain of
  conditions — images missing → images to approve → clips missing → else
  videos — so the Images step, with only its last image unreviewed and no
  images branch to take, landed on "Approve all 6 videos": a one-click
  sign-off of the whole next stage, offered from the page before it. Each step
  now owns its own card. (b) The monitor keyed off `focus` (set only by
  `?stage=`), so on the LIVE page a scene whose picture was still awaiting a
  decision showed its clip instead; keying off the derived `step` means the
  live page already shows the picture, and clicking "Images" changes nothing
  rather than flashing the clip first. (c) The filmstrip dot came from the
  Airtable status TEXT, which is display-only and lags the checkboxes — so the
  strip could not answer the one question it is looked at for. It is now
  per-step approval: green approved, grey awaiting, dimmed only when nothing
  is generated yet. Note selection had to stop borrowing `.act`, which also
  paints the blinking "generating" dot — the scene under review was the one
  scene whose own light you could never see.
- **The render lock is not protecting the render.** While a Final Assembly
  execution is alive, every step but Assembly is frozen in the stepper — but
  navigating could never have interrupted anything, the render runs in n8n and
  on Railway and does not care what is on screen. The real hazard is that
  `confirmFinalSettings` fires the assemble webhook ITSELF (see auto-assembly
  below), so walking back to Final touches and pressing render again starts a
  SECOND execution and both write `Link Video Final`. `stopAssembly()` kills
  the live executions and rewinds the status to `Setari Finale`, which is why
  stopping and going back are one button. The lock keys off `assembly.running`,
  never off the status, so the two states that are not a live render unlock by
  themselves: the gap where production is still upstream, and a render that
  failed (its panel then offers Restart plus a door back to Final touches,
  because a failed render is often a failed *setting*).
- **`?stage=` navigation is a full server round-trip**, and the page is
  `force-dynamic`: every click re-reads Airtable and asks n8n what is running
  before one pixel changes, so the previous step sat on screen for a second
  and the click read as ignored. Nothing about switching Images↔Video needs
  the server — same mounted board, same scene data — so `StageNav` records
  where the click is going and `SceneBoard` believes it immediately; the
  server render arrives and agrees. The guess is dropped when the committed
  stage changes, so a failed navigation cannot leave the UI lying.
- **Approval used to be one-way, and "Make changes" is the door back.** Every
  control in a step is gated on the scene NOT being approved, so signing off
  froze it — however wrong it turned out three steps later. `reopenStep()`
  expresses reopening as **un-approval of one scene**, which is the whole
  trick: the per-scene controls reappear by themselves and n8n's "is every
  scene approved" gates reopen with them, so the pipeline needed no change at
  all. Only the named scene is touched, so the batch gets exactly one piece
  of outstanding work and the rest of the film keeps its sign-off. What
  cascades is what was derived from the changed thing — the scene step owns
  BOTH the narration and the image prompt, so it invalidates image + voice +
  video; image → video, voice → video, clip → nothing. `saveSceneScript`
  applies the same rule without any button: a changed image prompt un-approves
  the picture, a changed line re-records the take. It deliberately does NOT
  start a regeneration: reopening means "this needs another look", and the
  producer then picks what to change. The initial script has no such button:
  it is written for the whole project, not per scene, and `restart-scripting`
  is its door.
- **…and the script is the one step where approval is FINAL.** Every per-scene
  step can be reopened; the script cannot, because the entire film is derived
  from it — chapters, scenes, narration, image prompts — so editing it
  afterwards would describe a film that no longer exists. `ScriptReview` takes
  a `locked` prop (Airtable `Status === 'approved'`) and renders a read-only
  record: no Save, no Approve, no Regenerate, and the text as a plain block
  rather than a textarea, because clicking the Script step is how you go back
  and READ it and a fixed-height scrollbox fights that. Two details that
  matter: **only `'approved'` locks** — an unknown or empty status must leave
  the gate usable, since freezing a script nobody signed off strands the
  pipeline with no door at all — and the sessionStorage draft is DROPPED when
  locked instead of restored, or an unsaved pre-approval edit reappears on top
  of the approved text and reads as what production is running on.
- **Drafts are filed automatically, and the de-duplication is what makes that
  bearable.** Every path that replaces an asset — image regen, video regen,
  `restartVideoRegen`, and restoring an older draft — calls `autoKeep` first,
  because the moment you need a draft is the moment you did not think to
  press the button. It swallows its errors on purpose: a safety net that can
  block the regeneration it protects is worse than none. Identity is the Flow
  media id for images and the Drive URL for clips, **never the URL of an
  Airtable attachment** — those are re-signed on every read, so comparing
  them would file a duplicate on every single regeneration. `MAX_VERSIONS_PER_KIND`
  (12) bounds the growth and the drop is reported, not silent.
- **One draft per kind is a place, not a date, and it needs a marker of its
  own.** Since every regeneration files one, the newest automatic keep is
  always "the thing that was on this scene before the current one" — which is
  the card reached for most, and a timestamp is a poor name for it. It is
  labelled **Last generation** instead. The obvious implementation ("newest
  entry with `auto: true`") is wrong the moment de-duplication bites: restore
  an older draft, then regenerate, and the asset just replaced is one that was
  already on file, so no new entry is written and the label stays on the wrong
  card. So the marker is an explicit `last` flag on exactly one entry per kind,
  moved by EVERY automatic keep including the de-duplicated one — which is why
  that branch now writes to Airtable where it used to return early. A manual
  "Save draft" never claims it: it files the asset that is still live, which is
  not a previous anything. `readVersions` falls back to the newest `auto` entry
  for drafts saved before the flag existed, and drops the guess as soon as a
  real marker is written.
- **Nothing in the pipeline keeps what it replaces.** There is one image and
  one clip per scene, and every regeneration overwrites in place — so a
  re-roll that came back worse was unrecoverable. "⤓ Save draft" copies the
  live asset aside first; the drafts appear in the inspector with Restore.
  Two Airtable fields hold them, both created 2026-08-14 and **written only
  by the site — n8n must never touch either**: `Versiuni Imagine`
  (attachment) and `Versiuni Media` (JSON metadata). The split is forced by
  how the two assets expire: **an image is copied INTO Airtable** because
  fal's link dies within hours, while **a clip only needs its URL** because
  Drive links are permanent. And restoring an image writes back its
  `Image Media ID` and prompt as well — without the Flow id the scene can no
  longer generate video at all (`Prep Video Regen` refuses it), which would
  look like the restore having silently broken the scene.
- **A scene has THREE inputs, and the site used to show two.** `Script Scenă`
  is the line, `Imagine First Frame` is the picture, and `Video Scenă URL` —
  despite the name — is the MOTION prompt handed to Veo. The finished clip
  lands in `Scene Final URL`, so the "URL" field stays prose for the life of
  the project. Scripting writes all three once; nothing downstream ever
  rewrites the motion prompt except the AI scene rewrite. So a producer who
  edited the narration and the image prompt still got a clip performing the
  ORIGINAL direction, with no field on screen explaining why — seen on
  "Working engine", where a mechanic the producer had written out kept
  appearing. **On a cinematic project this makes the script edit entirely
  inert**, because the narration is neither spoken nor captioned: the whole
  film is the image prompt plus the motion prompt. The video step now shows
  it as "Shot direction" (`saveVideoPrompt`), and saving it un-approves the
  clip. `Evaluate Video Approval` re-reads the field every polling cycle, so
  an edit lands on the next regeneration.
- **Refusal notes get translated to next steps** by `platform/lib/refusals.ts`
  (wired into ProductionActivity and SceneBoard). Match only literal pipeline
  codes, never bare words or bare numbers: `\bminor\b` hit ordinary reviewer
  feedback (and Romanian "minoră"), and `\b5\d\d\b` hit scene ORDERS — the
  chapters convention is `chapter*100+scene`, so "scene 503" is data, not an
  HTTP status. The deterministic-refusal branch must stay ahead of the
  transient branch.
- **Verifying mobile from a Claude Code web session:** headless Chromium
  refuses windows narrower than 500px — `--window-size=390,...` silently
  renders a 500px viewport and CROPS the screenshot to 390, which looks like
  catastrophic overflow that isn't there. Simulate a real 390px viewport with
  `--window-size=500,H --force-device-scale-factor=1.282` instead.
- **prefers-reduced-motion strips ALL animations globally** (the `*` rule in
  globals.css). Anything revealed by animation must set its resting state in
  the BASE rule (`.finflash` needs `opacity: 0` there, or reduced-motion users
  get the flash at full strength), and anything that starts a download for an
  animated payoff (hover video previews) must skip the download entirely when
  the media query matches.
- **Drive-hosted media must go through `platform/app/api/media`, never the
  Railway `/media`.** The render server's version buffers the whole file and
  answers a plain 200: no `Accept-Ranges` and the `Range` header ignored. A
  browser plays such a response progressively but **cannot seek**, which
  presented as "the player is broken — I can't scrub the final video". Final
  videos (`Link Video Final`) and voiceovers are Drive URLs, so all three
  players were affected; scene clips are on fal.media and were always fine
  because a CDN honours ranges. `mediaSrc()` in `platform/lib/media.ts` is the
  single place that decides, and it deliberately proxies **only**
  `drive.google.com` — pushing CDN-hosted clips through our own function would
  cost Vercel bandwidth for nothing. A 206 is returned `private, no-store`: a
  cache keyed on URL alone would serve one partial response for a different
  range, which looks like a corrupt file rather than a caching bug.
  **Scene clips are Drive URLs too** — `Set Scene Result` writes
  `uc?export=download&id=…`, so an older note here claiming they sit on
  fal.media is wrong for `Scene Final URL`. That is what makes the per-scene
  download work: `mediaSrc` routes them through `/api/media`, which is
  SAME-ORIGIN, and a browser only honours `<a download="name">` on a
  same-origin link. `?dl=<filename>` additionally asks the proxy for a
  `Content-Disposition`, so the file arrives named even when the link is
  opened rather than clicked — opt-in by query, because the same route feeds
  the players and an attachment header would make every clip download instead
  of play.
- **The narration exists only as one take per scene, so downloading it whole
  had to be built, not linked.** `Voiceover URL` is per scene and the takes are
  joined in exactly one place — inside the final video, muxed under the
  picture — so there was no way to get the narration on its own.
  `/api/audio-bundle?project=…&chapter=all|hook|N` concatenates them with
  ffmpeg and answers as an attachment. Four things are load-bearing:
  it is a **GET**, because `<a download>` cannot POST; the site's password
  middleware covers `/api`, so it is no more open than the page linking to it;
  every input is passed through `aformat` before `concat`, because a
  re-synthesized line can come back at a different sample rate and concat
  refuses inputs that disagree; and there is **no gap between takes** — the
  bundle is the narration as the cut plays it, and one that drifts from the
  video is worse than none. Chapter comes from `lib/chapters.ts`, which is now
  the single owner of `floor(Ordine Scenă / 100)` — the same rule `AB Pick
  Voice` uses in n8n. They must agree or "Chapter 2" downloads different lines
  from the ones labelled Ch. 2.
- **That put ffmpeg in the site's own image** (`apk add ffmpeg` in the
  Dockerfile runner stage). The alternative was the Railway render server,
  which already has ffmpeg — but the site holds neither its URL nor its key,
  so that route meant two new GitHub Secrets and a `remotion/**` push (which
  rebuilds Railway and can kill a live render). A 3-second mp3 join is not
  worth either.
- **…and a binary in the image is a dependency on WHICH COPY of the site you
  opened.** The first report of the feature was a 500 — from
  `n8n-chi-azure.vercel.app`, the pre-Hetzner deployment, which is still live
  and still auto-building this trunk. Everything else on it works, because
  everything else is Airtable and n8n over HTTP; only the one route that
  shells out to a binary cannot. `lib/mp3.ts` is the answer: no ffmpeg → join
  the frames in pure Node. **Two live copies of the site writing to one
  Airtable and one n8n is the real hazard here** — approvals from one,
  in-flight flags from the other, and `getAliveProduction()` answering for
  both. Turning the Vercel project off is the actual fix; the fallback only
  means the producer is not stranded when they land there.
- **The stale copy now says so itself** (`StaleCopyBanner`, any `*.vercel.app`
  host). Two things about how, both deliberate. It is a CLIENT check on
  `location.host`, not the Host header: `headers()` in the root layout is
  correct on the first paint and opts the **entire app** out of static
  rendering — `/login` and `/new` both stopped being prerendered, which the
  build output shows and nothing else warns about. A temporary banner must not
  change how every page is served. And it keys off the vercel.app suffix
  rather than a canonical-host env var, so it needs no configuration and
  cannot misfire on the real site.
- **The Vercel MCP connector cannot delete that project**, so this is still a
  manual step: the connector's grant covers the `FermaFabiz` team, which has
  ZERO projects, and the personal scope answers 403. The deployment lives in
  the personal account. Dashboard → the `n8n` project → Settings → Delete, or
  at minimum disconnect its Git integration so it stops rebuilding this trunk.
- **The pure-Node join is a fallback and not a replacement, and the reason is
  measured.** Every mp3 carries encoder delay/padding frames, trimmed by a
  decoder using the gapless info in the Xing header — the very header a frame
  concat has to strip. So each join gains ~36ms of silence: three takes came
  out 4.2006s through ffmpeg and 4.3106s through the Node path (parts decode
  to 4.2018s of real audio). Inaudible per join, but on a fifteen-scene film
  it is about half a second of drift against the cut. Verify this by decoding
  to WAV and counting samples — the container's own duration field will not
  show it, and the remotion-bundled ffmpeg has no `s16le` muxer, so decode to
  `-c:a pcm_s16le` in a `.wav` rather than to a pipe.
- **A per-scene download works only because `/api/media` is same-origin.** A
  browser ignores `download` on a cross-origin link, so a raw Drive href opens
  a tab instead of saving. `downloadSrc()` in `lib/media.ts` adds `?dl=<name>`
  for proxied assets and returns CDN URLs untouched, since the attribute is
  ignored there either way.
- **The rough cut: the film, watchable at any point.** The producer used to
  give 213 approvals one asset at a time and see the result exactly once — at
  the end, after a ~95-minute render. Every part was reviewed; the film never
  was. `RoughCut` only puts what already exists in order and plays it, because
  `MediaPlayer` already lays a voice over a silent clip. **It works before any
  clip exists** — a scene with a picture and a take plays as a still under its
  narration, which is an animatic, and that is the most valuable moment to
  watch: finding out the order is wrong before sixty clips are generated
  against it. It is deliberately NOT the render (no montage framing, captions,
  chapter cards, music or breath trim, and scene length is the take's own
  rather than `voiceDur + 0.35`) and the panel says so, or someone will chase
  differences that are supposed to be there. While it is up it sets
  `document.body.dataset.overlay`, which `useReviewKeys` checks — otherwise `A`
  behind the panel approves a scene nobody is looking at.
- **`FilmCost` reports units, never money.** A price per credit or per
  character is a commercial fact this repo does not hold, and a dollar figure
  invented from a guess is worse than none. Credits are the binding constraint
  anyway: 25,050 a month, no roll-over, against a target of 7,200 clips.
  `lib/cost.ts` prices the hook on quality and the body on
  `Editing Options.videoModel` (default free), counts a re-roll as a full
  generation via the draft list — the same signal `Prep Video Regen` uses as
  its take counter — and every figure is a FLOOR: per-scene model choices are
  not recorded and takes are not versioned, so a line re-recorded three times
  counts once. The panel states that basis rather than presenting the numbers
  as fact. `npm run check:cost` pins the arithmetic (11 cases).
  Note this added `videoModel` to `EditingOptions`: the key has always existed
  in the stored JSON — `Current Scene` in Media Generation reads it — and the
  site simply never declared it, so a paid film would have been priced as free.
- **A press has to show on screen before the server answers.** The action
  writes the row and revalidates, so the truth lands a second or several
  later — up to ten if the write just missed a refresh tick — and until then
  nothing moved, which reads as a click that did not register. On a film where
  213 decisions are made one at a time that pause IS the work.
  `useOptimisticApprovals` applies the press immediately and drops the guess
  when the server answers — **whichever way it answers**, so a refused write
  returns to the truth instead of leaving a green dot the database never
  accepted. Both the buttons and the keyboard go through it, or the two paths
  drift.
- **Keyboard review, because the board offered only two bad options.** Either
  "Approve all 71" — approving without looking — or click the scene, click
  Approve, then hunt the strip for the next one that owes something: over 400
  clicks for a 71-scene film, most of them navigation rather than judgement.
  So in practice the bulk button wins and nobody reviews anything. `A`
  approves and advances, `J`/`K` move, `R` puts the cursor in the note box,
  `Space` drives the monitor (`useReviewKeys`).
  Three things are load-bearing. **The typing guard**: `a` inside a textarea
  must type an `a`, not approve — the note field sits next to the approve
  button and is exactly where someone writes prose. **The advance rule** is a
  pure exported function (`pickNextOwing`) with its own check
  (`npm run check:review`), because its two edges are invisible when broken —
  it must never re-select the scene just approved (the key looks dead) and
  running out must END the pass rather than loop on the last scene.
  **The hint is rendered under the filmstrip**: a shortcut nobody can see is a
  shortcut nobody uses, and it carries the remaining count, which is the only
  place a long pass can be watched shrinking.
- **Undo, on the one action that is irreversible and easy to fire by
  accident.** "Approve all 71" is a single click and `A` also advances, so a
  double-press signs off a scene nobody looked at; the only way back was
  `reopenStep`, one scene at a time, or SQL in /db. `undoApprovals` clears the
  checkbox and **does not set a regeneration flag** — that distinction is the
  whole design, because `writeSceneApproval(…, "regenerate")` queues work at
  fal or Flow, so an undo built on it would spend money to reverse a mistake.
  It also does not cascade the way `reopenStep` does: reopening means "this
  needs another look" and rightly invalidates what was derived from it, undo
  means "that click was a mistake". One step of history only — a stack on a
  page that re-reads the server every ten seconds is a promise about state we
  do not control. Verified against a real Postgres: after approve-then-undo,
  `image_approved` is back to false with `regen_image` and `regen_image_at`
  untouched. What it cannot take back is a clip already queued by
  `flagStaleClip`, and the message says so.
- Count **approvals**, not asset existence, for pipeline progress. Counting
  clips that merely exist made "Video" tick green before review.
- **…but scope that count to the scenes the pass staged, not to the film.**
  See "The batch cap" — asking the project-wide question is what froze every
  film longer than 8 scenes.
- **The Inspector's chips are derived from checkboxes and assets, never from
  the status TEXT** — the same rule the gates follow, for the same reason.
  `Video` read `statusKind === 'run'` and therefore announced "Rendering" on
  scenes that had nothing at all (their status text still says "Generare
  Script"), while `Image` said "Awaiting review" for a picture that did not
  exist. On a project past the batch cap that was the state most scenes sat
  in, which is precisely what made the producer suspect the statuses were
  what had jammed production.
- **A getter that answers `null` for every failure must answer `null` for a
  NETWORK failure too, or its callers are guarding a lie.** `getExecutionError`
  returned null when n8n was unconfigured, when the response was not OK, and
  when the payload held no error — but `api()` is a bare `fetch`, and a
  request that never completes throws instead of returning a response for
  `!res.ok` to catch. `OpsPanel` compounded it by putting the list calls
  inside `try/catch` and the per-execution lookup AFTER it, so a three-second
  DNS blip on wf7 between the two calls killed the server component and
  answered the whole site with a black "Application error" page (digest
  2857745208, 2026-08-13). The same outage an hour earlier, hitting the list
  call, had produced the "Can't reach the n8n API" card and a perfectly usable
  page — the strategy was right, one call was outside it. The path is not
  rare: it runs on every render whenever any execution failed in the last 24h,
  and four had. **When a display-path fetch can throw, the page must not.**
- **A film's life continues after "Finalizat", and `Publishing` is where that
  state lives** (2026-09-03): review state (review/ready/posted), the YouTube
  title (counter warns past YouTube's 100-char cut), free notes, and the
  posted link. `PublishingPanel` renders under the finished film's player;
  the state ALSO takes over the library card's badge on finished films
  ("Ready to post" amber, "Posted") and feeds the "To post" filter tab —
  the library is where it earns its keep. Stored as a `publishing` key in
  Editing Options (merge-written like `motifCards`, nothing in n8n reads
  it), exposed as `Project.publishing`, normalized by `normalizePublishing`
  in derive.ts — absent reads as `review` with empty fields. The draft is
  sessionStorage-backed (`vf-pub:<id>`), the house rule for anything typed
  on a page that re-renders every 10s.
- **The YouTube description is DERIVED, never invented** (2026-09-04,
  `GET /api/yt-kit?project=…`): hook = the film's own opening narration;
  chapters = the script's `[CHAPTER n: title]` markers with timestamps
  summed from the real takes (`mp3DurationSeconds` in lib/mp3.ts walks
  frames in pure Node — no ffmpeg — approximating the breath trim at 0.1s
  net per scene and dividing by playback speed; first line pinned to 0:00,
  which YouTube requires); sources = the Evidence rows with a URL, the one
  part of the research pack a viewer gets to see. Takes are fetched
  straight from Drive like audio-bundle does — NOT through `/api/media`,
  which sits behind the site password and bounces a cookie-less server
  fetch to /login. `getProjectEvidence` is Postgres-only; on the frozen
  Airtable backend it answers empty and the description ships without a
  sources block. The panel's thumbnail picker lists every scene's
  full-resolution still (already generated, already approved — zero new
  cost); its styles live in `PublishingPanel.module.css` per the
  own-stylesheet rule.
- **On a short film the chapter list is per SCENE, and the labels come from a
  model behind a strict validator** (2026-09-04). Chapter count is
  `ceil(length/120)`, so every film under ~4 minutes is hook + one chapter —
  a two-line list under a nine-scene film read as the feature not working.
  Under 3 real chapters, yt-kit lists every scene; labels are 3-6-word key
  points from the **`YT Scene Titles` workflow (`Il5pFIbVwFwxHsIM`, webhook
  `yt-scene-titles`)** — one OpenAI call, because the model keys live in n8n,
  not on the site. Its parser refuses anything that is not a JSON array of
  exactly N non-empty strings, and every failure degrades to first-words
  labels: a wrong label is worse than a plain one. Same trap as upscale-film:
  `create_workflow_from_code` skipped the HTTP node's credential and it
  needed `setNodeCredential` after.
- **Every researched film since the cutover silently lost its research pack,
  and the producer's "why no sources?" found it** (2026-09-04, `db/007`).
  `Save Evidence` posts records carrying BOTH `Project_ID` (Airtable's text
  field) and `Proiect` (its linked twin); both map to the one `project_id`
  column, `at_assign` emitted it twice, INSERT died with `specified more
  than once` — and because Save Evidence is `onError: continueRegularOutput`
  BY DESIGN, the death was swallowed and the film shipped written against
  research nobody could see. `at_assign` now dedupes by column (first field
  wins); proven by replaying the exact failing payload through `at_create`.
  The Aston Martin film's 20 claims were recovered from execution 8970's
  persisted `Prep Evidence Rows` output and backfilled. **The general shape:
  a write that must never kill its caller is also a write whose failures
  nobody sees — grep its error path a day after shipping, not never.**
- Transient states need a grace period. The render-error panel fires on healthy
  gaps between executions; `AssemblyStatus` uses a 75s sessionStorage-backed
  grace before crying failure.
- **`getAssemblyState()` has THREE answers and the panel only drew two, so the
  third was drawn as a lie.** "A render is alive" and "nothing is alive" were
  both handled; the middle one — the project reads `Asamblare` while a
  production pass is still running, which n8n deliberately reports as no
  verdict — fell into the healthy layout with `startedAt: null`. Everything
  the panel says about progress hangs off elapsed time, so with no start time
  it printed the chip as "Running" with no clock, froze the step list on step
  one, and could never reach `slow`, which is the only condition that offers
  Restart. A film that had not begun rendering, presented as one that had,
  stuck at the first step for as long as the batch lasted. Reported 2026-09-12
  as *"nu trece de primul pas, nu arata nici cat dureaza render-ul"* — and the
  producer did the reasonable thing and stopped it, which on a real render is
  the one move that throws work away. `AssemblyState` now carries `upstream`
  (the worker execution holding it up) and the panel reads "Getting ready to
  assemble · Not started yet", names what is running, hides the step list
  entirely without a clock, and offers "← Back to Final touches" instead of
  "■ Stop the render". **The generalisation is the one this file keeps paying
  for: a progress display derived from a clock must not render at all when
  there is no clock** — the honest empty state is cheaper than the confident
  wrong one, and step one held forever looks exactly like a hang.
- **Handing over to Final touches is not one-way, and the page assumed it
  was.** `ProductionActivity` — the ONLY panel carrying Resume and Restart
  production — was gated on `!awaitingFinalSettings && !assembling`, which
  reads as "production is finished, stop showing its controls". A hook
  rewrite breaks that premise by construction: it deletes the chapter-0
  scenes and writes new ones with no picture and no clip onto a film that had
  already reached Final touches. So on 2026-09-12 the Burj Al Arab film sat
  with five approved hook scenes owing every asset, a batch from an hour
  earlier still alive (which makes `resumeProject` refuse anyway — correctly,
  it would duplicate), and **not one button on screen to start production**.
  The producer's report was *"nu imi apare ca lucreaza la audio sau imagini
  pt scene"*, and they were right: nothing was working and nothing could be
  made to. The panel now also renders whenever `outstandingShots > 0` — an
  approved scene with no clip and no video approval, the same `isPending`
  test the panel and the n8n batch already use. Every normal film has a clip
  on every approved scene by the time it hands over, so that count is 0 and
  the behaviour is unchanged; it is only the films that get work BACK that
  see it. **Generalises past the hook: any feature that returns a film to an
  earlier phase must ask which controls the later phase hid.**
- **A stranded in-flight flag must reach its exit from ANY step.** `hookRegen`
  lives in Editing Options and its two exits (re-send / cancel) live on
  `HookPanel`, which was rendered on the scene step and beside Final touches
  only — so a producer who moved on to the render found the spinner gone from
  the screen it was on and nothing anywhere to cancel it. The panel now
  follows a rewrite in flight onto whatever step is open. Same shape as the
  scene-rewrite and video-regen badges; this is the third time, so when you
  add a state whose exit is written by someone else, ask not only whether it
  HAS a local exit but whether that exit is on screen at the moment it is
  needed.
- **The escape hatches are a family now, and it is closed** (2026-09-16). The
  image and voice badges were the last two dead ends: `RegenBadge` replaces
  the whole button row, so a stranded `Regenerează Imagine` hid Approve, Save
  draft, Regenerate and the archive picker, and a stranded `Regenerează Voce`
  hid Approve, the per-scene voice select and Regenerate. Both now render the
  badge and the same pair every other in-flight state carries — "⟳ Send it
  again" / "Cancel — keep this picture|take" (`restartImageRegen` /
  `cancelImageRegen`, `restartVoiceRegen` / `cancelVoiceRegen`). Three things
  are worth copying into the sixth one:
  - **Re-arm the flag, do not assume it.** A run that got partway may have
    cleared it before dying, and the flag is what n8n's loop matches on. The
    restart writes it again, then fires the webhook.
  - **Carry the pin.** The voice retry passes `voiceSel[s.id]` back, because
    the producer's per-scene voice choice is on screen right beside the
    button and a retry that dropped it would bring the line back in the
    mode's default voice — a different narrator for one scene, which only a
    full listen catches.
  - **The restart says which of the two things happened.** A derived webhook
    that is not configured is not a send, so the action returns "sent" or
    "off" and the message tells the truth rather than promising a run that
    never left. Same honesty as `restartVideoRegen`'s three-way message.
  Both webhook URLs also got ONE owner each (`fireImageRegenWebhook`,
  `fireVoiceRegenWebhook` in `actions.ts`) rather than a second inline copy
  of the string-replacement rule — the seven site webhooks are all derived
  from `N8N_NEW_PROJECT_WEBHOOK_URL` by swapping the last path segment, and a
  copy that spells that segment differently fails silently against a host
  that answers 404.
- **A notification that says what happened but does not GO there is the same
  complaint one step further along** (2026-09-18, `lib/deep-link.ts`,
  `npm run check:deeplink`). The chime was given words precisely because the
  sound alone made the producer hunt the page; then the words said
  "S10 finished" and clicking them did nothing — the toast was a plain `div`
  with no handler, and the system notification's `onclick` called
  `window.focus()` and stopped, landing the producer wherever they already
  were. Every item now carries an `href` and both surfaces travel: the toast
  is a button that routes, the notification focuses the tab and then routes.
  What the fix turned on:
  - **The step and the scene are two different vocabularies.** The page
    derives a GATE name for the chime (`image-review`) and the stepper
    navigates by STEP key (`images`). `GATE_STEP` maps one to the other, and
    `STAGE_KEYS` moved beside it so the map cannot name a step the page does
    not serve. A gate with no entry still produces a link, still navigates,
    and still selects nothing — a failure that looks like success, which is
    why the check reads both vocabularies out of the real sources instead of
    restating them.
  - **`?scene=` is an INSTRUCTION, not state, so reading it removes it.** The
    project page re-renders itself every 10s; a param that stayed would drag
    the producer back to scene 10 every time that fired, however many other
    scenes they had clicked. `takeSceneParam` strips it with
    `history.replaceState` — not `router.replace`, which on a `force-dynamic`
    page is a full server round-trip to change nothing on screen.
  - **…which is exactly why the board's selection had to be written down.**
    Consuming the param and then losing the selection to the next remount
    undoes the click ten seconds after it worked, which reads as the click
    never having worked. `vf-scene-sel:<projectId>` in `sessionStorage`, the
    same remedy the prompt drafts carry, restored in an effect rather than a
    lazy initializer so the first client render cannot disagree with the
    server's.
  - **An empty destination must stay empty.** `withScene("", "S10")` returned
    `"?scene=S10"` — truthy, so a caller's `|| undefined` never fired, and it
    navigated to the CURRENT path. Found by writing the check, not by
    clicking: it is invisible until an item without an `href` exists, and
    then it looks like the page reloading itself for no reason.
  The three review panels consume the param differently because they are
  different shapes: `SceneBoard` selects the scene in its filmstrip;
  `AudioReview` and `SceneReview` are lists, so they scroll the row into view
  and ring it for 4.5s with the same accent outline a playing take wears —
  long enough to survive the smooth scroll, short enough not to read as a
  state. Verified in a real browser (Playwright against the demo backend):
  the param is consumed, the toast navigates, the row is ringed, and × does
  NOT travel.
- **`.pj-shell` is a hero CARD, not a page wrapper — and using it as one
  produces two faults that look unrelated** (2026-09-18, both series pages).
  The producer reported them separately: "titlul e sus nu se vede, e sub
  aceea bara de blur" and "marginea din stanga si cea din dreapta sunt
  conturate urat". One cause. `.pj-shell` carries a 30px radius, a
  background and `overflow: clip` — and **no padding**: every screen that
  uses it supplies its own inner box (`.pj-hero` at 44px on the library,
  `.wk-head` at 34px on the workspace) and keeps the rest of the page
  OUTSIDE the card. `/series` and `/series/[id]` wrapped their whole
  document in one instead, so:
  - the shell began 82px down the page and its first line of text with it,
    which is under the fixed 100px `.navfade` blur band. Measured, not
    guessed: `h1` at y=120 before, y=192 after — the workspace's is 202.
  - every horizontal rule ran flush into a rounded corner. There are more of
    them than you would think: `.specs` has a border top AND bottom, and
    `.fsec > header` one underneath, so a page of sections inside a clipped
    card is a stack of lines dying into the radius. That is the whole of
    "conturate urât".
  Both pages now compose exactly like `/projects/[id]`: `.room` (44px top,
  which is what clears the blur) → `.wk-shell` with `.arc wk-arc` and a
  `.wk-head` → the `fsec` sections after it, on the page ground. Nothing
  about the content changed. **The general rule: before reaching for a shell
  class, find the padded box the screens that already use it put inside.**
  Verified in a real browser at 1440 and 390: no horizontal overflow, the
  title inset from the card on both, and the header now reads pixel-for-pixel
  like the workspace's — including the lit band, which crosses the card the
  same way there (checked, so it is the site's look and not a new fault).
  There is no automated check for this one and that is deliberate: it is
  visible the moment the page is opened, which is exactly what the checks in
  this repo exist to substitute for when a fault is NOT.
- **A link to the page you are already on is the hardest dead button to
  see** (2026-09-18, `lib/library-filters.ts`). The producer's read of the
  library hero was "butonul ăsta mi se pare cam useless", and it was worse
  than useless: `Everything waiting on me` pointed at
  `/projects?filter=wait`, which is the page it sat on, and `ProjectsGrid`
  held its tab in `useState("all")` and never read a search param. So the
  click navigated, the address bar changed, the page re-rendered, and
  nothing whatsoever happened. Nothing errors, nothing logs, and the diff
  that would have caught it is the one that never wrote the reader.
  - **The reader is now pinned, not just the link.** `check:deeplink`
    asserts every `?filter=` in `app/` and `components/` names a key in
    `LIBRARY_FILTERS` — and greps `ProjectsGrid` for the `searchParams.get`
    that consumes it. A grep is blunt, but the fault WAS a missing line, and
    deleting it should now have to delete an assertion too.
  - **`useSearchParams`, not a mount-time read of `location`.** The hero
    link goes from /projects to /projects: a soft navigation that leaves the
    grid mounted, so an effect with `[]` deps would never fire and the
    button would still do nothing. This is the trap that makes "same page,
    different query" links special.
  - **Arriving with a filter scrolls to the list; choosing a tab does not.**
    The grid is below the fold from the hero, so a filter applied silently
    900px down is the same nothing. A tab clicked in the toolbar writes the
    same param, so it is flagged first (`selfSet`) — the producer is already
    looking at the list and yanking the viewport would be its own bug.
    Measured: no scroll movement across eight 15s auto-refreshes.
  - **The button itself now opens work.** It names and opens the film that
    has been WAITING LONGEST, not the newest — the list is newest-first, so
    the newest waiting film is the one the producer just made and already
    knows about. Taking the oldest makes the button a queue: clear it, come
    back, and it names the next. With one film waiting the lead line above
    has already named it, so the label shrinks to "Review it"; with several
    it names the one it opens and a second ghost offers "See all N".
  Free side-effect of reading the param: the chosen tab now survives the
  15s refresh, which used to drop it back to All.
- `ProductionActivity` (project page) mirrors the batch rule from `Sort & Cap
  Scenes`: a scene is done for the batch once its clip exists, pending scenes
  sort first, and `MEDIA_BATCH_CAP` in `platform/lib/n8n.ts` is a display
  mirror of the CAP in that node — if Dan changes the cap in n8n, update the
  constant too or the "N more runs needed" hint goes stale. The panel's
  "likely on scene X" line is an estimate from landed assets and is labeled
  as such; the batch reports no per-scene progress.

### Documentary mode — archive footage (2026-09-07)

Any scene of a `documentary` project can take a real still or clip from a
free archive instead of a generated picture. It is a **per-scene** decision on
the Images step (`ArchivePicker` inside `SceneBoard`, offered when the
project's category is `documentary`), never a project switch — the old
`real_footage` toggle was removed for the Captions-rule reason: a control
that changes nothing reads as a decision. The brief this came from (a
ChatGPT spec) was right about the shape and wrong about two facts: it named
Airtable as the database and Vercel as the host. The library is
`hov.stock_media` (db/007) and the site runs on Hetzner.

**It needs no change in n8n, and that is the whole design.** `Needs Image?`
skips a scene that already holds `Imagine Scenă`, `Needs Clip?` skips one
that already holds `Scene Final URL`, and every gate keys off the same
checkboxes as ever. So `attachArchiveAsset` (`platform/lib/archive/attach.ts`)
makes BOTH assets itself and writes them in one transaction
(`attachStockToScene`) with `Status Producție Scenă: 'Așteaptă Aprobare
Video'` — the stamp `Sort & Cap Scenes` counts as done, so the scene stops
eating a slot in the cap of 8 — and the approvals reset, because the producer
picked the asset, not signed it off. Final Assembly receives an ordinary mp4.

- **A still** becomes the scene image (full quality) and an 8s Ken Burns clip:
  constant-velocity push of 12%, direction alternating by scene order, made
  by the ffmpeg that has been in the site's own image since the narration
  bundle. **A video** becomes an 8s segment cut STRAIGHT FROM THE URL
  (`-ss` before `-i`, so a 46-minute 553 MB NASA reel costs the bytes of its
  eight seconds plus the index) and its first frame becomes the scene image
  — the same role Veo's start frame plays. Both are h264 mp4 at 24 fps on the
  project's canvas; Commons hands out VP9/Opus webm and Theora ogv, which
  nothing downstream plays as-is. `seconds` is clamped 3..20 and `offset`
  never starts past the end.
- **`zoompan` moves in WHOLE SOURCE PIXELS, and that is why the Ken Burns
  shook** (2026-09-15, reported as "it zooms out on the archive photos but
  shakes while it does it"). Every output frame it takes
  `w = trunc(iw / zoom)` and an integer `x`, crops that, and scales it to the
  canvas — so the move can only advance a whole source pixel at a time. The
  still was blown up to **2×** the canvas, making one source pixel half an
  output pixel, against a move of about 0.38 px per frame: most frames the
  picture did not move, the rest it jumped half a pixel, irregularly, 24 times
  a second. **More than half the apparent motion was rounding, not zoom.** A
  pull-out shows it worst because the frame is being remagnified at the same
  time, so the stutter is in the size as well as the position.
  Two fixes, in `lib/archive/kenburns.ts`:
  **6× supersample** (not a knee — the residue falls as 1/S — but the smallest
  factor keeping the sideways jump under 0.1 px across every clip length the
  picker allows, both orientations, both directions), and **`x` derived from
  the same truncated `w`** (`trunc((iw-trunc(iw/zoom))/2)`) instead of
  `iw/2-(iw/zoom/2)`, which rounded the width and the offset independently and
  let the centre wander. Measured: the between-frame jump went 0.28 → 0.093 px
  and the off-centre drift 0.56 → 0.093 px. The second fix is free and halves
  the wander at any supersample, so it must not be dropped in favour of "just
  supersample more".
  `npm run check:kenburns` simulates zoompan's integer arithmetic frame by
  frame and asserts both the limits and that **6 is the smallest factor that
  passes** — which is what stops it being lowered to save encode time and
  equally what stops it being raised on a hunch. It is a model of ffmpeg, not
  ffmpeg: this environment has no ffmpeg, so what it pins is the reasoning.
  The cost is real — a 7680×4320 intermediate frame and a wider downscale
  filter, so attaching a still takes longer than it did.
- **Pause is the button that destroys a regeneration, and the site tells the
  producer to press it (2026-09-17).** A video regeneration has no webhook of
  its own: the flag is noticed only by `Evaluate Video Approval`, polling every
  15s from inside a live batch that has already walked the whole film, and the
  work that follows is a Veo submit plus a poll loop whose result reaches the
  database only when it finishes. So the badge reads "Regenerating video…" and
  looks **identical at second one and at minute forty**, whether a batch is
  working on it or nothing is running at all. `resumeProject` answers with
  "if it looks stuck for more than a few minutes, use Pause first, then
  Resume", and `pauseProduction` stops every running execution while promising
  "Nothing is lost: every finished asset is already in Airtable/Drive, and
  Resume picks up exactly where this left off". **That promise is false for a
  regeneration in flight**: a submitted Veo generation is not a finished asset,
  it dies with the execution, and Resume restarts the pass from the top and
  must cross the whole film again before it can even see the flag. Measured on
  `recqbPJ7aZu0a21mt`: the flags were set at 13:47 while the batch that had
  produced all 48 clips sat at the video gate; it was stopped at 13:52:16 and a
  fresh one started at 13:52:17. Do that once and the regeneration is lost; do
  it whenever the badge looks stuck — which is always, because the badge cannot
  look like anything else — and a regeneration can never finish. That is the
  whole of the producer's "regen does nothing, and it has always been like
  this". **A state whose only honest reading is "wait" must say how long it has
  been waiting and whether anything is working on it**, or the producer's only
  available action becomes the one that guarantees failure. Fixed the same
  day: `regenSinceOf` in `derive.ts` is the one rule `db/001` asked for (the
  OLDEST set flag wins — a wait that resets every time a second request lands
  never looks old enough to question — and a flag with no timestamp says
  nothing rather than "just now"), `RegenBadge` shows the age and whether a
  batch is alive, `pauseProduction` counts what is in flight and says the work
  is thrown away rather than paused, and `resumeProject` stopped recommending
  Pause. **It needed no schema change**: the site reads `hov.scene` directly
  (`SCENE_SELECT` is `select s.*`), not the `at_scene` view, so the three
  columns were already in the row — worth knowing before designing a migration
  for anything else the scene table already holds. `npm run check:regen-wait`.
  Full account: `db/port/regen-unstick/README.md`.
- **The real fix was to stop Pause being the only lever, and that took a
  webhook (2026-09-17 evening).** Legibility made the wait readable and did
  not make it shorter; the entry above is the diagnosis, this is the cure.
  Video was the ONLY regeneration without a webhook of its own — text, image
  and voice each have one on Claude Scripting — so it alone had to ride a
  full Media Generation pass. `scene-video-regen` now runs the same `RG *`
  tail on its own execution: measured click to new clip in **2 min 57 s**
  (execution 14316), against a batch that had to walk 48 scenes first.
  **Three things had to move together, and any one alone would have been
  half a fix.** (1) The webhook, which is n8n's half. (2)
  `fireVideoRegenWebhook`, fired from all three places that set the flag —
  `approveScene(video, regenerate)`, the clip queued when an approved image
  made it stale, and the ⟳ re-send — each falling back to `nudgeProduction`
  where the webhook is not configured, so a deployment without it behaves
  exactly as before. (3) **`pauseProduction` had to stop killing it.** Pause
  stopped every running execution, so the button the producer reaches for
  when a regeneration looks stuck was guaranteed to destroy the
  regeneration; giving video its own run only removes that if Pause then
  leaves it alone. The rule reads the execution's `mode`, newly carried on
  `ExecutionSummary`: a `webhook` run on Media Generation or Claude Scripting
  is ONE SCENE'S work, everything else is the film's. Deliberately narrow —
  Final Assembly's `assemble` webhook is a whole render and Pause still stops
  it, and an unknown mode is treated as production, because stopping too much
  is the old behaviour while stopping too little strands a flag. `RegenBadge`
  gained `standalone` for the same reason: its old copy told the producer a
  regeneration is "only ever picked up by a live production run", which was
  true when written and was, for video, the sentence that sent them to the
  destructive button. Full account:
  `db/port/video-regen-webhook/README.md`.
- **A player that "corrects" drift on a timer will destroy a slow source
  (2026-09-20).** Scene review had become unusable — press play, the clip
  loads, then either freezes or loads slower than it plays until the two
  collide. It was not element count (one `MediaPlayer` mounts at a time) and
  it was not the clip (48 of 48 are on the box; Caddy answered a byte range in
  **25 ms**). It was the VOICEOVER, which no path has ever kept locally —
  `hov.attachment` holds 850 `image` rows and 775 `video` rows and has no
  audio field, so every take of every film is still fetched from Drive, where
  the same range measured **593–1383 ms**. Twenty to fifty times slower, and
  `/api/media` marked each 206 `no-store`, so a re-watch paid again.
  **The amplifier is the lesson**: `MediaPlayer` hard-set `a.currentTime`
  whenever the take drifted past 0.15 s, on `timeupdate`, which fires four
  times a second. Setting `currentTime` is a SEEK; each seek threw away the
  audio's buffer and cost a second of Drive; during that second the drift grew
  past the threshold again. The loop could not converge — 0.15 s is tighter
  than the media clock's own resolution — so the correction WAS the stall, and
  the video was dragged along by it. **Correct on deliberate moments (play,
  the user scrubbing); take ordinary drift out with `playbackRate`, which
  discards nothing; keep one rate-limited hard seek for real desync; and never
  correct while the element says `waiting` or `stalled`.** The other half of
  the fix is that `/api/media` now keeps what it fetches — the whole file on a
  miss, content-addressed by the Drive id under `/media/_drive/`, every later
  request served off disk with real ranges. A take is also `preload="auto"`
  now: tens of kilobytes is one request, where `metadata` left the browser
  ranging its way through a source that answers each range in about a second.
  Byte-range arithmetic is pinned by `npm run check:media-range` (49 checks) —
  an off-by-one there looks like "plays but will not seek", never like an
  off-by-one.
  **The proxy cache that shipped alongside it was WITHDRAWN the same hour,
  and the way it failed is the lesson.** Attempt one made the request that
  missed do the downloading, which is invisible on a 40 kB take — every test
  used one — and fatal on a film, where the browser got nothing until the
  server held the last byte and a player that used to start immediately never
  started. **A cache is not allowed to be slower than no cache.** Attempt two
  moved the fill off the request path, correctly, and still did not help:
  checked through Caddy, `/media/_drive/` answered 404 for every id, so the
  cache had never written a byte — `writeCached` swallows its own failure by
  design, and `mkdir` at the volume root is not something the `web`
  container's `group_add: "2000"` actually permits. Two regressions, no
  benefit, a component that never once worked; removed rather than repaired.
  **The measured win for scene review was the player fix alone.**
  It also left a trap on the way out: twelve minutes of `Cache-Control:
  private, max-age=31536000, immutable`, which tells a browser not to
  revalidate at all, so a truncated response was pinned for a year and a
  normal reload was exactly what `immutable` says to skip. `mediaSrc` appends
  `&v=2` now — a different URL cannot match a poisoned entry. **Never send
  `immutable` from a route that can answer with a partial or an error.**
  What to do instead, if a local copy of takes is ever wanted: an attachment
  row through `/api/media/ingest`, the path that has worked for 850 images
  and 775 clips. Prefer the path that already works, even when it is slower
  to arrive.
  Full account and the numbers: `db/port/scene-lag/README.md`.
- **The video-regen trap, and three guards for it.** A stock scene has no
  Flow asset to regenerate from, and `Prep Video Regen` THROWS without an
  `Image Media ID` — a throw that kills the whole batch, not the scene. So
  `Regenerează Video` must never be set on a scene whose `visual_source` is
  not `ai`: `flagStaleClip` answers `none` for it (approving the picture makes
  nothing stale — the clip was cut from the archive, not made from the
  picture), `sceneAction(video, regenerate)` refuses with a message, and the
  board hides the button in favour of "Another archive clip…". **Any new
  writer of that flag must check `visual_source` first.** Image regen is the
  door back: `backToAiImage` drops the link, the clip and `Scene Final URL`,
  then flags an ordinary image regeneration; once the new picture is
  approved, `Needs Clip?` sees a scene owing a clip.
- **Wikimedia was the only archive until 2026-09-09; the footage engine
  (its own section below) added the EU Audiovisual Service, DVIDS and NASA,
  and 2026-09-10 added nine more — `docs/footage-sources.md` is the
  catalogue.** Read off real responses (executions 10893/10895/10898): `filetype:video`
  finds both webm and ogv (`filemime:video/ogg` finds nothing — the ogv's
  MIME is `application/ogg`); `filetype:bitmap` also returns animated GIFs,
  skipped; `formatversion=2` makes `query.pages` an array; a public-domain
  template can carry no `License` code at all (`Copyrighted: "False"` is the
  fallback). Two US institutions were once declared here as disabled
  placeholders and have been REMOVED at the producer's request (2026-09-10:
  "I don't want to use them anymore") — never built, never searched, their
  keys read nowhere, their names gone from code, tests and labels. Do not
  bring them back, and do not bring anything back as a placeholder: a
  provider is a file under `lib/footage/providers/` or it is nothing.
- **The date field lies, so it is shown and never trusted.** Commons dated a
  1969 NASA clip `2015-06-12` (its YouTube upload) and answered "Benz
  Patent-Motorwagen 1886" with 2013 and 2021 photos of museum REPLICAS. The
  provider's string is stored verbatim as `date_original` and labelled
  "dated", the years the title and description MENTION ride alongside as
  `years_mentioned`, and relevance stays a human's call (or a model's, in a
  later slice). Do not derive a period from either field.
- **Rights are decided by code, from an allowlist** (`lib/archive/rights.ts`,
  13 fixture cases). NC and ND are rejected outright — no review can change
  what a licence says, so offering one would only invite the wrong answer.
  `ARCHIVE_AUTO_LICENSES` defaults to the brief's four (public domain, CC0,
  CC BY, CC BY-SA); share-alike is admitted but STATED on the asset and in
  the picker's chip. FAL, GFDL and anything unrecognised → `manual_review`,
  which the picker shows with its reason and still lets the producer use —
  they are the reviewer. `rejected` cannot be used.
- **Two status columns, on purpose.** `stock_media.review_status` is the
  rights verdict, refreshed on every sighting; `stock_media.status` is the
  producer's decision (candidate / approved / rejected / used) and a refresh
  never touches it. Conflated, a re-search would un-reject an asset.
- **`/api/archive/search`** serves the browser with the site cookie and n8n
  with the `x-hov-key` it already uses; `middleware.ts` opens the door only
  for the key, and the route checks both again. Every result is filed into
  the library best-effort (a filing failure costs the `id`, and the picker's
  "Use" stays disabled with the reason, never the search). `library=1`
  answers from what has already been seen.
- **The site tolerates db/007 not being applied.** A push deploys by itself,
  a migration runs by hand, and in between a scene query naming
  `hov.stock_media` would take down every project page. `stockReady()` in
  `postgres.ts` asks `to_regclass` (cached 60s) and the scene select drops
  the archive columns until the table exists. Apply with
  `docker exec -i n8n-postgres-1 psql -U hov -d hov -f - < db/007_stock_media.sql`.
- **Both ffmpeg recipes are proven on the live site** (2026-09-07, execution
  10907 on the disposable film `recaW2aLFFD06FpoN`): a 2400×3000 NASA still
  became a Ken Burns clip on the 9:16 canvas in **2.6s**, and the 20s Jack
  King webm was cut from second 5 into an 8s mp4 plus poster in **4.3s**,
  neither touching n8n. Verified by EYE, not by status code: the render
  server's `/inspect?mode=sheet` answers a contact-sheet JPEG, which an n8n
  HTTP node (response format `file`) plus a Code node
  (`getBinaryDataBuffer` → base64) carries into execution data, and
  `get_execution` then saves to a file this box can decode and view. The
  four tiles show the push-in and the real cut. That is the way to LOOK at
  any media from a session with no outbound HTTP.
  **How to exercise it without the UI:** `POST /api/archive/use` with the
  ingest key from an n8n HTTP node at `web:3000` — the route exists for
  exactly this. The scene rows read as designed afterwards: `visual_source`,
  `stock_media_id`, `scene_final_url` on the media store, both attachment
  rows replaced, approvals reset, one auto-kept draft per kind, and the
  library row marked `used`.
  **Credits are printed in the YouTube DESCRIPTION since 2026-09-10, not yet
  on the end screen.** The obligation is a CC BY / CC BY-SA licence naming its
  author as the price of use, and the description is the cheap half — no
  Railway push, no re-render, and it reaches every film already finished.
  `footageCredits()` in `lib/provenance.ts` builds it in two tiers and
  `/api/yt-kit` prints them under "Footage and images": REQUIRED credits come
  from `attributionFor()` — the same function the on-screen watermark uses, so
  the frame and the description cannot tell a viewer two different things —
  and everything else real (public domain, CC0, a government reel) is listed
  as a courtesy, because that is what a documentary description carries and
  what our API applications promise each provider. **The cap can only ever
  fall on the courtesy list**: dropping a required credit to fit a character
  budget is the one failure here nobody would see, since the description would
  still look complete. One line per SOURCE, not per scene. The end-screen
  credit is still owed and is still a Remotion change.

**AI-suggested footage, since 2026-09-07 (slice 3).** The producer's ask:
"when I approve the scenes, an AI should already have looked for real
footage for the scenes where it makes sense and offer me three or four
options in a bar — the rest get generated." Workflow **`Archive
Suggestions`** (`Lo78uXXCFYoIH73r`, webhook `archive-suggest`, POST
`{project_id}`, answers on receipt) holds the two model calls — the OpenAI
key lives in n8n, like `YT Scene Titles` and `Expand Brief` — and the site
holds everything else in `/api/archive/suggest`:

```
Fetch Scenes (GET, claims) → Build Query Prompt → Query Model → Parse Queries
  → Search Archives (POST stage=search) → Build Rank Prompts (batches of 8)
  → Rank Model → Parse Ranks → Store Suggestions (POST stage=store)
```

- **Fired by the site on scene-text approval** (`saveSceneScript` with
  approve, `approveAllScenes`), documentary films only, fire-and-forget.
  The run picks scenes that are approved, still `ai`, without a clip and
  not yet looked at, and **claims them for ten minutes**
  (`archive_suggest_claimed_at`), because every approval fires a run and two
  overlapping runs would spend the same model calls twice.
- **Two stamps, told apart on purpose.** `archive_suggested_at` says the
  scene was LOOKED AT, picks or not; without it "nothing relevant found" and
  "nobody looked yet" read identically and would send the producer searching
  by hand for a scene the AI had already cleared. The bar has three states —
  offers, cleared ("will be generated"), not yet (with the manual door
  "✨ Look for archive footage", which resets the stamps and fires again) —
  because the run dies silently and something on screen must say so.
- **Every Code node emits at least one item**, including a trivial model
  payload when there is nothing to ask, so `Store Suggestions` runs on every
  path and stamps what was processed. An IF-branched canvas would have been
  cleaner and was not worth learning the SDK's branch syntax for.
- **A pick must name a candidate the batch actually offered** (`Parse
  Ranks` checks against `Build Rank Prompts`' candidate ids) and the store
  drops any id the library does not hold — the same "an invented value
  cannot survive code" rule as `Validate Evidence Refs`. `rejected`
  licences are never offered at all. The rank prompt is told the catalogue
  date is usually the upload date, since that is the trap measured above.
- **Second search door for n8n**: the search stage runs up to two queries
  per scene, `mediaType: any`, with a 300ms breath between requests — a
  90-scene film can be a couple of hundred Commons calls, and the archive
  asks clients to be polite. Videos are listed before stills for the ranker.
- The bar's "Use" is `useArchiveAsset`, the same attach path as the
  hand-searched picker; `ArchiveCard` is shared by both so a licence reads
  the same wherever it appears. The filmstrip shows `🎞 N` on scenes with
  offers that are still undecided.
- **Both panels live UNDER THE MONITOR (`.stagemain`), not in the Inspector
  rail** (moved 2026-09-09, producer's call). The rail is capped at 400px by
  `.stage`'s `grid-template-columns`, and both halves are wide by nature — a
  row of offers and a grid of search results — so in there four offers showed
  as one and a half behind a scrollbar. Under the picture they get its full
  width (786px measured at a 1440 viewport) and sit directly beneath the image
  they would replace; the suggestions row became a `repeat(auto-fill,
  minmax(180px, 1fr))` grid at the same track size as the picker's results, so
  all four are visible at once and offers and search results are one kind of
  card. The toggle BUTTONS stayed in the Inspector rows — they belong with
  Approve/Regenerate, and a panel is content, not a control. On a narrow
  viewport the grid collapses to one column and the section stays attached to
  the monitor, above the Inspector.
- **Two defects shipped with slice 2/3 and lived for two days because nobody
  LOOKED at the page.** Both are invisible to tsc, to a build, and to reading
  the file.
  - **`var(--acc)` does not exist — the token is `--accent`.** An unknown
    custom property makes the whole declaration invalid and it is simply
    dropped, so the suggestions bar had NO background and NO border (measured:
    `rgba(0,0,0,0)` and `0px`), a selected card had no ring, and the
    picker's Any/Video/Photos control had no active state at all. Every one
    of those rules parsed, shipped, and did nothing. **Check a new
    stylesheet's tokens against the `:root` block** — `grep -ho 'var(--[a-z0-9-]*'
    on the module, each name against globals.css — it is a five-second grep
    and it is the only thing that catches this.
  - **`.abtn` carries `padding: 12px 0`** — no horizontal padding, because it
    is built for the `.abtns` GRID, where the cell supplies the width. Dropped
    into a flex row it collapses to the width of its label: "Use" rendered as
    a 27px circle with the word spilling out of both sides. Any archive panel
    putting an `.abtn` in a flex row states the padding itself.
  **The method, since a Claude Code session has no browser of its own:** write
  a throwaway `app/zz-probe-*/page.tsx` that renders the component with mock
  props (no database, no n8n), `next dev` on a spare port, and drive the
  Playwright chromium already on the box at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Screenshot AND measure
  — `getBoundingClientRect` on the panels proved the bar sits at the monitor's
  exact x and width, and `getComputedStyle` is what turned "the panel looks
  wrong" into "background is transparent because the token does not exist".
  Delete the probe and `rm -rf .next/types` afterwards, or the generated route
  types fail the next `tsc`.
- **First live run, measured** (execution 10942 on "How ww2 started",
  `recjhLgA7KpmQ3WpZ`, 16 scenes, fired while the film sat at its image
  gate): **42 seconds** end to end, 16 scenes looked at, 13 judged worth
  real footage, 2 of those found nothing usable (the House of Commons in
  1939), 29 picks stored. The picks read right — Molotov signing on
  23 August 1939, German soldiers at the Polish border barrier on
  1 September, the Brest-Litovsk parade, the Warsaw siege film — and the
  ranker demoted the generic "1939 Poland map" to 0.55 with a reason that
  says so. A film that already had its AI images when the run fired keeps
  them; the offers sit beside them and replace one only on Use.
- **"Three or four options" became the ceiling, and the ceiling filled with
  photographs** (2026-09-13, after the NASA film). The producer's original
  words above were built into the product as a hard FOUR in three places at
  once: the rank prompt's last sentence, `Parse Ranks`, and the store
  stage's `.slice(0, 4)`. A scene whose archives held one clip and three
  stills therefore offered four stills, and the report was "it finds mostly
  photos" — which read as a search problem and was a display cap. All three
  are `MAX_PICKS_PER_SCENE` = 16 now, a sanity bound on a prompt and a
  table rather than a number of options anyone chose, and the candidate
  pool the model reads went 12 → 16 out of a ranked `top` of 30. **A
  phrase from a feature request is a description, not a specification**:
  four was the producer picturing the feature, and it outlived the sentence
  by becoming a constant.
- **Video first, relevance dominant, in two places that must agree.**
  `VIDEO_FIRST_BONUS` (15, `lib/footage/rank.ts`) lifts a clip in the SORT
  key so it is offered ahead of a photograph of similar relevance, while a
  photograph that is clearly better still wins; `SUGGEST_SUBSELECT`
  (`lib/data/postgres.ts`) writes the same rule on the model's 0–1 scale and
  orders the bar on READ, so offers stored before the rule obey it too. The
  lift rides on the B-roll ladder, never on the media type: a talking head
  already carries a −15 visual penalty and lifting every video by +15 would
  cancel it exactly, undoing B-roll-first without a word in the diff to say
  so.
- **"It finds mostly photos" had three causes stacked, and only the first
  was the cap** (measured on the NASA film the same hour, executions 12936
  and 12940). Raising the cap took the film from 14 offers to 26 and still
  produced not one clip. Second cause: `Build Query Prompt` let the model
  choose `preferredMediaType` freely and it chose "image" on five scenes of
  seven, which makes the engine prefer stills AND switches off
  `VIDEO_FIRST_BONUS`, since a scene that asked for a still is asking for a
  still. Video is the prompt's default now and five of eight scenes asked
  for it on the next run. Third cause, and the one that still stands: the
  clips then DID reach the candidate lists and DID rank top — the Space Act
  signing scene had eight videos, the best at score 75 against stills in the
  forties — and the ranking model chose three scans of the Act anyway,
  because those clips are 2018 NASA anniversary montages, not 1958 newsreel,
  and the prompt tells it to reject the wrong decade. **That last one is not
  a bug and must not be "fixed" by loosening the rule**: a modern
  retrospective offered as archive footage of 1958 is exactly what the
  provenance system exists to prevent. A film about an institution founded
  in 1915 genuinely has photographs where it wants film. **The lesson is
  where to look**: a display cap, a request field and a model's judgement
  produce the identical symptom, and only re-running it end to end and
  reading what each stage ASKED FOR and was OFFERED tells them apart.
- **Destockd, and what a robots.txt line is worth** (2026-09-14). The
  producer asked for `destockd.com`: a shot-level front end over the FedFlix
  films our Internet Archive adapter already searches, cutting each film into
  shots and indexing them with CLIP — the one thing the Archive cannot do,
  since it hands back a twenty-minute reel and `rank.ts` halves anything over
  ten minutes. Its robots.txt is `Allow: /` with `Disallow: /api/`, and every
  data endpoint is under `/api/`. I built it import-only first and said so;
  the producer asked twice for it to be searched like the others, **and that
  is their call to make**: nothing here defeats a password, a paywall or a
  signed URL, the endpoints are public and unauthenticated, and the footage
  is public domain. What the decision changes is not permission but MANNERS,
  so the manners are code — one query per scene where every other adapter
  runs three, a self-imposed 20-a-minute ceiling that refuses before the
  request is made, a User-Agent naming us and how to reach us, 403/429 read
  as "stop" rather than "retry", and `FOOTAGE_DESTOCKD=off` as a one-variable
  exit. **Telling the operator is still owed and is not optional**;
  `contact@destockd.com` is on their About page.
  Three smaller findings, each of which decided part of the shape. Its pages
  are a hash router, so a shot's identity lives after the `#` and never
  reaches a server — which sounds like a dead end and is the opposite, since
  the fragment is still in the string a producer pasted. Its film TITLE is
  the only text a shot has, and on FedFlix that title is often the whole
  record ("Apollo (11) Spacecraft #107, Saturn V Rocket, AS-506, Launch and
  Tracking - July 16, 1969"), which is what carries subject, place and year
  into our own ranker. And its rights text had to be REWORDED: it said
  "third-party", which is one of the rights validator's own trigger phrases,
  so every clip was flagged as somebody else's material by its own
  disclaimer — the trap DVIDS's notice had already sprung once.
  **Read robots.txt and the legal page before designing an adapter**: both
  are public, both are free to fetch, and between them they settled every
  question before a line was written.
- **The provider's NAME is the link now.** The card carried a chip saying
  where an asset came through and, separately, a "source ↗" in each
  caller's action row: two controls for one fact, and the one you could
  click did not say where it went. `ArchiveCard` owns the link, so the
  suggestions bar, the picker and the admin page all gained it at once and
  each dropped its own.

### The source watermark — saying which pictures are real (2026-09-09)

A film cuts AI pictures, AI reconstructions and real archive material into one
montage and nothing on screen ever said which was which. Now a small corner
label does: **AI GENERATED · AI RECONSTRUCTION · ARCHIVAL FOOTAGE · ARCHIVAL
PHOTO · ACTUAL FOOTAGE · ILLUSTRATIVE FOOTAGE · REAL FOOTAGE · SOURCE
UNVERIFIED**. Full account in `docs/source-watermark-*.md` (six files); what
belongs here is the load-bearing parts.

- **The classification is STORED, never derived at read time.** `db/009` adds
  six columns to `scene` (`visual_origin` not-null default `ai_generated`,
  `provenance_confidence`, `provenance_manually_verified`, and event/location/
  date), backfilled once from `visual_source`. Everything after that is a
  WRITE: the archive attach, `detachStockFromScene`, an image approval, an
  image-prompt edit, the producer's own override. The render is a pure lookup
  — a renderer that re-derived provenance could disagree with the record the
  producer approved, on the one overlay whose job is telling the truth.
- **Nothing automatic may ever say ACTUAL FOOTAGE.** It means the media shows
  THIS event, place and date, and no signal we have establishes that: a
  ranker's relevance is a judgement about a search result, the archive's date
  field is frequently the UPLOAD date (Commons dated a 1969 NASA reel
  2015-06-12), and visual similarity says two newsreels look alike.
  `classifyVisualOrigin` tops out at archival_footage/archival_photo and its
  confidence is capped at **85, below `ACTUAL_FOOTAGE_MIN_CONFIDENCE` (90)** —
  so no automatic number can read as authority. Only the producer's Footage
  type control reaches actual/illustrative, and it sets `manuallyVerified`.
- **An AI picture is REFUSED, not warned, when someone tries to call it real.**
  A confirmation dialog cannot make model output authentic; the door is
  replacing the media, which is what the refusal sentence says and what the
  archive panel on the same step does. The mirror refusal (calling a real
  archive picture AI) exists too, pointing at "Back to AI".
- **The watermark and the licence credit are TWO SYSTEMS.** The switch owns the
  LABEL. A credit CC BY / CC BY-SA demands is a legal obligation and is drawn
  whether the switch is on or off — `planWatermarkBands({showLabel:false})`
  keeps exactly the bands that owe one and drops the rest. Do not collapse them
  into one flag, ever.
- **No date or place is printed unless a PERSON typed it.** `provenance_date`
  is deliberately separate from `stock_media.date_original`, and the picker does
  not even pre-fill from it. Same reason as above.
- **The label is per BAND, not per scene.** Consecutive scenes with the same
  badge merge into one continuous label, or six archive shots in a row blink
  the same words apart and back at every cut. It is suppressed over a full-frame
  card (the card REPLACES the picture) and under the hook title — the same
  `!activeCard && !chapterCardUp` gate the captions use.
- **`showSourceWatermark` defaults to TRUE and that is safe only because a
  scene with no `provenance` draws nothing.** Old props carry none. But note
  the consequence: **every film re-rendered from now on gains the label**,
  Story films included (every scene reads AI GENERATED), unless its producer
  switches it off.
- **This is the one finish the SITE stores, not `Normalize Webhook Input`.**
  One reader (Final Assembly's `Source Watermark` node reads Editing Options
  directly) and two writers, both on the site — the brief and Final touches —
  and Final touches already used `updateEditingOptions`. `createProject` writes
  `{sourceWatermark:false}` only on refusal, after the record is confirmed.
  Absence means ON, like captionColor's white.
- **`at_scene` was WRAPPED, not rewritten.** db/009 renames the db/002 view to
  `at_scene_core` and builds `at_scene` on top of it, adding one `Provenance`
  key. The obvious `create or replace view` would have meant retyping
  twenty-one Romanian field names (`Status Producție Scenă`, `Observații
  Scenă`…) that five workflows index by hand — and a mistyped diacritic there
  does not raise, it silently produces keys no gate matches. **Any future
  addition to at_scene should wrap the same way.**
- Tests: `npm run check:provenance` (platform, 58) and `npm run check:watermark`
  (remotion, 24). Commons returns creators as `Template:Helmut Laux`; both
  formatters strip the prefix, and that is pinned.

#### Previewing it before the render (2026-09-15)

`WatermarkPreview` (documentary only, under the Source watermark row in Final
touches) shows the badge on THIS film before an hour of Remotion says what it
looks like. Three decisions in it are worth keeping:

- **The frame is drawn at the render's real size and scaled as one piece.**
  The badge is 16px inside a 1280×720 box; the box gets
  `transform: scale(w/1280)`. Every proportion is preserved by construction
  instead of by a dozen multiplications, each of which would be a chance to be
  quietly wrong. **The frame is 1280×720, not 1080p** — see
  `remotion/src/Root.tsx` — and guessing 1920 would have drawn the badge half
  again too small relative to the picture.
- **It shows the badge TWICE, and that is the point.** A faithful thumbnail of
  a 16px badge is four pixels tall and unreadable; enlarging it inside the
  frame would misrepresent the one thing the preview exists to show. So the
  frame stays true about WHERE it sits and how much it takes, and the text is
  repeated underneath at 1:1 where it can be read. This was found by
  screenshotting the first version and discovering it was illegible — build
  the thing, then look at it.
- **It is not gated on the toggle being ON.** Switching the label off leaves a
  credit CC BY or CC BY-SA demands standing, which is the sentence the row's
  prose works hardest to explain; letting the producer watch the label vanish
  while the credit stays does it in one click. On a film with one CC BY-SA
  shot, switching off collapses the whole film to a single band — which is
  itself the clearest possible statement of what the switch does.

The geometry moved out of `SourceWatermark.tsx` into `WATERMARK_LAYOUT` /
`WATERMARK_STYLE` in `remotion/src/provenance.ts`, and `planWatermarkBands` is
mirrored into `platform/lib/provenance.ts` — the preview must merge bands the
way the render does, or it describes a film nobody will watch. **Four places
now carry those numbers**: the two modules and the two checks that pin them
(`check:watermark` in remotion, `check:footage` on the site). Verified by
nudging `left: 90` to `92` and watching the render's check fail.

### The Universal Footage Engine (2026-09-09)

One search behind every "real footage" door — the picker's *Search real
footage*, the `archive-suggest` run, *Add from URL*, *Upload*, and the
library at `/admin/footage`. `platform/lib/footage/` (engine, registry,
router, rights, provenance, ranking, dedupe, health, URL import, fifteen
providers in five tiers — `docs/footage-sources.md` is the catalogue of
what each covers, what was measured on it and which key unlocks it),
`db/010_universal_footage.sql` (applied 2026-09-09: 19 columns on
`stock_media`, the provider CHECK dropped, `footage_provider_status`,
`footage_search_cache`; 178 rows backfilled to archival provenance) and
`db/011_footage_sources.sql` (applied 2026-09-10: comments and one index,
nothing to migrate), routes under `/api/footage/*`, and
`docs/universal-footage-engine.md` plus ten sibling docs, which are the
spec. What belongs HERE is what will bite:

- **A retired provider is absent, never disabled.** Not in the registry, not
  in `ARCHIVE_PROVIDERS`, `adapterFor()` answers null, no key is read
  anywhere, no label map names it (a row it once filed still reads, with a
  title-cased id as its name). Two US institutions left this way on
  2026-09-10 at the producer's request; do not bring them back. The two
  label maps (`platform/lib/provenance.ts`, `remotion/src/provenance.ts`)
  stay in lockstep, like `presetForTone`.
- **Stock is a tier, not a subject, and it is routed only for a scene that
  names NO event** (`tierFit` in the registry): a real clip of the wrong
  thing is not real footage of anything. Even then the archives' `general`
  coverage outranks it — dated material first — and on a scene that names
  a subject ("a quiet BORDER town" matches geopolitics and migration) the
  official and archive sources fill all four slots and stock falls off the
  cap, which is the right order for a documentary. The other tiers: an
  official source LEADS on its own subjects (+3, or NASA loses an Artemis
  scene to the general archives), archives own history and are the
  fallback through `general`, communities (Flickr, Openverse) cover recent
  events and places, the library tier is never routed.
- **The Internet Archive's community area is unlicensed by default, and
  the first query proved it**: "moon landing" answered a YouTube mirror of
  a hoax video from the `altcensored` / `fringe` / `deemphasize`
  collections with no licence at all. So `internet_archive` never searches
  blind: film comes from collections whose POLICY is public domain
  (`PD_COLLECTIONS`: prelinger, universal_newsreels, FedFlix, usgovfilms,
  nasa) or carries a `licenseurl`; stills come from the PD collections
  only, because "berlin wall" stills under uploader-declared licences were
  junk; an uploader-declared licence outside those collections by a
  non-institutional creator is `manual_review`; YouTube mirrors
  (`identifier:youtube*`) and the Archive's own flagged collections are
  excluded outright. So filtered, "berlin wall" answered a 1961 US Army film
  of the Brandenburg Gate under a public-domain mark. The search-time
  `downloadUrl` there is a DIRECTORY (`/download/{id}`); the file is picked
  from `/metadata/{id}` at use time.
- **`attach.ts` resolves the bytes through `provider.resolveDownload`**
  (`resolveMediaUrl`), never from `stock.downloadUrl` directly. Three
  providers need it: the Archive's directory URL above, NASA (the search
  answer holds a preview), and Unsplash (its guidelines require a
  `download_location` call before use). Trusting the search-time URL would
  have attached a directory listing as a clip.
- **The EU Audiovisual Service is OPT-IN and off, because it has no public
  API.** Checked 2026-09-10 by fetching the site from n8n: the search page
  is an Angular app talking to an internal AWS API Gateway with a bearer
  token embedded in the app's own JS bundle. That token is an access
  control, not an offer, and the spec's URL-import rule ("never bypass an
  access control") applies to adapters too — so it is NOT used and must
  never be written into this repo or its docs. `EU_AV_API_BASE` has no
  default any more (the old default pointed at a path that does not exist,
  and the adapter's shape was never verified); the defensive reader stays
  for the day the Commission publishes an endpoint, and an EU AV PAGE still
  comes in through URL import with the rights it states.
- **DVIDS refuses `sort=relevance`, and that took the whole provider down
  on its first real run** (2026-09-10, the day the key arrived):
  `400 {"errors":{"sort":{"notInArray":"Invalid Sort Value (relevance)"}}}`.
  The parameter was written from the documentation and never sent, which is
  the risk `docs/footage-sources.md` names for every unkeyed adapter. It is
  simply GONE now rather than replaced: the valid vocabulary is published
  nowhere reachable (api.dvidshub.net/docs is behind a login), so any value
  would be a second guess with the same failure mode — and nothing is lost,
  because `rank.ts` re-scores every candidate from every provider together,
  so a provider's own ordering never reaches the producer.
  **The general shape, and the reason it was found in one look: an adapter
  that throws away the API's own error body is an adapter that cannot be
  debugged.** All thirteen now append what the archive actually SAID
  (`describeHttpError` in `lib/footage/request.ts`) — bounded, HTML-stripped,
  and never throwing, since a diagnostic that can fail would replace a real
  error with its own. The Wellcome `source.production` bug had sat behind a
  bare `HTTP 400` for exactly this reason, and was FIXED the same hour —
  `include` on the images endpoint accepts only `source.contributors`,
  `source.languages`, `source.genres` and `source.subjects`, and every
  Wellcome search since the adapter was written had been refused. Verified
  live afterwards: "cholera epidemic london" answers 11 public-domain
  lithographs from 1832-1854 in 600ms, and the two "In copyright" posters in
  the same page correctly come back `manual_review` with their reason.
- **The Library of Congress answers the Hetzner box with a Cloudflare
  challenge** (HTTP 403 "Just a moment…", measured 2026-09-10 on
  `loc.gov/search/?fo=json`; `api.openverse.org/v1/images/` answered an
  anonymous request the same way). LoC is written from the documented
  shape and OFF by default behind `FOOTAGE_ENABLE_LOC=1`.
- **Openverse is NOT off without its client — it runs anonymously, as the
  official client does** (the producer's correction, 2026-09-10; the first
  version switched it off, which was the wrong shape: absence of a
  credential means the lower quota, never no source). Anonymous is the
  API's own throttle — 5 requests an hour, 100 a day, 20 results a page
  (`anon_burst` / `anon_sustained`; the docs were unreachable from this
  session, so the numbers are from the API's declared rates, and its 429 is
  the authority) — so the adapter spends ONE request per search, on the
  most specific query, and keeps its own hourly window, refusing the sixth
  as a rate limit before the API is asked. `OPENVERSE_CLIENT_ID` +
  `OPENVERSE_CLIENT_SECRET` (free) switch it to the 10,000-a-day tier and
  three queries per search. Two mechanisms came with it: **`notice`** on
  `FootageProvider` — a caveat on an ENABLED provider, shown on the admin
  strip and the picker chips, distinct from `disabledReason` because a
  provider with a notice is still routed — and **a held-back provider no
  longer burns a slot**: `routeProviders` takes a `skip` predicate, the
  engine passes `heldBack`, and the report says "held back" for it instead
  of "not routed for this subject". That second one is what makes a
  Cloudflare-blocked anonymous provider survivable: it fails, cools off, and
  costs nothing while it does.
- **Rights are a filter, never a score.** `validateRights()` yields
  `cleared | attribution_required | editorial_only | manual_review |
  restricted | unknown`; `restricted` is removed before ranking and cannot be
  raised by anyone; the three review classes reach a render only through a
  human act recorded as `stock_media.status = 'approved'` (the picker's
  "Use — I accept the rights", the admin page's Verify). The suggestion run
  never offers a review class. `renderable()` is the one test.
- **A `©` naming the provider's own organisation is not a third party.**
  "© European Union" on an EU AV item, DoD branches on DVIDS. The first
  version read every `©` as a third party and classed the whole EU service
  as manual review — and DVIDS's own rights NOTICE contained the words
  "third party", which the validator then matched. Words like *courtesy of*
  / Getty / Reuters always mean somebody else; a bare copyright claim means
  it only when it names someone other than the provider (`OWN_NAME` in
  `lib/footage/rights.ts`). Never put the validator's own trigger words into
  a notice the validator reads.
- **ACTUAL FOOTAGE is decided from metadata, never from appearance**, and
  only here: `assessProvenance(request, asset)` says it when the asset's
  own event, filming date AND place all match the scene's request and the
  spec-weighted score (event 30, date 20, place 20, people/org 10, topic 10,
  metadata 10) reaches `ACTUAL_FOOTAGE_MIN_CONFIDENCE` (90). **A signal the
  request cannot ask for leaves the denominator** — a scene naming no
  person has no people evidence to find, so those ten points are not
  silently failed; event, date and place are never waived. The media-only
  `classifyVisualOrigin` still never says actual. **Uploads and URL imports
  stay `unknown` however well they match** (§25); the admin page's *Change
  provenance* is the only door up and demands event + place + date.
- **A mismatch is a penalty; an absence is not.** Every signal in
  `match.ts` is `yes | no | unknown`. An undated asset is not "the wrong
  date". `dateOriginal` (the catalogue's upload date) is never read for
  matching — only `filmingDate`, then `publicationDate`, then years the text
  mentions.
- **B-roll first, as a score and as a tie-break.** A speech, press
  conference or interview under narration scores 0.15 visual and takes the
  −15 poor-visual penalty ("a talking head where the scene wants
  pictures"); it inverts when the scene quotes a speaker. Ties break
  pictures > unclassified video > still > talking head. **When testing this,
  give both fixtures the same descriptive text** — the first test compared a
  B-roll clip with no event in its title against a presser that named it,
  and "the presser won" was the weights working, not the ladder failing.
- **Library first, always; `url_import` and `user_upload` are never
  routed.** Both carry `searchCapabilities.localOnly`: the engine's library
  pass reads their rows with everyone else's, so routing them would search
  the same rows twice and report a "provider" that never left the box. The
  picker's provider filter still reaches them through
  `EngineOptions.providers`. Best library score ≥ 62 with ≥ 3 candidates
  short-circuits every external call; the cache (6 h) is the second
  short-circuit; a provider that fails three times in a row is held back
  five minutes, a 429 fifteen — in memory, per process.
- **The admin strip's "N used" was a counter nobody incremented, and it read
  as a verdict on the sources** (2026-09-13). `recordSelection` was written,
  exported from `lib/footage/index.ts` — and called from nowhere, which a
  grep for its name settles in one line. `attachStockToScene` marks the
  ASSET (`stock_media.status = 'used'`); nothing ever told
  `footage_provider_status.assets_selected`, so every provider on
  `/admin/footage` read **0 used** while the database held six attached
  assets and two live scenes. The producer looked at "733 results · 0 used"
  across fifteen sources and reasonably concluded the archives never deliver
  anything — and asked for MORE providers, which is the wrong end entirely.
  Fixed by calling it once in `attachArchiveAsset`, right after the attach
  transaction: that is the single door both "Use" buttons go through (the
  picker via `actions.ts`, the suggestions bar and n8n via
  `/api/archive/use`), verified by grepping every caller of
  `attachStockToScene` before placing it. **Relevance is passed as `null`
  on purpose** — the ranker's score is not carried that far, and reaching
  for some other number in scope (the provenance confidence) would poison an
  average that means something else; `recordSelection` already counts null
  into neither sum nor n. **The general shape, and it is the third time this
  file records it: a number on a dashboard is read as a fact about the
  world, so a statistic that cannot go up is worse than one that is
  missing.** Grep a new counter's call sites the day after shipping it, the
  same way an `onError: continueRegularOutput` write needs its error path
  checked.
- **URL import is not a downloader.** Platform hosts (YouTube, Vimeo,
  TikTok, Facebook, Instagram, X, …) yield title and metadata only, no media
  URL, rights manual review by the platform's terms; `.m3u8`/`.mpd` are
  never media files; 401/403 pages are refused, never fetched around; no
  in-box hosts, no credentials in URLs, no `file:`. A page that states no
  licence is `manual_review`, not `unknown` — the page WAS read. Licence
  URLs (`creativecommons.org/licenses/by-nc-sa/…`) are expanded to codes in
  `classifyLicense()` before the NC/ND tests, or a CC link on a page reads
  as unknown.
- **The site tolerates db/010 not being applied** (`footageReady()` in
  postgres.ts, the same `to_regclass`/column probe as db/007 and db/009):
  `saveStockCandidates` writes the 15 enrichment columns only when the
  column exists. Same reason as before — a push deploys itself, a migration
  runs by hand, and the gap must not take down every project page.
- **Every provider key is a WARNING in the deploy gate, like ElevenLabs**:
  `DVIDS_API_KEY`, `EUROPEANA_API_KEY` (the demo key answers meanwhile),
  `FLICKR_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`,
  `UNSPLASH_ACCESS_KEY`, `OPENVERSE_CLIENT_ID` + `OPENVERSE_CLIENT_SECRET`,
  plus the two switches `FOOTAGE_ENABLE_LOC` and `EU_AV_API_BASE` (repo
  Variables, not Secrets). Without a key the provider reads as off with its
  reason, on the admin page and in the picker, and the router skips it; the
  film is unaffected (Openverse excepted — without its client it runs
  anonymously at the low quota, see the bullet above). All of them are in the heredoc that writes
  `platform.env` — the rule from the ElevenLabs entry, obeyed in the same
  commit. **`enabled` must be a GETTER over the env var**, read at call
  time, or a key added later needs a container rebuild to count. **The four
  adapters written without a key (Flickr, Pexels, Pixabay, Unsplash) are
  pinned on the documentation's shapes, not on a measured response** —
  watch each one's first real run on the health strip.
- **The n8n half is one prompt edit** (`Archive Suggestions`, active
  `a3278855` since 2026-09-10, `6b5a1417` the day before; repo copies in
  `db/port/footage-engine/`): `Build Query Prompt` names the SOURCES (never
  the keys — which are reachable is the registry's business), asks for a
  structured request per scene with a `stockshots` type for event-less
  B-roll, and forbids invention in as many words; `Parse Queries` sanitises
  it; `Build Rank Prompts` shows the ranking model the engine's score,
  provenance and rights class. `/api/archive/suggest` accepts BOTH the old
  `queries[]` and the new `request{}` shape, so prompt and site can move
  independently. No `universal-footage-search` workflow was created:
  `/api/footage/search` is that search, callable from any HTTP node with
  the ingest key.
- **Tests run the real engine with the edges mocked.**
  `scripts/footage-loader.mjs` is a `module.register` hook that resolves
  the site's `@/` alias and extensionless imports (`./types` → `types.ts`,
  `@/lib/footage` → `index.ts`) and swaps `lib/data/stock` and
  `lib/data/postgres` for in-memory doubles; `check-footage.mjs` stubs
  `globalThis.fetch` per hostname. `npm run check:footage`, 214 checks.
  Anything under `lib/footage/` that grows a new import path needs the
  loader to resolve it — Node knows neither the alias nor the missing
  extension. **A routing fixture must name no subject by accident**: "a
  quiet border town" was meant as the generic case and matched two
  categories, and the "stock is routed" test failed for the right reason.


### Settings is a hub, and the site has a night (2026-09-15)

The producer asked for two things in one breath: Settings should be "a few
buttons like Account / Billing / Customize" with nothing in them yet, and
Customize should hold a Dark Mode switch that turns "the whole site" dark.
Asked before building, they chose: **remove** the three tables that were the
old Settings page (genre profiles, script library, script examples — against
my advice, so recorded as their call), the buttons Account / Billing /
Notifications / Customize, and a three-way Light / Dark / Follow device.
**Two corrections came back within the hour and are the current state:**
the default is **Light**, not the device (no cookie means Daylight whatever
the phone says; "Follow device" only when chosen), and the night is an
**inversion** — "where there is black in Light mode, there should be white
in Dark mode", the step cards being the example — not a dimming.

**The three tables have no screen any more.** `hov.genre_profile`,
`hov.script_library` and `hov.script_example` are still read by Claude
Scripting exactly as before; they are edited in Postgres now. `AdminRow`,
`AddGenre` and `app/admin/actions.ts` are in git history (last at `b5150fe`)
if they are ever wanted back; the data layer's `save*`/`create*` functions
were left in place, so restoring is the three files plus the CSS block.

**The theme layer is `light-dark()`, and that choice is the whole design.**
Every colour token in `globals.css` carries both values in one call —
`--bg: light-dark(#ececed, #121216)` — and which half applies is decided by
`color-scheme` on `:root`: `light dark` follows the device, and
`data-theme="light"|"dark"` on `<html>` forces one. So there is exactly ONE
owner per token and no second block to keep in lockstep, which is the trap
this file already pays for in three other places. The cost is a browser
floor of spring 2024 (Chrome 123 / Safari 17.5 / Firefox 120), the same
vintage as the `:has()` and `color-mix()` the file was already leaning on.
`light-dark()` is a `<color>`, so it also works inside a gradient stop or a
shadow colour; a whole gradient or shadow LIST cannot be one, which is why
`--card-fill`, `--shell` and the five shadow tokens spell their stops out.

**The choice travels as a cookie, and the server stamps it.** `hov-theme`
(`light` / `dark` / `system`, a year, Lax) is read in `app/layout.tsx`, which
puts `data-theme` on `<html>` — so a dark page arrives dark on its first
paint, with no script and no white flash. A `localStorage` flag can only be
read after the first paint, which IS the flash. Reading the cookie in the
root layout makes every route dynamic; every page already was. `lib/theme.ts`
is the single owner of the cookie name, the three values, the parse, and
`applyTheme()` (attribute + cookie, `Secure` only over https — a Secure
cookie set over plain http is dropped silently, which would make the toggle
work everywhere except `next dev`). `generateViewport` sets
`<meta theme-color>` from the same cookie so the phone's tab strip follows.
"system" is stored explicitly rather than by deleting the cookie, and the
ATTRIBUTE is always stamped: no cookie and "light" both mean
`color-scheme: light`, "dark" forces the night, only "system" writes
`light dark`. The first cut had the missing attribute mean "device" — the
producer wanted a colleague's first visit to be the one look everybody
knows, so it means Light.

**What "inverting" actually took, so it is not re-derived.** The Daylight
header comment said it in 2026-08: an inversion is not a value swap. The
literal count was the measure — 291 colour literals in `globals.css` and ~100
across the module sheets — and the pass over them was one auditable script
(`theme-pass.py` in that session's scratchpad; its rules are what matters):

- **Ink-alpha is the tint, and the tint flips.** Every hairline and faint
  fill was `rgba(24, 20, 40, α)` — ink on light. They now mix from `--tint`
  (`light-dark(#181428, #fff)`): `color-mix(in srgb, var(--tint) N%,
  transparent)` at the odd alphas, so the value stays visible at the site,
  while the three named steps `--line` / `--line2` / `--line-soft` are
  explicit pairs with a slightly stronger night alpha (11 / 17 / 7%),
  because a card's edge is most of what says "card" on a dark ground.
- **Every shadow is a `light-dark()` pair, and the night alpha is 4–5× the
  day's — this was the third cut, and the producer's report is why.** The
  first cut kept the day alphas at the ~40 per-site two-layer stacks on the
  theory that a dark card is lifted by being lighter than the ground; the
  report was exact — *"little to no contrast, the bubble effect disappears,
  everything looks flat"*. Measured on the settings cards in composited
  pixels, which is the only honest way: by day the card is 1.05× its ground
  and the SHADOW makes the bubble, dipping 13% right under the card. On the
  first night ground (`#121216`) the same shadow dipped 3%, because a black
  shadow on a near-black ground has nowhere to go — and that is the whole
  lesson: **on a dark ground, elevation cannot come from shadows unless the
  ground leaves room under it.** So the ground is `#1a1a1f` (dark, with
  room), the cards climb to `#26262d` / `#2e2e36` (1.17× and 1.30× the
  ground — in perceptual L* the card step is five times the day's), every
  shadow alpha is written out per theme (`0 18px 44px light-dark(rgba(24,
  20, 40, .16), rgba(0, 0, 0, .72))`), and the four card shadow tokens carry
  a one-pixel bright top edge at night (`--edge`, transparent by day) —
  the other half of what makes a dark surface read as catching light.
  `--shadow-ink` is gone; it only ever expressed the wrong idea.
- **Some tokens have a ROLE, and the role decides the night value.**
  `--accent-deep` is the deep end of every panel gradient, so it keeps its
  value — and every `color: var(--accent-deep)` (chip text, 14 sites) moved
  to a new `--accent-ink`, which is the deep step by day and a pale one at
  night. Same for the pale near-opaque status chips on the project cards:
  `--chip-*` flips pale→deep while `--green-ink` / `--red-ink` / `--amber`
  flip the other way. **And the near-black panels INVERT** — the "where you
  are" step card, the floor panel, the brief's estimate rail, the toasts,
  the near-black pills: white on the dark ground at night, lit from the same
  corner by a pale lilac (`--panel-glow`) where the day panel has its deep
  purple. The first cut stepped them UP to a lifted dark instead, on the
  reasoning that a dark panel on a dark ground reads as a hole; the producer
  looked at it and asked for the inversion, and it is better — the black
  card marking "where you are" was invisible as a lifted grey. What made the
  flip cheap is that everything written on a panel reads a `--panel-*` token
  (`-ink`, `-text`, `-body`, `-dim`, `-faint`, `-line`, `-line2`, `-fill`,
  `-fill2`, `-ok`, `-err`, the glow rings), and **`--panel-accent` is the
  accent as it reads ON A PANEL** — the lift on black, the deep on white.
  `--accent-lift` itself now appears only in the page arcs. The one
  literal that had survived on the brief's white submit pill went back to
  tokens for the same reason: at night that pill is near-black on white.
- **A literal survives only where the surface is the same in both themes:**
  video overlays, the near-black panels' internals, the white pill on the
  brief's dark panel (`.nb-est .go` — its `--near-black` text became the
  literal `#17171a` for the same reason), the two white tiles on the
  landing's purple caps. Everything on the ground, a card or a chip reads a
  token. The favicon tile (`ProductionTicker`) stays dark on purpose and was
  never a page colour.
- **The accent lifts one step at night** (`#7a4fd6` → `#9a7ce4`), measured:
  the day accent is 3.5:1 on the dark ground, under the 4.5 the mono labels
  it colours need; the lift reads 5.3 on the ground and 4.1 on a card. The
  dark ink ramp was measured the same way (`--dim` 6.4 on the ground, 5.0
  on a card, `--faint` 5.0 on the card it is reserved for). `--muted` now exists
  as an alias of `--dim` because five module sheets were written against a
  `--muted` that had never been defined and were falling through to a grey
  fallback — unreadable on dark, and a silent bug by day.
- **The segmented control's thumb needed its own token.** `--card2` is one
  step above the track at night and the thumb read as flat on the theme
  picker; `--raised` (`light-dark(#fdfdfe, #34343e)`) is that step. Found on
  a screenshot, like the phone-width wrap of "Follow device" (equal thirds
  folded it; the segments are sized by their labels under 720px now).

**Verified in a real browser, not by reading CSS**: every screen (landing,
projects, a project at every stage, the brief, footage, login, the four
settings pages) at 1200 and 390 in light, dark and device-dark-with-no-cookie,
and the picker clicked through — set, reload, another page, Follow device,
then the device flipped under it — with the attribute, the cookie, the
`color-scheme` and the `theme-color` meta read back at each step.

**Rule from here: a colour literal in `globals.css` or a module sheet needs a
sentence saying which both-theme surface it sits on.** Anything else is a
token, and a token is one `light-dark()` — never a second block.

### Series — the same cast, film after film (2026-09-16)

A series is a film's Story Bible and its consistency references hoisted above
the project and copied back down on each episode (`db/port/series/README.md`
has the whole mechanism). What the site learned building it:

- **Nothing in n8n knows what a series is, on purpose.** The bible rides to
  Claude Scripting as Lore — the canon input `Generate Story Bible` already
  treats as ground truth — and the reference sheets ride as the five Editing
  Options keys `Cast Sheet Prep` / `Set Plate Prep` already skip. One
  orchestrator node (`Normalize Webhook Input`) stores them from the payload.
- **A key the site writes after creation is not safe on a film with a
  reference photo**: `Merge Ref Into Options` rebuilds the whole blob from
  Normalize's value. `createdBy` learned this first; series refs are stored
  by Normalize for the same reason, and the site's post-create merge is only
  a backstop.
- **A face needs bytes.** `castSheets[name].url` is a signed Flow link that
  dies within hours, so the series page can only show a portrait we copied
  while it was alive — `hov.sheet_media`, via `/api/media/ingest` with
  `field: "sheet"`. Until Media Generation posts each new sheet there, a show
  shows initials and says why.
- **`/new` is a server page with a client form now** (`page.tsx` reads
  `?series=` and passes a plain `SeriesPrefill`; the old page is
  `NewVideoForm.tsx`, unchanged in what it posts). Every posted field name is
  the same; `series_id` is the one addition, and it is read only by
  `createProject`.
- **The series is a COPY, frozen.** Starting it from a film copies the bible,
  the refs and the settings; a later change to that film changes nothing in
  the show. Editing a character's description on the series page rewrites
  the copy, which is what the next episode reads.
- **The copy keeps itself in step, since the same evening.** The producer's
  one condition for the whole feature was "nothing manual after an episode",
  and the three things that would have been manual all hang off ONE moment:
  script approval (`approveScript` → `onEpisodeScriptApproved`), which is
  after the Story Bible exists and before Media Generation reads the
  references. (1) Names: Lore says `USE EXACTLY THESE NAMES` and the writer
  still sometimes writes "Pip the Fox" for "Pip"; the sheets are keyed by
  name, so the episode's refs are re-keyed to the bible's spelling where the
  match is unambiguous (`reconcileRefsToBible`: exact, unique whole-word
  containment, unique given name of 3+ letters — `check:series` pins the
  rules). (2) New characters / places / objects go back to the show
  (`mergeBibles`; a respelling is not new), and both the series page and the
  next episode read the union of every episode's sheets
  (`getSeriesRefsUnion`, earlier wins). (3) The recap is written by n8n
  (`series-recap`, `db/port/series-recap/`), one replace-or-append line per
  episode; the site only fires the webhook and never waits. What the site
  learned: **fit a growing text into a capped prompt from the NEWEST end**
  — `composeSeriesLore` used to cut the Lore at 8000 from the end, which is
  exactly where the recap sits, so a long-running show would have lost its
  latest episodes first. It now drops the oldest lines instead.

### A section nobody can reach does not exist (2026-09-21)

The producer's report was *"Series is very hard to find"*, and the reason was
not design, layout or wording: **on a laptop there was no link to it at all.**

`/series` had been built, linked from a film that already belonged to a show,
and added to `NavMenu` — the phone's fold-away menu. The bar in
`app/layout.tsx` was a separate thing entirely, three `<Link className="navlink">`
written out by hand: Projects, Footage, Settings. So the two lists disagreed
about how many sections the site has, and the one that was missing from the
list nobody thought of as a list was the newest section. It cost nothing to
find once looked at, and it had been invisible for five days.

**Two copies of a navigation is one copy too many.** `lib/nav.ts` now owns the
sections, `NavLinks` draws them in the bar, `NavMenu` folds the same array
away under 720px, and `npm run check:deeplink` asserts the layout contains
`<NavLinks />` and no hand-written `navlink` — the third destination owner
beside `deep-link.ts` (gate → step) and `library-filters.ts` (`?filter=`).

**The same edit fixed a bar that lied about where you were.** `Projects` wore
`className="navlink on"` as a LITERAL, so it was the current section on every
page of the site, Settings and Footage included. A static "you are here" is
worse than none: it is confidently wrong, it survives every visual review
because it looks exactly like a working highlight, and knowing where you are
requires the path, which is only knowable in the browser — which is why
`NavLinks` is the one client component in the layout.

**And the link had to lead somewhere that answers.** `/series` throws by
design without Postgres (`needPg` — the Airtable adapter predates series), so
the moment the bar linked it from every page, a demo or preview deployment
answered a click with a 500. `seriesAvailable` lets the index say that in a
sentence instead; everything deeper keeps the guard, because nothing reaches
it without passing the index. **Before you link a page from the chrome, open
it in every state the deployment can be in.**

### The failure list: a stop by hand is not a failure (2026-09-16)

The producer sent a screenshot of the health panel with three red "failed"
rows and asked for them to be fixed. None was a failure. Two were
`Master Orchestrator · Execute Media Generation (Resume/Batch) · The
execution was cancelled manually` — the trace of their own Pause → Resume:
`pauseProduction` stops the children first, and the orchestrator that was
waiting in Execute Workflow then ends with status `error` and n8n's
"cancelled manually" text. The third was `18x6ub9yUvj7H7fy · Probe Series ·
relation "webhook_entity" does not exist` — a session's throwaway probe,
already archived, listed by raw id because the panel only knew the four
production workflows by name.

- **`isManualStop()` (`lib/n8n.ts`) splits the list.** A row whose message
  matches "cancelled manually" is shown with a grey `stopped` chip and the
  sentence "Stopped by hand … Not a failure: Resume picks the film up where
  it left off", is NOT counted in the summary, and does not turn the card
  red. The summary reads "No failures in the last 24h · 2 stopped by hand"
  with the idle grey dot. Still listed, because a stop the producer did not
  press is worth a look; just not an alert.
- **Throwaways are hidden, unknowns are not.** `getWorkflowMeta()` resolves
  an id the static map does not know through `GET /workflows/{id}` (cached
  ten minutes) and drops the row when the workflow is archived or named
  `zz …` — the convention every probe follows (create → run once →
  archive). A lookup that fails answers null and the row stays, by id: an
  unknown workflow is never hidden. The static map now also names the seven
  single-purpose workflows (Expand Brief, Hook Regen, Archive Suggestions,
  Music Library, YT Scene Titles, Upscale Film, Series Recap), because a
  failure there is real and deserves a name.
- **What the panel cannot do**: delete an execution. The n8n MCP connector
  has no delete, and the site's API key is not reachable from a web session,
  so a probe's failed run stays in n8n's own list until it ages out of the
  24-hour window. Naming probes `zz …` is what keeps them off the site.
### What was stopping production: the site's own restart button (2026-09-17)

Three multi-account test runs died within minutes of starting, and the producer
said it was not them. It was the site — `⟳ Restart this pass` in
`ProductionActivity`.

**How the cause was established, since executions carry no actor.** Only three
code paths ever stop a Media Generation execution, and all three are behind a
click: `pauseProduction` (Pause), `deleteProjects` (Delete), `restartProduction`
(this button). There is no cron, no API route and no effect that fires any of
them — `restart` is bound to `onClick` and nothing else.

n8n's own record then says WHICH button, from the timing alone. The cancelled
runs come in pairs where the next execution starts **1.7-5.3 s** after the
previous one is stopped: `14215`→`14246` (1.8 s), `13033`→`13215` (5.3 s),
`14371`→`14374` (1.7 s). That gap is machine-tight and is exactly
`restartProduction`'s shape — pause, poll up to 6×1 s for the alive list to
clear, fire `resume-project`. A human pressing Pause and then Resume cannot
produce 1.7 s. And `14199` and `13978` were stopped in the **same 130 ms**
(10:55:49.405 / .535) although `13978` had been running since the previous
afternoon on a different project, which is the `pauseProduction` loop over the
whole `running` list.

**Why it kept happening with nobody meaning to.** `FROZEN_MIN` was 12 minutes.
A real media pass runs for the best part of an hour — `lib/n8n.ts` says so in
`STALL_AGE_MS`, which is **45**. So the panel offered the restart on every
healthy pass, over copy asserting *"If nothing new has appeared in that time, it
is wedged"*. Two constants making the same judgment disagreed by 4×, and the
lower one was the one the producer read. `FROZEN_MIN` is now 45 and carries a
comment naming its twin; **they must move together.**

Two things the copy did not say and now does: the restart stops **every**
execution n8n has running, another project's included, because the public API
cannot map an execution to a project; and while saved assets are kept, anything
mid-generation at Google is abandoned and made again — which on a long pass is
most of the work the click was meant to rescue.

**The dead guard, worth knowing before trusting it.** `nudgeProduction`,
`resumeProject` and `restartScripting` each sweep `getStalledProduction()` and
stop what it returns. That loop can never run: all three return early when
`getAliveProduction()` is non-empty, and a stalled execution is by definition
`running`, so it is always in the alive list first. The automatic stall-killer
reads as a live safety net and is unreachable code. That is the safe direction
to fail — but do not count it as protection that exists.

### Deep Search — a warning with no button

`DeepSearchPanel` sits above `ScriptReview`, reads `hov.fact_check` through
`getDeepSearch`, and has no controls at all. That is deliberate and it was the
producer's call: *warn loudly, never block*. The script gate works exactly as
it did; this panel only tells the producer what the checker made of the text
they are about to approve. Full account of the n8n side:
`db/port/fact-check/README.md`, and `docs/lessons-pipeline.md` under "The
script is checked against its own research".

**Null draws nothing, and that is the important case.** Every film written
before 2026-09-18 has no row, and so does every project on the frozen Airtable
backend. "We never checked this" must not render as "this passed" — so a null
report produces no panel, and a report that ran and found nothing produces one
green line. Those are different pieces of news and the component keeps them
apart, along with two more: `skipped` (fiction, or no research pack — said in
its own words so it cannot read as a pass) and `overwhelmed` (too much
unsupported for a correction to be safe, so nothing was changed).

**The one that has to be said out loud is `corrected`.** The rewrite happens
before segmentation, so by the time the producer sees the script gate the text
in the box is not the text that was written. Nothing else on the page would
ever tell them. The panel says it in bold, and each finding shows the sentence
**as it stood**, since the new wording is already in the textarea below — the
old one is the only way to see what moved.

**The reader is deliberately permissive.** `DeepSearchReport` has no required
fields and `getDeepSearch` passes the stored jsonb through without validating
it. A report written by last month's version of the workflow has to render in
today's panel: a reader that insists on a shape is how an old row becomes a
crash on the page the producer needs. The query is also guarded by
`tableReady`, like the stock tables — before `db/012` is applied an unguarded
read would abort the transaction and take the whole project page with it.

### A button that changes the page under you has to reload it — 2026-09-19

The one control that panel now has is "⟳ Re-check this script", and the day it
learned to CORRECT what it finds it acquired a failure mode the report-only
version could not have. Three separate mechanisms conspire:

1. The webhook answers `onReceived`, so the click returns in milliseconds and
   the answer lands about a minute later. Nothing changes on screen.
2. `AutoRefresh` does a `router.refresh()` every 10 s, so the REPORT updates by
   itself — including the line *"the script below already contains the
   corrections"*.
3. `ScriptReview` seeds its textarea from `content` **once, on mount**, and
   restores any `sessionStorage` draft over it on every remount.

Put together: the panel announces a correction the box does not contain, and
keeps announcing it for as long as the producer stays on the page. That is this
project's oldest fault — *the artifact on screen outliving the fix* — in the one
place where the artifact is the thing being judged.

So `DeepSearchRerun` does not fire and forget. It captures the report's
`checkedAt`, polls `router.refresh()` every 4 s, and when the stamp moves it
either says *"nothing needed changing"* or, if `rewritten > 0`, **drops the
stale draft key and does a full `window.location.reload()`**. A soft refresh
cannot fix this, because React will not reset an uncontrolled textarea and the
draft would be restored on top anyway. It gives up after three minutes with a
message that says where to look, because a spinner that spins forever is a
worse lie than an error.

Two smaller pieces of the same thought. **The button arms when there is
something to lose** — an unsaved draft means the re-check is about to read
text the producer is not looking at and then reload over their typing, so it
asks first, the same shape as Pause's *"sure?"*. And **the poll does NOT pause
on a hidden tab**, unlike `AutoRefresh`: pressing this and switching away is
the normal case, and the whole point is that the answer is there on return.

### The all-clear is a sentence, not an absence

The producer's words were *"daca dupa check nu apare nimic flagged atunci ar
trebui sa apara un mesaj cu 'Everything seems fine and checked'"*, and the
reason they had to ask is instructive: the panel already SAID so, in a chip
reading "All checked" and a count of statements. A count is not a verdict. A
producer who presses a button to find out whether anything is wrong should not
have to infer "nothing is wrong" from the absence of red — they should read it.
So `clean` and `corrected` now print one green line above the findings, and it
names the hook when the report's `scope` is `final`, because "including the
hook" is the specific reassurance this button exists to give.

The same applies to the state that says nothing was fixed. A re-run on a film
past its script gate checks in full and refuses to edit — `frozen` — and
without a sentence explaining that, "3 unsupported" on an approved film reads
as a correction that is still coming. It is not; the scenes hold the text by
then. The detail line says so and points at the scenes.

### A red light is only worth having if it is right in both directions

The producer's whole brief for it was one sentence: *"In the case anything
stops working I want the thing to become Red so I can tell you to solve it."*
Three things fell out of taking that literally.

**One owner, because the same verdict is drawn in three places** — the panel
above the script gate, the Settings card, and the dot on the Settings hub.
`lib/deep-search.ts` computes it and nothing else is allowed to; a light that
is green on the hub and red on the film teaches the producer to ignore all
three. `npm run check:deepsearch` pins every branch.

**`red` means exactly one thing: this film asked for Deep Search and did not
get it.** It is NOT set for a film that was never a candidate, and — the one
that takes discipline — it is NOT set for a film that was checked and came back
with problems. Unsupported statements are the feature working. A refused
rewrite is the safety valve working. Colouring those red would make the alarm
meaningless inside a week, and then the real one lands on a page nobody reads.

**The detector is sound because of an ordering, not a guess.** `FC Save Report`
runs before `Combine Chapters`, which runs before the script row is written.
So by the time a script exists, a documentary's report exists too — and "a
documentary with a script and no report" is a fault rather than a race. That is
the whole of the red state, and it is why the panel takes `scriptExists`
instead of trying to infer it.

**A skip code the site has never heard of fails CLOSED.** An unknown reason is
red, not green — otherwise a future version of the workflow could switch the
alarm off by inventing a reason nobody taught the site about.

One deliberate piece of restraint: the `off` state is a one-line note, never a
card. Every film now gets a report row — a Story film's simply says
"not-documentary" — so a card would put a grey Deep Search panel above the
script of every film that was never going to be checked. The producer asked to
see whether it is active; one line answers that, and a card would be in the way.

**And the alarm must not fire on history.** Every documentary written before
Deep Search existed has no report, which by the rule above is exactly the shape
of a fault — so the very first thing the producer would have seen was a false
one, on their own Google Maps film, whose script was written an hour before the
chain went live. `DEEP_SEARCH_LIVE_AT` is a hardcoded instant for that reason.
Inferring the cutoff from the oldest row in the table would have been tidier
and wrong: it moves every time an old project is deleted, and would eventually
start explaining real faults away as ancient history. An UNKNOWN creation date
is not an excuse either — a backend that stopped returning the date would
otherwise switch the alarm off everywhere at once.

**The same sentence, three times over, reads as a bug** (2026-09-19). Since
the judge started ruling on one ASSERTION at a time rather than one sentence —
see `docs/lessons-pipeline.md`, "A sentence is only as sound as its weakest
clause" — several findings arrive carrying the SAME `quote`, because that is
what a compound sentence with three separate problems in it honestly looks
like. Listed flat, the panel printed the identical line three times and a
producer would reasonably conclude it was repeating itself. `groupBySentence`
renders one entry per sentence with its assertions nested under it, each with
its own chip and its own reason, and `claim` — which had been in the type and
never on screen — is what distinguishes them.

The header had to change with it, for a reason that is the same class of
mistake as the link to the page you are already on: **`checked` counts
statements and the script has sentences, and after the prompt change those are
no longer the same number.** "26 statements were checked" above a script with
thirteen flagged sentences in it is arithmetic the producer cannot make add
up, so the panel says both — "26 statements across 13 sentences" — and says
the second one only when it differs. `report.sentences` carries it, and the
panel counts distinct quotes itself when the field is missing, because every
report written before that day has no such field and an old film's panel still
has to add up.

### The tone is part of what kind of film it is (2026-09-19)

The brief asked two questions that were really one. Section 01 asks **what kind
of film** — Story, Documentary, Cinematic, Kids story — and section 02 asks
**how it should feel**, a row of twelve tone chips that every film landed on
`Dark` with, whatever had just been chosen above it. A documentary written in
the Dark profile is not a small mismatch: the tone names a row in
`hov.genre_profile`, and that row is the structure, the voice and the words per
minute Claude Scripting writes the entire script with. So the default was
quietly making a Documentary sound like a thriller unless the producer noticed
the second row and corrected it.

Each category now owns its tone — `defaultTone` on the entry in
`lib/categories.ts`: Story is **Epic**, Documentary is **Documentary**,
Cinematic is **Cinematic**, Kids story is **Childish**. It is the same contract
`narratorVoice` already had: the chip lights up the moment the category is
chosen, so it is a visible selection the producer can disagree with, never a
hidden default applied at submit.

Three things are worth carrying past this feature.

**A required field is how a map stays total.** `defaultTone` is not optional
and it is typed as `Tone` (from the new `lib/tones.ts`, which is now the one
owner of the twelve names). A category added without one does not compile, and
a misspelled tone does not compile either — which matters more than it sounds,
because the failure it prevents is silent: Scripting matches the profile on
`lower(tone)` and falls back to its built-in DOCUMENTARY profile when nothing
matches, with no error, no log line and nothing on screen. The same reason
`lib/tones.ts` carries the date its twelve rows were last measured against the
database, and `check:tones` pins the list against that measurement.

**"Is it still the default?" is not a test for "did anybody touch this".** The
kids-only version of this effect asked exactly that — `tone === DEFAULT_TONE`
— and it worked only because one category had a default and it differed from
everyone else's. The moment all four have one, that test cannot tell a producer
who deliberately clicked *Epic* on a Story film from one who never looked at
the row, and would overwrite the first one's choice on the next category click.
It takes an explicit `toneTouched` flag, set by the chips and never cleared.
The general form: **a proxy for "untouched" that reads the value works only
while the value is unique to being untouched** — the day a real choice can
equal the default, the proxy starts lying, and it lies by throwing away
somebody's work.

**Two states need saying which one you are in.** The row now carries a hint
that reads either *"following Story — change it and it stays where you put
it"* or *"your pick — it stays put if you change what kind of film this is"*.
Without it the two states are pixel-identical, and a producer cannot tell
whether changing the category is about to move their tone. That is the same
rule as the in-flight flags in `CLAUDE.md`, one step earlier: a state with no
exit is a dead end, and a state you cannot see you are in is a surprise.

Verified in real Chromium against `next dev`, not by reading the code: all four
categories move the row, a hand-picked `Horror` survives three category
changes, a reload starts following the category again, and Kids story still
selects George and the Storyteller read beside its Childish tone (19/19). The
server keeps the same backstop for a form that never rendered the row —
`createProject` resolves an empty `tone` through `getCategory(...).defaultTone`
rather than the old literal `"Dark"`, with `||` and not `??`, because `""`
matches no profile either.


### An episode has to look like an episode (2026-09-21)

The series feature shipped working and still failed its producer: opening
`/new?series=<id>` gave them a page headed "New project · Start a video"
with a thin strip above it saying which show it belonged to, an empty title
field, and every setting back at its factory default. *"Simt ca e foarte
vag… vreau sa se simta ca face parte dintr-o serie, nu de parca ar fi un
proces de a face un video complet nou."* Three things were wrong, and they
are worth separating because only one of them is visual.

- **The page said what it was, in the wrong place.** A banner above the
  header does not change what a page IS; the header does. On an episode the
  `h1` is now the show's name, the pill is `Episode N`, and under the
  sentence sits the cast, the places and the LAST line of the recap — the
  two facts that make this an episode rather than a film with a borrowed
  look. The way back to the show is a link inside that sentence, not a
  button beside it: on this page the series is the context, not an action
  the producer came here to take.
- **A series is a FORMAT, and only a third of it was being carried.**
  `SeriesSettings` held the category, the voice and the video tier; the
  length, the look, the seven overlay switches, the two levels, the caption
  colour, hands-off, the cast and the multi-voice mode were all re-asked
  every episode. Now the whole brief is frozen when the show is created
  (`seriesSettingsFromProject`) and applied when it opens. Two details that
  make it safe: every new field is NULLABLE and every reader falls back to
  the form's own default, so a series stored before this opens exactly as
  it did; and the overlays are stored under the FORM's field names
  (`SERIES_FINISHES` maps them once, at freeze time), so `NewVideoForm`
  reads `series.finishes[f.name]` with no translation of its own.
  `check:series` pins both.
  The one thing the show deliberately does NOT do is learn: a setting
  changed on one episode's brief changes that episode only. Otherwise
  shortening a single episode would quietly shorten the show.
  **A freeze is a COPY, and shipping the wider copy does not widen the
  copies already taken** — which is the half that would have made this look
  broken. The producer's own show was frozen on 09-16 with seven keys; the
  day the whole brief started being carried, their episode 2 still opened at
  60 seconds with chapter cards on, because their ROW said nothing about
  either. `backfillSeriesSettings` closes that where it is felt rather than
  in a migration: the brief re-derives the missing half from the film the
  show was started from, writes it back once, and never touches a key the
  show already has. Measured on that show before shipping — 90 s not 60,
  chapter cards off not on, drawn cards off not on, hands-off on not off.
  **When a feature copies state at a moment, ask what the rows written
  before it will do** — they will not error, they will quietly behave like
  the old version.
- **The stock title suggestions were noise on an episode.** "A documentary
  about the last lighthouse keepers" is not episode 4 of anybody's series.
  They are replaced by one button that asks the show what should happen
  next (`series-next`, `db/port/series-next/`), which fills the title and —
  only when the box is empty — the direction. A producer who already wrote
  their own direction must not lose it to a suggestion they asked for about
  the title.

**The effect that follows the category had to be taught about episodes.**
Kids story selects the Storyteller VOICE when the producer has not touched
it — and a show that deliberately reads in the plain voice stores exactly
the same `null` as a producer who has not touched anything, so on an
episode the effect cannot tell them apart and must not guess. It returns
early while the category still equals the series', and wakes only if the
producer moves this episode to a different one. The writing tone needs no
guard: the tone row's own `toneTouched` flag (added the same week, for the
unrelated reason that every category now has a default tone) starts TRUE on
an episode whose show has one.
