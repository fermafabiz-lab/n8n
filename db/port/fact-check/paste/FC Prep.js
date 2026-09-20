// Decide whether this script gets Deep Search at all, and lay out what the
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
// DOCUMENTARY MODE ONLY — the producer's instruction, 2026-09-18. This is the
// outer gate and it is deliberately the project's declared category rather
// than anything inferred from the text: Deep Search is a feature of
// Documentary mode, and a film made in any other mode does not get it even if
// its narration is entirely factual. The consequence is worth stating because
// it is not obvious: `story` is the site's DEFAULT, so films that read as
// documentaries (Burj Al Arab, Peking to Paris, the Tupac film) are filed as
// `story` and are NOT checked. Asking for Deep Search means choosing
// Documentary when the film is created.
//
// The judge's own factual/story verdict is KEPT as an inner gate, for the
// documentary whose narration turns out to be a dramatisation. Two gates, one
// per failure mode: this one answers "was it asked for", that one answers "can
// it be done".
const g = $json;

// `Fetch Project Record` IS THE NODE THAT CARRIES THE PROJECT ROW, and reading
// the category from anywhere else does not work. This cost the producer a film:
// the first version read `$('Receive Project Data')`, which is the sub-workflow
// TRIGGER, and that node declares typed inputs — Project_ID, Tema, Tonalitate,
// Pace, Lenght, Language, Style, Lore — so n8n emits ONLY those eight. There is
// no `fields` on it and there never was. The read returned undefined, every
// documentary skipped as `no-mode`, and because the skip path bypassed the
// report writer there was no row to say so: the producer's Google Maps film
// reached its script with a red light and no explanation.
//
// What made the wrong node look right is that `FC Save Report` reads
// `$('Receive Project Data').first().json.Project_ID` and works — because
// `Project_ID` is one of the declared eight. One field resolving is not
// evidence that the object is there.
//
// `Voice Mode` has read the category exactly this way since the kids styles
// landed. When a workflow already answers a question somewhere, copy THAT
// node's reference rather than inventing one.
let category = '';
let modeRead = false;
try {
  const pf = ($('Fetch Project Record').first().json || {}).fields || {};
  const o = JSON.parse(pf['Editing Options'] || '{}') || {};
  if (o && typeof o === 'object' && 'category' in o) {
    category = String(o.category || '').toLowerCase().trim();
    modeRead = true;
  }
} catch (e) {
  // Left as not read — which is a RED state downstream, not a quiet skip.
  // A documentary whose mode could not be read is the one case where doing
  // nothing looks exactly like working, so it is reported as a fault.
}
const isDocumentary = category === 'documentary';

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
const run = isDocumentary && researched && pack.length > 0 && chapters.length > 0;

// Why it did not run, as a CODE the site can colour by and a sentence the
// producer can read. The two are deliberately separate: the prose will be
// reworded, the code is what the red light is wired to.
//
// `not-documentary` is the only skip that is NORMAL. Every other one happens
// on a film that asked for Deep Search and did not get it, which is exactly
// what the producer wants to see turn red.
let skipCode = null;
let skipped = null;
if (!run) {
  if (!modeRead) {
    skipCode = 'no-mode';
    skipped =
      'Deep Search could not tell which mode this film was made in, so it did not run. This is a fault, not a setting.';
  } else if (!isDocumentary) {
    skipCode = 'not-documentary';
    skipped =
      'Deep Search runs on Documentary films only, and this film was made in ' +
      (category ? category.charAt(0).toUpperCase() + category.slice(1) : 'another') +
      ' mode.';
  } else if (!researched) {
    skipCode = 'not-researched';
    skipped =
      'This documentary reached the script with no research behind it, so there was nothing to check it against.';
  } else if (pack.length === 0) {
    skipCode = 'no-pack';
    skipped =
      'The research step found no sourced claims for this documentary, so there was nothing to check the script against.';
  } else {
    skipCode = 'no-chapters';
    skipped = 'The narration arrived with no chapters.';
  }
  console.log('DEEP SEARCH skipped (' + skipCode + '): ' + skipped);
}

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

return [
  {
    json: {
      ...g,
      fc: {
        run,
        category,
        skipCode,
        skipped,
        pack,
        packList,
        narration,
        originalWords: words(narration),
      },
    },
  },
];
