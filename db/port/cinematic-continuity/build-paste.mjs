// Builds paste/ from original/ — every edit an exact replacement of one
// anchor, throwing unless the anchor occurs the expected number of times.
// original/ is the live code: Claude Scripting e45ef4c1, Media Generation
// b9527072.
//
//   node db/port/cinematic-continuity/build-paste.mjs
//
// Two producer asks, 2026-09-23, on top of db/port/cinematic-mode/:
//   1. A Cinematic film has NO hook: the film opens on its first shot, and the
//      scene that used to be reserved for the teaser goes back into the film.
//   2. Continuity from scene to scene must be extremely high: every shot is
//      the next moment of the one before, and the previous picture anchors the
//      next one as the previous SHOT of the same scene, not as a palette.
// Everything here changes only when the film is Cinematic; check.mjs proves
// the other categories get the same output as before.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const orig = (f) => fs.readFileSync(path.join(dir, 'original', f), 'utf8');
const out = (f, s) => fs.writeFileSync(path.join(dir, 'paste', f), s);

function replaceN(src, from, to, n, label) {
  const k = src.split(from).length - 1;
  if (k !== n) throw new Error(`${label}: expected ${n} occurrence(s) of ${JSON.stringify(from.slice(0, 80))}, found ${k}`);
  return src.split(from).join(to);
}
const replaceOnce = (src, from, to, label) => replaceN(src, from, to, 1, label);

// ---------------------------------------------------------------------------
// The shared REFERENCE ASSEMBLY block — the same three edits in all three
// copies, so the block stays word for word identical (check.mjs asserts it).
// ---------------------------------------------------------------------------
function editCons(s, label) {
  s = replaceOnce(
    s,
    '//   - the previous frame                      LAST, palette only\n',
    '//   - the previous frame                      LAST, palette only\n' +
      '//     (a Cinematic film: the previous SHOT, when it is in the same place)\n',
    label + ' header',
  );
  s = replaceOnce(
    s,
    "    if (a.prevId && refs.length < 5 && !refs.some((r) => r.id === a.prevId)) { refs.push({ id: a.prevId, role: 'palette', name: '' }); used.palette = true; }\n",
    "    // A CINEMATIC film (a.continuity) is one continuous action, and when the\n" +
      "    // previous scene is in the same place its picture is the previous SHOT of\n" +
      "    // this one — same light, same state of everything — not a palette swatch.\n" +
      "    // Across a change of place it stays a palette (2026-09-23,\n" +
      "    // db/port/cinematic-continuity).\n" +
      "    const sameShot = !!a.continuity && !!a.prevF && (() => { const p = tagged(a.prevF, 'loc:').map(norm), h = tagged(f, 'loc:').map(norm); return p.length > 0 && h.length > 0 && p[0] === h[0]; })();\n" +
      "    if (a.prevId && refs.length < 5 && !refs.some((r) => r.id === a.prevId)) { refs.push({ id: a.prevId, role: sameShot ? 'continuity' : 'palette', name: '' }); if (sameShot) used.continuity = true; else used.palette = true; }\n",
    label + ' push',
  );
  s = replaceOnce(
    s,
    "      else if (r.role === 'palette') parts.push('The LAST reference image is only for colour palette and film look, never for layout and never for who or where anyone is.');\n",
    "      else if (r.role === 'palette') parts.push('The LAST reference image is only for colour palette and film look, never for layout and never for who or where anyone is.');\n" +
      "      else if (r.role === 'continuity') parts.push('Reference image ' + k + ' is the PREVIOUS SHOT of this same continuous scene, a moment earlier: the same place in the same state, the same light, weather and hour, the same people in the same clothes with the same dirt and wear, and every object in the state and position it was left in. This shot is the NEXT MOMENT of that action, seen from the new angle and distance the text describes.');\n",
    label + ' parts',
  );
  return s;
}

// --- Build Image Request (Media Generation, the batch) ----------------------
{
  let s = editCons(orig('mg-Build_Image_Request.js'), 'Build Image Request');
  s = replaceOnce(
    s,
    "if (promptSim > 0.55) prevId = '';\n",
    "// A Cinematic film keeps the previous shot even when the prompts are alike:\n" +
      "// consecutive shots of one continuous action SHOULD share most of their words.\n" +
      "const continuity = String(opts.category || '') === 'cinematic';\n" +
      "if (promptSim > 0.55 && !continuity) prevId = '';\n" +
      "// The previous scene's place, from this node's previous run (it emits its\n" +
      "// own loc tags on a Cinematic film for exactly this).\n" +
      "let prevF = null;\n" +
      "try {\n" +
      "  if (continuity && $runIndex > 0) {\n" +
      "    const pr = $('Build Image Request').all(0, $runIndex - 1);\n" +
      "    const t = pr && pr[0] && pr[0].json && Array.isArray(pr[0].json.locTags) ? pr[0].json.locTags : null;\n" +
      "    if (t) prevF = { 'Tag-uri Scenă': t.map((x) => 'loc:' + x) };\n" +
      "  }\n" +
      "} catch (e) { prevF = null; }\n",
    'Build Image Request similarity',
  );
  s = replaceOnce(
    s,
    'afterRefusal: afterRefusal, strict: strict, strictNotes: strictNotes });\n',
    'afterRefusal: afterRefusal, strict: strict, strictNotes: strictNotes, continuity: continuity, prevF: prevF });\n',
    'Build Image Request plan call',
  );
  s = replaceOnce(
    s,
    'rawPrompt: prompt, promptSimilarityToPrev: Number(promptSim.toFixed(2)) } }];',
    "rawPrompt: prompt, promptSimilarityToPrev: Number(promptSim.toFixed(2)), ...(continuity ? { locTags: CONS.tagged(f, 'loc:') } : {}) } }];",
    'Build Image Request output',
  );
  out('mg-Build_Image_Request.js', s);
}

// --- Evaluate Image Approval (Media Generation, the gate's regen) ----------
{
  let s = editCons(orig('mg-Evaluate_Image_Approval.js'), 'Evaluate Image Approval');
  s = replaceOnce(
    s,
    "afterRefusal: rejected, strict: false, strictNotes: '' });\n",
    "afterRefusal: rejected, strict: false, strictNotes: '', continuity: String(regenOpts.category || '') === 'cinematic', prevF: i > 0 ? (recs[i - 1].json.fields || {}) : null });\n",
    'Evaluate Image Approval plan call',
  );
  out('mg-Evaluate_Image_Approval.js', s);
}

// --- IR Build Request (Claude Scripting, the site's regen) -----------------
{
  let s = editCons(orig('cs-IR_Build_Request.js'), 'IR Build Request');
  s = replaceOnce(
    s,
    'const idx = all.findIndex((r) => r.id === scene.id);\n',
    "const idx = all.findIndex((r) => r.id === scene.id);\n" +
      "// A Cinematic film keeps the previous shot even when the prompts are alike\n" +
      "// (see the shared block: it is the previous SHOT there, not a palette).\n" +
      "const continuity = String(opts.category || '') === 'cinematic';\n",
    'IR continuity flag',
  );
  s = replaceOnce(s, "    if (hit / Math.max(A.size, B.size) > 0.55) prevId = '';\n", "    if (hit / Math.max(A.size, B.size) > 0.55 && !continuity) prevId = '';\n", 'IR similarity');
  s = replaceOnce(
    s,
    "afterRefusal: rejectedBefore, strict: false, strictNotes: '' });\n",
    "afterRefusal: rejectedBefore, strict: false, strictNotes: '', continuity: continuity, prevF: idx > 0 ? (all[idx - 1].fields || {}) : null });\n",
    'IR plan call',
  );
  out('cs-IR_Build_Request.js', s);
}

// ---------------------------------------------------------------------------
// The writing path.
// ---------------------------------------------------------------------------
const N_OLD = "Math.max(1, Math.ceil($('Receive Project Data').first().json.Lenght / 8) - 1)";
const N_NEW = "Math.max(1, Math.ceil($('Receive Project Data').first().json.Lenght / 8))";

{
  let s = orig('cs-Cine_Treatment.txt');
  s = replaceOnce(
    s,
    'Every shot is an 8-second clip, and one short opening teaser is made separately and placed before your first sequence, so your sequences together hold EXACTLY',
    'Every shot is an 8-second clip and there is no separate opening teaser — the film opens on your first shot — so your sequences together hold EXACTLY',
    'Treatment teaser',
  );
  s = replaceN(s, N_OLD, N_NEW, 3, 'Treatment shot count');
  s = replaceOnce(
    s,
    '\nFIRST, the CONCEPT — what makes this a film rather than a slideshow:\n',
    "\nCONTINUITY IS THIS FILM'S SPINE — the producer's first requirement. The film plays as ONE continuous flow of time and space, as if a single crew followed it without once looking away: each sequence picks up exactly where the previous one ended — the next stage of the same work, the next stretch of the same journey, the next room of the same house — never a jump to an unrelated place and never a skipped stage. Inside a sequence time is continuous and every shot is the next moment of the one before; between sequences time moves only as far as the light arc moves it, and the cut between them carries a shape, a movement or an object across. Plan FEW places and stay in each long enough to be continuous in it.\n" +
      '\nFIRST, the CONCEPT — what makes this a film rather than a slideshow:\n',
    'Treatment continuity',
  );
  out('cs-Cine_Treatment.txt', s);
}

{
  let s = orig('cs-Cine_Shot_List.txt');
  s = replaceOnce(
    s,
    '\nTHE CRAFT — what makes a sequence cinematic instead of a row of pictures:\n',
    '\nCONTINUITY — THE FIRST RULE OF THIS FILM, above every rule below. The film is one continuous action, and every shot begins exactly where the shot before it ended:\n' +
      '(a) Inside a sequence the shots are consecutive moments of the SAME action in the SAME place, seconds apart: the subject, what it holds, its clothes with their dirt and wear, every prop and the state it is in, the weather and the light carry over exactly; the light moves only by the step eight seconds allows.\n' +
      '(b) Where the subject stood, which way it faced and which way it travelled when one shot ended is where the next shot finds it. A thing picked up stays in hand until a shot puts it down; a door opened stays open; earth dug stays dug.\n' +
      '(c) Each cut is motivated by the shot before it: a new angle on the action already under way (a cut on action), a move closer to what the last shot revealed, or a reveal of what the last shot was looking at. Name the link in the action field when it helps — "the same slab", "still turning", "where the barrow stopped".\n' +
      '(d) Between sequences, the last shot of one and the first of the next are a match cut: the same shape, movement or object carries across the cut, and time moves only as far as the light arc says.\n' +
      '\nTHE CRAFT — what makes a sequence cinematic instead of a row of pictures:\n',
    'Shot List continuity',
  );
  s = replaceOnce(
    s,
    'Three example lines FROM A DIFFERENT FILM — copy their form, never their content:\n' +
      'WIDE, LOW ANGLE · slow crane up · The grey coupe crests the pass left to right as the valley opens below it and the road ribbons down into cloud · last sun behind the car, a long shadow reaching ahead · Sound: engine note rising, wind\n' +
      'EXTREME CLOSE-UP · locked-off · A bead of oil swells on the steel lip of the sump plug and drops into the pan below · one work lamp overhead, hard shine on the metal · Sound: garage hum, a single drip\n' +
      'MEDIUM, OVER THE SHOULDER · handheld follow · The mechanic walks away from the camera down the dark workshop toward the open door and the rain beyond it · cold daylight from the door, warm lamp behind · Sound: footsteps on concrete, rain building\n',
    'Three CONSECUTIVE example lines FROM A DIFFERENT FILM — copy their form and their continuity, never their content:\n' +
      "WIDE, LOW ANGLE · slow push in · The potter carries a slab of wet clay left to right across the dim workshop toward the wheel by the window · cold dawn light from the window, the room in blue shadow · Sound: bare feet on stone, the wheel's slow hum\n" +
      'MEDIUM, SIDE · locked-off · At the window the potter drops the same slab onto the spinning wheel head, wet clay still glinting from the carry · the same cold dawn light now touching the wheel from the left · Sound: the wet slap of clay, the hum rising\n' +
      'EXTREME CLOSE-UP · slow push in · Both thumbs press into the centre of that clay as it turns, a ridge of slip climbing between the fingers · the same dawn light raking across the wet surface · Sound: the hiss of clay under wet hands\n',
    'Shot List examples',
  );
  out('cs-Cine_Shot_List.txt', s);
}

{
  let s = orig('cs-Cine_Guard.js');
  s = replaceOnce(
    s,
    'const ordered = Math.max(1, Math.ceil(Number(rp.Lenght || 64) / 8) - 1);\n',
    '// A Cinematic film has no hook (2026-09-23), so no scene is held back for\n' +
      '// one: the whole length is shots.\n' +
      'const ordered = Math.max(1, Math.ceil(Number(rp.Lenght || 64) / 8));\n',
    'Guard ordered',
  );
  out('cs-Cine_Guard.js', s);
}

{
  let s = orig('cs-Voice_Mode.js');
  s = replaceOnce(
    s,
    "the film's only audio besides music is the natural sound of what is on screen.\\n` : !characters ? '' : `\\nDIALOGUE MODE: the chapter script c",
    "the film's only audio besides music is the natural sound of what is on screen.\\n(f) CONTINUITY — the first rule of a cinematic film: consecutive scenes are consecutive moments of one action. Before writing each scene's image_prompt, work out where the previous scene's motion LEFT everything — where the subject stands and faces, what it holds, the state of the work, the light, the weather — and compose this scene's first frame from exactly that state, seen from the angle and distance this scene's line names. The same location state, time_of_day, wardrobe (with its dirt and wear), props and weather carry across every scene of the chapter unless the line itself changes them, and scenes in the same place carry the same location tag. The first scene of the chapter continues from the chapter plan's OPENS ON line.\\n` : !characters ? '' : `\\nDIALOGUE MODE: the chapter script c",
    'Voice Mode continuity',
  );
  out('cs-Voice_Mode.js', s);
}

console.log('paste/: ' + fs.readdirSync(path.join(dir, 'paste')).join(', '));
