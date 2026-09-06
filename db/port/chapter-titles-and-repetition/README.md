# Chapter titles, and repetition the guard can count

**APPLIED 2026-09-03**, through the n8n MCP connector, one node per workflow.
Both live versions were diffed against this directory afterwards and no other
node was touched.

| workflow | node | live version |
|---|---|---|
| 4. Final Assembly (`BY22Vlhh20Xdkr5Z`) | `Fetch Script Titles` | `8d8f9bcc` |
| Claude Scripting (`gkEtGMecv4TC3ZHp`) | `Narration Guard` | `4ff941ea` |

`*.before.*` is the rollback: paste it back into the same node and publish.

---

## 1. The chapter cards had no titles, and nobody could see it

`Build Remotion Props` builds `chapterTitles` from the `[CHAPTER n: title]`
markers in the linked script. It was fed by this:

```sql
where id = $hov${{ (($('Fetch Project Info').first().json.fields || {}).scripts || [])[0] || 'missing' }}$hov$
```

`fields.scripts` was an Airtable **reverse link**. `hov.at_project` never
emitted it — look at the view in `db/002_airtable_compat.sql`: the link is
stored the other way round, on the script, as `Associated Project`. So the
expression fell through to its own fallback, the query looked up the literal
id `'missing'`, no row came back, and `chapterTitles` was `{}` on **every film
since the 15 Aug cutover**.

Nothing failed. Remotion has a fallback for old projects that predate titles:

```tsx
keyLine={chapterTitles[String(s.chapter ?? 1)] || (narrationIsSpoken ? keyLineFor(s.narratorText) : '')}
```

so each chapter card printed the first eight words of the scene's own
narration — one beat before the voice says them, over a card whose whole job
is to show what is *not* being said. On the 71-scene Boyd film
(`recnyQ92QsXehZ98S`, execution 9330) four cards did that, while the real
titles sat in the script the whole time:

> The Floor, the Clock, and the Decision · Why Hard Work Alone Was Not Enough ·
> Make the Small Place Better, Then Bigger · Return to the Same Moment, Changed

The fix asks the script instead, filtering `at_script`'s own
`Associated Project` array, newest first. **Through the view, not the base
table** — everything else this workflow reads is a `hov.at_*` view, and the
render path should not be the first thing to discover a missing base-table
grant. Verified on a throwaway read-only workflow before publishing: the Boyd
project resolves to script `recEzvV0ngTHpOqC5`, five markers present,
`script chapters` still populated.

`Build Remotion Props` was deliberately **not** changed. Its regex is enough
once the row arrives, and the rewrite path (`Rewrite Script`) is required by
its own system prompt to keep the marker lines, so the markers are the one
source that survives every path.

## 2. Repetition was asked for and never measured

The writer's rule 2 is SAY EVERYTHING ONCE. The editor's rule 1 is REPETITION —
"the single biggest defect". `Narration Guard` enforced structure, empty
chapters and **length** — and length is the one pressure that pushes the other
way: a draft that runs out of story reaches its word count by telling the same
dates again a chapter later. The Boyd film shipped with 1941 told four times,
1952, 1962, 1966, 1975 and 1977 twice each, and the $6,667 / $3,000 split
twice.

The guard now counts what it was already asking for:

- **facts** — years, sums, quantities; a name recurring is a protagonist, a
  number recurring is the same fact stated twice. Reported at **3+**
  occurrences, with the chapters they fall in.
- **phrasing** — an identical six-word run appearing twice. Overlapping
  windows of one repeat are folded, so five offenders means five sentences,
  not five views of one.

Both go through the existing `editorFeedback` path: same `MAX_RETRIES = 2`,
same accept-anyway ending. A repetitive film still ships — it just costs at
most two more editor passes, and those passes are now told exactly what to cut
and to replace it with events from the spine rather than description.

Thresholds were checked against real narration before shipping: the 44-scene
Ploiești film raises nothing, a synthetic Boyd-style recycling raises `1941
(3 times, chapters 1, 2, 3)` plus four verbatim phrasings. A clean script
stays silent, which is what keeps the retry cost at zero for good drafts.

## Not fixed here

Both of these were found reading the Boyd film; three more things it showed are
still open: the drawn cards produce nothing because `Choose Motif Cards` fails
its validator and neither motif fits a timeline of years, the elastic stretch
hits its 0.65 / 1.5 clamps on scenes whose narration runs past 12 seconds, and
a ten-minute film takes about fifty minutes of Remotion render.
