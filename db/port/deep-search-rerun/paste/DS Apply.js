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
  f.action = still ? 'flagged' : 'rewritten';
  if (!still) fixedSentences.add(String(f.quote || '').trim());
}
const rewritten = fixedSentences.size;

const ran = fc.run && !fc.storyMode;

const report = ran
  ? {
      category: fc.category || '',
      checked: findings.length,
      flagged: findings.filter((f) => f.verdict !== 'supported').length,
      sentences: fc.sentences || 0,
      searched: fc.searched || 0,
      rewritten,
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
    report.rewritten + ' rewritten' + (hookChanged ? ' (hook updated)' : '') +
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
    },
  },
];
