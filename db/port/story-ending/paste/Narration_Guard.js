// The editor's output, checked by code before it becomes the script: every
// planned chapter present as a [CHAPTER n: title] block, none empty, and the
// whole narration inside the length window. Anything wrong goes BACK to Edit
// Full Narration with the problems spelled out, at most MAX_RETRIES times;
// then the draft is accepted as it is (logged), because a slightly short film
// beats a dead scripting run. Length is a code decision now, not the
// writer's "most important rule" — that rule is what made the old chapters
// pad themselves with set-dressing inventories.
const text = String($json.output !== undefined ? $json.output : ($json.text || '')).replace(/\r\n/g, '\n').trim();
const outline = ($('Generate Outline').first().json.output || {});
const planned = outline.chapters || [];
const rp = $('Receive Project Data').first().json;
const scenes = Math.max(1, Math.ceil(Number(rp.Lenght || 64) / 8) - 1);
const target = scenes * 22;
const min = Math.round(target * 0.9);
const max = Math.round(target * 1.12);
const blocks = text.split(/\n(?=\[CHAPTER\s+\d+\s*:)/i).map(b => b.trim()).filter(Boolean);
const chapters = [];
for (const block of blocks) {
  const h = block.match(/^\[CHAPTER\s+(\d+)\s*:\s*([^\]]*)\]\s*\n?/i);
  if (!h) continue;
  chapters.push({ chapter_number: parseInt(h[1], 10), chapter_title: h[2].trim(), narrator_script: block.slice(h[0].length).trim() });
}
chapters.sort((a, b) => a.chapter_number - b.chapter_number);
const wc = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const words = chapters.reduce((n, c) => n + wc(c.narrator_script), 0);
const problems = [];

// REPETITION, counted instead of merely asked for. The writer is told to say
// everything once and the editor is told repetition is the biggest defect —
// and nothing measured it, while the one rule that WAS enforced here was
// length. So a draft that runs out of story reaches the word count the only
// way left to it: by telling the same dates and sums again a chapter later.
// The 71-scene Boyd film shipped with 1941, 1952, 1962, 1966 and 1975 each
// told two to four times. Code finds them and the editor is handed the list;
// it is never a hard failure, only feedback.
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

// A fact here is a NUMBER — a year, a sum, a quantity. A name recurring is a
// protagonist; a number recurring is the same fact stated twice.
const FACT = /[$€£]\s?\d[\d.,]*(?:\s?(?:million|billion|mil|milioane|miliarde))?|\b\d[\d.,]*\s?(?:square feet|sq ft|kilometers|kilometres|km|miles|mph|percent|dollars|lei)\b|\b(?:1[0-9]{3}|20[0-9]{2})\b/gi;
const facts = new Map();
for (const c of chapters) {
  const re = new RegExp(FACT.source, 'gi');
  let f;
  while ((f = re.exec(norm(c.narrator_script)))) {
    const key = f[0].replace(/\s+/g, ' ').trim();
    const hit = facts.get(key) || { count: 0, chapters: new Set() };
    hit.count += 1;
    hit.chapters.add(c.chapter_number);
    facts.set(key, hit);
  }
}
const repeatedFacts = [...facts.entries()]
  .filter(([, h]) => h.count >= 3)
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 8)
  .map(([k, h]) => k + ' (' + h.count + ' times, chapters ' + [...h.chapters].sort((a, b) => a - b).join(', ') + ')');
if (repeatedFacts.length) problems.push('Told more than twice: ' + repeatedFacts.join('; ') + '. Each of these stays ONLY where it lands best and goes everywhere else; a later mention is a three-word reference, never a restatement. Replace what you cut with EVENTS from the spine, not with description.');

// Phrasing: six identical words in a row, twice, is a sentence that survived a
// copy whatever facts are in it. Overlapping windows of one repeat are folded
// together so the editor gets five distinct offenders, not five views of one.
const shingles = new Map();
for (const c of chapters) {
  const w = norm(c.narrator_script).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i + 6 <= w.length; i++) {
    const key = w.slice(i, i + 6).join(' ');
    const hit = shingles.get(key) || { count: 0 };
    hit.count += 1;
    shingles.set(key, hit);
  }
}
const phrases = [];
for (const [key, hit] of [...shingles.entries()].sort((a, b) => b[1].count - a[1].count)) {
  if (hit.count < 2 || phrases.length >= 5) continue;
  const head = key.split(' ').slice(0, 3).join(' ');
  if (phrases.some((p) => p.key.includes(head))) continue;
  phrases.push({ key, count: hit.count });
}
if (phrases.length) problems.push('Repeated verbatim: ' + phrases.map((p) => '"' + p.key + '" (' + p.count + ' times)').join('; ') + '. Rewrite or cut every later occurrence.');

// INVENTORY AND COMMENTARY — the writer's rules 3 and 5, counted the same way
// repetition now is. Rule 3 is EVENTS NOT INVENTORY and rule 5 forbids telling
// the viewer what the events mean; both were only ever requested, and four
// films out of five obey them while one does not. Measured over the last five
// films of 20+ scenes: 1.4 / 1.9 / 8.6 / 11.6 percent of sentences under four
// words with zero commentary phrases, against 24.9 percent and seven phrases
// on the Motivational one — object inventories ("Low ceiling. Green felt.
// Brass ashtrays. A wall clock.") and lines like "That is the correction."
// The thresholds sit in that gap on purpose: a film that writes scenes costs
// nothing and only the essay pays an editor pass.
//
// NEITHER CHECK RUNS ON A SILENT OR A DIALOGUE FILM. A cinematic script is an
// unspoken beat sheet, which is terse by design ("The black coupe snaps
// sideways into the hairpin"), and character dialogue is legitimately short.
// Firing on either would spend two editor passes correcting a film that is
// written exactly as it was asked to be. Read the same way `Voice Mode` reads
// it, from the same node, so the two cannot disagree about what a film is.
let category = '', multiVoice = 'off', castCount = 0;
try {
  const pf = ($('Fetch Project Record').first().json || {}).fields || {};
  const o = JSON.parse(pf['Editing Options'] || '{}') || {};
  category = String(o.category || '');
  multiVoice = String(o.multiVoiceMode || 'off');
  castCount = Array.isArray(o.cast) ? o.cast.length : 0;
} catch (e) {}
if (category !== 'cinematic' && !(multiVoice === 'characters' && castCount > 0)) {
  const FRAGMENT_PCT = 18;   // the essay is 24.9; the worst film that reads well is 11.6
  const FRAGMENT_MIN = 10;   // a ratio out of six sentences is noise, not a style
  const COMMENTARY_MAX = 2;  // every film that writes scenes scored zero
  // A sentence that tells the viewer what to think instead of showing the next
  // event. Every phrase here is one the writer prompt already bans, and none of
  // them appears in the four films that read as scenes.
  const COMMENTARY = /\b(?:that is (?:the|how|what|why)|this is (?:how|what|why)|the answer is|the lesson (?:is|here)|what (?:changes|matters|counts) is|the truth is|the point is|in many ways|the real (?:question|reason|story) is|and that is (?:the|how|what|why))\b/i;
  const sentencesOf = (s) => String(s || '').replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
  let sentences = 0, fragments = 0;
  const runs = [], commentary = [];
  for (const c of chapters) {
    const ss = sentencesOf(c.narrator_script);
    sentences += ss.length;
    // A RUN of three or more is the inventory signature, and it is reported as
    // evidence rather than used as a trigger: two of the good films carry one
    // deliberate triplet each ("Wheat bends. Earth trembles. Silence breaks.")
    // and must not be corrected for it. Density is what separates them.
    let run = [];
    for (const s of ss) {
      if (wc(s) <= 3) { fragments += 1; run.push(s); }
      else { if (run.length >= 3) runs.push(run.join(' ')); run = []; }
      if (COMMENTARY.test(norm(s))) commentary.push(s);
    }
    if (run.length >= 3) runs.push(run.join(' '));
  }
  const pct = sentences ? Math.round((fragments / sentences) * 1000) / 10 : 0;
  if (pct >= FRAGMENT_PCT && fragments >= FRAGMENT_MIN) problems.push('Inventory instead of events: ' + fragments + ' of ' + sentences + ' sentences (' + pct + '%) are under four words, against 9% or less on a film that reads as scenes.' + (runs.length ? ' Worst runs: ' + runs.slice(0, 3).map((r) => '"' + r + '"').join('; ') + '.' : '') + ' Turn each list of objects into one thing that HAPPENS in the scene, and keep a fragment only where it lands a beat.');
  if (commentary.length > COMMENTARY_MAX) problems.push('Telling the viewer what to think, ' + commentary.length + ' times: ' + commentary.slice(0, 4).map((s) => '"' + s + '"').join('; ') + '. Cut every one of them; the next event carries the meaning, and the viewer draws the conclusion.');

  // GLOSSARY, META, SIGNPOSTS — the three shapes of the "basic and friendly"
  // script, measured over the 14 most recent films before the thresholds
  // were set (2026-09-10). The Burj Al Arab explainer scored 3 definitions
  // ("A pile is a long structural element…"), 4 meta lines ("Only now does
  // the film move inside", "This is turning point four") and 11.9% of its
  // sentences opening on a steering connector ("So the question is…", "By
  // the end of this stage…"); the films that read as stories scored 0, 0-2
  // and 0-6.8%. Meta lines are a defect at any count — "The camera returned
  // again and again" narrated a film about Ceaușescu and "This chapter,
  // 'Internal Causes', unveils" narrated Rome — so one is enough to fire.
  const DEFINITION_MAX = 1;   // two glossary sentences is an explainer, not a film
  const SIGNPOST_PCT = 10;    // Burj 11.9; Boyd 8.9; the good films 0-6.8
  const SIGNPOST_MIN = 8;
  const DEFINITION = /^(?:a|an)\s+[a-z][a-z\s-]{1,40}?\s+(?:is|are)\s+(?:a|an|the|any|one)\s+[a-z][a-z\s-]{2,}\b(?:that|which|who|where|used|driven|placed|made|designed|built|whose)\b|^(?:a|an|the)?\s*[a-z][a-z\s-]{1,30}?\s+(?:means|refers to|is called|is known as|is defined as)\b|^(?:in other words|put simply|simply put|that means|this means)\b/i;
  const META = /\b(?:the (?:film|camera|viewer|viewers|documentary|video|audience|narration|narrator|story we|chapter)|this (?:chapter|film|video|documentary|story)|turning point|in this (?:film|video|story|chapter)|as we (?:see|follow|watch|will see)|we (?:now )?(?:see|watch|follow|turn)|let us|let's|our story|the next chapter|before we|as you (?:watch|can see|will see))\b/i;
  const SIGNPOST = /^(?:now|so|then|next|at this point|by (?:the end of|now)|this is where|here|from here|meanwhile|in this (?:stage|phase)|with that|and so|that said|as a result)\b[,\s]/i;
  const definitions = [], metaLines = [], signposts = [];
  for (const c of chapters) {
    for (const s of sentencesOf(c.narrator_script)) {
      const n = norm(s);
      if (DEFINITION.test(n)) definitions.push(s);
      if (META.test(n)) metaLines.push(s);
      if (SIGNPOST.test(n)) signposts.push(s);
    }
  }
  if (definitions.length > DEFINITION_MAX) problems.push('Glossary instead of story, ' + definitions.length + ' definitions: ' + definitions.slice(0, 4).map((s) => '"' + s + '"').join('; ') + '. Rewrite each as the thing in ACTION with its number ("crews drive 230 piles forty metres down") — never "X is a Y that…".');
  if (metaLines.length) problems.push('The narration talks about the film instead of telling it, ' + metaLines.length + ' time(s): ' + metaLines.slice(0, 4).map((s) => '"' + s + '"').join('; ') + '. Remove every mention of the film, the camera, the viewer, a chapter or a turning point; say what HAPPENS instead.');
  const spct = sentences ? Math.round((signposts.length / sentences) * 1000) / 10 : 0;
  if (spct >= SIGNPOST_PCT && signposts.length >= SIGNPOST_MIN) problems.push('Signposting: ' + signposts.length + ' of ' + sentences + ' sentences (' + spct + '%) open on a steering connector — ' + signposts.slice(0, 4).map((s) => '"' + s.split(/\s+/).slice(0, 6).join(' ') + '…"').join('; ') + '. Cut the connector and let the order carry the logic; a beat opens on a particular, never on "Now", "So", "Then" or "At this point".');

  // THE ENDING — the producer's "se termina brusc parca fara sens sau concluzie".
  // Measured on the six most recent finished films of 2+ minutes: FIVE of them
  // end on a trailing subordinate clause that only says where things rest —
  // "…while Paris gathers around him", "…while the shop stays open behind you",
  // "…while hidden light fills the water". The sixth, the one that actually
  // lands, ends on a statement. That is not a coincidence of style: the outline
  // used to be asked for an ending as "the last thing the viewer sees and
  // understands", i.e. a camera position plus a feeling — and rule 10 forbids
  // the narration from saying either, so the plan's ending could only ever
  // reach the film as a final SHOT. The outline now asks for the closing EVENT
  // and its consequence; this is the check that says whether one arrived.
  //
  // Feedback, never a hard failure, like everything else here — and skipped for
  // a silent or a dialogue film by the same gate as the checks above, because a
  // beat sheet legitimately ends on an image. Both languages the pipeline
  // writes in: an English-only pattern is the bug the motif validator already
  // shipped once.
  const STOPS_ON_SHOT = /[,\s](?:while|as|în timp ce|in timp ce|pe când|pe cand|în vreme ce)\s+\S+(?:\s+\S+){2,}\s*[.!?…]?\s*$/i;
  const lastChapter = chapters[chapters.length - 1];
  if (lastChapter) {
    const ss = sentencesOf(lastChapter.narrator_script);
    const lastSentence = ss[ss.length - 1] || '';
    if (STOPS_ON_SHOT.test(lastSentence)) {
      problems.push('The film stops instead of ending: the last sentence is a camera line — "' + lastSentence + '". Replace the final two or three sentences of the last chapter with a CLOSING BEAT: the last event and the consequence that outlives it, answering the question the film opened with, in this film\'s own particulars. It is the one place meaning may be stated aloud — still not a summary of the chapters, not a moral addressed to the viewer, and not a new fact.');
    }
  }
}
if (chapters.length !== planned.length) problems.push('The draft has ' + chapters.length + ' [CHAPTER n: title] blocks but the plan has ' + planned.length + ' chapters (' + planned.map(c => c.chapter_number + ': ' + c.chapter_title).join('; ') + '). Output exactly one block per planned chapter, in order, with those numbers.');
const thin = chapters.filter(c => wc(c.narrator_script) < 15);
if (thin.length) problems.push('Chapter(s) ' + thin.map(c => c.chapter_number).join(', ') + ' are empty or under 15 words.');
if (words < min) problems.push('The narration is ' + words + ' words; it must be at least ' + min + ' (target ' + target + '). Add EVENTS from the spine and the chapter plan — no description, no repetition.');
if (words > max) problems.push('The narration is ' + words + ' words; it must be at most ' + max + ' (target ' + target + '). Cut redundancy and commentary first.');
// MUST-INCLUDE — the producer's mandatory points, verified rather than
// requested (an instruction in a prompt is not a constraint; this is).
// A point counts as present when at least half of its meaningful terms
// (4+ letters, diacritics folded) appear anywhere in the narration.
try {
  const eo = JSON.parse((($('Fetch Project Record').first().json || {}).fields || {})['Editing Options'] || '{}') || {};
  const must = (Array.isArray(eo.mustInclude) ? eo.mustInclude : []).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
  if (must.length) {
    const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const hay = fold(text);
    const STOP = new Set(['care','este','sunt','pentru','despre','cand','când','unde','cum','fiind','avea','with','that','this','from','have','been','what','when','where','into','about','their','there','which','vrea','vreau','moment','momentul','scena','scene']);
    for (const point of must) {
      const terms = [...new Set(fold(point).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w)))];
      if (!terms.length) continue;
      const hit = terms.filter(t => hay.includes(t)).length;
      if (hit < Math.ceil(terms.length / 2)) {
        problems.push('REQUIRED POINT MISSING: the producer marked this as mandatory and the draft does not contain it — "' + point + '". Work it into the chapter where it naturally belongs, as a real event or revelation, without adding length elsewhere.');
      }
    }
  }
} catch (e) { /* an unreadable project record must not kill the guard */ }
const attempt = $runIndex + 1;
const MAX_RETRIES = 2;
if (problems.length && attempt <= MAX_RETRIES) {
  console.log('NARRATION GUARD retry ' + attempt + '/' + MAX_RETRIES + ' (' + words + ' words): ' + problems.join(' | '));
  return [{ json: { output: text, editorFeedback: problems.join('\n'), retry: true, attempt } }];
}
if (!chapters.length) throw new Error('The narration has no [CHAPTER n: title] blocks after ' + MAX_RETRIES + ' editor passes. Head: ' + text.slice(0, 300));
if (problems.length) console.log('NARRATION GUARD accepting after ' + MAX_RETRIES + ' retries with: ' + problems.join(' | '));
console.log('NARRATION GUARD ok: ' + chapters.length + ' chapters, ' + words + ' words (target ' + target + ', window ' + min + '-' + max + ')');
return [{ json: { output: text, retry: false, chapters, words, target, min, max } }];