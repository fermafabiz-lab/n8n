// Fold any sources found back onto the judge's findings, settle a verdict for
// each, and decide what the rewrite is allowed to touch.
//
// This is `FC Resolve` adapted to the re-run's node names. It kept the rewrite
// half — the producer asked on 2026-09-19 for the button to FIX what it finds,
// not only report it — which means the overwhelmed backstop matters here for
// exactly the reason it does in the first pass: rewriting most of a film stops
// being a correction and becomes a replacement.
//
// BY NAME, NOT `$json`, for the reason that bites everywhere in this chain: an
// agent's output REPLACES the payload with `{output: …}`, so neither `fc` nor
// the chapters survive `DS Judge`.
const g = $('DS Prep').first().json;
const fc = (g && g.fc) || {};

let findings = [];
let mode = '';
try {
  const out = $('DS Judge').first().json.output || {};
  findings = Array.isArray(out.findings) ? out.findings : [];
  mode = String(out.mode || '').toLowerCase();
} catch (e) {
  findings = [];
}

// A story reaching here is the same inner gate as the first pass: a documentary
// whose narration turns out to be a dramatisation is not a film with 56 errors
// in it, and saying so is the only useful answer.
const storyMode = mode === 'story';

const narration = String(fc.narration || '');
const before = findings.length;
findings = findings.filter(
  (f) => f && typeof f.quote === 'string' && f.quote.trim() && narration.includes(f.quote.trim()),
);
if (findings.length !== before) {
  console.log(
    'DEEP SEARCH re-run dropped ' + (before - findings.length) + ' finding(s) whose quote did not match the script verbatim',
  );
}

const gaps = storyMode ? [] : findings.filter((f) => f.verdict === 'unsupported');

// Parse the search results, if the search ran. Identical parser to `FC Resolve`
// — including the `\s*` before every pipe, which is the fix for the version
// that anchored on `$` and silently matched nothing.
const results = new Map();
try {
  const raw = String($('DS Source').first().json.output || '');
  const re = /RESULT:\s*(\d+)\s*\|\s*STATUS:\s*(confirmed|refuted|not-found)\s*(?:\|\s*SOURCE:\s*([^|\n]*))?(?:\|\s*URL:\s*([^|\s]*)\s*)?(?:\|\s*DATE:\s*([^|\n]*))?(?:\|\s*SAYS:\s*([^\n]*))?/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const url = String(m[4] || '').replace(/[).,\]]+$/, '');
    results.set(Number(m[1]), {
      status: m[2].toLowerCase(),
      source: String(m[3] || '').trim(),
      url: /^https?:\/\/\S+\.\S+/i.test(url) ? url : '',
      date: String(m[5] || '').trim(),
      says: String(m[6] || '').trim(),
    });
  }
} catch (e) {
  // The search branch did not run, or produced nothing readable.
}

let searched = 0;
gaps.forEach((f, i) => {
  const r = results.get(i + 1);
  if (!r) return;
  searched += 1;
  if (r.status === 'confirmed' && r.url) {
    f.verdict = 'supported';
    f.source = r.source;
    f.url = r.url;
    f.sourceDate = r.date;
    f.reason = r.says || 'Confirmed by a source found for this statement.';
  } else if (r.status === 'refuted' && r.url) {
    f.verdict = 'contradicted';
    f.source = r.source;
    f.url = r.url;
    f.sourceDate = r.date;
    f.reason = r.says || 'A source contradicts this statement.';
  } else {
    f.reason = (f.reason || '') + ' No source could be found for it.';
  }
});

// What the rewrite may touch. `supported` is never touched — a sentence the
// sources back is correct, and rewriting correct prose is how a fact-checker
// starts damaging scripts.
for (const f of findings) {
  f.action = f.verdict === 'supported' ? 'keep' : 'rewrite';
}
let toFix = storyMode ? [] : findings.filter((f) => f.action === 'rewrite');

const sentencesOf = (list) => new Set(list.map((f) => String(f.quote || '').trim()));
const allSentences = sentencesOf(findings);
const badSentences = sentencesOf(toFix);

// PAST APPROVAL THE RE-RUN REPORTS AND DOES NOT EDIT. The scenes carry their
// own copy of every line and their own recordings by then, so changing the
// script under them is the "a line and its recording drift apart" fault. The
// findings still reach the producer in full.
let frozen = false;
if (toFix.length && !fc.mayRewrite) {
  frozen = true;
  console.log(
    'DEEP SEARCH re-run not rewriting: this film already has ' + fc.sceneCount +
      ' scenes, which carry their own copy of the narration. Reporting only.',
  );
  toFix = [];
}

// THE BACKSTOP, unchanged in intent from `FC Resolve`: most of the film failing
// is not a film that is mostly wrong, it is a check aimed at the wrong thing,
// and rewriting at that volume replaces the producer's script instead of
// correcting it. Measured in SENTENCES because the judge rules on one assertion
// at a time — see `db/port/fact-check/README.md` §5.
const OVERWHELMED_SHARE = 0.6;
const OVERWHELMED_FLOOR = 8;
const overwhelmed =
  allSentences.size >= OVERWHELMED_FLOOR && badSentences.size / allSentences.size > OVERWHELMED_SHARE;
if (overwhelmed) {
  console.log(
    'DEEP SEARCH re-run not rewriting: ' +
      badSentences.size + ' of ' + allSentences.size +
      ' sentences are unsupported, which reads as a script this pack was never meant to back. Reporting only.',
  );
  toFix = [];
}

console.log(
  'DEEP SEARCH re-run ' +
    findings.length + ' checkable statements across ' + allSentences.size + ' sentences, ' +
    findings.filter((f) => f.verdict === 'supported').length + ' supported, ' +
    findings.filter((f) => f.verdict === 'unsupported').length + ' unsupported, ' +
    findings.filter((f) => f.verdict === 'contradicted').length + ' contradicted' +
    (searched ? ' (' + searched + ' looked up)' : ''),
);

// GROUPED BY SENTENCE, because the rewrite's unit is the sentence. A compound
// sentence arrives here as several findings, and listing it several times would
// ask for it to be rewritten several times — two independent rewrites of one
// sentence, the second overwriting the first, each blind to the other's problem.
const grouped = [];
const byQuote = new Map();
for (const f of toFix) {
  const q = String(f.quote || '').trim();
  let e = byQuote.get(q);
  if (!e) {
    e = { quote: q, problems: [] };
    byQuote.set(q, e);
    grouped.push(e);
  }
  e.problems.push(f);
}
// A REDUNDANT SENTENCE IS CUT, NOT REWORDED, and the instruction has to say so
// in the imperative — the ladder's first three rungs (attribute, soften,
// correct) all keep the sentence, and every one of them leaves the viewer
// hearing the same fact twice in a new costume.
const problemOf = (f) => {
  if (f.verdict === 'contradicted') return 'a source contradicts this';
  if (f.verdict === 'redundant') return 'THE NARRATION ALREADY SAYS THIS — delete the sentence, do not reword it';
  return 'nothing we can cite supports this';
};

const fixList = grouped
  .map((e, i) => {
    const problems = e.problems
      .map(
        (f) =>
          `   - ${f.claim || 'this statement'}: ${problemOf(f)}. ${(f.reason || '').trim()}${f.url ? ' [' + f.url + ']' : ''}`,
      )
      .join('\n');
    // When every problem with a sentence is that it repeats another, the whole
    // entry is a deletion and saying so once at the top beats hoping the model
    // reads to the end of the bullets.
    const allDup = e.problems.every((f) => f.verdict === 'redundant');
    const head = allDup
      ? '   CUT THIS SENTENCE — it repeats what the narration has already said:'
      : `   WHAT IS WRONG WITH IT${e.problems.length > 1 ? ' (' + e.problems.length + ' separate problems — fix all of them in the one rewrite)' : ''}:`;
    return `${i + 1}. SENTENCE: ${e.quote}\n${head}\n${problems}`;
  })
  .join('\n\n');

return [
  {
    json: {
      ...g,
      fc: {
        ...fc,
        findings,
        searched,
        overwhelmed,
        frozen,
        storyMode,
        sentences: allSentences.size,
        badSentences: badSentences.size,
        needsRewrite: toFix.length > 0,
        fixList,
      },
    },
  },
];
