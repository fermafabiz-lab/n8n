// Accept the corrected narration, or keep the original — and either way hand
// `Combine Chapters` exactly what `Narration Guard` would have handed it.
//
// THIS NODE IS THE SAFETY VALVE OF THE WHOLE CHAIN. Everything upstream is a
// language model with an opinion about a producer's script. Nothing it
// produces reaches the film unless it passes here, and the fallback is always
// the draft that already cleared the narration guard — a script with an
// unsourced sentence in it is a far smaller problem than no script, or than a
// script quietly rewritten into something the producer did not approve.
//
// What is checked, and why each one:
//  - same chapters, same numbers: a rewrite that drops or invents a chapter
//    has misunderstood the job.
//  - no empty chapter: an empty narrator_script segments into nothing.
//  - length within tolerance: the word count decides the film's runtime and
//    its scene count, so a chapter that loses a third of its words silently
//    shortens the film (see the narration guard's own length window).
//  - untouched chapters really are untouched: the rewrite is told to change
//    only the flagged sentences; if it tidied elsewhere we cannot tell what
//    else it changed, so the whole rewrite is refused.
// BY NAME, NOT `$json`, and for a sharper reason than usual: this node is
// reached from TWO directions. `FC Fix?`[1] arrives carrying FC Resolve's
// payload; `FC Rewrite` arrives carrying an agent's `{output: {chapters}}` and
// nothing else. Only one of those has the narration on it, so the narration is
// never read positionally — the rewrite's proposal is fetched by name below.
const g = $('FC Resolve').first().json;
const fc = (g && g.fc) || {};
const original = Array.isArray(g.chapters) ? g.chapters : [];
const findings = Array.isArray(fc.findings) ? fc.findings : [];
const wc = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

// Which chapters were allowed to change: the ones containing a flagged quote.
const toFix = findings.filter((f) => f.action === 'rewrite');
const touched = new Set();
for (const f of toFix) {
  for (const c of original) {
    if (String(c.narrator_script || '').includes(f.quote)) touched.add(Number(c.chapter_number));
  }
}

let next = null;
let refusal = null;

if (!fc.needsRewrite) {
  refusal = null; // nothing to do; not a refusal
} else {
  let proposed = [];
  try {
    const out = $('FC Rewrite').first().json.output || {};
    proposed = Array.isArray(out.chapters) ? out.chapters : [];
  } catch (e) {
    proposed = [];
  }

  if (!proposed.length) {
    refusal = 'the rewrite returned no chapters';
  } else if (proposed.length !== original.length) {
    refusal = 'the rewrite returned ' + proposed.length + ' chapters for ' + original.length;
  } else {
    const byNum = new Map(proposed.map((c) => [Number(c.chapter_number), c]));
    const merged = [];
    for (const c of original) {
      const p = byNum.get(Number(c.chapter_number));
      if (!p) {
        refusal = 'chapter ' + c.chapter_number + ' is missing from the rewrite';
        break;
      }
      const text = String(p.narrator_script || '').trim();
      if (!text) {
        refusal = 'chapter ' + c.chapter_number + ' came back empty';
        break;
      }
      const wasWords = wc(c.narrator_script);
      const nowWords = wc(text);
      // A fifth either way. Wide enough that attributing or cutting one
      // sentence passes; narrow enough that a rewrite which re-tells the
      // chapter does not.
      if (wasWords && (nowWords < wasWords * 0.8 || nowWords > wasWords * 1.2)) {
        refusal = 'chapter ' + c.chapter_number + ' went from ' + wasWords + ' to ' + nowWords + ' words';
        break;
      }
      if (!touched.has(Number(c.chapter_number)) && text !== String(c.narrator_script || '').trim()) {
        refusal = 'chapter ' + c.chapter_number + ' was changed but had nothing flagged in it';
        break;
      }
      merged.push({ ...c, narrator_script: text });
    }
    if (!refusal) next = merged;
  }
}

if (refusal) {
  console.log('FACT CHECK rewrite REFUSED — keeping the original narration: ' + refusal);
}

const chapters = next || original;

// What actually changed, per finding, for the report the producer reads.
let rewritten = 0;
for (const f of findings) {
  if (f.action !== 'rewrite') {
    f.action = 'kept';
    continue;
  }
  if (!next) {
    // The rewrite was refused or never ran: the sentence stands as written,
    // and the report must say so rather than claiming a fix that did not land.
    f.action = 'flagged';
    f.after = f.quote;
    continue;
  }
  const still = chapters.some((c) => String(c.narrator_script || '').includes(f.quote));
  f.action = still ? 'flagged' : 'rewritten';
  if (!still) rewritten += 1;
}

// Rebuild the two derived fields the guard emitted, so anything downstream
// reading them sees the script that now exists rather than the draft.
const output = chapters
  .map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title || ''}]\n${String(c.narrator_script || '').trim()}`)
  .join('\n\n');
const words = chapters.reduce((n, c) => n + wc(c.narrator_script), 0);

const report = fc.run
  ? {
      checked: findings.length,
      flagged: findings.filter((f) => f.verdict !== 'supported').length,
      searched: fc.searched || 0,
      rewritten,
      refused: refusal || undefined,
      // Nothing was rewritten and that was a decision, not a failure — the
      // share of unsupported statements was high enough that this pack was
      // plainly never meant to back this script. The site says so in its own
      // words rather than printing a wall of red. See `FC Resolve`.
      overwhelmed: fc.overwhelmed ? true : undefined,
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
      checked: 0,
      flagged: 0,
      searched: 0,
      rewritten: 0,
      skipped: fc.skipped || 'not checked',
      // Distinguishes "we read it and it is a story" from "there was no pack
      // to read it against", which are the same outcome and different news.
      storyMode: fc.storyMode ? true : undefined,
      findings: [],
    };

console.log('FACT CHECK done: ' + report.checked + ' checked, ' + report.flagged + ' flagged, ' + report.rewritten + ' rewritten');

// Base64 for the writer downstream. The report quotes the narration verbatim,
// so it is arbitrary producer text going into a SQL literal: dollar-quoting
// would be undone by a `$hov$` in the prose, and any `$` followed by a digit
// ("$5 billion") is read as a positional parameter the moment that node is
// ever switched to transaction batching. Encoding here — where Buffer exists,
// which it does not in an n8n expression — makes the query immune to both.
const fcReport64 = Buffer.from(JSON.stringify(report), 'utf8').toString('base64');

// The Narration Guard shape, exactly — `Combine Chapters` reads `$json`.
return [
  {
    json: {
      output,
      retry: false,
      chapters,
      words,
      target: g.target,
      min: g.min,
      max: g.max,
      fcReport: report,
      fcReport64,
    },
  },
];
