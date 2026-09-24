// The approved script, turned back into chapters.
//
// THE ONE RULE HERE: the approved TEXT is the film. The stored `script
// chapters` JSON is the structure the pipeline built earlier, and its words
// are the OLD film — they may be used as a skeleton, never as content.
//
// This node broke that rule until 2026-09-24 and the failure was silent. It
// parsed `[CHAPTER n: title]` markers out of the approved text, and when it
// found none it fell through to `chapters = original.map(...)` — the old
// chapters, words and all. So a producer who REPLACED the script (pasting
// their own text, or an AI rewrite that dropped the marker lines) approved a
// new script and got scenes, images, voice and a finished film made from the
// old one. Nothing errored, nothing logged, and the only way to notice was to
// watch the film. Measured on recCrWO2ummZA4Ba4: content said 7.000 RPM, the
// stored chapters said 5.000, and all 12 scenes said 5.000.
const rec = $json;
const fields = rec.fields || {};
const scriptRef = String(rec.id || '?');
const editedText = String(fields['Script Content'] || '').replace(/\r\n/g, '\n').trim();
let original = [];
try { original = JSON.parse(fields['script chapters'] || '[]'); if (!Array.isArray(original)) original = []; } catch (e) { original = []; }

const wordSet = (s) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2));
const similarity = (a, b) => {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
};
const countWords = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

// 1. The happy path — the text still carries its marker lines.
//
// A chapter's original summary (story beats, ENDS WITH / LEADS INTO) is only
// reusable if the narration is still essentially the SAME text. When the user
// edited or fully regenerated the script, keeping the old summary made
// segmentation blend the OLD story's beats into the new scenes (seen in
// production: rewritten script, final video still contained old-script
// content). Similarity = word-overlap ratio; below 0.8 the summary is dropped
// and segmentation follows the narration alone.
let chapters = [];
let parsedFrom = 'markers';
if (editedText) {
  const blocks = editedText.split(/\n(?=\[CHAPTER\s+\d+\s*:)/i).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const h = block.match(/^\[CHAPTER\s+(\d+)\s*:\s*([^\]]*)\]\s*\n?/i);
    if (!h) continue;
    const num = parseInt(h[1], 10);
    const title = h[2].trim();
    const script = block.slice(h[0].length).trim();
    const orig = original.find(c => c.chapter_number === num) || {};
    const keepSummary = similarity(orig.narrator_script, script) >= 0.8;
    chapters.push({
      chapter_number: num,
      chapter_title: title,
      chapter_summary: keepSummary ? (orig.chapter_summary || '') : '',
      narrator_script: script,
    });
  }
}

// 2. There IS an approved text and it has no markers in it.
//
// This is the case that used to silently serve the old film. The producer's
// words are the only content there is now, so they are cut into the old
// chapters' SHAPE: same numbers, same titles, same relative lengths (a
// two-line hook stays a two-line hook), and every summary dropped because the
// beats they describe belong to a story that no longer exists.
//
// The cut only ever falls between the producer's own paragraphs — a chapter
// break in the middle of a sentence would be a new kind of silent damage.
// Prose with no blank lines falls back to lines, then to sentences.
const spreadOverSkeleton = (text, skeleton) => {
  let blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length < 2) blocks = text.split(/\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length < 2) blocks = (text.match(/[^.!?]+[.!?]+["'”’)\]]*\s*/g) || [text]).map((b) => b.trim()).filter(Boolean);
  const slots = (skeleton.length ? skeleton.slice() : [{ chapter_number: 1, chapter_title: '' }])
    .sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0));
  const n = Math.min(slots.length, blocks.length);
  const oldWords = slots.slice(0, n).map((c) => countWords(c.narrator_script) || 1);
  const totalOld = oldWords.reduce((a, b) => a + b, 0) || n;
  const totalNew = countWords(text);
  const want = oldWords.map((w) => Math.max(1, Math.round((totalNew * w) / totalOld)));
  const out = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const remaining = n - k - 1;
    const taken = [blocks[i++]];
    if (k === n - 1) {
      while (i < blocks.length) taken.push(blocks[i++]);
    } else {
      while (i < blocks.length && blocks.length - i > remaining && countWords(taken.join(' ')) < want[k]) {
        taken.push(blocks[i++]);
      }
    }
    out.push({
      chapter_number: slots[k].chapter_number,
      chapter_title: slots[k].chapter_title || '',
      chapter_summary: '',
      narrator_script: taken.join('\n\n'),
    });
  }
  return out;
};

if (chapters.length === 0 && editedText) {
  parsedFrom = 'plain';
  chapters = spreadOverSkeleton(editedText, original);
  console.log('SCRIPT NO MARKERS ' + scriptRef + ': the approved text carries no [CHAPTER n: title] lines, so ' +
    chapters.length + ' chapter(s) were rebuilt FROM THAT TEXT (' + countWords(editedText) + ' words). ' +
    'The stored chapters were used for numbers and titles only — none of their words reached the film.');
}

// 3. Nothing was approved at all. This is the only case where the previous
// chapters are still the best answer, and it says so out loud.
if (chapters.length === 0) {
  parsedFrom = 'stored';
  chapters = original.map(c => ({ chapter_number: c.chapter_number, chapter_title: c.chapter_title, chapter_summary: c.chapter_summary || '', narrator_script: c.narrator_script }));
  console.log('SCRIPT EMPTY ' + scriptRef + ': the approved text is empty, keeping the ' + chapters.length + ' stored chapter(s).');
}

chapters.sort((a, b) => a.chapter_number - b.chapter_number);
if (!chapters.length) throw new Error('No chapters found after approval.');

// The Story Bible (characters/locations pasted into every image prompt) was
// generated from the ORIGINAL script. If the approved narration diverged
// substantially, the bible must be rebuilt or the visuals tell the old
// story while the audio tells the new one. A script that arrived without
// markers is a replacement by definition, so it never has to argue the point.
const origAll = original.map(c => c.narrator_script || '').join(' ');
const editedAll = chapters.map(c => c.narrator_script || '').join(' ');
const scriptChanged = parsedFrom === 'plain' || (original.length > 0 && similarity(origAll, editedAll) < 0.8);
console.log('SCRIPT PARSE ' + scriptRef + ': ' + parsedFrom + ', ' + chapters.length + ' chapters, ' +
  countWords(editedAll) + ' words, scriptChanged=' + scriptChanged);
return [{ json: { chapters, scriptChanged } }];
