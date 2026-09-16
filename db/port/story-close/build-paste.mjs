// Builds paste/ from original/ — every edit is an INSERTION into the live
// body, made here so the diff is exactly what this file says and nothing
// else. Run it, then `node --check` the .js outputs, then update_workflow
// from paste/. Re-running is idempotent (it always starts from original/).
//
//   node db/port/story-close/build-paste.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const orig = (f) => fs.readFileSync(path.join(dir, 'original', f), 'utf8');
const out = (f, s) => fs.writeFileSync(path.join(dir, 'paste', f), s);

/** Insert `add` right after the ONE line matching `after`; throw otherwise. */
function insertAfter(src, after, add, label) {
  const lines = src.split('\n');
  const hits = lines.map((l, i) => (after.test(l) ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) throw new Error(`${label}: expected exactly one line matching ${after}, found ${hits.length}`);
  lines.splice(hits[0] + 1, 0, add);
  return lines.join('\n');
}
/** Replace the ONE occurrence of `from` with `to`; throw otherwise. */
function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected exactly one occurrence of ${JSON.stringify(from.slice(0, 60))}, found ${n}`);
  return src.replace(from, to);
}

// ---------------------------------------------------------------------------
// Voice Mode — one owner for the resolution rules, four consumers.
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Voice_Mode.js');
  const block = `
// ---- The resolution (deznodământ), 2026-09-16 ----
//
// A story is not over when its climax is. Measured on the films written after
// the 09-12 ending fix: the Lego chase ends on the arrest and the clay
// builders' film ends with two of the three builders shut inside a house —
// both stop AT the climax, and the producer's "se termina brusc, fara
// concluzie" is exactly that. The 09-12 guard only catches a trailing camera
// clause; nothing asked for what comes AFTER the last turning point.
//
// So a Story and a Kids story get a resolution beat of their own: the final
// situation of the characters, set after the climax in time, written as the
// LAST PARAGRAPH of the last chapter. Narration Guard checks the paragraph is
// there and Plan Scene Splits gives it its own scene. Composed here, once,
// because the outline, the writer, the editor and the segmenter all need the
// same idea in their own words. Documentary and Cinematic are untouched: a
// documentary legitimately closes on an open question, a silent film on a
// shot. An absent category is a Story — that is the site's default.
//
// For a kids film the resolution is WARM whatever the tone's structure says:
// both kids films so far were made under the Dark profile, whose beat 5 is
// "Aftermath, not resolution", and that beat won over kids rule (e) because
// the structure shapes the outline and rule (e) only reaches the writer.
const closingWanted = !cinematic && (category === '' || category === 'story' || category === 'kids');
const closingOutline = !closingWanted ? '' : \`
THE RESOLUTION — a story is not over when its climax is. AFTER the last turning point comes the resolution: the final situation of the characters. Plan it as its own beat, the last in the film, set later in time than the climax (that evening, the next morning, a season on): where each main character ends up, what is settled, what they keep or have lost, what is different now that the conflict is over. It answers the throughline; it belongs to no turning point and is never the climax retold. Put it in the spine's "ending" field, and give the LAST chapter a third closing line, RESOLVES WITH, after its LEADS INTO line (see below). The resolution takes one scene of the ceiling above: a story that needs its last scene for its ending drops one escalation, never the ending.\${kids ? \`
FOR A CHILDREN'S STORY the resolution is WARM, and this REPLACES beat 5 of the dramatic structure above whatever it says: the hero is safe and home, the small problem is mended, everyone is accounted for — nobody is left behind, lost or shut away, and nothing stays wrong — and the gentle lesson is worn lightly in the last line.\` : ''}
\`;
const closingOutlineLine = !closingWanted ? '' : \`RESOLVES WITH: <LAST chapter only, a third line: the final situation of the characters AFTER the climax — 2-3 sentences the narration will say out loud, a moment later in time than the climax, never the climax itself\${kids ? '; warm, everyone safe and together, the gentle lesson in the last sentence' : ''}>\`;
const closingNarration = !closingWanted ? '' : \`
17. THE RESOLUTION (this completes rule 15 for a story). After the climax, write the resolution as the LAST PARAGRAPH of the last chapter, on its own, separated from the climax by a blank line: 2-3 sentences, 18-45 words, set later in time than the climax (that evening, the next morning, a season on — name the time, never signpost it), saying where the characters end up and what is different now that the conflict is settled. It is the plan's RESOLVES WITH line told in the film's own particulars; it names the protagonist; it is not the climax retold, not a summary, and not a camera position. A film that ends on its climax stops instead of ending, and an editor CHECKS for this paragraph.\${kids ? \`
For a children's story the resolution is warm: the hero safe and home, the problem mended, everyone together — and the gentle lesson in the last sentence, worn lightly, the way a picture book closes.\` : ''}
\`;
const closingEditor = !closingWanted ? '' : \`
4c. THE RESOLUTION — the film must not end on its climax. The last chapter ends with a separate final paragraph (a blank line before it) of 2-3 sentences, 18-45 words, set later in time than the climax, saying where the characters end up and what is different now that the conflict is settled — the plan's RESOLVES WITH line. If the draft's last paragraph IS the climax, or the resolution is one clause glued to it, write the paragraph.\${kids ? " For a children's story it is warm: everyone safe, home and together, the problem mended, the gentle lesson in the last sentence." : ''}
\`;
const closingSegment = !closingWanted ? '' : \`
THE RESOLUTION SCENE: when this chapter's plan carries a RESOLVES WITH line, its LAST numbered narration line is the resolution — a moment later in time than the climax. Stage it as a settled, wider, calmer shot than the one before it (a different hour of the bible's lighting progression, the characters at rest or arriving home, the conflict visibly over), with ONE slow camera move, so the film lands instead of stopping.
\`;
`;
  s = replaceOnce(s, '\n// ---- The hook: which style, and the rules for it ----', block + '\n// ---- The hook: which style, and the rules for it ----', 'Voice Mode block');
  s = replaceOnce(s,
    "narrationRules: narrationRules + kidsNarration, segmentRules: segmentRules + kidsSegment, hookRules: hookRules + kidsHook,",
    "narrationRules: narrationRules + kidsNarration + closingNarration, segmentRules: segmentRules + kidsSegment + closingSegment, hookRules: hookRules + kidsHook, closing: { wanted: closingWanted, kids: closingWanted && kids }, closingOutline, closingOutlineLine, closingEditor,",
    'Voice Mode return');
  out('cs-Voice_Mode.js', s);
}

// ---------------------------------------------------------------------------
// Generate Outline — two injection points, both from Voice Mode.
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Generate_Outline.txt');
  s = insertAfter(s, /^\{\{ \$\('Genre Profile'\)\.first\(\)\.json\.p\.structure \}\}$/,
    "{{ $('Voice Mode').first().json.closingOutline || '' }}", 'Outline: after structure');
  s = insertAfter(s, /^LEADS INTO: </,
    "{{ $('Voice Mode').first().json.closingOutlineLine || '' }}", 'Outline: after LEADS INTO');
  out('cs-Generate_Outline.txt', s);
}

// ---------------------------------------------------------------------------
// Edit Full Narration — rule 4c after 4b.
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Edit_Full_Narration.txt');
  s = insertAfter(s, /^4b\. THE ENDING/, "{{ $('Voice Mode').first().json.closingEditor || '' }}", 'Editor: after 4b');
  out('cs-Edit_Full_Narration.txt', s);
}

// ---------------------------------------------------------------------------
// Narration Guard — the check, inside the same gate as the ending check.
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Narration_Guard.js');
  const check = `
  // THE RESOLUTION (2026-09-16) — the check for the paragraph writer rule 17
  // asks for. The 09-12 ending check only catches a trailing camera clause;
  // the films written after it ended ON the climax (the Lego chase on the
  // arrest, the clay builders with two of the three shut inside the house)
  // and that is what the producer heard as "no conclusion". A story's last
  // chapter must end with a SEPARATE final paragraph — 2-3 sentences, 18-45
  // words — set after the climax and naming the protagonist. Same gate as
  // the checks above, same feedback path, never a hard failure. Story and
  // Kids only, read from Voice Mode so this cannot disagree with the rule it
  // enforces (an absent category is a Story, the site's default).
  let closing = { wanted: false, kids: false };
  try { closing = $('Voice Mode').first().json.closing || closing; } catch (e) {}
  if (closing.wanted && lastChapter) {
    const paras = String(lastChapter.narrator_script || '').split(/\\n\\s*\\n/).map((p) => p.trim()).filter(Boolean);
    const last = paras[paras.length - 1] || '';
    const lastWords = wc(last);
    const lastSentences = sentencesOf(last).length;
    // The protagonist as the spine names them — the HEAD of that field, before
    // any comma, dash or bracket ("Jack Miller, a Brick City patrol officer"
    // names Jack Miller, not Brick City), as capitalised words, folded, minus
    // articles. A spine that gives no name (a "you" film) skips the name test
    // rather than failing it.
    let names = [];
    try {
      const prot = String((outline.story_spine || {}).protagonist || '').split(/[,;:—–(\\-]/)[0];
      names = (prot.match(/\\b\\p{Lu}\\p{L}{2,}\\b/gu) || []).map(norm).filter((n) => !['the', 'one', 'our', 'his', 'her', 'their', 'and', 'who'].includes(n));
    } catch (e) {}
    const named = !names.length || names.some((n) => norm(last).includes(n));
    const who = names[0] ? names[0].charAt(0).toUpperCase() + names[0].slice(1) : 'the characters';
    const ask = 'Write the resolution as the LAST PARAGRAPH of the last chapter, separated from the climax by a blank line: 2-3 sentences, 18-45 words, set later in time than the climax, saying where ' + who + ' and the others end up and what is different now that the conflict is settled' + (closing.kids ? ' — warm: everyone safe, home and together, the problem mended, the gentle lesson in the last sentence' : '') + '. Not the climax retold, not a summary, not a camera position.';
    if (paras.length < 2) problems.push('The film ends on its climax: the last chapter is one paragraph, with no resolution set apart after it. ' + ask);
    else if (lastWords < 18 || lastSentences < 2) problems.push('The resolution is too thin to be a scene: the last paragraph is ' + lastWords + ' words in ' + lastSentences + ' sentence(s). ' + ask);
    else if (lastWords > 45) problems.push('The last paragraph is ' + lastWords + ' words — that is a chapter, not a resolution. Keep the resolution to 2-3 sentences (18-45 words) and move the rest up into the story.');
    else if (!named) problems.push('The last paragraph never says what becomes of ' + who + '. ' + ask);
  }`;
  // Right after the STOPS_ON_SHOT block, which is the last statement inside
  // the gate — its closing brace is the line `  }` that precedes the gate's `}`.
  s = replaceOnce(s,
    "      problems.push('The film stops instead of ending: the last sentence is a camera line — \"' + lastSentence + '\". Replace the final two or three sentences of the last chapter with a CLOSING BEAT: the last event and the consequence that outlives it, answering the question the film opened with, in this film\\'s own particulars. It is the one place meaning may be stated aloud — still not a summary of the chapters, not a moral addressed to the viewer, and not a new fact.');\n    }\n  }\n}",
    "      problems.push('The film stops instead of ending: the last sentence is a camera line — \"' + lastSentence + '\". Replace the final two or three sentences of the last chapter with a CLOSING BEAT: the last event and the consequence that outlives it, answering the question the film opened with, in this film\\'s own particulars. It is the one place meaning may be stated aloud — still not a summary of the chapters, not a moral addressed to the viewer, and not a new fact.');\n    }\n  }\n" + check + "\n}",
    'Guard: after STOPS_ON_SHOT');
  out('cs-Narration_Guard.js', s);
}

// ---------------------------------------------------------------------------
// Plan Scene Splits — the resolution paragraph is cut off before chunking.
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Plan_Scene_Splits.js');
  s = replaceOnce(s,
    "const out = [];\nconst items = $input.all();\n",
    `const out = [];
const items = $input.all();
// THE RESOLUTION SCENE (2026-09-16). A Story or Kids story ends on a separate
// final paragraph (writer rule 17, checked by Narration Guard), and it has to
// reach the screen as its own shot: chunked with the rest of the chapter it
// lands wherever the word arithmetic puts it — folded into the climax's scene
// as often as not, which undoes the whole point. So the LAST chapter is cut
// in two before chunking: everything up to its last blank line is chunked as
// before, and the final paragraph becomes the film's last scene — ONE scene
// whenever it fits the ceiling a scene may carry (the guard keeps it under
// 45 words, so only the longest resolutions become two). A chapter with no
// paragraph break, a runt tail, or a film that is not a story falls through
// to the ordinary chunking, so nothing older than this changes.
let closingWanted = false;
try { closingWanted = !!((($('Voice Mode').first().json || {}).closing || {}).wanted); } catch (e) {}
const ordinals = items.map((it) => Number(((it.json || {}).fields || {})['Ordine'])).filter(Number.isFinite);
const lastOrdinal = ordinals.length ? Math.max(...ordinals) : NaN;
`,
    'Splits: setup');
  s = replaceOnce(s,
    "  const chunks = hookLines.length > 1 ? hookLines : planChunks(((j.fields || {})['Script Capitol']));\n",
    `  const script = String((j.fields || {})['Script Capitol'] || '').replace(/\\r\\n/g, '\\n').trim();
  const isLast = closingWanted && !isHook && Number((j.fields || {})['Ordine']) === lastOrdinal;
  const split = isLast ? script.match(/^([\\s\\S]*\\S)\\n[ \\t]*\\n\\s*(\\S[\\s\\S]*)$/) : null;
  const closingText = split ? split[2].replace(/\\s+/g, ' ').trim() : '';
  const closingChunks = split && wc(closingText) >= 12 ? (wc(closingText) <= MAX_WORDS_PER_SCENE ? [closingText] : planChunks(closingText)) : [];
  const chunks = hookLines.length > 1 ? hookLines : (closingChunks.length ? planChunks(split[1]).concat(closingChunks) : planChunks(script));
  if (closingChunks.length) console.log(\`Chapter \${(j.fields || {})['Ordine']}: resolution paragraph -> its own \${closingChunks.length} scene(s)\`);
`,
    'Splits: chunking');
  out('cs-Plan_Scene_Splits.js', s);
}

// ---------------------------------------------------------------------------
// Final Assembly / Build Timeline — the last picture holds after the last word.
// ---------------------------------------------------------------------------
{
  let s = orig('fa-Build_Timeline.js');
  s = replaceOnce(s,
    "const hookRiser = !!hookPlan",
    `// THE CLOSING HOLD (2026-09-16). The last scene used to end 0.35s after the
// last word, then the flash and the end screen — the montage's classic breath,
// right between two scenes and wrong after the last one, where it is what the
// producer hears as the film "stopping". On a Story the last picture now holds
// 1.5s after its narration, 2s on a Kids story (whose listeners are slower);
// documentary and cinematic keep the classic cut. Applied to the LAST VOICED
// scene — a silent tail shot has no narration to hold after — through the
// per-scene gapSeconds /assemble already clamps to [0, 2]. An absent category
// is a Story, the site's default, so films made before categories existed get
// the hold too when they are re-rendered.
const closingCategory = (opts.category === undefined || opts.category === '' ) ? 'story' : String(opts.category);
const closingHold = closingCategory === 'kids' ? 2 : closingCategory === 'story' ? 1.5 : null;
if (closingHold !== null) {
  for (let i = scenes.length - 1; i >= 0; i--) {
    if (scenes[i].audioUrl) { scenes[i].gapSeconds = closingHold; break; }
  }
}
const hookRiser = !!hookPlan`,
    'Timeline: closing hold');
  out('fa-Build_Timeline.js', s);
}

console.log('paste/ rebuilt from original/');
