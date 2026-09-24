#!/usr/bin/env node
//
// check.mjs — run Claude Scripting's `Parse Approved From Airtable` against
// fixtures, with no n8n and no network.
//
//     node db/port/script-headers/check.mjs
//
// WHY THIS EXISTS. This node decides what the film is MADE OF. It used to
// answer "the old script" whenever the approved text had no [CHAPTER n: title]
// marker lines, and it answered it silently — the producer approved a new
// script and watched a film of the old one. The branch that did it is the
// branch no happy-path run ever takes, which is exactly the kind that rots.
//
// The body is read from paste/, the committed source the live node was pasted
// from. This does NOT prove the live node matches the file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const BODY = readFileSync(join(here, 'paste', 'Parse Approved From Airtable.js'), 'utf8');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
};

function run({ content, chapters }) {
  const logs = [];
  const fn = new Function('$json', 'console', BODY);
  const out = fn(
    { id: 'recScript1', fields: { 'Script Content': content, 'script chapters': JSON.stringify(chapters ?? []) } },
    { log: (...a) => logs.push(a.join(' ')) },
  );
  return { ...out[0].json, logs };
}

const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const all = (r) => r.chapters.map((c) => c.narrator_script).join('\n');

// The real shape of the failure, from recCrWO2ummZA4Ba4 (2026-09-24).
const STORED = [
  { chapter_number: 0, chapter_title: 'HOOK', chapter_summary: 'old beats', narrator_script: 'Turația motorului: 5.000 RPM controlat.\nECU-ul taie combustibil la limită calibrată.' },
  { chapter_number: 1, chapter_title: 'Pragul pe care ECU-ul îl poate apăra', chapter_summary: 'old beats', narrator_script: 'Tehnicianul explică plafonul de 5.000 RPM. '.repeat(8) },
  { chapter_number: 2, chapter_title: 'Ce se rupe primul', chapter_summary: 'old beats', narrator_script: 'Supapele și bielele la 5.000 RPM. '.repeat(8) },
];
const REPLACED = [
  'Fiecare motor este proiectat să funcționeze într-un anumit interval de turații.',
  'La 7.000 RPM, motorul tău face peste 100 de rotații în fiecare secundă.',
  'În interior, pistoanele își schimbă direcția de peste 200 de ori pe secundă.',
  'Calculatorul motorului taie alimentarea înainte ca piesele să cedeze.',
].join('\n\n');

console.log('The script the producer approved is the film');
const replaced = run({ content: REPLACED, chapters: STORED });
ok('a replacement with no markers is NOT answered with the old chapters',
  !all(replaced).includes('5.000'), all(replaced).slice(0, 80));
ok('…and every word comes from the approved text', all(replaced).includes('7.000'));
ok('…and it says so in the log, loudly enough to grep',
  replaced.logs.some((l) => /^SCRIPT NO MARKERS recScript1: /.test(l)));
ok('…and the Story Bible is rebuilt, so the pictures follow the new story',
  replaced.scriptChanged === true);
ok('…and no old beats ride along in a summary',
  replaced.chapters.every((c) => c.chapter_summary === ''));

console.log('The shape of the old script is kept, its words are not');
ok('the chapter count follows the skeleton', replaced.chapters.length === 3);
ok('the numbers are the skeleton\'s, hook included',
  replaced.chapters.map((c) => c.chapter_number).join(',') === '0,1,2');
// A chapter title is printed on the chapter card (remotion/src/FinalVideo.tsx
// reads props.chapterTitles), so keeping the old one would put old words on
// screen over the new film. Empty lets the render fall back to a key line from
// the scene's own narration — the producer's text.
ok('the old titles are dropped, because a title is words on screen',
  replaced.chapters.every((c) => c.chapter_title === ''));
ok('a two-line hook stays short rather than taking a third of the film',
  words(replaced.chapters[0].narrator_script) < words(replaced.chapters[1].narrator_script));
ok('nothing is dropped on the floor',
  REPLACED.split(/\n\s*\n/).every((p) => all(replaced).includes(p.trim())));
ok('no chapter is cut inside a sentence',
  replaced.chapters.every((c) => /[.!?]$/.test(c.narrator_script.trim())));

console.log('The paths that already worked still work');
const marked = run({
  content: '[CHAPTER 0: HOOK]\nTuratia motorului: 5.000 RPM controlat.\n\n[CHAPTER 1: Pragul]\nPistoanele și bielele cedează dincolo de șapte mii de rotații.',
  chapters: STORED,
});
ok('markers are parsed as before', marked.chapters.length === 2 && marked.chapters[0].chapter_title === 'HOOK');
ok('an untouched chapter keeps its beats',
  run({
    content: '[CHAPTER 1: Pragul]\n' + STORED[1].narrator_script,
    chapters: STORED,
  }).chapters[0].chapter_summary === 'old beats');
// Note the similarity is over word SETS, so a chapter rewritten with the same
// vocabulary counts as unchanged — this fixture uses different words on
// purpose.
ok('a chapter rewritten in other words drops them',
  marked.chapters[1].chapter_summary === '');
const empty = run({ content: '', chapters: STORED });
ok('an empty approval is the one case that keeps the stored chapters', empty.chapters.length === 3);
ok('…and that case is logged too', empty.logs.some((l) => /^SCRIPT EMPTY /.test(l)));

console.log('Shapes that must not throw');
ok('one unbroken paragraph still becomes chapters',
  run({ content: 'Prima frază. A doua frază. A treia frază. A patra frază.', chapters: STORED }).chapters.length >= 1);
ok('a replacement with no stored skeleton at all becomes one chapter',
  (() => { const r = run({ content: REPLACED, chapters: [] }); return r.chapters.length === 1 && r.chapters[0].chapter_number === 1; })());
ok('fewer paragraphs than chapters is not a crash',
  run({ content: 'O singură frază scurtă.', chapters: STORED }).chapters.length >= 1);

// The site's half: it cannot stop a producer from replacing the text (nor
// should it — the fix above makes that safe), but it must SAY what will
// happen. A grep, because the failure being guarded is that the warning was
// quietly deleted.
const panel = readFileSync(join(here, '..', '..', '..', 'platform', 'components', 'ScriptReview.tsx'), 'utf8');
console.log('The panel warns before the producer approves');
ok('it still tests the text for the markers', /\\\[CHAPTER\\s\+\\d\+\\s\*:/.test(panel));
ok('…and only when the stored text had them and the draft does not',
  /MARKER\.test\(content\)\s*&&\s*!MARKER\.test\(text\)/.test(panel));
ok('…and it says approving is still safe rather than blocking it',
  /You can still\s*\n?\s*approve it/.test(panel));

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll script-header checks passed.');
process.exit(failures ? 1 : 0);
