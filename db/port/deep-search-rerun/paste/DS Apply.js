// Accept the corrected script, or keep the one that exists — and build the
// report either way.
//
// THIS IS THE SAFETY VALVE, and it is `FC Apply`'s with one extra job: the
// first pass hands its chapters to `Combine Chapters` and the pipeline carries
// on, while this one has to hand back TEXT that replaces a row the producer is
// reading. Every refusal below is a case where keeping the existing script is
// the better outcome, because a script with an unsourced sentence in it is a
// far smaller problem than a script quietly turned into something else.
//
// BY NAME, NOT `$json`: this node is reached from two directions. `DS Fix?`[1]
// arrives carrying DS Resolve's payload; `DS Rewrite` arrives carrying an
// agent's `{output: {chapters}}` and nothing else.
const g = $('DS Resolve').first().json;
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
    const out = $('DS Rewrite').first().json.output || {};
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
      // THE HOOK IS CUT ONE SHOT PER LINE, so a correction that merges two of
      // its lines silently drops a shot from the film. The prompt says so and
      // this is what enforces it.
      if (Number(c.chapter_number) === 0) {
        const wasLines = String(c.narrator_script || '').split(/\n+/).filter((s) => s.trim()).length;
        const nowLines = text.split(/\n+/).filter((s) => s.trim()).length;
        if (wasLines !== nowLines) {
          refusal = 'the hook went from ' + wasLines + ' lines to ' + nowLines + ', and each line is a shot';
          break;
        }
      }
      merged.push({ ...c, narrator_script: text });
    }
    if (!refusal) next = merged;
  }
}

if (refusal) {
  console.log('DEEP SEARCH re-run rewrite REFUSED — keeping the script as it was: ' + refusal);
}

const chapters = next || original;

// The script text, reassembled in EXACTLY the shape `Combine Chapters` writes,
// so that when nothing changed the bytes are identical and `DS Write` has
// nothing to do. The check harness asserts that round-trip; a reassembly that
// drifted would rewrite every script it touched even on a clean film.
const script = chapters
  .map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title || ''}]\n${String(c.narrator_script || '').trim()}`)
  .join('\n\n');
const scriptChanged = script.trim() !== String(fc.narration || '').trim();

// SHORTER IS ALLOWED; SILENTLY SHORTER IS NOT — see `FC Apply` for the whole
// argument. Measured over the BODY, without the hook, because that is what
// `Narration Guard` measured when it derived the floor.
const floorWords = Number(fc.minWords) || 0;
const bodyNow = chapters
  .filter((c) => Number(c.chapter_number) !== 0)
  .reduce((n, c) => n + wc(c.narrator_script), 0);
const wentShort = next && floorWords > 0 && bodyNow < floorWords;
if (wentShort) {
  console.log(
    'DEEP SEARCH re-run the corrected narration is ' + bodyNow + ' words, under the ' + floorWords +
      ' this film\'s length needs — it does not have enough sourced material to fill its running time.',
  );
}

// THE HOOK LIVES IN TWO PLACES and both have to move together. Chapter 0 is
// the hook in the script text; `Editing Options.hookPlan.beats` is the same
// lines again, and it is the copy the RENDER speaks. Fixing one and not the
// other is the "a line and its recording drift apart silently" fault exactly —
// the panel would show a corrected hook while the film still said the old one.
const hookChapter = chapters.find((c) => Number(c.chapter_number) === 0);
const hookBeats = hookChapter
  ? String(hookChapter.narrator_script || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
const editing = (g && g.editing) || {};
const oldBeats = Array.isArray(editing.hookPlan && editing.hookPlan.beats) ? editing.hookPlan.beats : [];
const hookChanged = hookBeats.length > 0 && JSON.stringify(hookBeats) !== JSON.stringify(oldBeats);

const nextEditing = hookChanged
  ? { ...editing, hookPlan: { ...(editing.hookPlan || {}), beats: hookBeats } }
  : editing;

// What actually changed, per finding. COUNTED IN SENTENCES: the judge rules on
// one assertion at a time, so a compound sentence arrives as several findings
// that all stop matching the moment that one sentence is rewritten, and
// counting findings would report "3 corrected" for one edit.
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
    f.action = 'flagged';
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

const ran = fc.run && !fc.storyMode;

// THE TOP-UP'S ARITHMETIC — see `FC Apply` for why it lives in the valve.
//
// THE TARGET IS `preCheckWords`: the body before Deep Search ever touched this
// film, written by the first pass and carried forward by every re-check. A
// report from before 2026-09-23 has none, and then the anchor is what THIS
// press started with — the conservative choice, because it can never lengthen
// a film past a length it actually had.
//
// NOT gated on a correction landing this press. A film shortened by an EARLIER
// press is still short, and the producer asked for its running time back.
//
// PAST THE SCRIPT GATE, NEVER: the scenes carry their own copy of every line.
const FILL_MIN_GAP = 25;
const preCheckWords = Number(fc.preCheckWords) > 0 ? Number(fc.preCheckWords) : Number(fc.bodyWords) || 0;
const gapWords = Math.max(0, preCheckWords - bodyNow);
const usedRefs = [
  ...new Set(
    findings
      .map((f) => String(f.ref || ''))
      .join(',')
      .split(/[^A-Za-z0-9]+/)
      .filter((r) => /^[A-Za-z]*\d+$/.test(r))
      .map((r) => r.toUpperCase()),
  ),
];
const fill = {
  run: !!ran && fc.mayRewrite !== false && gapWords >= FILL_MIN_GAP,
  gapWords,
  preCheckWords,
  nowWords: bodyNow,
  min: floorWords,
  narration: script,
  packList: fc.packList || '',
  usedRefs,
  chapters,
};

const report = ran
  ? {
      category: fc.category || '',
      checked: findings.length,
      flagged: findings.filter((f) => f.verdict !== 'supported').length,
      sentences: fc.sentences || 0,
      searched: fc.searched || 0,
      rewritten,
      // Carried forward, so the next press measures against the same length.
      preCheckWords,
      // The corrected narration is under the film's ordered length. Not a
      // failure and never a refusal — a statement about how much of this film
      // its research can actually support.
      short: wentShort ? { words: bodyNow, min: floorWords } : undefined,
      // Sentences removed because the narration already carried the fact.
      // Undefined rather than 0 when there were none, so an older report and a
      // clean new one read the same on the panel.
      deduped: deduped || undefined,
      refused: refusal || undefined,
      overwhelmed: fc.overwhelmed ? true : undefined,
      // The film is past its script gate, so the re-run checked and refused to
      // edit. Distinct from `overwhelmed`, which is a judgement about the
      // check; this is a fact about the film's stage.
      frozen: fc.frozen ? true : undefined,
      // WHAT MAKES THIS REPORT DIFFERENT FROM THE FIRST PASS. `scope: 'final'`
      // means the text checked was the script as it stands — hook included,
      // corrections included — rather than the draft the first pass saw.
      rerun: true,
      scope: 'final',
      // The hook's spoken copy moved too, so nothing downstream is stale.
      hookFixed: hookChanged ? true : undefined,
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
      skipped: fc.storyMode
        ? 'This film tells a story rather than recounting real events, so there is nothing to check it against.'
        : fc.skipped || 'not checked',
      skipCode: fc.storyMode ? 'story' : fc.skipCode || 'unknown',
      storyMode: fc.storyMode ? true : undefined,
      findings: [],
    };

console.log(
  'DEEP SEARCH re-run done: ' + report.checked + ' checked, ' + report.flagged + ' flagged, ' +
    report.rewritten + ' rewritten' + (deduped ? ', ' + deduped + ' repeated sentence(s) cut' : '') + (hookChanged ? ' (hook updated)' : '') +
    (report.skipCode ? ' (skipped: ' + report.skipCode + ')' : ''),
);

// Base64 for both writers. The report quotes the script verbatim and the script
// IS producer prose, so both are arbitrary text heading into a SQL literal:
// dollar-quoting is undone by a `$hov$` in the text and any `$` followed by a
// digit ("$5 billion") becomes a positional parameter under transaction
// batching. Buffer exists here and does not in an n8n expression.
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

return [
  {
    json: {
      projectId: g.projectId,
      projectName: g.projectName,
      scriptChanged,
      hookChanged,
      script,
      fcReport: report,
      fcReport64: b64(JSON.stringify(report)),
      script64: b64(script),
      editing64: b64(JSON.stringify(nextEditing)),
      // For `DS Top Up?` / `DS Fill` / `DS Fill Apply`. `DS Write` and
      // `DS Save` read only the keys above, so it rides along harmlessly on the
      // path where the top-up does not run.
      fill,
    },
  },
];
