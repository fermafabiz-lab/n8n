// One item out, or the agent below runs once per scene.
//
// The scene list is taken from Validate Evidence Refs — the last node that has
// every scene in the order the film plays — and each scene is handed to the
// model with the SHOT and MOTION prompts beside its narration. Those two are
// the load-bearing half of the input: they are what lets the model see that a
// scene is already showing the thing it was about to draw, which is the
// mistake this whole feature was born from.
const items = $('Validate Evidence Refs').all();
const scenes = items.map((it, i) => {
  const j = it.json || {};
  const chapter = Number(j.chapter_number ?? 0);
  const scene = Number(j.scene_number ?? i + 1);
  return {
    index: i,
    // chapter*100 + scene, the convention every workflow already shares.
    order: chapter * 100 + scene,
    chapter,
    narration: String(j.narrator_text || ''),
    shot: String(j.image_prompt || ''),
    motion: String(j.video_motion_prompt || ''),
  };
});

let research = '';
try { research = String($('Extract Claims').first().json.output || ''); } catch (e) {}

let title = '';
let tone = '';
try {
  const p = $('Receive Project Data').first().json || {};
  title = String(p['Nume Proiect'] || p.name || p.Tema || '');
  tone = String(p.Tonalitate || p.tone || '');
} catch (e) {}

const brief = [
  `FILM: ${title}`,
  `TONE: ${tone}`,
  '',
  'SCENES (index · narration · what the shot will show)',
  ...scenes.map((s) => [
    `${s.index} · ${s.narration}`,
    `    SHOT: ${s.shot}`,
    `    MOTION: ${s.motion}`,
  ].join('\n')),
  '',
  'RESEARCH PACK (may be empty)',
  research || '(none — this film was not researched, so no fact from outside the script is available)',
].join('\n');

return [{ json: { brief, scenes, sceneCount: scenes.length } }];