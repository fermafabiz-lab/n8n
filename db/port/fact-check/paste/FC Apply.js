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
//
// THREE directions now, not two. `FC Run?`[false] reaches here as well, so a
// film Deep Search declined still gets a report row saying WHY — without that
// the skip path wrote nothing at all, and "no row" meant both "it was a Story
// film" and "the chain is dead". Those are the two things the producer's red
// light exists to tell apart, and for a day it could not.
//
// BY NAME, NOT `$json`: `FC Fix?`[1] arrives carrying FC Resolve's payload and
// `FC Rewrite` arrives carrying an agent's `{output: {chapters}}` and nothing
// else, so the narration is never read positionally.
let g;
try {
  g = $('FC Resolve').first().json;
} catch (e) {
  // The gate said no, so FC Resolve never ran. FC Prep is the payload then.
  g = $('FC Prep').first().json;
}
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

// HOW MANY WORDS EACH CHAPTER IS SUPPOSED TO LOSE. A `redundant` sentence is
// told to leave, so the chapter it sits in is EXPECTED to come back shorter —
// and the length guard below, which exists to catch a rewrite that re-tells a
// chapter in miniature, would otherwise read a correct deletion as exactly that
// and refuse the whole rewrite. Subtracting the cut first keeps the guard as
// strict as it was about everything else.
//
// DEDUPED BY QUOTE, because the judge rules on one assertion at a time and a
// sentence can arrive as several findings; counting its words once per finding
// would let a chapter shrink by a multiple of what was actually removed.
const cutWordsFor = new Map();
const countedCuts = new Set();
for (const f of toFix) {
  if (f.verdict !== 'redundant') continue;
  const q = String(f.quote || '').trim();
  if (!q || countedCuts.has(q)) continue;
  countedCuts.add(q);
  for (const c of original) {
    if (String(c.narrator_script || '').includes(q)) {
      const n = Number(c.chapter_number);
      cutWordsFor.set(n, (cutWordsFor.get(n) || 0) + wc(q));
      break;
    }
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
      const expectWords = Math.max(1, wasWords - (cutWordsFor.get(Number(c.chapter_number)) || 0));

      // THE BAND IS NOT SYMMETRIC, and making it so cost a real film its
      // correction. A rewrite may never GROW a chapter — padding is how the
      // narration used to reach a word count, and the fifth above is what
      // stops it. But a rewrite that SHORTENS is usually doing exactly what it
      // was asked to: a sentence nothing can back is cut, and the chapter
      // weighs less afterwards because the film now says less.
      //
      // `Narration Guard` settled this for the whole project on 2026-09-13 —
      // "the length is a CEILING: a film shorter than ordered is correct" —
      // and this guard was still treating it as a two-sided constraint. On
      // 2026-09-23 that refused a correct fix on the producer's Google Maps
      // film: five unsourceable statements in an eleven-sentence script, the
      // rewrite cut them, 178 words became 128, and the whole correction was
      // thrown away for being 28% shorter. The producer kept all five.
      //
      // What survives is the check against a chapter being RE-TOLD rather than
      // corrected, which is what losing more than half of it looks like.
      if (wasWords && nowWords > expectWords * 1.2) {
        refusal =
          'chapter ' + c.chapter_number + ' grew from ' + wasWords + ' to ' + nowWords + ' words' +
          (expectWords !== wasWords ? ' (about ' + expectWords + ' expected after the cut)' : '');
        break;
      }
      if (wasWords && nowWords < expectWords * 0.5) {
        refusal =
          'chapter ' + c.chapter_number + ' lost more than half its words (' + wasWords + ' to ' + nowWords +
          '), which is a re-telling rather than a correction';
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
  console.log('DEEP SEARCH rewrite REFUSED — keeping the original narration: ' + refusal);
}

const chapters = next || original;

// What actually changed, per finding, for the report the producer reads.
//
// COUNTED IN SENTENCES. Since the judge rules on one assertion at a time, a
// compound sentence arrives here as several findings that all carry the SAME
// quote, and all of them stop matching the moment that one sentence is
// rewritten. Counting findings would report "3 corrected" for one corrected
// sentence — a number the producer reads as three edits to go and reread.
const fixedSentences = new Set();
// Counted apart from the corrections, because they are a different piece of
// news: a correction changes what the film SAYS and the producer must reread
// it, a deletion only removes a sentence they were about to hear for the
// second time. Rolled together, "5 sentences corrected" would send them
// hunting for five edits when there are three.
const cutSentences = new Set();
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
  const dup = f.verdict === 'redundant';
  f.action = still ? 'flagged' : dup ? 'cut' : 'rewritten';
  if (!still) (dup ? cutSentences : fixedSentences).add(String(f.quote || '').trim());
}
// A sentence with both problems — repeated AND unsourced — is a correction, not
// a deletion, wherever it lands: `redundant` is only ever used for a statement
// the sources DO back, so the two sets cannot legitimately overlap. Subtracting
// is belt and braces against a judge that ignores that instruction.
for (const q of fixedSentences) cutSentences.delete(q);
const rewritten = fixedSentences.size;
const deduped = cutSentences.size;

// Rebuild the two derived fields the guard emitted, so anything downstream
// reading them sees the script that now exists rather than the draft.
const output = chapters
  .map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title || ''}]\n${String(c.narrator_script || '').trim()}`)
  .join('\n\n');
const words = chapters.reduce((n, c) => n + wc(c.narrator_script), 0);

// SHORTER IS ALLOWED; SILENTLY SHORTER IS NOT. The guard above no longer
// refuses a rewrite for shrinking, because a film that says only what it can
// back is the point. But the word count is what decides the runtime and the
// scene count, so a correction that takes the narration under the length the
// producer ordered is news they have to be given: it means the film does not
// have enough SOURCED material to fill its running time, and the answer is
// more research or a shorter film — neither of which this chain can choose.
//
// `min` is `Narration Guard`'s own floor (55% of the target it derived from
// the ordered length), read from the payload rather than recomputed, so the
// two cannot disagree about the same film.
const floorWords = Number(g.min) || 0;
const wentShort = next && floorWords > 0 && words < floorWords;
if (wentShort) {
  console.log(
    'DEEP SEARCH the corrected narration is ' + words + ' words, under the ' + floorWords +
      ' this film\'s length needs — it does not have enough sourced material to fill its running time.',
  );
}

const report = fc.run
  ? {
      // The mode the film was made in, carried so the panel can say it back
      // without a second query. Deep Search only runs on `documentary`.
      category: fc.category || '',
      checked: findings.length,
      flagged: findings.filter((f) => f.verdict !== 'supported').length,
      // How many SENTENCES those statements came from. `checked` counts
      // assertions and one sentence often carries several, so the two numbers
      // diverge on purpose — the panel says both, because "26 statements" and
      // "13 sentences" answer different questions and either alone misleads.
      sentences: fc.sentences || new Set(findings.map((f) => String(f.quote || '').trim())).size,
      searched: fc.searched || 0,
      rewritten,
      // The corrected narration is under the film's ordered length. Not a
      // failure and never a refusal — a statement about how much of this film
      // its research can actually support.
      short: wentShort ? { words, min: floorWords } : undefined,
      // Sentences removed because the narration already carried the fact.
      // Undefined rather than 0 when there were none, so an older report and a
      // clean new one read the same on the panel.
      deduped: deduped || undefined,
      refused: refusal || undefined,
      // Nothing was rewritten and that was a decision, not a failure — the
      // share of unsupported statements was high enough that this pack was
      // plainly never meant to back this script. See `FC Resolve`.
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
      category: fc.category || '',
      checked: 0,
      flagged: 0,
      searched: 0,
      rewritten: 0,
      skipped: fc.skipped || 'not checked',
      // THE FIELD THE RED LIGHT IS WIRED TO. The prose above will be reworded
      // one day; this will not. `not-documentary` and `story` are normal —
      // every other value means a film that should have been checked was not.
      skipCode: fc.skipCode || 'unknown',
      // Distinguishes "we read it and it is a story" from "there was no pack
      // to read it against", which are the same outcome and different news.
      storyMode: fc.storyMode ? true : undefined,
      findings: [],
    };

console.log('DEEP SEARCH done: ' + report.checked + ' checked, ' + report.flagged + ' flagged, ' + report.rewritten + ' rewritten' + (deduped ? ', ' + deduped + ' repeated sentence(s) cut' : '') + (report.skipCode ? ' (skipped: ' + report.skipCode + ')' : ''));

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
