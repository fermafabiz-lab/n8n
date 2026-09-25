// The graphic plan of one film: WHICH style its graphics are drawn in (when
// the producer left it on "AI picks"), WHAT they say — the people and
// places worth a name tag, the figures worth a count-up — and WHICH family
// of transitions its cuts get (when that too was left to the AI). Asked once
// the scene texts are approved, because a tag names something a scene SAYS
// and the scenes are only final then.
//
// Graphics are Story and Documentary only, the producer's call (2026-09-24):
// Kids story and Cinematic get their own later. Transitions are for EVERY
// category (2026-09-25): they belong to a theme, not to a kind of film. An
// explicit pick of either is never asked about again; with both picked and
// nothing to extract, nothing is asked at all.
const r = $json;
const id = String(r.id || '?');
const category = String(r.category || 'story').trim().toLowerCase();
const STYLES = ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten'];
const TRANSITIONS = ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'];
const picked = STYLES.includes(r.graphic_style) ? r.graphic_style : null;
const pickedTransition = TRANSITIONS.includes(r.transition_style) ? r.transition_style : null;
const graphics = ['story', 'documentary'].includes(category) && picked !== 'classic';
const askTransition = !pickedTransition;
if (!graphics && !askTransition) {
  console.log('GRAPHIC PLAN SKIP ' + id + ': nothing to choose (' + category + ', graphics ' + (picked || 'auto') + ', transitions ' + pickedTransition + ')');
  return [];
}
let scenes = r.scenes;
if (typeof scenes === 'string') { try { scenes = JSON.parse(scenes); } catch (e) { scenes = []; } }
scenes = (Array.isArray(scenes) ? scenes : []).filter((s) => Number(s.order) > 0);
const body = scenes.filter((s) => Number(s.chapter) > 0 && String(s.text || '').trim());
if (graphics && body.length < 2) {
  console.log('GRAPHIC PLAN SKIP ' + id + ': ' + body.length + ' scenes with narration');
  return [];
}

// How many graphics a film can carry. A tag every ~20 s at most and a figure
// every ~60 s: more than that and the footage becomes a slide deck. The render
// drops anything that does not fit its scene anyway (placeGraphics), so these
// are budgets for the model, re-applied in Parse Plan.
const length = Number(r.length_seconds) > 0 ? Number(r.length_seconds) : Math.max(1, body.length) * 6;
const maxTags = Math.max(2, Math.round(length / 20));
const maxStats = Math.max(1, Math.round(length / 60));

const styleBlock = (graphics && !picked) ?
  'Choose the GRAPHIC STYLE that suits this film\'s THEME (not its category):\n' +
  '- reportage: news-like. White headline bars and a vertical rule. For current affairs, investigations, business, technology, crime, politics, sport.\n' +
  '- editorial: magazine-like. Dark cards, a small kicker over bold titles, a white flash on each chapter. For explainers, history told briskly, science, culture, biography.\n' +
  '- cinematic: a large luminous title with a chromatic edge, slim rules. For epic, mythic, dramatic, war, adventure, space, mystery.\n' +
  '- handwritten: chapter titles written by hand, dark cards. For intimate, personal, nostalgic, travel, food, gentle stories, letters and diaries.\n' +
  '- classic: no graphics over the footage at all. Only when every other style would be wrong for the film.\n\n' : '';

const transitionBlock = askTransition ?
  'Choose the TRANSITION family its cuts use, by THEME. A few cuts get it, never all:\n' +
  '- push: the next picture slides the last one out, sideways or upward. Energetic, forward-moving: journeys, sport, business, technology, lists.\n' +
  '- crossfade: one picture dissolves into the next. Gentle and continuous: nature, history told calmly, memory, biography, bedtime stories.\n' +
  '- blur: the picture blurs away into the next, sometimes smearing sideways. Dreamlike or reflective: mystery, the past, emotion, travel.\n' +
  '- shutter: two black halves snap shut and open on the next picture. Mechanical and punchy: engineering, industry, war, crime, investigation.\n' +
  '- glitch: a short digital jolt. Modern and edgy: the internet, science fiction, cyberpunk, hacking, technology gone wrong.\n' +
  '- none: plain cuts only. When any movement between pictures would feel wrong for the film.\n\n' : '';

const graphicsBlock = graphics ?
  'Then choose the GRAPHICS. Every graphic belongs to ONE scene and labels something that scene\'s narration SAYS:\n' +
  '- person: someone named in the scene. title = the name as spoken; subtitle = their role or title in at most 5 words as the narration gives it ("emperor", "prefect of the grain supply"), never what they did; leave it empty when the narration gives none.\n' +
  '- place: a named place in the scene. title = the place as spoken; subtitle = where or what it is in at most 6 words, taken from the narration.\n' +
  '- stat: ONE figure spoken in the scene. value = the number as digits (40 for "forty million" with suffix "M"); suffix = at most 3 letters or % (%, M, K, B, km); label = what it counts in at most 5 words; caption = optional context in at most 8 words. A range ("20 to 40 million") or an approximate figure is not a stat.\n' +
  'Each graphic carries quote = the EXACT words of that scene\'s narration it is about, copied character for character, 1 to 8 words. A graphic without an exact quote is rejected.\n' +
  'Rules: a person or place is tagged only the FIRST time it matters, never twice. At most one graphic per scene. At most ' + maxTags + ' person and place tags in total and at most ' + maxStats + ' stats. Fewer is better than weak ones: skip generic places ("the city"), unnamed people and round rhetorical numbers. ' +
  'Write titles and subtitles in the film\'s language (' + String(r.language || 'English').slice(0, 40) + '). Never invent a fact the narration does not state.\n' : '';

const scenesText = scenes.map((s) =>
  'SCENE ' + s.order + (Number(s.chapter) > 0 ? ' (chapter ' + s.chapter + ')' : ' (cold open — never place anything here)') +
  ': ' + String(s.text || '').replace(/\s+/g, ' ').trim().slice(0, 900)
).join('\n');

const payload = {
  model: 'gpt-5.4',
  response_format: { type: 'json_object' },
  messages: [
    {
      role: 'system',
      content:
        'You design the on-screen look of a short narrated film. ' +
        styleBlock + transitionBlock + graphicsBlock +
        'Answer with JSON only: {' +
        ((graphics && !picked) ? '"style": "<id>", ' : '') +
        (askTransition ? '"transition": "<id>", ' : '') +
        '"why": "<one sentence>"' +
        (graphics ? ', "items": [{"kind": "person"|"place"|"stat", "scene": <scene number>, "quote": "...", "title": "...", "subtitle": "...", "value": 0, "suffix": "", "label": "...", "caption": "..."}]' : '') +
        '}'
    },
    {
      role: 'user',
      content:
        'Film: ' + String(r.name || '').trim().slice(0, 200) +
        '\nCategory: ' + category + (r.tone ? '\nTone: ' + String(r.tone).slice(0, 60) : '') +
        (graphics && picked ? '\nThe producer already chose the graphic style "' + picked + '": return it as style.' : '') +
        '\nLength: ' + Math.round(length) + ' seconds\n\n' + scenesText.slice(0, 60000)
    }
  ]
};
return [{ json: {
  project_id: id,
  picked,
  picked_transition: pickedTransition,
  graphics,
  category,
  max_tags: maxTags,
  max_stats: maxStats,
  scenes,
  payload,
} }];
