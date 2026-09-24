// The shot list, checked by code before it becomes the script of a Cinematic
// film (2026-09-23, db/port/cinematic-mode/README.md).
//
// WHY A CINEMATIC FILM HAS ITS OWN WRITING PATH. It used to run the Story
// chain — outline, narration, editor — with a paragraph appended that said
// "no voice". The outline was forbidden to think in pictures ("a STORY plan,
// not a shot list — never say how anything looks, moves or is lit") and built
// a protagonist/want/obstacle spine; the editor, which never received the
// silent-film rules, then replaced every sentence that described the picture
// with "the intent, the stake, the cost". So the Hobbit film of 2026-09-20 was
// written as narrated prose ("By the late Third Age, most hobbits build with
// wood or brick, so every stroke here must justify the older way") and then
// shown with the voice switched off. The producer's words: a story with the
// dialogue taken out. Now `Cinematic?` sends the film to `Cine Treatment` (a
// director's plan: concept, visual arc, sequences with shot counts) and
// `Cine Shot List` (one shot per line), and this node is what the editor and
// Narration Guard are on the Story path.
//
// THE SHAPE IT EMITS IS `Narration Guard`'S SHAPE — {output, retry, chapters,
// words, target, min, max} — because `FC Prep` and everything after it read
// `$json`, and `Combine Chapters` reads `$json.chapters`. `min` is 0: a shot
// list has no word floor, so Deep Search's "shorter than ordered" note (a
// statement about narration) can never fire on one.
//
// ONE RETRY, THEN REPAIR. The first failure goes back to `Cine Shot List`
// with the problems listed; the second pass is accepted and repaired by code,
// because a film with one sequence a shot short is far better than no film.
// The repairs only ever REMOVE (numbering, markdown, surplus shots) — nothing
// is invented here.
const SEP = ' · ';
const wc = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const attempt = typeof $runIndex === 'number' ? $runIndex : 0;
const MAX_RETRIES = 1;

const treatment = ($('Cine Treatment').first().json || {}).output || {};
const planned = (Array.isArray(treatment.chapters) ? treatment.chapters : [])
  .map((c, i) => ({
    chapter_number: Number(c.chapter_number) || i + 1,
    chapter_title: String(c.chapter_title || '').trim(),
    shots: Math.max(1, Math.round(Number(c.shot_count) || 0)),
  }));
const rp = $('Receive Project Data').first().json;
// A Cinematic film has no hook (2026-09-23), so no scene is held back for
// one: the whole length is shots.
const ordered = Math.max(1, Math.ceil(Number(rp.Lenght || 64) / 8));

// ---- parse --------------------------------------------------------------
// Tolerant on purpose: a marker in bold, a numbered or bulleted line, a
// "Shot 3:" prefix and a blank line inside a sequence are all things a model
// does while meaning the right thing, and none of them is worth a retry.
const raw = String($json.output || '').replace(/\r\n/g, '\n');
const MARK = /^\s*\**\s*\[\s*CHAPTER\s+(\d+)\s*:\s*([^\]]*)\]\s*\**\s*$/i;
const clean = (l) =>
  l
    .replace(/^\s*(?:[-*•]+|\d+\s*[.)]|shot\s*\d+\s*[:.)-])\s*/i, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const written = [];
let cur = null;
for (const line of raw.split('\n')) {
  const m = line.match(MARK);
  if (m) {
    cur = { chapter_number: Number(m[1]), chapter_title: m[2].trim(), lines: [] };
    written.push(cur);
    continue;
  }
  const l = clean(line);
  if (!l) continue;
  if (!cur) {
    // Shots before any marker: the model forgot the first one. They belong
    // to sequence 1 — throwing them away would cut the film's opening.
    cur = { chapter_number: planned.length ? planned[0].chapter_number : 1, chapter_title: planned.length ? planned[0].chapter_title : '', lines: [] };
    written.push(cur);
  }
  cur.lines.push(l);
}
const chapters = written.filter((c) => c.lines.length);

// ---- check --------------------------------------------------------------
const problems = [];
if (!chapters.length) problems.push('No shots were found. Every sequence opens with its [CHAPTER n: title] marker line, followed by its shot lines.');
if (planned.length && chapters.length !== planned.length) {
  problems.push(`The treatment has ${planned.length} sequence(s) and the shot list has ${chapters.length}. Write every sequence, each under its own [CHAPTER n: title] marker, in order.`);
}
for (const p of planned) {
  const c = chapters.find((x) => x.chapter_number === p.chapter_number);
  if (!c) continue;
  if (c.lines.length !== p.shots) {
    problems.push(`Sequence ${p.chapter_number} has ${c.lines.length} shot line(s); the treatment gives it exactly ${p.shots}. One line is one 8-second shot, so the count is the film's running time.`);
  }
}
// Words only a PERSON does. "whisper" was here and came out after probe
// 16583, where it flagged "Sound: drone hover, scanner whisper" twice — a
// machine's sound, the kind of line this film is supposed to have.
const SPEECH = /["“”„]|\b(says?|said|tells?|told|asks?|asked|shouts?|shouted|replies|replied|calls out|speaks?|spoke|narrat\w*|voice-?over)\b/i;
// Lengths are measured where they mean something. The whole line carries
// four fields of framing, light and sound around the action and runs 42-70
// words on a good list (probe 16582), so a ceiling on the WHOLE line only
// punished the richest shots; the action field is where "two shots in one
// line" shows, and a "then" inside it is the same fault named outright —
// the segmenter's own rule 6b refuses a chained action, and Veo cannot play
// one in eight seconds.
const THEN = /\bthen\b/i;
const badForm = [], speech = [], short = [], long = [], chained = [];
chapters.forEach((c) =>
  c.lines.forEach((l, i) => {
    const tag = `sequence ${c.chapter_number}, shot ${i + 1}`;
    const fields = l.split(SEP);
    if (fields.length < 5 || !/^sound\s*:/i.test(fields[fields.length - 1].trim())) badForm.push(tag);
    if (SPEECH.test(l)) speech.push(tag);
    const w = wc(l);
    const action = fields.length >= 5 ? fields[2] : l;
    if (w < 14) short.push(tag);
    if (w > 90 || wc(action) > 40) long.push(tag);
    if (THEN.test(action)) chained.push(tag);
  }),
);
const list = (a) => a.slice(0, 6).join('; ') + (a.length > 6 ? ` and ${a.length - 6} more` : '');
if (badForm.length) problems.push(`Not in the five-field form "SHOT SIZE AND ANGLE · CAMERA MOVE · WHAT HAPPENS · LIGHT · Sound: …": ${list(badForm)}.`);
if (speech.length) problems.push(`Speech or narration in a silent film (a quote, or someone saying, asking or narrating): ${list(speech)}. Show it as an action instead.`);
if (short.length) problems.push(`Too thin to shoot (under 14 words): ${list(short)}. Name the subject, the action, where it happens and the light.`);
if (long.length) problems.push(`More than one shot's worth (an action over 40 words, or a line over 90): ${list(long)}. One line is one image with one movement.`);
if (chained.length) problems.push(`Two actions chained with "then": ${list(chained)}. Eight seconds hold one action — keep the one that matters, or give each its own line.`);

const total = chapters.reduce((n, c) => n + c.lines.length, 0);
console.log(`CINE GUARD attempt ${attempt + 1}: ${chapters.length} sequence(s), ${total} shot(s) for ${ordered} ordered` + (problems.length ? `; ${problems.length} problem(s)` : '; clean'));
if (problems.length) problems.forEach((p) => console.log('  - ' + p));

if (problems.length && attempt < MAX_RETRIES && chapters.length) {
  return [{ json: { output: raw, guardFeedback: problems.map((p, i) => `${i + 1}. ${p}`).join('\n'), retry: true, attempt } }];
}
if (!chapters.length) throw new Error('Cine Guard: the shot list holds no shots — ' + (raw ? raw.slice(0, 200) : 'the writer returned nothing'));

// ---- repair (second pass only reaches here with problems) --------------
// A sequence longer than its plan loses shots from its MIDDLE: the first shot
// is the OPENS ON match cut and the last is the ENDS WITH frame the next
// sequence answers, and both are load-bearing. A sequence shorter than its
// plan stays short — a shorter film is correct, a padded one is not.
for (const c of chapters) {
  const p = planned.find((x) => x.chapter_number === c.chapter_number);
  if (p && c.lines.length > p.shots) {
    const cut = c.lines.length - p.shots;
    c.lines = p.shots === 1 ? [c.lines[c.lines.length - 1]] : c.lines.slice(0, p.shots - 1).concat(c.lines.slice(-1));
    console.log(`CINE GUARD: sequence ${c.chapter_number} cut by ${cut} surplus shot(s) from its middle`);
  }
  if (!c.chapter_title && p) c.chapter_title = p.chapter_title;
}

const out = chapters.map((c) => ({ chapter_number: c.chapter_number, chapter_title: c.chapter_title, narrator_script: c.lines.join('\n') }));
const output = out.map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title}]\n${c.narrator_script}`).join('\n\n');
const words = out.reduce((n, c) => n + wc(c.narrator_script), 0);
return [{ json: { output, retry: false, chapters: out, words, target: words, min: 0, max: words, cine: { ordered, shots: out.reduce((n, c) => n + c.narrator_script.split('\n').length, 0), attempts: attempt + 1, accepted: problems.length ? problems : [] } } }];
