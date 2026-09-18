// Decide whether this script can be fact-checked at all, and lay out what the
// judge needs. Sits between `If Narration Retry`[1] and `Combine Chapters`.
//
// THE SHAPE IT EMITS IS `Narration Guard`'S SHAPE, and that is load-bearing:
// `Combine Chapters` reads `$json` — not a named node — so every node inserted
// on this edge has to hand on `{output, retry, chapters, words, target, min,
// max}` untouched or the chapters vanish silently. (`Choose Bible` reads
// `$('Rebuild Story Bible')` by name, which is why inserting `Save Rebuilt
// Bible` there was safe; this edge is the other kind.) Everything the chain
// adds rides in `fc`, which nothing downstream reads.
//
// IT RUNS ONLY ON A RESEARCHED SCRIPT WITH A PACK. Fiction has no claims to
// check against — `Extract Claims` yields zero on the No Research branch — and
// checking invention against an empty list would flag every sentence of every
// story film. A pack of zero is not a strict checker, it is a broken one.
const g = $json;

let pack = [];
let researched = false;
try {
  // Safe by construction: `Extract Claims` sits on BOTH the research and the
  // no-research branch precisely so this reference never dangles.
  const ec = $('Extract Claims').first().json;
  pack = Array.isArray(ec.claims) ? ec.claims : [];
  researched = ec.researched === true;
} catch (e) {
  // No pack reachable — not a reason to lose a script.
}

const chapters = Array.isArray(g.chapters) ? g.chapters : [];
const run = researched && pack.length > 0 && chapters.length > 0;

// The narration as the judge will see it, with the chapter markers kept so it
// can tell where a sentence lives, and so a quote it returns can be found
// again by exact string match.
const narration = chapters
  .map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title || ''}]\n${String(c.narrator_script || '').trim()}`)
  .join('\n\n');

// The pack, numbered. Same rendering `Extract Claims` uses for the writer, so
// the judge and the writer are looking at one list in one format.
const packList = pack
  .map((c) => `${c.ref}. ${c.claim} [${c.source}${c.date && c.date !== 'n/a' ? ', ' + c.date : ''} — ${c.url}]`)
  .join('\n');

const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

if (!run) {
  console.log(
    'FACT CHECK skipped: ' +
      (!researched ? 'not a researched topic' : pack.length === 0 ? 'no sourced claims' : 'no chapters'),
  );
}

return [
  {
    json: {
      ...g,
      fc: {
        run,
        skipped: run
          ? null
          : !researched
            ? 'This film is not a researched topic, so there is nothing to check it against.'
            : pack.length === 0
              ? 'The research step found no sourced claims, so there was nothing to check the script against.'
              : 'The narration arrived with no chapters.',
        pack,
        packList,
        narration,
        originalWords: words(narration),
      },
    },
  },
];
