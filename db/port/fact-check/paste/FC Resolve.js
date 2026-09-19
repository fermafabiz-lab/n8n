// Both branches meet here: the one that went looking for sources and the one
// that had nothing to look for. Folds any sources found back onto the judge's
// findings, settles a final verdict for each, and decides what the rewrite is
// allowed to touch.
//
// Everything is wrapped so that a missing upstream node degrades to "no
// findings" rather than throwing. This chain sits in the middle of scripting:
// the worst thing it can do is not correct a script, and the worst thing it
// MUST NEVER do is lose one.

// BY NAME, NOT `$json`. This node is fed by `FC Judge`, and an agent's output
// REPLACES the payload with `{output: …}` — neither the chapters nor `fc`
// survive it. Reading `$json` here would hand `FC Apply` an empty chapter list
// and kill the run at `Combine Chapters`, one node later and with an error
// message about the wrong thing. Same reason `Choose Bible` reads
// `$('Rebuild Story Bible')` by name.
const g = $('FC Prep').first().json;
const fc = (g && g.fc) || {};

let findings = [];
let mode = '';
try {
  const out = $('FC Judge').first().json.output || {};
  findings = Array.isArray(out.findings) ? out.findings : [];
  mode = String(out.mode || '').toLowerCase();
} catch (e) {
  findings = [];
}

// A STORY IS NOT A FILM WITH ERRORS IN IT. This was found by running the judge
// on "The Roman slave who conquered Egypt" — a fiction film that was
// nonetheless researched, so it reached here with a fifteen-claim pack and an
// invented protagonist. The judge was right about all 56 of its statements and
// useless about all 56: nothing in a pack about Ptolemaic Egypt backs what
// Lazarus did on a Tuesday. Left alone, the rewrite would have been handed
// every sentence of the film.
//
// This is the INNER gate. `FC Prep` already refused every film not made in
// Documentary mode; this one catches the documentary whose narration turns out
// to be a dramatisation, which no category can tell you.
if (mode === 'story') {
  return [
    {
      json: {
        ...g,
        fc: {
          ...fc,
          run: false,
          storyMode: true,
          skipCode: 'story',
          skipped:
            'This film tells a story rather than recounting real events, so there is nothing to check it against. Its research was used as background, not as claims.',
          findings: [],
          searched: 0,
          needsRewrite: false,
          fixList: '',
        },
      },
    },
  ];
}

// The narration as it stands, so a quote that does not appear in it verbatim
// can be thrown away. The judge is told to copy exactly; this is what makes
// that instruction enforceable instead of merely requested.
const narration = String(fc.narration || '');
const before = findings.length;
findings = findings.filter((f) => f && typeof f.quote === 'string' && f.quote.trim() && narration.includes(f.quote.trim()));
if (findings.length !== before) {
  console.log('DEEP SEARCH dropped ' + (before - findings.length) + ' finding(s) whose quote did not match the narration verbatim');
}

// The unsupported ones, in the SAME order the search prompt numbered them.
const gaps = findings.filter((f) => f.verdict === 'unsupported');

// Parse the search results, if the search ran at all.
const results = new Map();
try {
  const raw = String($('FC Source').first().json.output || '');
  // Every field is optional and every separator may be padded, because the
  // only thing that can be relied on is the model's goodwill about a format.
  // Two details are not cosmetic: each `|` gets its own leading `\s*` (the
  // first version of this anchored the line with `$` and had no slack before
  // the pipes, so a perfectly well-formed line with a space before `| DATE:`
  // matched NOTHING and the whole search step silently did nothing), and the
  // URL is `[^|\s]*` rather than `\S*` so it cannot swallow the next pipe when
  // the field is empty.
  const re = /RESULT:\s*(\d+)\s*\|\s*STATUS:\s*(confirmed|refuted|not-found)\s*(?:\|\s*SOURCE:\s*([^|\n]*))?(?:\|\s*URL:\s*([^|\s]*)\s*)?(?:\|\s*DATE:\s*([^|\n]*))?(?:\|\s*SAYS:\s*([^\n]*))?/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const url = String(m[4] || '').replace(/[).,\]]+$/, '');
    results.set(Number(m[1]), {
      status: m[2].toLowerCase(),
      source: String(m[3] || '').trim(),
      // A claimed source with no resolvable URL is treated as not-found: the
      // whole point of this step is a link a producer can open.
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
let toFix = findings.filter((f) => f.action === 'rewrite');

// A SENTENCE IS THE UNIT OF THE SCRIPT; AN ASSERTION IS THE UNIT OF THE CHECK.
// Since the judge was taught to rule on one assertion at a time (2026-09-19),
// several findings routinely share one `quote` — that is the fix for the
// compound sentence whose good half hid its bad half. Everything that measures
// the SCRIPT therefore has to count sentences, not findings, or the same change
// of prompt quietly moves every threshold underneath it.
const sentences = (list) => new Set(list.map((f) => String(f.quote || '').trim()));
const allSentences = sentences(findings);
const badSentences = sentences(toFix);

// THE BACKSTOP, for when the judge answers `factual` about something that is
// not. A documentary written from its own pack holds up in most of its
// sentences; four bad ones in twenty is the shape of a real problem. Most of
// the film failing is not a film that is mostly wrong, it is a check aimed at
// the wrong thing — and rewriting most of a film is the one outcome this chain
// must never produce, because at that volume the rewrite is no longer
// correcting the producer's script, it is replacing it.
//
// So past this line we stop offering to fix and start only reporting. The
// producer still sees every finding, which is the whole of "warn loudly, never
// block"; nothing is hidden and nothing is rewritten.
//
// MEASURED IN SENTENCES, deliberately. "Most of the film is wrong" is a
// statement about the film's prose, and a sentence with three bad clauses in it
// is still one sentence the producer has to reread. Counting findings instead
// would make this threshold depend on how finely the judge happens to slice a
// sentence that day — which is a prompt, not a fact about the script.
const OVERWHELMED_SHARE = 0.6;
const OVERWHELMED_FLOOR = 8; // below this a high share is just a short script
const overwhelmed = allSentences.size >= OVERWHELMED_FLOOR && badSentences.size / allSentences.size > OVERWHELMED_SHARE;
if (overwhelmed) {
  console.log(
    'DEEP SEARCH not rewriting: ' +
      badSentences.size + ' of ' + allSentences.size +
      ' sentences are unsupported, which reads as a script this pack was never meant to back. Reporting only.',
  );
  toFix = [];
}

console.log(
  'DEEP SEARCH ' +
    findings.length + ' checkable statements across ' + allSentences.size + ' sentences, ' +
    findings.filter((f) => f.verdict === 'supported').length + ' supported, ' +
    findings.filter((f) => f.verdict === 'unsupported').length + ' unsupported, ' +
    findings.filter((f) => f.verdict === 'contradicted').length + ' contradicted' +
    (searched ? ' (' + searched + ' looked up)' : ''),
);

// The brief the rewrite works from: only the sentences that need changing,
// each with what is wrong and what the source actually says.
//
// GROUPED BY SENTENCE, because the rewrite's unit is the sentence. A compound
// sentence now arrives here as several findings, and listing it several times
// would ask for it to be rewritten several times — two independent rewrites of
// one sentence, the second overwriting the first, each blind to the other's
// problem. One entry, every problem under it, is the same information and one
// instruction.
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
const fixList = grouped
  .map((e, i) => {
    const problems = e.problems
      .map(
        (f) =>
          `   - ${f.claim || 'this statement'}: ${f.verdict === 'contradicted' ? 'a source contradicts this' : 'nothing we can cite supports this'}. ${(f.reason || '').trim()}${f.url ? ' [' + f.url + ']' : ''}`,
      )
      .join('\n');
    return `${i + 1}. SENTENCE: ${e.quote}\n   WHAT IS WRONG WITH IT${e.problems.length > 1 ? ' (' + e.problems.length + ' separate problems — fix all of them in the one rewrite)' : ''}:\n${problems}`;
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
        sentences: allSentences.size,
        badSentences: badSentences.size,
        needsRewrite: toFix.length > 0,
        fixList,
      },
    },
  },
];
