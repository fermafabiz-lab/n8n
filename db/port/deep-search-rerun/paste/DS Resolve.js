// Fold any sources found back onto the judge's findings and build the report.
// This is `FC Resolve` with the rewrite half removed: a re-run never edits the
// script, so there is no fix list, no `needsRewrite`, and no overwhelmed
// backstop — that backstop exists to stop a RUNAWAY REWRITE, and with nothing
// to rewrite it would only suppress information the producer asked for.
//
// BY NAME, NOT `$json`, for the reason that bites everywhere in this chain: an
// agent's output REPLACES the payload with `{output: …}`, so neither `fc` nor
// the project id survives `DS Judge`.
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

// The panel reads `action` on every finding. A re-run changes nothing, so a
// statement either held up (`kept`) or still stands unsupported (`flagged`) —
// `rewritten` can never occur here and its absence is the honest signal that
// nothing in the script moved.
for (const f of findings) {
  f.action = f.verdict === 'supported' ? 'kept' : 'flagged';
}

const sentences = new Set(findings.map((f) => String(f.quote || '').trim()));

if (storyMode) {
  console.log('DEEP SEARCH re-run: the judge read this narration as a story; nothing checked.');
}

console.log(
  'DEEP SEARCH re-run ' +
    findings.length + ' checkable statements across ' + sentences.size + ' sentences, ' +
    findings.filter((f) => f.verdict === 'supported').length + ' supported, ' +
    findings.filter((f) => f.verdict === 'unsupported').length + ' unsupported, ' +
    findings.filter((f) => f.verdict === 'contradicted').length + ' contradicted' +
    (searched ? ' (' + searched + ' looked up)' : ''),
);

const ran = fc.run && !storyMode;

const report = ran
  ? {
      category: fc.category || '',
      checked: findings.length,
      flagged: findings.filter((f) => f.verdict !== 'supported').length,
      sentences: sentences.size,
      searched,
      // Always zero, and deliberately present: the panel prints "the script
      // below already contains the corrections" off this number, and a re-run
      // must never make that claim.
      rewritten: 0,
      // WHAT MAKES THIS REPORT DIFFERENT FROM THE FIRST PASS, and the only two
      // fields the site needs to say so. `scope: 'final'` means the text
      // checked was the script as it stands — hook included, rewrite included
      // — rather than the draft the first pass saw.
      rerun: true,
      scope: 'final',
      findings: findings.map((f) => ({
        quote: f.quote,
        claim: f.claim || '',
        verdict: f.verdict,
        ref: f.ref || '',
        reason: (f.reason || '').trim(),
        source: f.source || '',
        url: f.url || '',
        action: f.action,
      })),
    }
  : {
      category: fc.category || '',
      checked: 0,
      flagged: 0,
      searched: 0,
      rewritten: 0,
      rerun: true,
      scope: 'final',
      skipped: storyMode
        ? 'This film tells a story rather than recounting real events, so there is nothing to check it against.'
        : fc.skipped || 'not checked',
      skipCode: storyMode ? 'story' : fc.skipCode || 'unknown',
      storyMode: storyMode ? true : undefined,
      findings: [],
    };

console.log(
  'DEEP SEARCH re-run done: ' + report.checked + ' checked, ' + report.flagged + ' flagged' +
    (report.skipCode ? ' (skipped: ' + report.skipCode + ')' : ''),
);

// Base64 for the writer, for the same reason `FC Apply` does it: the report
// quotes the script verbatim, so it is arbitrary producer text heading into a
// SQL literal, and any `$` followed by a digit ("$5 billion") becomes a
// positional parameter the moment that node is switched to transaction
// batching. Buffer exists here and does not in an n8n expression.
const fcReport64 = Buffer.from(JSON.stringify(report), 'utf8').toString('base64');

return [{ json: { projectId: g.projectId, projectName: g.projectName, fcReport: report, fcReport64 } }];
