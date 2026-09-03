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
if (chapters.length !== planned.length) problems.push('The draft has ' + chapters.length + ' [CHAPTER n: title] blocks but the plan has ' + planned.length + ' chapters (' + planned.map(c => c.chapter_number + ': ' + c.chapter_title).join('; ') + '). Output exactly one block per planned chapter, in order, with those numbers.');
const thin = chapters.filter(c => wc(c.narrator_script) < 15);
if (thin.length) problems.push('Chapter(s) ' + thin.map(c => c.chapter_number).join(', ') + ' are empty or under 15 words.');
if (words < min) problems.push('The narration is ' + words + ' words; it must be at least ' + min + ' (target ' + target + '). Add EVENTS from the spine and the chapter plan — no description, no repetition.');
if (words > max) problems.push('The narration is ' + words + ' words; it must be at most ' + max + ' (target ' + target + '). Cut redundancy and commentary first.');
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
