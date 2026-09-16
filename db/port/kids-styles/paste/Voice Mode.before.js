// Dialogue instructions for the writing prompts. Empty strings in every
// mode except 'characters', so classic projects render the exact same
// prompt text as before this node existed.
let mode = 'off', cast = [], narration = 'with', category = '', catOpts = {}, hookStyleWanted = '';
try {
  const pf = ($('Fetch Project Record').first().json || {}).fields || {};
  const o = JSON.parse(pf['Editing Options'] || '{}') || {};
  mode = String(o.multiVoiceMode || 'off');
  cast = Array.isArray(o.cast) ? o.cast : [];
  narration = String((o.categoryOptions || {}).narration || 'with');
  category = String(o.category || '');
  catOpts = (o.categoryOptions && typeof o.categoryOptions === 'object') ? o.categoryOptions : {};
  hookStyleWanted = String(o.hookStyle || '').trim().toLowerCase();
} catch (e) {}
// A silent film overrides every voice mode: nobody speaks at all.
const cinematic = category === 'cinematic';
const characters = !cinematic && mode === 'characters' && cast.length > 0;
const noNarrator = characters && narration === 'none';
const narrationRules = cinematic ? `\nSILENT FILM MODE — THIS FILM HAS NO NARRATION AND NO SPOKEN WORDS AT ALL (as important as the word count rule). This REPLACES rule 16 ("the voice says what the picture cannot"): here there is no voice, and the text IS the picture plan.\nThe text you write is a SILENT VISUAL BEAT SHEET: it is never spoken, never synthesized, never shown on screen. It exists only to drive the edit — each ~20-22 word beat becomes one 8-second shot, so the word count rule above still applies exactly.\nRules:\n(a) Terse, concrete, PRESENT-TENSE visual action — what the camera sees, one event per beat ("The black coupe snaps sideways into the hairpin, gravel spraying off the cliff edge").\n(b) No dialogue, no quotes, no inner thoughts, no addressing the viewer — nobody speaks in this film.\n(c) Every beat implies SOUND: engines, impacts, weather, footsteps, machinery — the film is carried entirely by the natural sound of what is on screen.\n(d) The story still escalates beat to beat like a real film: setup, build, payoff.\n` : !characters ? '' : noNarrator ? `\nDIALOGUE MODE — THIS FILM IS CHARACTER-DRIVEN, WITH NO NARRATOR AT ALL (as important as the word count rule).\nEvery single beat is SPOKEN by a Story Bible character; the tag [NARRATOR] is FORBIDDEN and must never appear. Rules:\n(a) Tag EVERY beat with its speaker at the start of the line, exactly: [CHARACTER: Name] — Name must match a Story Bible character name exactly. Never leave a line untagged.\n(b) Scene-setting, time jumps and transitions are carried by the characters themselves — what they say, notice, or react to — never by narration.\n(c) Dialogue is natural speech: contractions, hesitations, rhythm. Characters reveal the story by talking to each other; no exposition dumps, no character narrating facts at the camera.\n(d) Beats stay ~20-22 words (tags count as zero words); the total word count rule above still applies.\n(e) A character line is FIRST-PERSON SPEECH. Never write third-person narration inside a character tag — "he slides the stub into her notebook" is narration wearing a costume. If a beat cannot be said naturally by a character, rewrite it as something a character would actually say.\n` : `\nDIALOGUE MODE — THIS FILM IS CHARACTER-DRIVEN (as important as the word count rule).\nThe chapter is carried by the Story Bible characters SPEAKING to each other in direct dialogue. Rules:\n(a) 60-80% of the words are spoken lines; the narrator appears only in short connective beats (scene-setting, transitions), never to explain what dialogue could show.\n(b) Tag EVERY beat with its speaker at the start of the line, exactly: [NARRATOR] for narration, [CHARACTER: Name] for speech — Name must match a Story Bible character name exactly. Never leave a line untagged.\n(c) Dialogue is natural speech: contractions, hesitations, rhythm. Characters reveal the story by talking to each other; no exposition dumps, no character narrating facts at the camera.\n(d) Beats stay ~20-22 words (tags count as zero words); the total word count rule above still applies.\n`;
const segmentRules = cinematic ? `\nSILENT FILM MODE: narrator_text is a silent shot note — it is never spoken and never captioned — so keep it a terse description of the visible action. ALL storytelling lives in image_prompt and video_motion_prompt. In every video_motion_prompt make the action's SOUND read clearly from the visuals (a revving engine, screeching tires, pouring rain, a slamming door): the film's only audio is the natural sound of what is on screen.\n` : !characters ? '' : `\nDIALOGUE MODE: the chapter script contains speaker tags ${noNarrator ? '[CHARACTER: Name] (no narrator exists in this film)' : '[NARRATOR] and [CHARACTER: Name]'}. In narrator_text PRESERVE every tag verbatim: each copied line keeps its tag, and if you split a tagged passage across two scenes, repeat the tag at the start of the second part. A scene may contain several tagged lines. In every image prompt, put the SPEAKING character(s) on screen — paste their full visual_description — and match the shot to the exchange (over-the-shoulder for confrontations, close-up for whispered lines).\n`;
const hookRules = cinematic ? `\nTHIS FILM HAS NO NARRATION: nothing in the hook is spoken either. Only the SILENT hook styles are available (slate, action, cliffhanger) — every beat you write is a shot note the camera performs, never a line a voice reads.\n` : !noNarrator ? '' : `\nTHIS FILM HAS NO NARRATOR. The hook too is SPOKEN by a Story Bible character, in first person, and must start with its speaker tag exactly: [CHARACTER: Name] (Name matching the Story Bible). Never write untagged narration — untagged text would fall back to a narrator voice that does not exist in this film.\n`;
// KIDS STORY MODE is ADDITIVE: it composes with whatever voice mode is on
// (a silent kids film keeps the silent-film rules, a dialogue one keeps its
// tags) instead of replacing it, so the blocks below only ever APPEND.
// Non-kids projects append empty strings and render byte-identical prompts.
const kids = category === 'kids';
const kidsIllustrated = String(catOpts.visual_style || 'illustrated') !== 'cartoon3d';
const kidsStylePrefix = kidsIllustrated
  ? "Children's storybook illustration, soft watercolor and gouache textures, warm pastel palette, rounded friendly character shapes, gentle diffuse lighting"
  : 'High-quality 3D animated film still for children, soft rounded character design, expressive friendly faces, vivid warm colors, cinematic soft lighting';
const kidsNarration = !kids || cinematic ? '' : `
KIDS STORY MODE — this film is for young children (about ages 3-8) and every line is read aloud to them (as important as the word count rule).
(a) Short, simple sentences: one idea per sentence, everyday words a small child knows. No abstract vocabulary, no long clause chains.
(b) Warm and playful: the narrator is a storyteller by the bed, not a documentarian — gentle humour, wonder, and an occasional direct question to the little listener ("And do you know what the little fox did next?").
(c) Use repetition and rhythm the way picture books do: a recurring phrase or sound word children can anticipate and say along.
(d) NOTHING frightening: no death, no violence, no monsters played for fear, no peril without quick comfort. Tension stays mild and resolves kindly.
(e) The story still has a real arc — a lovable hero, a small problem, a warm ending with a gentle lesson worn lightly, never preached.
`;
const kidsSegment = !kids ? '' : `
KIDS STORY MODE — the film LOOKS like an animated children's film, never like photography.
(a) START every image_prompt with this exact style prefix, word for word, before anything else: "${kidsStylePrefix}". The style is the film's identity; a single photorealistic frame breaks it.
(b) Render every character and set description from the Story Bible IN that style: rounded, friendly proportions — no photorealistic humans anywhere in this film.
(c) In every video_motion_prompt keep movement gentle and easy to follow — a picture book coming softly to life, never fast or violent action.
`;
const kidsHook = !kids || cinematic || noNarrator ? '' : `
KIDS STORY: open like a storyteller inviting a child in — warm, curious, direct ("Have you ever wondered...?") — never dramatic or ominous.
`;

// ---- The hook: which style, and the rules for it ----
//
// The hook used to be one 18-22 word line over one 8-second shot, with the
// project TITLE typed over it. It is a small film of its own now: a style,
// one shot per beat, and an optional on-screen card. `Editing Options.hookStyle`
// decides — absent or 'auto' lets the model pick from what fits (every film
// gets a real hook either way), a named style forces it. The site's old
// `hookTitle` switch is not read any more.
//
// Three styles are SILENT (slate, action, cliffhanger): their beats are shot
// notes, prefixed [SILENT] by Prepend Hook To Chapters so the scene writer
// stores them with no narration and Media Generation makes no take for them.
// A silent film may only use those; a kids film may not use the two violent
// ones. The list is what Hook Guard enforces, so an unavailable style can
// never reach a scene however the model answers.
const HOOK_STYLES = ['teaser', 'question', 'figure', 'slate', 'action', 'cliffhanger'];
const SILENT_HOOK_STYLES = ['slate', 'action', 'cliffhanger'];
let hookAllowed;
// Absent reads as 'auto' — the same default the site's picker starts on
// (derive.ts normalizeHookStyle), so a film created before the picker
// existed and one that left it alone get the same opening.
if (HOOK_STYLES.includes(hookStyleWanted)) hookAllowed = [hookStyleWanted];
else hookAllowed = HOOK_STYLES.slice();
if (cinematic) hookAllowed = hookAllowed.filter((s) => SILENT_HOOK_STYLES.includes(s));
if (kids) hookAllowed = hookAllowed.filter((s) => ['teaser', 'question', 'slate'].includes(s));
if (!hookAllowed.length) hookAllowed = cinematic ? ['action'] : ['teaser'];
const hookForced = hookAllowed.length === 1;

const HOOK_STYLE_DEFS = {
  teaser: 'TEASER — 3 to 5 SPOKEN beats of 2-10 words each, one shot per beat. The most dramatic stretch of the story told like a trailer: present tense, concrete, each beat a step further in, and NEVER the outcome — the viewer must not learn how it ends. Example shape for a heist story: "One student. / A bank with three vaults. / Past the guards, alone. / Out with the money, and nobody suspects him." card stays empty.',
  question: 'QUESTION — 1 or 2 SPOKEN beats (3-12 words each) plus card.line1 = ONE question on screen, 3-12 words, ending with "?", that the film answers. card.line2 and card.source empty.',
  figure: 'FIGURE — 1 or 2 SPOKEN beats plus card.line1 = ONE number the film states (a year, a sum, a count), copied EXACTLY as the narration or the research pack writes it — never a number you computed or remembered; card.line2 = what it measures, at most 8 words; card.source = the evidence ref (E1..E20) when it comes from the research pack, else "".',
  slate: 'SLATE — exactly 1 SILENT shot note (8-25 words): the establishing frame of the story\'s main location as the bible describes it, no person near the camera, calm, with empty space in the centre of the frame for a title. card.line1 = the PLACE (at most 6 words), card.line2 = the DATE or time as the story states it (at most 6 words; leave "" if the story never states one — do not invent a date). Nothing is spoken.',
  action: 'ACTION — 2 or 3 SILENT shot notes (8-25 words each): the climax IN MOTION — what the protagonist does at the peak, each note one concrete visible action with its sound implied, no faces close to camera. Nothing is spoken; the story starts right after.',
  cliffhanger: 'CLIFFHANGER — 2 or 3 SILENT shot notes (8-25 words each): the moment BEFORE the catastrophe or the turn, tension rising shot by shot, ending on the frame just before the outcome — never the outcome itself. Nothing is spoken; the film then starts from the beginning.',
};
const hookStyleRules =
  '\nHOOK STYLE. ' + (hookForced
    ? 'The producer chose the style ' + hookAllowed[0].toUpperCase() + ' — use it and no other.'
    : 'Choose the ONE style that fits this story best from the list below and name it in "style".') +
  '\n' + hookAllowed.map((s) => '- ' + HOOK_STYLE_DEFS[s]).join('\n') +
  '\nA SPOKEN beat is a line the narrator says. A SILENT shot note is what the camera sees, present tense, never spoken — write it as a shot, not as prose.' +
  '\nThe hook may use only Story Bible characters and locations, and must not reveal how the story ends.\n';

// Handed to the segmenter for the hook chapter only (Ordine 0). The teaser
// is cut fast — a beat is a 2-4 second shot, not an 8-second scene — so the
// composition rules change: high contrast, one strong subject, motion that
// reads in a second.
const hookSegmentRules = `
THIS IS THE HOOK CHAPTER — the film's opening teaser, cut FAST. Every numbered line above is one SHOT of 2-4 seconds, not an 8-second scene, and the rules for this chapter override the ones below where they differ:
(a) scene_duration_seconds is 3 for every shot (6 for a shot whose line describes an empty establishing frame with room for a title).
(b) Composition for a shot that lasts three seconds: ONE strong subject, high contrast, dramatic light, tight or extreme framing — the kind of frame a trailer cuts to. No wide busy scenes that need time to read.
(c) video_motion_prompt: ONE decisive move that reads in a second — a fast push-in, a whip-pan, a hard tracking shot, a crash-zoom — and ONE clear action. Energy over subtlety. Keep the audio direction and the continuity rule exactly as elsewhere.
(d) A line starting with [SILENT] is a shot note, not narration: copy it VERBATIM as narrator_text (keep the [SILENT] prefix), and build the image and the motion from what it describes. Nothing in it is spoken.
(e) A line describing an establishing frame with space for a title: the image is wide, static-feeling, nobody near the camera, the centre of the frame uncluttered; the motion is a slow, steady drift only.
(f) Shots must differ hard from one another (location, subject, scale) — a teaser that shows the same frame three times is not a teaser.
`;
return [{ json: { mode, characters, noNarrator, cinematic, kids, castSize: cast.length, narrationRules: narrationRules + kidsNarration, segmentRules: segmentRules + kidsSegment, hookRules: hookRules + kidsHook, hookStyle: hookForced ? hookAllowed[0] : 'auto', hookStyleWanted: HOOK_STYLES.includes(hookStyleWanted) ? hookStyleWanted : 'auto', hookAllowed, hookForced, hookSilentStyles: SILENT_HOOK_STYLES, hookStyleRules, hookSegmentRules } }];