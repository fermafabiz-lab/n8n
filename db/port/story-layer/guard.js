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
