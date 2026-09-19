// Lay out for the judge exactly what `FC Prep` lays out — and deliberately
// under the SAME key, `fc`.
//
// THAT IS THE WHOLE TRICK OF THIS CHAIN. `DS Judge` and `DS Source` then take
// the committed prompts from `db/port/fact-check/paste/` BYTE FOR BYTE, because
// those prompts read `$json.fc.packList` and `$json.fc.narration`. One prompt
// text, two live nodes. The cost is that the two nodes must be re-pasted
// TOGETHER whenever the judge prompt changes — that is the `KIDS_STYLES` rule
// again, and it is written down in this folder's README and in CLAUDE.md.
//
// What this does NOT do is decide anything about a rewrite. A re-run reports;
// it never edits. The producer is looking at the script when they press the
// button, and may well have hand-edited it — changing text under someone who
// is reading it is the "silent edit" failure the panel exists to prevent.
const row = $json || {};

let category = '';
let modeRead = false;
try {
  const o = JSON.parse(row.editing_options || '{}') || {};
  if (o && typeof o === 'object' && 'category' in o) {
    category = String(o.category || '').toLowerCase().trim();
    modeRead = true;
  }
} catch (e) {
  // Left unread, which is a RED state downstream — same rule as `FC Prep`.
}
const isDocumentary = category === 'documentary';

// The script as it now stands. `hov.script.content` is already in the judge's
// expected shape, hook included, so there is nothing to rebuild.
const narration = String(row.script || '').trim();

let pack = [];
try {
  const raw = row.claims;
  pack = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
  if (!Array.isArray(pack)) pack = [];
} catch (e) {
  pack = [];
}

const run = isDocumentary && pack.length > 0 && narration.length > 0;

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
  } else if (!narration) {
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

const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

return [
  {
    json: {
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
      projectId: String(row.project_id || ''),
      projectName: String(row.project_name || ''),
    },
  },
];
