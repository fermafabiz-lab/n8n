# Deep Search — does the script say anything our sources do not?

Built 2026-09-18, live the same day. **Named "Deep Search" by the producer**
that afternoon; the n8n nodes keep their `FC *` prefix and the table is still
`hov.fact_check`, because renaming thirteen live nodes would mean rewriting
every `$('FC …')` reference between them and renaming a live table buys
nothing. Read `FC` as Deep Search everywhere below. The producer's ask: *"a system to check
whether the information from the scripting part is accurate and rewrite it if
not, so it has no factual errors"* — after ChatGPT read a Google Maps script
this pipeline had written and listed four things in it that were not true.

Three decisions were theirs, taken before any of this was written:

| Question | Their answer |
|---|---|
| Report first, or fix straight away? | **Flag and rewrite immediately** |
| Look things up for claims the pack does not cover? | **Yes — one targeted search, then decide** |
| May it hold up the script approval? | **Warn loudly, never block** |
| Which films get it? | **Documentary mode only** (added the same day) |

The third is the load-bearing one. Nothing in this chain has a button, a gate
or a veto. It corrects what it can, says what it could not, and the producer
approves the script exactly as before.

## Why this is tractable at all

Because the retrieval half already existed. `Research Tema` → `Extract Claims`
gathers a numbered pack of sourced claims (E1…E20) with a real URL each, and
the narration is WRITTEN FROM that pack. So the question is not the open-ended
and hallucination-prone *"is this true?"* but the closed-book one: **does any
claim in this numbered list say this?** A model can answer that from the text
in front of it without knowing anything about the world — which is exactly
what the judge is told to do, in as many words.

The second step is the only one that leaves the pack, and it is deliberately
narrow: one search per unsupported statement, for a primary source, producing
a URL that code checks looks like a URL.

## The chain

Inserted between `If Narration Retry`[1] and `Combine Chapters` in **Claude
Scripting** (`gkEtGMecv4TC3ZHp`) — after the narration exists and passes the
length guard, and **before segmentation**, which is the whole point: at that
moment no scene and no voice take exists, so a rewrite costs nothing and
invalidates nothing. Ten minutes later it would desynchronise every take from
its line (see CLAUDE.md, "A line and its recording drift apart silently").

```
If Narration Retry[1] → FC Prep → FC Run?
   ├─[false] ──────────────────────────────→ FC Apply   (writes WHY it skipped)
   └─[true]  → FC Judge → FC Gap?
                  ├─[true]  → FC Source ─┐
                  └─[false] ─────────────┴→ FC Resolve → FC Fix?
                                                ├─[true]  → FC Rewrite ─┐
                                                └─[false] ──────────────┴→ FC Apply
                                                     FC Apply → FC Save Report
                                                              → FC Done
                                                              → Combine Chapters
```

| Node | What it does |
|---|---|
| `FC Prep` | **Documentary mode only**, then researched, with a pack, with chapters. Renders the pack and the narration for the judge; emits `Narration Guard`'s exact shape plus `fc`. |
| `FC Run?` | What `FC Prep` decided. Otherwise straight to `Combine Chapters`. |
| `FC Judge` | `mode` (factual or story) first; then every checkable statement with a verdict against the numbered claims ONLY. `Editor Model`, gpt-5.4. |
| `FC Gap?` | Any `unsupported` findings? |
| `FC Source` | One targeted primary-source lookup per gap, one `RESULT:` line each. `Research Model`, gpt-5.4 with web search. |
| `FC Resolve` | Folds found sources back onto the findings, settles each verdict, decides what the rewrite may touch. |
| `FC Fix?` | Anything left to fix? |
| `FC Rewrite` | Attribute → soften → correct → cut, on the listed sentences only. `Editor Model` + `FC Rewrite Parser`. |
| `FC Apply` | **The safety valve.** Accepts or refuses the rewrite; always emits a usable narration. |
| `FC Save Report` | Upserts `hov.fact_check`, in-line on the spine, base64 in and decoded in Postgres. |
| `FC Done` | Puts the narration back on `$json` after the Postgres node replaced it. |

Models are REUSED, not duplicated — `Editor Model` feeds the judge and the
rewrite, `Research Model` the search, the same way `Story Bible Model` was
already shared. `FC Judge`, `FC Source`, `FC Rewrite` and `FC Save Report` all
carry `onError: continueRegularOutput`: none of them may take a script down.

## The two that got through, and cost the producer a film

Both landed in the same publish at 15:18 and were found four hours later, by
the producer, on their own documentary — which reached its script gate with a
red light, no explanation, and a script whose hook said the acquisition was in
April while its first chapter said October.

### The category was read from a node that does not carry it

`Receive Project Data` is the sub-workflow TRIGGER, and it declares typed
inputs — `Project_ID`, `Tema`, `Tonalitate`, `Pace`, `Lenght`, `Language`,
`Style`, `Lore`. n8n emits ONLY those eight. There is no `fields` on it and
there never was, so `fields['Editing Options']` was `undefined` on every film,
`modeRead` was false, and every documentary skipped as `no-mode`.

`Fetch Project Record` is the node that carries the row, and `Voice Mode` has
read the category off it since the kids styles landed. **When a workflow
already answers a question somewhere, copy THAT node's reference.**

Three things disguised it, and they are the transferable part:

- **The execution data showed the object.** `get_execution` on the trigger
  returns its stack entry, which is the INPUT the parent sent — not the output
  the node emits.
- **A sibling reference worked.** `FC Save Report` reads `Project_ID` off the
  same node and always has, because that field IS declared. One field
  resolving is not evidence the object is there.
- **The failure was caught.** The read sat inside a `try` whose `catch`
  recorded "mode could not be read" — honest, and completely invisible,
  because of the second bug.

### A skip wrote nothing, so silence meant two different things

`FC Run?`[false] went straight to `Combine Chapters`, bypassing the report
writer. So `skipCode` — the entire field the red light reads — never reached
the database on the path that sets it, and an absent row meant both "this was
a Story film" and "the chain is dead". Those are precisely the two states the
producer asked to be able to tell apart.

The false branch now goes through `FC Apply`, which finds its payload from
`FC Resolve` or falls back to `FC Prep`. **Every film gets a row. From here
on, no row means the chain genuinely did not run.**

### And the reason neither was caught before shipping

The only end-to-end run that ever verified Deep Search — execution 14771 at
15:00 — ran on `ea076103`, the version BEFORE the Documentary gate was
published at 15:18. The gate's first real film was the producer's. **A change
published after the run that verified it is unverified**, and "I verified this
feature" is not the same claim as "I verified this version of it".

## The three things that were wrong, and how each was found

None of these were found by reading the code. All three came out of running it.

### 1. The search step was silently inert

`FC Resolve`'s `RESULT:` parser anchored each line with `$` and had no `\s*`
before the pipes. A perfectly well-formed line —

```
RESULT: 1 | STATUS: confirmed | SOURCE: Jumeirah | URL: https://… | DATE: 2026 | SAYS: …
```

— matched **nothing**, because after `URL:` the greedy `\S*` stopped at the
space and the very next thing the pattern demanded was `\|`. So every lookup
would have been paid for and thrown away, and the only symptom would have been
a fact-checker that never found a source for anything.

Found by `scripts/check-fact-check.mjs`, before the node had ever run. The
fixture in that file is now the REAL response out of execution 14761, curly
quotes and all.

### 2. The outer gate is the producer's, not the model's

The first cut deliberately did NOT gate on the project's category, on the
evidence that `story` is the site's default and of eleven researched films only
three said `documentary`. The producer overruled it the same afternoon —
**Deep Search is a feature of Documentary mode** — and that settles it: a film
made in any other mode does not get checked, whatever its narration says.

The consequence is worth writing down because it is not obvious from the
screen: the Burj Al Arab, Peking to Paris and Tupac films are documentaries in
substance and `story` in the database, so they would get nothing. Asking for
Deep Search now means **choosing Documentary when the film is created**.

`FC Prep` reads the category off `Receive Project Data`'s `Editing Options` —
the project record, not the webhook payload, so it survives the form, resume
and restart alike, and it is the same reference `FC Save Report` already
depends on for the project id, so it adds no new way for the chain to break.

### 3. A story is not a film with errors in it

Run the judge on `recqbPJ7aZu0a21mt`, "The Roman slave who conquered Egypt",
and it flags **55 of its 56 statements**. Every verdict is correct — nothing in
a fifteen-claim pack about Ptolemaic Egypt backs what Lazarus did on a Tuesday
— and the whole result is worthless. Worse: `FC Fix?` would have handed the
rewrite every sentence of the film.

`FC Prep` cannot catch this. Its gate is "researched, with a pack", and that
film is both: it is fiction that was researched for its background. **Nor can
the project's category** — `story` is the site's DEFAULT, so the Burj Al Arab,
Peking to Paris and Tupac films all carry it too, and they are documentaries.
Of eleven researched films in the database, only three say `documentary`.

The only signal that separates them is the narration itself. So the judge is
asked FIRST what it is reading and answers in `mode`; a `story` returns an
empty list and the chain becomes a pass-through. The same film now answers
`{"mode":"story","findings":[]}` in 2.2 s, where it spent 46 s producing 56
useless findings.

### 4. …and a backstop, for when it gets that wrong

`FC Resolve` also refuses to rewrite when more than 60% of at least 8 checkable
statements are unsupported. A documentary written from its own pack holds up in
most of its sentences; four bad ones in twenty is a real problem, most of the
film failing is a check aimed at the wrong thing. Past that line the chain
reports and stops offering to fix — the producer sees every finding, and
nothing is changed. Rewriting most of a film is the one outcome this chain must
never produce, because at that volume the rewrite is no longer correcting the
producer's script, it is replacing it.

## 5. A sentence got one verdict, and its good half hid its bad half

The producer read the first post-Deep-Search Google Maps script against
ChatGPT and came back with four things it had let through. All four turned
out to be the same fault, and it is the most instructive one in this folder
because **the check was working exactly as specified and the specification was
wrong**.

The judge returned ONE FINDING PER SENTENCE. A documentary sentence is almost
never one assertion:

> "In 2004, Google Local added maps, directions, and reviews to business
> listings. Search and mapping were already moving together, **while Where 2
> still sat outside the browser**."

Claim E18 backs the first half. Nothing in the pack says anything about where
Where 2 ran in 2004 — that is a separate assertion about one company's product
at one time. The judge, asked for a verdict on the sentence, found a source
for what it was mostly about and said `supported`. Same shape three more
times: *"reached … about 200 million places"* against a claim saying Maps held
"information, ratings and reviews FOR about 200 million places" (a different
verb), and *"Lars Eilstrup Rasmussen worked in Noel Gordon's Sydney spare
room"* against a claim that FOUR people founded the company there (a group
narrowed to an individual).

`FC Judge` now asks for **one finding per assertion**, repeating the `quote`
as many times as the sentence needs, with `claim` as what distinguishes them.
On the producer's own narration that took the film from 15 findings to 26
across 13 sentences, and all four of the reported misses came back
`unsupported`.

### …and the ZipDash one, which was not the checker's fault

> "Google acquired Where 2 Technologies and Keyhole that month, **then bought
> ZipDash** as it assembled its mapping stack."

ZipDash was bought in **September 2004**, before the other two. ChatGPT called
this "the biggest thing your fact-checking system missed", and the system did
miss it — but not by failing to check. It checked, and the pack said:

> **E5.** Google acquired ZipDash in 2004 **after buying Where 2 Technologies
> and Keyhole** as part of building its mapping capabilities.

The judge marked the sentence `supported` with `ref: "E3, E4, E5"` and it was
right to: our own research asserted that order. **A closed-book checker
inherits its pack's errors, and no amount of care in the judge can fix a
wrong claim.** What CAN be fixed is the judge trusting an ordering it was
handed in prose. So:

> ORDER OF EVENTS IS CHECKED AGAINST DATES, NEVER AGAINST WORDING. A claim
> that merely uses "after", "then", "later" or "following" is NOT a source for
> the order — those words are how the research was written up, not something a
> source was checked for, and they have been wrong.

E3 and E4 are dated October 2004; E5 says only "2004". Two events dated, one
not, so the ORDER is `unsupported` — which routes it to `FC Source` for a real
lookup instead of being inherited. **The general rule for any closed-book
check: a claim's PROSE is not evidence, only its facts are.** Dates settle
order.

### 6. …and then attribution walked straight around the order rule

**LIVE as `3d1834f1`, published 2026-09-19 11:14 — and in that order.** It sat
committed-but-unpublished for an hour first, because the OpenAI account ran
out of credits at ~10:00 and **a prompt change nobody has run is not a prompt
change you publish**; the producer topped it up, execution 15071 ran the new
judge against this film's real narration and a pack rebuilt from its own
findings' citations, both new rules fired, and only then did it go live. That
is the 09-18 lesson applied rather than described.

The producer made a fresh Google Maps documentary at 09:47, on the published
one-assertion judge, and read it against ChatGPT again. It came back much
cleaner — no major false claim — but with the ZipDash chronology still wrong.
Here is why, and it is a genuinely new hole rather than the old one recurring.

The narration said:

> "Google acquired Where 2 in October 2004 and, **according to the same
> report**, added Keyhole and ZipDash."

The judge returned two findings, and both are correct:

| claim | verdict | ref |
|---|---|---|
| Google acquired Where 2 in October 2004 | `supported` | E4 |
| The same U.S. congressional report **says** Google added Keyhole and ZipDash | `supported` | E16 |

E16 really does say that. **The ordering was never ruled on as an ordering** —
once the writer attributed it, the assertion the judge extracted was a claim
about what a report SAYS, which is true, so "dates settle order" never fired.
Attribution laundered the chronology.

And the source it launders through is a real one. ChatGPT traced the bad order
to the **2020 U.S. House Judiciary report**, which states the Where 2
acquisition and says Google "soon followed" with Keyhole and ZipDash — while
other chronologies put ZipDash in **September 2004**, before both. So the
strongest form of the lesson from §5 is now demonstrated rather than asserted:
**a reputable primary source can carry an imprecise chronology, and citing it
does not make the chronology right.**

Two changes, neither published:

- `FC Judge` — an attributed statement about a fact that exists independently
  of who reports it (a date, an order, a count, a measurement) is TWO
  assertions: the attribution, and the fact. Rule on both. The limit is
  deliberate and stated in the prompt: a party's claim about ITSELF ("Google
  said Maps had a billion users") stays ONE claim, because what Google said is
  the fact and no one else can settle its internal number.
- `FC Rewrite` — **an ordering is never repaired by attribution.** The ladder's
  first rung is "attribute it", which is right for most things and wrong for
  this one: it leaves the same chronology in the viewer's ears with a citation
  in front of it. For an ordering the fix is rung 2, soften: name the period
  everything is agreed to have happened in and drop the sequence.

### A second, separate miss on the same film: the script disagreeing with itself

Not something ChatGPT flagged as a fact problem — it noticed only that the
prose reads repetitively — but the same two sentences carry two different
years for one event:

> "In **early 2003**, Lars Eilstrup Rasmussen and Jens Eilstrup Rasmussen
> started Where 2 Technologies in Sydney and built Expedition."
> …
> "In **2004**, two Australians and two Danes came together in Sydney to
> develop a new kind of mapping technology for the internet."

Same founding, same city, two years, two counts. The second sentence produced
**no finding at all** — it was not extracted, because "came together to
develop" reads like scene-setting. It is not: it carries a date and a count.

`FC Judge` now says so, and adds the capability that was missing rather than
merely the instruction: **the narration must agree with ITSELF.** The judge
holds the whole script and is the only step that ever reads it as a whole, so
a restatement with a changed number is its job. This is the same failure that
opened the whole Deep Search story — the producer's first red-light film had a
hook saying April and a first chapter saying October — and until now nothing
in the chain could see it, because every check ran against the pack and never
across the script.

### 7. THE HOOK IS NEVER CHECKED, and it never has been

> **Closed 2026-09-19 by the re-check button** — see the box at the end of §8.
> The hole below is still exactly right about the FIRST pass, which is why it
> stays written out: `Generate Hook` still runs after this chain, and rule 3b
> is still a constraint rather than a check. What changed is that something
> now reads the hook afterwards.

**This is the largest hole in the feature and it is architectural, not a
prompt.** Read the canvas order:

```
If Narration Retry[1] → FC Prep → FC Run? → … → FC Apply → FC Save Report
  → FC Done → Combine Chapters → Generate Hook
```

**`Generate Hook` runs AFTER the entire Deep Search chain.** The hook does not
exist when the judge reads the narration, so `FC Prep` cannot put it in
`fc.narration`, so it has never been checked on any film since the feature
shipped. The first two sentences of every documentary — the ones a viewer is
most likely to watch — are the only ones nothing reads.

Found on 2026-09-19 on the producer's third Google Maps film
(`recxsFvSEv3g6blYn`, 21 findings over 9 sentences), where every one of the 9
checked sentences came from chapter 1 and the hook said:

> Lars Rasmussen faced a deadline in 2003.
> The Sydney team held just four members.

No deadline appears in that script, in its research pack, or anywhere in the
sources. It is an invention, and it opens the film.

**The judge is not the problem.** Fed the same hook inside the narration, it
catches it immediately — execution 15089: *"Lars Rasmussen faced a deadline in
2003"* → `unsupported`, *"No sourced claim mentions any deadline involving Lars
Rasmussen in 2003"*, while *"The Sydney team held just four members"* comes
back `supported` on the four-person claim. The chain would work if it ran.

**This also re-explains the very first incident.** CLAUDE.md records the
producer's first red-lit film as having "a hook that said April and a first
chapter that said October", filed under the gate bug. The gate bug was real
and separate; the hook/chapter mismatch was THIS, and it was never fixed
because nobody noticed the hook was outside the checked text.

**What is live now is a constraint, not a check.** `Generate Hook` gained
rule 3b: every date, number, name and specific event in the hook must already
appear in the narration, with the deadline line quoted as the failure to learn
from. That attacks the cause — the hook is a teaser for a script that has just
been fact-checked, so it should never assert something the script does not —
and it costs nothing. But **a constraint is not a check**: if the model
disobeys, nothing catches it.

**The real fix, still owed**, is one of:

1. a small `HK *` check after `Hook Guard` that judges the hook's beats
   against the same pack (new nodes, new wiring, must not break the hook
   retry loop); or
2. moving the whole FC chain after the hook exists (bigger rewire, and the
   hook is written FROM the narration, so the ordering is not accidental).

(1) is the cheaper and safer of the two. Neither was attempted on 09-19 —
it was the fourth publish of the day on a workflow the producer was actively
making films through, and new nodes in a live chain deserve their own sitting.

### 8. Nothing checks what the REWRITE produced

The second half of the same shape: **what the producer reads is not what was
checked.** `FC Apply` validates the rewrite's STRUCTURE — chapter count, no
empty chapter, length within a fifth, untouched chapters really untouched —
and never re-reads its prose. So the rewrite can:

- **introduce a new unsourced claim.** Its own prompt forbids this ("NEVER
  introduce a fact that is not in the sources above… a replacement sentence
  with a new date, a new number or a new name in it is worse than the sentence
  it replaced") and nothing enforces it.
- **half-fix a contradiction.** On `recxsFvSEv3g6blYn` the judge ruled
  *"Between 2002 and 2003, Lars Rasmussen worked with…"* `contradicted`
  because the sources put the layoffs in 2002 and the Sydney team after. The
  rewrite corrected the WHO and kept "Between 2002 and 2003".
- **create a new internal inconsistency.** That same film now says "In 2002 …
  teamed up in Sydney" and "Between 2002 and 2003 … teamed up in Sydney" —
  one event, two dates. The self-consistency rule from §6 would catch it, but
  it ran before the rewrite.

The fix is the same shape as the hook's: the judge is cheap and already
correct, it just needs to see the final text. **A single re-run of `FC Judge`
over the FINISHED narration, after both the rewrite and the hook, would close
§7 and §8 together** — and would have caught every one of the four things
ChatGPT flagged on this film. That is the next piece of work on this feature.

> **BOTH ARE CLOSED, the same evening** — `db/port/deep-search-rerun/`, the
> "⟳ Re-check this script" button, Claude Scripting `6d7e0079`. Thirteen
> `DS *` nodes re-read `hov.script.content` (the finished text, hook included,
> corrections applied), re-run the judge and the live lookup over it, and
> correct what nothing can back — in the script AND in
> `editing_options.hookPlan.beats`, which is the copy the render speaks.
> Measured on this exact film, four presses: flagged **3 → 2 → 1 → 0**, with
> the three corrections on the first press being precisely the invented hook
> line, the over-universal scope claim and the counterfactual. The fourth
> press wrote nothing at all.
>
> **It is a separate button, not a fifth node in this chain, and that is the
> design.** A re-check that ran automatically at the end of scripting would
> face the same problem one level up — something would then have to check what
> IT rewrote — so the recursion has to stop at a human. The producer presses
> it while reading, which is the only moment anyone can say "that reads worse
> than what it replaced".

### 9. The rewrite manufactured duplicates, and cutting them shortens the film

Found 2026-09-19 by the producer's reader, on the script four presses of the
re-check had produced. Every fact in it was sourced. It also said one of them
four times:

```
[CHAPTER 0: HOOK]  In 2003, Google Labs launched "Search by Location."
      chapter 1 ¶1  In September 2003, Google Labs launched "Search by
                    Location" before Google had sufficient mapping data.
      chapter 1 ¶2  In 2003, Google Labs launched "Search by Location"
                    before Google had sufficient mapping data.
      chapter 1 ¶3  A House report says Google Labs launched "Search by
                    Location" in September 2003 before Google had
                    sufficient mapping data.
```

**THIS CHAIN MADE THEM.** `FC Rewrite` is told "you may use these and nothing
else as fact" and "if cutting a sentence leaves a chapter noticeably short,
carry the same beat with the material the sources do support" — and is never
shown what the narration already says. So each press replaced an unsourced
sentence with the best-sourced fact available, which was the fact the sentence
before it already carried. The convergence reported in
`db/port/deep-search-rerun/README.md` as 3 → 2 → 1 → 0 flagged was measuring
the factual axis while the editorial one got worse on every pass.

The fix is in three places, both copies of each: the rewrite may not restate
what the narration already says and the length rule no longer pushes toward
filler; the judge has a fourth verdict, `redundant`; and `FC Resolve` tells the
rewrite to CUT such a sentence in the imperative, while `FC Apply` subtracts
the cut words before the length guard measures.

**Verified on the film that caused it** (executions 15228 and 15231). Press one
cut two — including one where the judge split the attributed sentence into its
attribution (`supported`) and its underlying fact (`redundant`), which is the
§6 rule and this one composing correctly. Press two cut the rest.

#### THE BILL, and it is not small

| | chapter 1 |
|---|---|
| before the two presses | **185 words, 11 sentences** |
| after | **101 words, 6 sentences** |
| lost | **84 words — 45%** |

**Nothing measures that.** `FC Apply`'s guard is per press and per chapter: it
subtracts the words a press was asked to cut and then allows ±20% around what
remains, which is correct for one press and blind across several. Two presses
at a quarter each is nearly half the chapter, and **the word count is what
decides the film's runtime and how many scenes it is cut into.**

**And the film lost its closing line.** *"A four-person Sydney prototype had
become a public product, and online maps were expected to move"* was cut as a
repeat of the hook's four-person team — which it is, and which is also what a
closing bookend IS. The rule as written cannot tell a deliberate echo from an
accidental one, and the last line of a film is the likeliest place to find one.

**All three are paid.** ~~What is owed, in this order:~~

1. ~~**A floor the cuts cannot go under.**~~ **Shipped.** `DS Load` reads
   `length_seconds`, `DS Prep` re-derives `Narration Guard`'s own arithmetic
   from it, and `DS Resolve` spends a budget of `bodyWords − minWords` in
   script order, one charge per sentence. A repeat that does not fit is
   REPORTED and not removed, so the producer can still cut it by hand. **No
   floor means no limit, not a limit of zero** — a film with no stored length
   would otherwise have the whole feature switched off silently, which looks
   exactly like a judge that found nothing.
2. ~~**Exempt the last sentence of the last chapter.**~~ **Shipped, in both
   halves.** The judge is told that a closing echo is a bookend and the hook is
   a teaser (`TWO ECHOES ARE NOT REPETITION`), and `DS Resolve` spares both
   again in code — belt and braces, because cutting a hook line would cost more
   than the line: `DS Apply` refuses any rewrite that changes the hook's line
   count, so one hook cut throws away every other correction in the same press.
3. ~~Until 1 ships, pressing the button repeatedly shortens the film.~~ The
   floor is measured against the script AS IT NOW STANDS rather than per press,
   so ten presses cannot take the film under it.

### What that change moved underneath everything else

The judge now returns roughly twice as many findings for the same script, all
of them correct, several sharing a `quote`. Three things measured the script
by counting findings and had to stop:

| Where | Was | Now |
|---|---|---|
| `FC Resolve`'s overwhelmed backstop | `toFix / findings > 0.6` | distinct sentences, so the threshold does not move when the judge slices more finely |
| `FC Resolve`'s `fixList` | one numbered entry per finding | grouped by sentence, every problem under it — two entries for one sentence asks for two independent rewrites, the second blind to the first's problem |
| `FC Apply`'s `rewritten` | one per finding cleared | distinct sentences, so one corrected sentence reads as one correction and not three |

`report.sentences` is new and carries the second number to the panel, which
says both. The panel also groups its findings by sentence for the same reason
the fix list does: the identical quote three times over reads as a bug.

**The lesson worth keeping is the one about thresholds.** A ratio measured
over units a PROMPT defines is not a threshold, it is a coincidence — change
how finely the model is asked to slice and every number underneath moves with
it, silently and in the direction that looks like nothing happened.

## 10. The checker was right and the valve threw the answer away

Found 2026-09-23, on the producer's own Google Maps documentary, and it is the
cheapest kind of fault to miss: **every part of the chain did its job, and the
film still shipped with five unsourceable statements in it.**

The row in `hov.fact_check` said so out loud and nobody read the field:

    checked 18, flagged 5, rewritten 0,
    refused: "chapter 1 went from 178 to 128 words"

`FC Judge` found five statements the pack cannot back. `FC Rewrite` cut them.
`FC Apply` measured the result against a **symmetric** band — a fifth either
way around what the chapter should weigh — found it 28% shorter, and threw the
whole correction away. The producer kept all five sentences, and the panel told
them a correction had been written and rejected, which is true and useless.

**The band should never have been symmetric, and this project had already
decided that.** `Narration Guard` settled it on 2026-09-13: *the length is a
CEILING — a film shorter than ordered is correct, and only a draft under 55% of
its target, a broken one rather than a short one, goes back for length.* The
valve was still treating length as a two-sided constraint a fortnight later.
Nothing linked the two; the guard's rule lived in its own node and its own
paragraph of `docs/lessons-pipeline.md`.

The band is one-sided now, in `FC Apply` and `DS Apply` alike:

| Direction | Verdict | Why |
|---|---|---|
| grew past **+20%** | refused | padding is how a narration used to reach a word count |
| anywhere between | **accepted** | a film that says only what it can back is the point |
| lost more than **half** a chapter | refused | that is a re-telling, not a correction |

**Shorter is allowed; SILENTLY shorter is not.** Both nodes now compare the
corrected narration against `Narration Guard`'s own `min` and write
`short: {words, min}` into the report when it lands under. It is never a
refusal. It is a fact the producer has to be given, because the word count is
what sets the runtime and the scene count: it means the film does not have
enough SOURCED material to fill the length ordered, and the answer is more
research or a shorter film — neither of which this chain gets to choose. The
panel says exactly that.

**The general lesson is about where a rule lives.** "How short is too short"
had one owner, and a second node was quietly answering the same question
differently. A guard that re-derives a project-wide decision instead of reading
it will drift from it, and the drift is invisible until it refuses something
correct — at which point it looks like the checker being wrong rather than the
valve being wrong.

### The relationship a sentence asserts is an assertion too

Same film, same day, the other half. The producer put the checked script in
front of a second reader, which agreed with all five `unsupported` verdicts and
then questioned one `supported` one:

> *"Inside Google, the Sydney software gained the scale it had lacked."*

Two assertions. That it had scale inside Google — the pack backs that — and
that it had **LACKED** scale before, which nothing anywhere says. **The judge's
own output convicted it**: `claim` read *"gained scale it had previously
lacked"* and `reason` justified only *"gained scale inside Google"*. It wrote
down a narrower justification than its own claim and passed anyway.

`A TRANSITION IS ITS OWN ASSERTION` (§4) was the same rule in one special case.
The general form is now in the prompt: **a source must support not only the
nouns, dates and events in a sentence, but the RELATIONSHIP it asserts between
them** — cause, intention, limitation, comparison, order, consequence. The
family is enumerated so none is missed, with the before-and-after case worked
through because half of it is invisible: a comparison asserts what was true
BEFORE as well as after, and a claim about the after settles nothing about the
before. The self-check is one line and does the most work — **when your reason
covers less than your claim says, the verdict is unsupported.**

The reader's own summary of why this is worth having is worth keeping:

> *"I wouldn't weaken the checker because it produced five unsupported
> statements. The problem is mostly the script generator adding cinematic
> connective language that outruns the evidence, not the checker being too
> strict."*

**That points at the next piece of work, and it is not in this chain.**
`Write Full Narration` and `Edit Full Narration` produce the connective prose —
*became*, *gained*, *could not*, *which meant* — that this judge then has to
catch one sentence at a time. Constraining the writer is cheaper than checking
the writing, but those two nodes are on the main path of EVERY film in every
category, so it needs its own verification and it is not a change to make in
the same afternoon as this one.

## What is verified, and how

| Claim | Evidence |
|---|---|
| The judge answers `story` for fiction | execution **14758**, `recqbPJ7aZu0a21mt` → `{"mode":"story","findings":[]}` in 2.2 s |
| …and `factual` for a documentary filed under the `story` category | execution **14759**, `recUHwTIqrNB6vXBl` (Burj Al Arab) → `mode: factual`, 41 statements, 28 supported, 13 flagged |
| …and catches real errors | same run: *"In 1993, Tom Wright fixes the form"* → "sources name Tom Wright and **1994**"; "documented use of 24-carat gold leaf" → no claim mentions gold leaf; "cooling pipes"; "reached by its causeway"; "asymmetrical structure" |
| …without flagging what the pack does back | same run: 321 m, 280 m offshore, 230 piles, 9,000 t of steel, 70,000 m³ of concrete, the 180 m atrium, 1 December 1999, and both suite counts (202 per Khaleej Times, 198 per Jumeirah) all read `supported` with a ref |
| `FC Source` returns parseable lines with real URLs | execution **14761**: 12 statements, 12 `RESULT:` lines, 8 with a resolvable primary source (Jumeirah's own page for the gold leaf and the causeway, Designing Buildings for Al Muntaha and the fabric façade) |
| The whole chain runs end to end and the rewrite is ACCEPTED | execution **14764**, the same film, 1m46s: 47 statements checked, 16 looked up, **8 corrected, 0 still flagged**, `refused: null`, 6 chapters in and 6 out, per-chapter words `31,385,412,348,339,357` → `33,371,414,343,340,356` |
| **A skipped film writes its row** | a disposable Story film, 2026-09-19: `{skipCode: "not-documentary", category: "story", checked: 0, skipped: "Deep Search runs on Documentary films only, and this film was made in Story mode."}`. This is the branch that wrote nothing at all for four hours |
| **The fixed gate runs on a real film** | execution at 19:32 for `recAVSS5qpc9V5DjV` ("How the Rosetta Stone was deciphered"): `{category: "documentary", checked: 15, searched: 9, flagged: 1, rewritten: 1}`. The `category` in the row is the proof — it is the field that was `undefined` all afternoon |
| **The LIVE nodes run inside a real scripting execution** | execution **14771**, a real pipeline fired at the `new-project` webhook for the disposable film `rec4ZIQVVxXZcS5no` ("How the first cash machine was installed in Enfield in 1967"): `hov.fact_check` written at 15:03:01 with `{checked: 18, flagged: 1, searched: 5, rewritten: 1}` and 18 stored findings, and the run went on to write its script and park at the approval gate — so `FC Done` handed the narration back intact |
| **Attribution stops laundering an order, and the script is read against itself** | execution **15071**, the new judge prompt against `reczMt4d9zqrYcceL`'s real narration: the ZipDash sentence now returns THREE findings where the previous version returned two — the attribution still `supported` on E16 (it really does say that), plus *"Google added Keyhole and ZipDash after acquiring Where 2"* as its own finding, `unsupported`, reason *"no date is given here for ZipDash, so the chronology cannot be backed from the claims alone"*. And *"In 2004, two Australians and two Danes came together in Sydney"* — which produced **no finding at all** on the live version — comes back `unsupported`. 17 findings over 10 sentences against 17 over 9, so the two new rules added what was missing without inflating the rest |
| **…and an ordering that IS dated still passes, which is the half that matters** | execution **15074**, a whole pipeline fired at `new-project` at 11:14:43 — after the 11:14 publish — for the disposable documentary `recKMOrar94pZqq6j` (Facebook/Instagram/WhatsApp/Oculus, chosen because its acquisitions cluster). Row at 11:16:05: `{checked: 15, sentences: 7, flagged: 0, searched: 5, rewritten: 0}`. The finding to read is *"Facebook completed the Instagram acquisition after the FTC closed its investigation"* → **`supported`, ref `E2, E5`**, reason *"E5 dates the FTC closure to August 22, 2012, and E2 says the acquisition was completed in August 2012, establishing that the closure came first"*. **The judge cited the two dates as its justification.** That is the rule behaving as designed rather than as a blunt instrument: an undated ordering (ZipDash) is refused, a dated one is accepted and says which dates settled it. The obvious failure mode — flagging every sentence containing "after" — did not happen, and five statements the pack did not cover were all sourced live from Facebook's own announcements and Meta's Form 10-K |
| **One assertion at a time, on the producer's own film** | execution **15034**, the new `FC Judge` prompt run against `recJiAdwRqaeg8DnR`'s real narration and real pack: 26 findings across **13 distinct sentences** (was 15 findings, one per sentence), and all four of ChatGPT's reported misses come back `unsupported` — the ZipDash ordering (*"the claims date Where 2 and Keyhole to October 2004, but ZipDash is only dated to 2004"*), the browser clause, *"reached … 200 million places"*, and the spare-room narrowing |
| **The PUBLISHED chain runs one-assertion-at-a-time on a real film** | execution **15039**, a whole pipeline fired at `new-project` at 09:38:19 — **after** `63d21d49` went live at 09:37, which is the point — for the disposable documentary `recF5TgqBT8nBwea5` (YouTube, February 2005 to November 2006). Row written 09:40:08: `{category: "documentary", checked: 21, sentences: 10, flagged: 2, searched: 8, rewritten: 2}`, and `count(distinct quote) = 10` against 21 findings, so eleven of them share a sentence with another. The two unsupported ones are the exact shape the producer reported: *"On February 14, 2005, youtube.com was registered, **giving Chad Hurley a real address for an unproven company**"* (E1 backs the date, nothing backs the rest) and *"YouTube said it was founded that month by PayPal veterans, **with Hurley alongside Steve Chen and Jawed Karim**"* (E2 backs "PayPal veterans", nothing names the three). **Under the old prompt both sentences would have come back `supported`.** The row right below it is the producer's own 09:18 film on the previous version: `checked: 15`, `sentences: null`, 15 findings over 15 distinct quotes — one per sentence |
| **§10, both halves, on the film that caused them** | execution **16421**, a real `deep-search-rerun` on the producer's `recSFjNpnuA0ylZAi` at 12:11, fired **after** `7a865309` went live at 12:08. Before: `{checked: 18, flagged: 5, rewritten: 0, refused: "chapter 1 went from 178 to 128 words"}` — the correct fix written and thrown away. After: `{checked: 22, flagged: 5, rewritten: 4, refused: null}`, every finding's `action` now `kept` or `rewritten`, none left `flagged`. **The same rewrite the old band rejected was accepted** |
| **…and the relationship rule split the sentence the reader questioned** | same run: *"Inside Google, the Sydney software gained the scale it had lacked"* was ONE `supported` finding before and is TWO now — `supported :: "Inside Google, the Sydney software gained scale."` and `unsupported :: "Before Google acquired it, the Sydney software had lacked scale."` It reads as the prompt's own worked example because it IS the prompt's own worked example |
| **…and all four sentences it removed are from the named family** | intention (*"The aim was practical: make street finding work as continuous space"*), inability (*"the startup could not deliver it worldwide on its own"*), comparison (*"gained the scale it had lacked"*) and change of state (*"was no longer only a startup tool"*). Four for four — the rule is finding the category it was written for, not flagging at random |
| **…and the floor held without needing to refuse anything** | the corrected body is **137 words against a floor of 133** (90 s → 11 scenes → 242 target → 55% = 133), so `short` is absent and nothing was withheld. One more press would report it rather than shrink the film past it |
| `FC Resolve`, `FC Apply`, `FC Done` behave | `node scripts/check-fact-check.mjs` — 71 assertions over the committed bodies, including every refusal branch, the multi-finding sentence, the grouped fix list, and that a finely sliced sentence does not trip the overwhelmed backstop |

`scripts/check-fact-check.mjs` runs the real `db/port/fact-check/paste/*.js`
bodies with a fake `$`/`$json`, so it fails the moment a body and its intent
drift apart. It does NOT prove the live node matches the file — that is
`db/port/lib/diff-workflow.mjs`.

The verification workflows were throwaways and are archived:
`PhZtGYUo5mLqd11E` (the data probes) and `eMjJ0X7RvH6PUbuT` (the chain); and
from 2026-09-19, `q5gue5gQ4oJkRtmx` and `utlOHyZDN31Bbzr3` (the two judge
prompts against real narration and pack), `wyUS527vzBnGQaGo` /
`UL5DChAzyhiYWLzW` (fire `new-project`) and `snKTsHwHQUfobBGE` /
`YhGEJUOMr5gNXgIf` / `2fX41mkMCBk4ON5G` (read `hov.fact_check` back).

**The ordering rule is now exercised in both directions, and the positive one
is the one that proves it.** The YouTube film (15039) asserted no relative
order at all; the Facebook film (15074) asserted one and had it ACCEPTED,
with the judge naming the two dates that settled it. A rule that refuses
undated orderings is only useful if it still passes dated ones — otherwise it
is a filter on the word "after", and every acquisition documentary would
arrive at the gate covered in red.

## Version ids

| Version | What |
|---|---|
| `538a914c` | the valve refuses a rewrite that drops a sentence the sources back (re-check 16463) — **published 2026-09-23 ~13:55, and what is live**; account in `db/port/deep-search-topup/README.md` |
| `8c317407` | the TOP-UP — sourced running time back after a correction, on both chains — published 2026-09-23 13:40; its own account is `db/port/deep-search-topup/README.md` |
| `7a865309` | §10 — the one-sided length band, the `short` record, and the judge ruling on the RELATIONSHIP a sentence asserts — published 2026-09-23 12:08 |
| `f379e56d` | the floor the dedupe cuts cannot go under, and the two echoes it spares |
| `dfc81d23` | §9 — `redundant`, and the rewrite that manufactured four copies of one sentence |
| `a9ecfbb4` | §7 hook constraint + counterfactuals and whole-category scope are checkable — published 2026-09-19 11:30 |
| `3d1834f1` | §6 — attribution does not settle an order, and the narration must agree with itself — published 2026-09-19 11:14 |
| `63d21d49` | one assertion at a time, dates settle order, the counts move to sentences — published 2026-09-19 09:37 |
| `b927a298` | the skip path writes its report too — published 2026-09-18 19:32 |
| (same publish) | the category read moved to `Fetch Project Record` |
| `99ad980b` | Documentary-mode gate, skip codes, the Deep Search rename — published 15:18, **broken for four hours** |
| `b9f95221` | the active version this was built on |
| `e3091e15` / `600ce4a5` / `60efa205` | the three edits that added the 13 nodes |
| `38d05de7` | read the narration by node name, not `$json` (an agent replaces the payload) — **published 14:31** |
| `20fb4e8c` | the `RESULT:` parser fix and the overwhelmed backstop |
| `ea076103` | `storyMode` / `overwhelmed` in the report — published 14:47 |

Rolling back means publishing `b9f95221`: the chain is additive, and `FC Prep`
is the only node on the old happy path's edge. To undo only the one-assertion
change and keep everything else, publish `b927a298` instead.

## What is owed

- **The research pack is the next thing to fix.** The ZipDash error was born in
  `Research Tema` / `Extract Claims`, which wrote "Google acquired ZipDash in
  2004 **after** buying Where 2 Technologies and Keyhole" — an ordering the
  research asserted and nothing sourced. The judge no longer trusts it, which
  turns a wrong answer into a lookup, but the pack is still writing relative
  order as if it were fact. **Claims should carry DATES, not sequence words**;
  the fix is in the extraction prompt, and it is worth doing because every
  reader of the pack inherits the same error, the writer included — this one
  reached the narration before the checker ever saw it.

- **A film the producer keeps.** The live chain has now run inside a real
  scripting execution (14771, above) and the row it wrote is good: 17 of 18
  statements held up, ten against the pack by ref and the rest against sources
  a targeted search found — Historic England's listing notice for the Enfield
  branch among them, with a URL — and the one that did not (*"The problem was
  not simply to copy a teller by machine"*, an interpretation no claim covers)
  was rewritten away. What is still owed is the same run on a film somebody
  intends to keep, where the corrected sentences are READ as prose rather than
  counted.
- **Watch what the rewrite does to the prose.** Execution 14764 changed eight
  sentences and every length check passed, but nobody has read the result as
  prose. "9,000 tonnes of white steel climb skyward" losing its *white* is
  correct and also a small loss of image; that trade is the producer's call to
  see, and the panel shows the old sentence beside the new script for exactly
  that reason.
- **Watch the promotions.** In execution 14761 the search "confirmed" that Tom
  Wright had fixed the design by 1993 from a library catalogue's `1993/1999`
  creation-date range — thin, and it promoted a sentence the pack put in 1994.
  The report shows the source and the URL, so it is visible rather than
  hidden, but if this happens often the prompt's source ladder needs a rung
  about date ranges.
- The `FC Source` numbering is mapped by the model's own `RESULT: n`, not by
  position, so a skipped line is harmless. A MIS-numbered line is not, and
  nothing detects it.
