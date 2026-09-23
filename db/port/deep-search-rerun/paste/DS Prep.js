// Lay out for the judge exactly what `FC Prep` lays out — and deliberately
// under the SAME key, `fc`.
//
// THAT IS THE WHOLE TRICK OF THIS CHAIN. `DS Judge` and `DS Source` then take
// the committed prompts from `db/port/fact-check/paste/` BYTE FOR BYTE, because
// those prompts read `$json.fc.packList` and `$json.fc.narration`. One prompt
// text, two live nodes. The cost is that the two nodes must be re-pasted
// TOGETHER whenever the judge prompt changes — that is the `KIDS_STYLES` rule
// again, and it is written down in this folder's README and in CLAUDE.md.
const row = $json || {};

let category = '';
let modeRead = false;
let editing = {};
try {
  editing = JSON.parse(row.editing_options || '{}') || {};
  if (editing && typeof editing === 'object' && 'category' in editing) {
    category = String(editing.category || '').toLowerCase().trim();
    modeRead = true;
  }
} catch (e) {
  editing = {};
  // Left unread, which is a RED state downstream — same rule as `FC Prep`.
}
const isDocumentary = category === 'documentary';

// The script as it now stands. `hov.script.content` is already in the judge's
// expected shape, hook included, so there is nothing to rebuild.
const narration = String(row.script || '').trim();

// PARSED BACK INTO CHAPTERS, because the rewrite works on chapters and the
// re-run only has the assembled text. The markers `Combine Chapters` writes
// are `[CHAPTER n: title]`, so the parse is exact and the reassembly in
// `DS Apply` round-trips to the same bytes when nothing changes — which the
// check harness asserts, because a reassembly that drifted would rewrite every
// script it touched even when the judge found nothing.
function parseChapters(text) {
  const out = [];
  const re = /^\[CHAPTER\s+(\d+):\s*([^\]]*)\]\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    marks.push({ number: Number(m[1]), title: m[2].trim(), from: m.index, bodyFrom: m.index + m[0].length });
  }
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].from : text.length;
    out.push({
      chapter_number: mk.number,
      chapter_title: mk.title,
      narrator_script: text.slice(mk.bodyFrom, end).trim(),
    });
  });
  return out;
}
const chapters = parseChapters(narration);

let pack = [];
try {
  const raw = row.claims;
  pack = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
  if (!Array.isArray(pack)) pack = [];
} catch (e) {
  pack = [];
}

// WHETHER A CORRECTION MAY BE WRITTEN AT ALL. At the script gate a film has no
// chapters and no scenes — measured on 2026-09-19, `recxsFvSEv3g6blYn` read
// `scenes: 0, chapters: 0` while parked there — so the script text is the only
// thing derived from the narration and rewriting it is safe. Past approval the
// scenes carry their own copy of every line and their own recordings, and
// changing the script under them is precisely the "a line and its recording
// drift apart silently" fault in a new costume. So: past that point the re-run
// still CHECKS and still reports, and refuses to edit.
const sceneCount = Number(row.scene_count || 0);
const mayRewrite = sceneCount === 0;

// THE FLOOR THE CUTS MAY NOT GO UNDER.
//
// `FC Apply`'s length guard is per press and per chapter: it subtracts the
// words a press was asked to cut, then allows a fifth either way around what
// remains. That is right for one press and blind across several — two presses
// at a quarter each pass individually and halve the chapter together, which is
// exactly what happened on 2026-09-19 (185 words to 101, and the film lost its
// closing line). The word count is what decides the film's runtime and how
// many scenes it is cut into, so an unbounded shrink is a shorter film nobody
// ordered.
//
// THE SAME ARITHMETIC AS `Narration Guard`, deliberately copied rather than
// invented: it is the one owner of "how short is too short", and a second
// opinion here would mean the first pass and the re-run disagreeing about the
// same film. Keep these four lines in step with it.
const lengthSeconds = Number(row.length_seconds || 64);
const plannedScenes = Math.max(1, Math.ceil(lengthSeconds / 8) - 1);
const targetWords = plannedScenes * 22;
const minWords = Math.round(targetWords * 0.55);

// MEASURED WITHOUT THE HOOK, because `Narration Guard` measured without it —
// chapter 0 does not exist when the guard runs. Comparing a hook-inclusive
// count against a hook-exclusive floor would quietly buy the cuts two spare
// lines of budget.
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const bodyWords = chapters
  .filter((c) => Number(c.chapter_number) !== 0)
  .reduce((n, c) => n + words(c.narrator_script), 0);

// THE LAST SENTENCE OF THE LAST CHAPTER IS NEVER CUT. A closing line that
// echoes the opening is a bookend, which is what a closing line IS — and the
// dedupe removed one on its first outing ("A four-person Sydney prototype had
// become a public product" repeats the hook's four-person team, and repeating
// it is the point). `db/port/story-close/` exists because that resolution was
// worth adding; this is what stops a fact-checker taking it away again.
const lastBody = [...chapters].filter((c) => Number(c.chapter_number) !== 0).pop();
const closingSentence = lastBody
  ? (String(lastBody.narrator_script || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() || '')
  : '';

const run = isDocumentary && pack.length > 0 && narration.length > 0 && chapters.length > 0;

// Why it did not run, in the SAME vocabulary the first pass uses, so the site's
// one owner of the verdict (`platform/lib/deep-search.ts`) needs no new codes.
// `no-script` is the only one this chain can produce that the first pass cannot:
// a film whose script row is missing has nothing to re-check.
let skipCode = null;
let skipped = null;
if (!run) {
  if (!modeRead) {
    skipCode = 'no-mode';
    skipped =
      'Deep Search could not tell which mode this film was made in, so the re-run did not happen. This is a fault, not a setting.';
  } else if (!isDocumentary) {
    skipCode = 'not-documentary';
    skipped =
      'Deep Search runs on Documentary films only, and this film was made in ' +
      (category ? category.charAt(0).toUpperCase() + category.slice(1) : 'another') +
      ' mode.';
  } else if (!narration || chapters.length === 0) {
    skipCode = 'no-script';
    skipped = 'This film has no script saved yet, so there was nothing to re-check.';
  } else {
    skipCode = 'no-pack';
    skipped =
      'The research step saved no sourced claims for this documentary, so there was nothing to check the script against.';
  }
  console.log('DEEP SEARCH re-run skipped (' + skipCode + '): ' + skipped);
}

// Same rendering `FC Prep` uses, so the judge sees one list in one format
// whichever door it came through.
const packList = pack
  .map((c) => `${c.ref}. ${c.claim} [${c.source}${c.date && c.date !== 'n/a' ? ', ' + c.date : ''} — ${c.url}]`)
  .join('\n');

return [
  {
    json: {
      chapters,
      fc: {
        run,
        category,
        skipCode,
        skipped,
        pack,
        packList,
        narration,
        originalWords: words(narration),
        mayRewrite,
        sceneCount,
        // The floor, and what the cuts are measured against.
        lengthSeconds,
        targetWords,
        minWords,
        bodyWords,
        closingSentence,
        // The length before Deep Search first touched this film, recorded by the
        // first pass. Zero when the report predates the top-up.
        preCheckWords: Number(row.pre_check_words) || 0,
      },
      editing,
      projectId: String(row.project_id || ''),
      projectName: String(row.project_name || ''),
    },
  },
];
