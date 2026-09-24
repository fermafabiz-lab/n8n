// Dialogue instructions for the writing prompts. Empty strings in every
// mode except 'characters', so classic projects render the exact same
// prompt text as before this node existed.
let mode = 'off', cast = [], narration = 'with', category = '', catOpts = {}, hookStyleWanted = '', facesOffOpt;
try {
  const pf = ($('Fetch Project Record').first().json || {}).fields || {};
  const o = JSON.parse(pf['Editing Options'] || '{}') || {};
  mode = String(o.multiVoiceMode || 'off');
  cast = Array.isArray(o.cast) ? o.cast : [];
  narration = String((o.categoryOptions || {}).narration || 'with');
  category = String(o.category || '');
  catOpts = (o.categoryOptions && typeof o.categoryOptions === 'object') ? o.categoryOptions : {};
  hookStyleWanted = String(o.hookStyle || '').trim().toLowerCase();
  facesOffOpt = o.facesOff;
} catch (e) {}
// A silent film overrides every voice mode: nobody speaks at all.
// Since 2026-09-23 a Cinematic film is written by Cine Treatment and Cine
// Shot List, not by Write Full Narration, so `narrationRules` below is no
// longer read for one; `segmentRules` and `hookRules` still are.
const cinematic = category === 'cinematic';
const characters = !cinematic && mode === 'characters' && cast.length > 0;
const noNarrator = characters && narration === 'none';
const narrationRules = cinematic ? `\nSILENT FILM MODE — THIS FILM HAS NO NARRATION AND NO SPOKEN WORDS AT ALL (as important as the word count rule). This REPLACES rule 16 ("the voice says what the picture cannot"): here there is no voice, and the text IS the picture plan.\nThe text you write is a SILENT VISUAL BEAT SHEET: it is never spoken, never synthesized, never shown on screen. It exists only to drive the edit — each ~20-22 word beat becomes one 8-second shot, so the word count rule above still applies exactly.\nRules:\n(a) Terse, concrete, PRESENT-TENSE visual action — what the camera sees, one event per beat ("The black coupe snaps sideways into the hairpin, gravel spraying off the cliff edge").\n(b) No dialogue, no quotes, no inner thoughts, no addressing the viewer — nobody speaks in this film.\n(c) Every beat implies SOUND: engines, impacts, weather, footsteps, machinery — the film is carried entirely by the natural sound of what is on screen.\n(d) The story still escalates beat to beat like a real film: setup, build, payoff.\n` : !characters ? '' : noNarrator ? `\nDIALOGUE MODE — THIS FILM IS CHARACTER-DRIVEN, WITH NO NARRATOR AT ALL (as important as the word count rule).\nEvery single beat is SPOKEN by a Story Bible character; the tag [NARRATOR] is FORBIDDEN and must never appear. Rules:\n(a) Tag EVERY beat with its speaker at the start of the line, exactly: [CHARACTER: Name] — Name must match a Story Bible character name exactly. Never leave a line untagged.\n(b) Scene-setting, time jumps and transitions are carried by the characters themselves — what they say, notice, or react to — never by narration.\n(c) Dialogue is natural speech: contractions, hesitations, rhythm. Characters reveal the story by talking to each other; no exposition dumps, no character narrating facts at the camera.\n(d) Beats stay ~20-22 words (tags count as zero words); the total word count rule above still applies.\n(e) A character line is FIRST-PERSON SPEECH. Never write third-person narration inside a character tag — "he slides the stub into her notebook" is narration wearing a costume. If a beat cannot be said naturally by a character, rewrite it as something a character would actually say.\n` : `\nDIALOGUE MODE — THIS FILM IS CHARACTER-DRIVEN (as important as the word count rule).\nThe chapter is carried by the Story Bible characters SPEAKING to each other in direct dialogue. Rules:\n(a) 60-80% of the words are spoken lines; the narrator appears only in short connective beats (scene-setting, transitions), never to explain what dialogue could show.\n(b) Tag EVERY beat with its speaker at the start of the line, exactly: [NARRATOR] for narration, [CHARACTER: Name] for speech — Name must match a Story Bible character name exactly. Never leave a line untagged.\n(c) Dialogue is natural speech: contractions, hesitations, rhythm. Characters reveal the story by talking to each other; no exposition dumps, no character narrating facts at the camera.\n(d) Beats stay ~20-22 words (tags count as zero words); the total word count rule above still applies.\n`;
const segmentRules = cinematic ? `\nCINEMATIC FILM — EVERY SHOT IS ALREADY DESIGNED (this section overrides rule 5 and the VISUAL VARIETY rule wherever they differ). The film has no narration at all: each numbered line above is one shot from the director's shot list, in the form "SHOT SIZE AND ANGLE · CAMERA MOVE · WHAT HAPPENS · LIGHT · Sound: …". It is never spoken and never captioned.\n(a) narrator_text: copy the line verbatim, exactly as rule 1 says.\n(b) EXECUTE the shot the line designs: the image_prompt opens with the line's shot size and angle and shows its subject at the first instant of its action, in the line's light; the video_motion_prompt's camera movement IS the line's camera move, and its action IS the line's action, travelling the way the line says. Add everything the line leaves to you — the bible's full visual descriptions, the place in its current state, the palette, the lens — and keep the shot itself as written.\n(c) visual_scene_description: what this shot shows across its 8 seconds, in two sentences taken from the line.\n(d) The shot list already carries the edit's rhythm — its changes of shot size, its match cuts between sequences, its light moving through the hours — so following it line by line IS the visual variety this film needs; time_of_day and location follow the line and the chapter plan.\n(e) SOUND: the line's Sound field goes into the video_motion_prompt's style & ambiance, written as what is heard ("the chip of the spade in wet clay, larks overhead"), before the closing clause — the film's only audio besides music is the natural sound of what is on screen.\n` : !characters ? '' : `\nDIALOGUE MODE: the chapter script contains speaker tags ${noNarrator ? '[CHARACTER: Name] (no narrator exists in this film)' : '[NARRATOR] and [CHARACTER: Name]'}. In narrator_text PRESERVE every tag verbatim: each copied line keeps its tag, and if you split a tagged passage across two scenes, repeat the tag at the start of the second part. A scene may contain several tagged lines. In every image prompt, put the SPEAKING character(s) on screen — paste their full visual_description — and match the shot to the exchange (over-the-shoulder for confrontations, close-up for whispered lines).\n`;
const hookRules = cinematic ? `\nTHIS FILM HAS NO NARRATION: nothing in the hook is spoken either. Only the SILENT hook styles are available (slate, action, cliffhanger) — every beat you write is a shot note the camera performs, never a line a voice reads.\n` : !noNarrator ? '' : `\nTHIS FILM HAS NO NARRATOR. The hook too is SPOKEN by a Story Bible character, in first person, and must start with its speaker tag exactly: [CHARACTER: Name] (Name matching the Story Bible). Never write untagged narration — untagged text would fall back to a narrator voice that does not exist in this film.\n`;
// KIDS STORY MODE is ADDITIVE: it composes with whatever voice mode is on
// (a silent kids film keeps the silent-film rules, a dialogue one keeps its
// tags) instead of replacing it, so the blocks below only ever APPEND.
// Non-kids projects append empty strings and render byte-identical prompts.
const kids = category === 'kids';
// The look is ONE mandatory prefix on every image_prompt, so adding a style
// is adding a line here plus a choice in the site's categories.ts — and the
// prefix lands in the STORED prompt, which is why every regeneration path
// (IR Build Request, Build Image Request, the refusal rewrites) inherits it
// for free. The two original keys keep their exact old strings, so every
// film already made renders byte-identical prompts.
//
// One list rather than a Dimension x Technique pair: crossed controls would
// offer "2D claymation" and "3D watercolor", which are not things. Each
// label on the site carries its own dimension instead.
//
// Every prefix is a POSITIVE noun phrase. A style described by what it is
// not ("not photorealistic") is the negation trap that makes the model
// render the thing named — see the ambient-motion rule.
const KIDS_STYLES = {
  // --- 2D ---
  illustrated: "Children's storybook illustration, soft watercolor and gouache textures, warm pastel palette, rounded friendly character shapes, gentle diffuse lighting",
  crayon: "Children's crayon and chalk drawing, thick waxy strokes, visible paper tooth, bright primary colours, joyful naive proportions",
  papercut: 'Paper cut-out collage animation still, layered coloured paper with visible torn edges and soft drop shadows, flat storybook depth, warm craft-paper palette',
  cel: 'Classic hand-painted 2D cel animation still for children, clean confident ink outlines, flat gouache colour fills, painted background art, warm saturated palette',
  // --- 3D ---
  cartoon3d: 'High-quality 3D animated film still for children, soft rounded character design, expressive friendly faces, vivid warm colors, cinematic soft lighting',
  brick: 'Scene built from interlocking plastic toy bricks, glossy moulded minifigures with cylindrical hands and printed smiling faces, visible studs and brick seams, bright primary colours, macro toy photography lighting',
  clay: 'Stop-motion clay animation still, hand-modelled plasticine characters with visible fingerprints and sculpting marks, soft matte surfaces, miniature handcrafted set, warm practical lighting',
  felt: 'Needle-felted wool and soft-toy animation still, fuzzy fibre textures, hand-stitched seams and button eyes, cosy handmade miniature set, warm soft lighting',
};
const kidsStyleKey = Object.prototype.hasOwnProperty.call(KIDS_STYLES, String(catOpts.visual_style || ''))
  ? String(catOpts.visual_style)
  : 'illustrated';
const kidsStylePrefix = KIDS_STYLES[kidsStyleKey];
// The three physically animated styles move differently, and a smooth CGI
// glide over clay reads as the wrong medium entirely.
const kidsStopMotion = kidsStyleKey === 'clay' || kidsStyleKey === 'brick' || kidsStyleKey === 'felt';
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
(c) In every video_motion_prompt keep movement gentle and easy to follow — a picture book coming softly to life, never fast or violent action.${kidsStopMotion ? '\n(d) The film is animated frame by frame by hand: movement carries the small deliberate steps and slight pose-to-pose snap of stop motion, and the camera moves in short simple pushes.' : ''}
`;
// ---- Faces and speech, 2026-09-22 ----
//
// Google's video filter refuses two things a photorealistic film is made of,
// and each refusal costs a whole generation: a human FACE turned to camera
// (`PROMINENT`, "recognizable real person" — a generated photoreal face trips
// it too), and a still of someone about to SPEAK (`AUDIO_GENERATION_FILTERED`:
// the video model invents a soundtrack from the still, and a voice is what is
// refused). Measured on the first real film through the account pool: 22 of
// 54 scenes refused at least once, 21 of them with a face or a person mid-
// conversation in the image prompt; scenes with neither were refused 1 in 7.
// Full account: db/port/pool-tail-and-refusals/README.md, step 1c.
//
// Keyed on STYLE, not category: that film was `category: story` with a
// Documentary tone and style, and rule 3 of the segmenter ends every image
// prompt in "cinematic, photorealistic, 8k" for every film that is not a
// kids film — so "not kids" IS "photorealistic" in this pipeline. The kids
// styles are drawn, and drawn faces do not trip the filter.
//
// `Editing Options.facesOff` is a strict boolean OFF switch, like `endFrame`:
// only the literal `false` turns the rule off, because there is no UI for
// the key yet and a hand-typed "false" must not silently disable a rule that
// costs an hour a film. The rule is APPENDED, like the kids block, so a film
// with it off renders byte-identical prompts.
const facesOff = !kids && facesOffOpt !== false;
const facesSegment = !facesOff ? '' : `
FACES AND SPEECH — the video filter refuses two things, and each refusal costs a whole generation (22 of 54 scenes on one film): a photorealistic human FACE turned toward the camera, and a still that shows someone about to SPEAK — a video call on screen, a headset at an ear, a microphone, an open mouth, two people face to face mid-conversation — because the video model invents a soundtrack from the still and a voice is what gets refused. So in every image_prompt and video_motion_prompt, people are framed from behind, in profile at a distance, as silhouettes, as hands and objects, or as a figure small in a wide shot; a face fills the frame only on the cast sheet, never in a scene. A call or a conversation is shown as the screen seen over a shoulder, the desk before or after the call, the headset lying on the desk, the back of the listener, the empty chair — the speaker's mouth stays out of frame. Write what the frame CONTAINS ("seen from behind", "in profile on the far side of the room", "hands on the keys"); an instruction written as an absence makes the model render the thing it names. This overrides the face half of rule 2: weave clothing, hair, build and posture into every prompt, and keep the face turned away.
`;
const kidsHook = !kids || cinematic || noNarrator ? '' : `
KIDS STORY: open like a storyteller inviting a child in — warm, curious, direct ("Have you ever wondered...?") — never dramatic or ominous.
`;

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
const closingOutline = !closingWanted ? '' : `
THE RESOLUTION — a story is not over when its climax is. AFTER the last turning point comes the resolution: the final situation of the characters. Plan it as its own beat, the last in the film, set later in time than the climax (that evening, the next morning, a season on): where each main character ends up, what is settled, what they keep or have lost, what is different now that the conflict is over. It answers the throughline; it belongs to no turning point and is never the climax retold. Put it in the spine's "ending" field, and give the LAST chapter a third closing line, RESOLVES WITH, after its LEADS INTO line (see below). The resolution takes one scene of the ceiling above: a story that needs its last scene for its ending drops one escalation, never the ending.${kids ? `
FOR A CHILDREN'S STORY the resolution is WARM, and this REPLACES beat 5 of the dramatic structure above whatever it says: the hero is safe and home, the small problem is mended, everyone is accounted for — nobody is left behind, lost or shut away, and nothing stays wrong — and the gentle lesson is worn lightly in the last line.` : ''}
`;
const closingOutlineLine = !closingWanted ? '' : `RESOLVES WITH: <LAST chapter only, a third line: the final situation of the characters AFTER the climax — 2-3 sentences the narration will say out loud, a moment later in time than the climax, never the climax itself${kids ? '; warm, everyone safe and together, the gentle lesson in the last sentence' : ''}>`;
const closingNarration = !closingWanted ? '' : `
17. THE RESOLUTION (this completes rule 15 for a story). After the climax, write the resolution as the LAST PARAGRAPH of the last chapter, on its own, separated from the climax by a blank line: 2-3 sentences, 18-45 words, set later in time than the climax (that evening, the next morning, a season on — name the time, never signpost it), saying where the characters end up and what is different now that the conflict is settled. It is the plan's RESOLVES WITH line told in the film's own particulars; it names the protagonist; it is not the climax retold, not a summary, and not a camera position. A film that ends on its climax stops instead of ending, and an editor CHECKS for this paragraph.${kids ? `
For a children's story the resolution is warm: the hero safe and home, the problem mended, everyone together — and the gentle lesson in the last sentence, worn lightly, the way a picture book closes.` : ''}
`;
const closingEditor = !closingWanted ? '' : `
4c. THE RESOLUTION — the film must not end on its climax. The last chapter ends with a separate final paragraph (a blank line before it) of 2-3 sentences, 18-45 words, set later in time than the climax, saying where the characters end up and what is different now that the conflict is settled — the plan's RESOLVES WITH line. If the draft's last paragraph IS the climax, or the resolution is one clause glued to it, write the paragraph.${kids ? " For a children's story it is warm: everyone safe, home and together, the problem mended, the gentle lesson in the last sentence." : ''}
`;
const closingSegment = !closingWanted ? '' : `
THE RESOLUTION SCENE: when this chapter's plan carries a RESOLVES WITH line, its LAST numbered narration line is the resolution — a moment later in time than the climax. Stage it as a settled, wider, calmer shot than the one before it (a different hour of the bible's lighting progression, the characters at rest or arriving home, the conflict visibly over), with ONE slow camera move, so the film lands instead of stopping.
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
return [{ json: { mode, characters, noNarrator, cinematic, kids, facesOff, castSize: cast.length, narrationRules: narrationRules + kidsNarration + closingNarration, segmentRules: segmentRules + kidsSegment + closingSegment + facesSegment, hookRules: hookRules + kidsHook, closing: { wanted: closingWanted, kids: closingWanted && kids }, closingOutline, closingOutlineLine, closingEditor, hookStyle: hookForced ? hookAllowed[0] : 'auto', hookStyleWanted: HOOK_STYLES.includes(hookStyleWanted) ? hookStyleWanted : 'auto', hookAllowed, hookForced, hookSilentStyles: SILENT_HOOK_STYLES, hookStyleRules, hookSegmentRules } }];