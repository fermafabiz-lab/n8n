// Builds paste/ from original/ for the four EXISTING nodes this change edits.
// Every edit is a replacement of one exact span, made here so the diff is
// exactly what this file says and nothing else; each one throws unless its
// anchor occurs exactly once. Re-running is idempotent (it always starts from
// original/, which is the live body at Claude Scripting 538a914c).
//
//   node db/port/cinematic-mode/build-paste.mjs
//
// The three NEW nodes (Cine Treatment, Cine Shot List, Cine Guard) are
// written directly in paste/ — they have no live original to edit.
//
// The rule every edit here keeps: a film that is NOT cinematic gets the same
// bytes as before. Voice Mode changes only a string chosen when
// `cinematic` is true; Plan Scene Splits and Combine Chapters branch on
// Voice Mode's `cinematic` flag; Rewrite Script picks its system message on
// the same flag and keeps the old one verbatim as the other arm.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const orig = (f) => fs.readFileSync(path.join(dir, 'original', f), 'utf8');
const out = (f, s) => fs.writeFileSync(path.join(dir, 'paste', f), s);

/** Replace the ONE occurrence of `from` with `to`; throw otherwise. */
function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected exactly one occurrence of ${JSON.stringify(from.slice(0, 70))}, found ${n}`);
  return src.replace(from, () => to);
}

// ---------------------------------------------------------------------------
// Voice Mode — the segmenter's Cinematic rules. The line is now a SHOT the
// director designed, so the segmenter executes it instead of inventing one.
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Voice_Mode.js');
  const oldSeg =
    "const segmentRules = cinematic ? `\\nSILENT FILM MODE: narrator_text is a silent shot note — it is never spoken and never captioned — so keep it a terse description of the visible action. ALL storytelling lives in image_prompt and video_motion_prompt. In every video_motion_prompt make the action's SOUND read clearly from the visuals (a revving engine, screeching tires, pouring rain, a slamming door): the film's only audio is the natural sound of what is on screen.\\n` : ";
  const newSeg =
    "const segmentRules = cinematic ? `\\nCINEMATIC FILM — EVERY SHOT IS ALREADY DESIGNED (this section overrides rule 5 and the VISUAL VARIETY rule wherever they differ). The film has no narration at all: each numbered line above is one shot from the director's shot list, in the form \"SHOT SIZE AND ANGLE · CAMERA MOVE · WHAT HAPPENS · LIGHT · Sound: …\". It is never spoken and never captioned.\\n(a) narrator_text: copy the line verbatim, exactly as rule 1 says.\\n(b) EXECUTE the shot the line designs: the image_prompt opens with the line's shot size and angle and shows its subject at the first instant of its action, in the line's light; the video_motion_prompt's camera movement IS the line's camera move, and its action IS the line's action, travelling the way the line says. Add everything the line leaves to you — the bible's full visual descriptions, the place in its current state, the palette, the lens — and keep the shot itself as written.\\n(c) visual_scene_description: what this shot shows across its 8 seconds, in two sentences taken from the line.\\n(d) The shot list already carries the edit's rhythm — its changes of shot size, its match cuts between sequences, its light moving through the hours — so following it line by line IS the visual variety this film needs; time_of_day and location follow the line and the chapter plan.\\n(e) SOUND: the line's Sound field goes into the video_motion_prompt's style & ambiance, written as what is heard (\"the chip of the spade in wet clay, larks overhead\"), before the closing clause — the film's only audio besides music is the natural sound of what is on screen.\\n` : ";
  s = replaceOnce(s, oldSeg, newSeg, 'Voice Mode segmentRules');
  // The beat-sheet rules stay for their one remaining reader: none. They were
  // Write Full Narration's, and a Cinematic film no longer reaches that node.
  // Kept rather than deleted so this diff is only the change that matters.
  s = replaceOnce(
    s,
    '// A silent film overrides every voice mode: nobody speaks at all.\n',
    '// A silent film overrides every voice mode: nobody speaks at all.\n// Since 2026-09-23 a Cinematic film is written by Cine Treatment and Cine\n// Shot List, not by Write Full Narration, so `narrationRules` below is no\n// longer read for one; `segmentRules` and `hookRules` still are.\n',
    'Voice Mode comment',
  );
  out('cs-Voice_Mode.js', s);
}

// ---------------------------------------------------------------------------
// Plan Scene Splits — a Cinematic chapter is cut on its LINES: one line is
// one shot the director counted, never a word budget.
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Plan_Scene_Splits.js');
  s = replaceOnce(
    s,
    "try { closingWanted = !!((($('Voice Mode').first().json || {}).closing || {}).wanted); } catch (e) {}\n",
    "try { closingWanted = !!((($('Voice Mode').first().json || {}).closing || {}).wanted); } catch (e) {}\n" +
      '// A CINEMATIC film (2026-09-23) is a shot list: every line of a chapter is\n' +
      '// one shot, counted by the director in Cine Treatment and checked by Cine\n' +
      '// Guard. Chunking it by words would merge two shots into one scene or split\n' +
      '// one across two, so its chapters are cut on line breaks, like the hook.\n' +
      'let cinematic = false;\n' +
      "try { cinematic = (($('Voice Mode').first().json || {}).cinematic) === true; } catch (e) {}\n",
    'Plan Scene Splits flag',
  );
  s = replaceOnce(
    s,
    '  const chunks = hookLines.length > 1 ? hookLines : (closingChunks.length ? planChunks(split[1]).concat(closingChunks) : planChunks(script));\n',
    "  const shotLines = cinematic && !isHook ? script.split(/\\n+/).map((l) => l.replace(/^\\s*(?:[-*•]+|\\d+\\s*[.)])\\s+/, '').replace(/\\s+/g, ' ').trim()).filter(Boolean) : [];\n" +
      '  const chunks = hookLines.length > 1 ? hookLines : shotLines.length ? shotLines : (closingChunks.length ? planChunks(split[1]).concat(closingChunks) : planChunks(script));\n',
    'Plan Scene Splits chunks',
  );
  out('cs-Plan_Scene_Splits.js', s);
}

// ---------------------------------------------------------------------------
// Combine Chapters — the plan comes from Cine Treatment on a Cinematic film,
// because Generate Outline never ran (and referencing it would throw).
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Combine_Chapters.js');
  s = replaceOnce(
    s,
    "const outline = $('Generate Outline').first().json.output || {};\n",
    '// A Cinematic film is planned by Cine Treatment and never reaches Generate\n' +
      '// Outline, and a node that did not run throws when referenced — so the\n' +
      "// plan is read from whichever one Voice Mode's flag says ran. Its concept\n" +
      '// stands in for the story spine the hook is shown.\n' +
      "const cine = (($('Voice Mode').first().json || {}).cinematic) === true;\n" +
      "const outline = (cine ? $('Cine Treatment') : $('Generate Outline')).first().json.output || {};\n",
    'Combine Chapters outline',
  );
  s = replaceOnce(s, 'story_spine: outline.story_spine || null,', 'story_spine: outline.story_spine || (cine ? outline.concept : null) || null,', 'Combine Chapters spine');
  out('cs-Combine_Chapters.js', s);
}

// ---------------------------------------------------------------------------
// Rewrite Script — the producer's "reject with feedback" path. Its system
// message demanded "flowing spoken narration only", which would turn a shot
// list back into prose on the first rejection.
// ---------------------------------------------------------------------------
{
  let s = orig('cs-Rewrite_Script.txt');
  const storySystem = s.match(/content: ('You are an expert script editor\.(?:[^'\\]|\\.)*')/);
  if (!storySystem) throw new Error('Rewrite Script: story system message not found');
  const cineSystem =
    "'You are the director of a silent cinematic short film, revising its SHOT LIST according to the producer\\'s feedback. The script is a shot list: [CHAPTER n: title] marker lines, each followed by one shot per line in the form \"SHOT SIZE AND ANGLE · CAMERA MOVE · WHAT HAPPENS · LIGHT · Sound: the dominant sound\". STRICT RULES: keep the exact [CHAPTER n: title] marker lines (titles may change, format may not); keep one shot per line in that five-field form, in English; keep the number of shot lines in each chapter within 10% of the original, because every line is one 8-second shot and the count is the film\\'s running time; everything in a line is seen or heard, because nobody speaks in this film and nothing is narrated; keep every shot the feedback does not touch exactly as it is. Output ONLY the revised shot list — no markdown, no numbering, no notes.'";
  s = replaceOnce(s, 'content: ' + storySystem[1], "content: ($('Voice Mode').first().json.cinematic === true ? " + cineSystem + ' : ' + storySystem[1] + ')', 'Rewrite Script system');
  out('cs-Rewrite_Script.txt', s);
}

console.log('paste/: cs-Voice_Mode.js, cs-Plan_Scene_Splits.js, cs-Combine_Chapters.js, cs-Rewrite_Script.txt');
