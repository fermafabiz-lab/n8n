// PROBE ONLY — stands in for the live `DS Apply` in a throwaway workflow, so the
// real `DS Fill` prompt and the real `DS Fill Apply` guard can run against a
// real film, on the real model, BEFORE the top-up is published. Named
// `DS Apply` in that workflow because `DS Fill Apply` reads it by that name.
//
// It builds the same `fill` block `DS Apply` builds, from a `Load` node that
// reads the film's current script, its research pack and the refs its last
// report cited. Nothing here writes anywhere.
const row = $json || {};
const text = String(row.script || '').trim();

// DS Prep's parse, verbatim in effect: `[CHAPTER n: title]` markers.
const chapters = [];
const re = /^\[CHAPTER\s+(\d+):\s*([^\]]*)\]\s*$/gm;
const marks = [];
let m;
while ((m = re.exec(text)) !== null) marks.push({ n: Number(m[1]), title: m[2].trim(), from: m.index, body: m.index + m[0].length });
marks.forEach((mk, i) => {
  const end = i + 1 < marks.length ? marks[i + 1].from : text.length;
  chapters.push({ chapter_number: mk.n, chapter_title: mk.title, narrator_script: text.slice(mk.body, end).trim() });
});

let pack = [];
try {
  pack = Array.isArray(row.claims) ? row.claims : JSON.parse(row.claims || '[]');
} catch (e) {
  pack = [];
}
const packList = pack
  .map((c) => `${c.ref}. ${c.claim} [${c.source}${c.date && c.date !== 'n/a' ? ', ' + c.date : ''} — ${c.url}]`)
  .join('\n');

const wc = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const bodyNow = chapters.filter((c) => c.chapter_number !== 0).reduce((n, c) => n + wc(c.narrator_script), 0);

// THE LENGTH BEFORE DEEP SEARCH, for this one film, from the refusal the old
// valve printed on 2026-09-23: "chapter 1 went from 178 to 128 words". Chapter 1
// was its only body chapter. Nothing recorded it — that is what `preCheckWords`
// fixes from now on.
const preCheckWords = Number(row.pre_check_words) || 178;
const gapWords = Math.max(0, preCheckWords - bodyNow);
const usedRefs = [
  ...new Set(
    String(row.refs || '')
      .split(/[^A-Za-z0-9]+/)
      .filter((r) => /^[A-Za-z]*\d+$/.test(r))
      .map((r) => r.toUpperCase()),
  ),
];
const script = chapters.map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title || ''}]\n${c.narrator_script}`).join('\n\n');

return [
  {
    json: {
      projectId: row.project_id,
      projectName: row.project_name,
      scriptChanged: false,
      hookChanged: false,
      script,
      fcReport: { rerun: true, preCheckWords },
      fcReport64: '',
      script64: '',
      editing64: '',
      fill: {
        run: gapWords >= 25,
        gapWords,
        preCheckWords,
        nowWords: bodyNow,
        min: 133,
        narration: script,
        packList,
        usedRefs,
        chapters,
      },
    },
  },
];
