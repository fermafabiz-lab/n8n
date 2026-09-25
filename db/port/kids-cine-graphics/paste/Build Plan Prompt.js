// The graphic plan of one film: WHICH style its graphics are drawn in (when
// the producer left it on "AI picks"), WHAT they say, and WHICH family of
// transitions its cuts get (when that too was left to the AI). Asked once the
// scene texts are approved, because every graphic labels something a scene
// SAYS and the scenes are only final then.
//
// Each category has its own styles and its own kind of graphic (2026-09-25):
//   Story, Documentary  names, places, figures (the news/editorial family)
//   Kids story          characters, speech bubbles, stickers, a celebration —
//                       the model is SHOWN the scene stills, so a contour or a
//                       bubble lands on the character it is about
//   Cinematic           location slates; a silent film has nothing to label
// Transitions are for every category. An explicit pick of either is never
// asked about again; with both picked, nothing is asked at all.
const r = $json;
const id = String(r.id || '?');
const category = String(r.category || 'story').trim().toLowerCase();
const STYLES_BY = {
  story: ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten'],
  documentary: ['classic', 'reportage', 'editorial', 'cinematic', 'handwritten'],
  kids: ['classic', 'kidsStorybook', 'kidsPlayful', 'kidsAll'],
  cinematic: ['classic', 'cineFilm', 'cineNeon', 'cineMemory'],
};
const STYLES = STYLES_BY[category] || STYLES_BY.story;
const TRANSITIONS = ['none', 'push', 'crossfade', 'blur', 'shutter', 'glitch'];
const MEDIA = 'https://house-of-videos.com/media/';
const picked = STYLES.includes(r.graphic_style) ? r.graphic_style : null;
const pickedTransition = TRANSITIONS.includes(r.transition_style) ? r.transition_style : null;
const graphics = picked !== 'classic';
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

// How many graphics a film can carry: more than this and the footage becomes a
// slide deck. The render drops anything that does not fit its scene anyway
// (placeGraphics), so these are budgets for the model, re-applied in Parse Plan.
const length = Number(r.length_seconds) > 0 ? Number(r.length_seconds) : Math.max(1, body.length) * 6;
const chapters = new Set(body.map((s) => Number(s.chapter))).size;
const B = {
  tags: Math.max(2, Math.round(length / 20)),
  stats: Math.max(1, Math.round(length / 60)),
  characters: 3,
  speech: Math.max(2, Math.round(length / 30)),
  moments: Math.max(1, Math.round(length / 45)),
  slates: Math.max(1, Math.min(4, chapters)),
};

const styleText = {
  story:
    '- reportage: news-like. White headline bars and a vertical rule. For current affairs, investigations, business, technology, crime, politics, sport.\n' +
    '- editorial: magazine-like. Dark cards, a small kicker over bold titles, a white flash on each chapter. For explainers, history told briskly, science, culture, biography.\n' +
    '- cinematic: a large luminous title with a chromatic edge, slim rules. For epic, mythic, dramatic, war, adventure, space, mystery.\n' +
    '- handwritten: chapter titles written by hand, dark cards. For intimate, personal, nostalgic, travel, food, gentle stories, letters and diaries.\n' +
    '- classic: no graphics over the footage at all. Only when every other style would be wrong for the film.\n',
  kids:
    '- kidsStorybook: calm and warm. Chapter titles written by hand, each main character introduced once in a drawn frame, confetti on the happy ending. For bedtime stories, gentle adventures, lessons.\n' +
    '- kidsPlayful: lively. Speech bubbles, a drawn contour naming a character, stickers on little discoveries, confetti. For funny, busy, adventurous stories.\n' +
    '- kidsAll: everything of both. For a longer story with many characters and moments.\n' +
    '- classic: no graphics at all.\n',
  cinematic:
    '- cineFilm: an auteur film. The title over the first shot, typed location slates, 2.39:1 bars, calm chapter titles. For drama, nature, travel, character studies.\n' +
    '- cineNeon: the same frame with chapter titles that tear in on a digital glitch. For science fiction, cyberpunk, cities at night, technology.\n' +
    '- cineMemory: the title, warm light leaks on each chapter change, calm chapter titles, no bars. For memory, nostalgia, dreams, family, the past.\n' +
    '- classic: no graphics at all.\n',
};
const styleBlock = (graphics && !picked) ?
  'Choose the GRAPHIC STYLE that suits this film\'s THEME:\n' + (styleText[category] || styleText.story) + '\n' : '';

const transitionBlock = askTransition ?
  'Choose the TRANSITION family its cuts use, by THEME. A few cuts get it, never all:\n' +
  '- push: the next picture slides the last one out, sideways or upward. Energetic, forward-moving: journeys, sport, business, technology, lists.\n' +
  '- crossfade: one picture dissolves into the next. Gentle and continuous: nature, history told calmly, memory, biography, bedtime stories.\n' +
  '- blur: the picture blurs away into the next, sometimes smearing sideways. Dreamlike or reflective: mystery, the past, emotion, travel.\n' +
  '- shutter: two black halves snap shut and open on the next picture. Mechanical and punchy: engineering, industry, war, crime, investigation.\n' +
  '- glitch: a short digital jolt. Modern and edgy: the internet, science fiction, cyberpunk, hacking, technology gone wrong.\n' +
  '- none: plain cuts only. When any movement between pictures would feel wrong for the film.\n\n' : '';

const lang = String(r.language || 'English').slice(0, 40);
const QUOTE = 'Each graphic carries quote = the EXACT words of that scene\'s text it is about, copied character for character, 1 to 8 words. A graphic without an exact quote is rejected. ';
const graphicsBlock = !graphics ? '' : category === 'kids' ?
  'Then choose the GRAPHICS. You are shown the still of each scene. Every graphic belongs to ONE scene:\n' +
  '- character: a named character, the FIRST scene where they are clearly visible and named. title = the name as the story says it, plus at most 3 words of who they are ("Pip the Bunny Builder"). box = where they stand in THAT scene\'s still, as [x, y, width, height] fractions of the picture (0 to 1), tight around their head and body.\n' +
  '- speech: a short line, at most 8 words, that a character says or clearly feels, taken word for word from the scene text ("Oh dear. It is gone!"). box = the speaking character in that scene\'s still, as above.\n' +
  '- moment: a little discovery or surprise, as a sticker of at most 3 words ("Clue found!", "Found it!").\n' +
  '- celebrate: the scene of the happy ending, once.\n' +
  QUOTE +
  'Rules: at most one graphic per scene; at most ' + B.characters + ' characters, ' + B.speech + ' speech lines, ' + B.moments + ' moments and 1 celebrate. A character only where the still shows them. Write in ' + lang + '.\n'
  : category === 'cinematic' ?
  'Then choose the GRAPHICS. The scene texts are shot descriptions of a film with no narration. Choose location SLATES:\n' +
  '- slate: on the first shot of a new place or time. title = the place in at most 3 words ("Megabuilding H10"); subtitle = the time or the wider place in at most 4 words ("Night City · 18:42"), only from what the shot text says.\n' +
  QUOTE +
  'Rules: at most ' + B.slates + ' slates, never two in a row. Write in ' + lang + '. Never invent a place the shot text does not name or describe.\n'
  :
  'Then choose the GRAPHICS. Every graphic belongs to ONE scene and labels something that scene\'s narration SAYS:\n' +
  '- person: someone named in the scene. title = the name as spoken; subtitle = their role or title in at most 5 words as the narration gives it ("emperor", "prefect of the grain supply"), never what they did; leave it empty when the narration gives none.\n' +
  '- place: a named place in the scene. title = the place as spoken; subtitle = where or what it is in at most 6 words, taken from the narration.\n' +
  '- stat: ONE figure spoken in the scene. value = the number as digits (40 for "forty million" with suffix "M"); suffix = at most 3 letters or % (%, M, K, B, km); label = what it counts in at most 5 words; caption = optional context in at most 8 words. A range ("20 to 40 million") or an approximate figure is not a stat.\n' +
  QUOTE +
  'Rules: a person or place is tagged only the FIRST time it matters, never twice. At most one graphic per scene. At most ' + B.tags + ' person and place tags in total and at most ' + B.stats + ' stats. Fewer is better than weak ones: skip generic places ("the city"), unnamed people and round rhetorical numbers. ' +
  'Write titles and subtitles in the film\'s language (' + lang + '). Never invent a fact the narration does not state.\n';

const itemShape = category === 'kids'
  ? '{"kind": "character"|"speech"|"moment"|"celebrate", "scene": <scene number>, "quote": "...", "title": "...", "text": "...", "label": "...", "box": [0, 0, 0, 0]}'
  : category === 'cinematic'
    ? '{"kind": "slate", "scene": <scene number>, "quote": "...", "title": "...", "subtitle": "..."}'
    : '{"kind": "person"|"place"|"stat", "scene": <scene number>, "quote": "...", "title": "...", "subtitle": "...", "value": 0, "suffix": "", "label": "...", "caption": "..."}';

const scenesText = scenes.map((s) =>
  'SCENE ' + s.order + (Number(s.chapter) > 0 ? ' (chapter ' + s.chapter + ')' : ' (cold open — never place anything here)') +
  ': ' + String(s.text || '').replace(/\s+/g, ' ').trim().slice(0, 900)
).join('\n');

// Kids: the stills go in with the text, low detail, one per story scene that
// has one — a label in the user message ties each picture to its scene.
const userContent = [{ type: 'text', text:
  'Film: ' + String(r.name || '').trim().slice(0, 200) +
  '\nCategory: ' + category + (r.tone ? '\nTone: ' + String(r.tone).slice(0, 60) : '') +
  (graphics && picked ? '\nThe producer already chose the graphic style "' + picked + '": return it as style.' : '') +
  '\nLength: ' + Math.round(length) + ' seconds\n\n' + scenesText.slice(0, 60000) }];
const withImages = graphics && category === 'kids';
if (withImages) {
  for (const s of body.slice(0, 24)) {
    if (!s.image) continue;
    userContent.push({ type: 'text', text: 'Still of SCENE ' + s.order + ':' });
    userContent.push({ type: 'image_url', image_url: { url: MEDIA + String(s.image).replace(/^\/+/, ''), detail: 'low' } });
  }
}

const payload = {
  model: 'gpt-5.4',
  response_format: { type: 'json_object' },
  messages: [
    {
      role: 'system',
      content:
        'You design the on-screen look of a short film. ' +
        styleBlock + transitionBlock + graphicsBlock +
        'Answer with JSON only: {' +
        ((graphics && !picked) ? '"style": "<id>", ' : '') +
        (askTransition ? '"transition": "<id>", ' : '') +
        '"why": "<one sentence>"' +
        (graphics ? ', "items": [' + itemShape + ']' : '') +
        '}'
    },
    { role: 'user', content: userContent }
  ]
};
return [{ json: {
  project_id: id,
  picked,
  picked_transition: pickedTransition,
  graphics,
  category,
  styles: STYLES,
  budgets: B,
  max_tags: B.tags,
  max_stats: B.stats,
  media: MEDIA,
  scenes,
  payload,
} }];
