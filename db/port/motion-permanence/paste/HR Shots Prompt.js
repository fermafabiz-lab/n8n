// One shot per beat — the hook chapter's rules from Voice Mode's
// hookSegmentRules and the segmenter's image/motion/continuity rules, in a
// second copy kept in lockstep by hand. The scripting run's segmenter is the
// original; this asks for the same fields so the scenes it writes are
// indistinguishable from the ones Save scenes To Airtable1 writes.
//
// 2026-09-13 — THIS COPY IS THE ONE THAT WROTE THE BROKEN CLIP. The café
// film's failing shot was a HOOK scene, so Claude Scripting's rule 6 never
// touched it: Hook Regen writes the hook's scenes from the rules below, and
// they were still the old wording. Rule 5 here is now the same instruction as
// the segmenter's rule 6 (`db/port/motion-permanence/paste/rule6.txt`),
// sentence for sentence, with three deliberate hook-only differences flagged
// at the line itself.
//
// What changed, in the order the producer hit them on screen:
//  - ONE ACTION, NOT A SEQUENCE. Nothing here forbade chaining verbs, so a
//    hook beat came back as "reaches ... strips off ... pivots back toward the
//    swinging door" — three shots asked for in one. Veo fills the eight
//    seconds by performing the first action twice, losing the held object, and
//    walking the subject out of frame and back.
//  - OBJECT PERMANENCE. Nothing said that what a character picks up stays in
//    their hands, and an object that is merely picked up is put down again or
//    vanishes roughly half the time.
//  - AMBIENT MOTION IS NOT FREE. The old rule 5 handed the model
//    "ambient/atmospheric motion only", which reads as a standing order to
//    invent movement, and in a still indoor room the model invents wind: the
//    papers taped to the fridge flapped, and the fridge door and the prep
//    table moved with nobody touching them. Motion is now allowed only where
//    something in frame CAUSES it, indoors there is no weather, and nothing at
//    all is written when nothing causes motion.
//  - NO MOTION ADJECTIVE ON A PROP. "the swinging door" makes Veo swing the
//    door. Write "the door".
//  - THE NEGATIVE IS A BARE NOUN LIST NOW. The old appended clause was eleven
//    "no X" phrases; Google's own Veo guidance is explicit that instructive
//    negation ("no walls", "don't show walls") makes the model render the very
//    thing it names — which is how we came to ask, in the positive prompt, for
//    a subject that "appears, disappears, duplicates".
//  - "Everything else that moves travels the SAME way" is GONE. It is the same
//    sentence round one removed from the submit tail: it forbids the crossings
//    and oncoming traffic a teaser legitimately wants, and a hook is exactly
//    where those shots live.
//
// Note what happens to the appended "Negative:" clause downstream: HR Apply
// stores this prompt in `Video Scenă URL`, and Media Generation's
// `Current Scene`, `Submit Video Regen` and `End Frame Prompt` all SPLIT that
// field on /\s*Negative:\s*/i and keep only the half before it, then append
// their own canonical tail. So the clause below is what the producer reads in
// the site's textarea, not what Veo is sent — and if the two wordings drift
// apart, the textarea starts lying about the film. Grep for "Negative:" to
// find every copy; they must all move together.
const prep = $('HR Prep').first().json;
const hook = $json.hook;
const lines = hook.lines.map((l, i) => (i + 1) + '. ' + l).join('\n');
const style = prep.style || '';
const tone = prep.tone || '';

const system = 'Return ONLY a raw JSON object {"scenes": [...]}. No intro, no markdown.\n\n' +
  'You are a film editor and storyboard artist turning the OPENING TEASER of a film into shots. Each numbered line below is exactly ONE shot; output EXACTLY ' + hook.lines.length + ' scenes, in order, one per line.\n\n' +
  'THIS IS THE HOOK CHAPTER — the film\'s opening teaser, cut FAST. Every numbered line is one SHOT of 2-4 seconds, not an 8-second scene:\n' +
  '(a) scene_duration_seconds is 3 for every shot (6 for a shot whose line describes an empty establishing frame with room for a title).\n' +
  '(b) Composition for a shot that lasts three seconds: ONE strong subject, high contrast, dramatic light, tight or extreme framing — the kind of frame a trailer cuts to. No wide busy scenes that need time to read.\n' +
  '(c) video_motion_prompt: ONE decisive move that reads in a second — a fast push-in, a whip-pan, a hard tracking shot, a crash-zoom — and ONE clear action. Energy over subtlety. Rule 5 governs the rest of the sentence and it bites hardest here: a three-second shot has room for one gesture and nothing else.\n' +
  '(d) A line starting with [SILENT] is a shot note, not narration: copy it VERBATIM as narrator_text (keep the [SILENT] prefix), and build the image and the motion from what it describes. Nothing in it is spoken.\n' +
  '(e) A line describing an establishing frame with space for a title: the image is wide, static-feeling, nobody near the camera, the centre of the frame uncluttered; the motion is a slow, steady CAMERA drift only, and everything inside the frame holds still.\n' +
  '(f) Shots must differ hard from one another (location, subject, scale) — a teaser that shows the same frame three times is not a teaser.\n\n' +
  'CRITICAL OUTPUT HYGIENE: image_prompt and video_motion_prompt are sent VERBATIM to an image/video model. NEVER write rule labels or scaffolding words — no "visual_description", "bible", "[shot type]" or any bracketed placeholder. Flowing prose only.\n\n' +
  'CONTENT SAFETY — absolute for image_prompt and video_motion_prompt: (a) NO visible minors — imply a child off-screen (a small shoe, an empty swing); crowds are "adult men and women". (b) NO real, named or recognizable people — generic descriptions with "no resemblance to any real person". (c) NO graphic violence, gore, wounds or corpses — imply through aftermath, shadows, reactions. A prompt that breaks these gets the shot rejected.\n\n' +
  'Rules:\n' +
  '1. narrator_text: copy the numbered line, character for character (keep a [SILENT] prefix).\n' +
  '2. Use ONLY characters/locations from the STORY BIBLE and weave their full physical description (age, hair, face, exact clothing, colours) into every image prompt where they appear. Write the light INTO each image_prompt (hour, weather, quality of light, where the shadows fall).\n' +
  '3. image_prompt: ONE image per shot — the exact first frame the clip starts from. 60-90 words of flowing prose in English: shot type, the subject in full physical detail, the action frozen at the shot\'s opening instant, the location in detail, the lighting, the colour palette, the lens/framing, ending with the aesthetic tags (' + style + ', ' + tone + ' tone, cinematic, photorealistic, 8k).\n' +
  '4. visual_scene_description: 1-2 sentences of what happens on screen during the shot; something visibly changes.\n' +
  // Rule 5 is Claude Scripting rule 6, verbatim, except for three hook-only
  // deviations: the shot is 2-4 seconds rather than 8, "the next scene" reads
  // "the next shot" because that is the unit this prompt works in, and rule 6's
  // (a)-(d) sublabels are flattened into prose to match the numbering already
  // used here. Every other sentence must stay character-identical to rule6.txt.
  '5. video_motion_prompt: the Veo prompt as flowing prose — camera movement, then subject, then action, then context, then style & ambiance, 25-45 words. ONE ACTION, NOT A SEQUENCE: the shot is two to four seconds, which is one gesture and no more — a reach, a turn, a pour, a step. If the beat wants three things to happen, choose the ONE that carries the story and let the rest be implied by the next shot. Never chain verbs with "then", "and then", or a comma list ("reaches, strips off the stack, and pivots to the door" is three shots, and asking for it in one produces a subject that teleports, drops what it is holding, and walks out and back to fill the time). DIRECTION IS NOT OPTIONAL: whenever anything travels — a person walking, a vehicle, a boat, a crowd — say WHICH WAY, relative to the frame and to the camera ("moves left to right", "recedes away from the camera", "the camera paces alongside at the same speed"), and make it agree with what the still already shows: a car framed from behind drives AWAY, a car framed head-on comes TOWARD the camera. IF THE SUBJECT HOLDS OR PICKS UP ANYTHING, say that it stays in their hands to the end of the shot — an object that is merely picked up is put down again, or vanishes, roughly half the time. Context: describe ONLY motion that something in the shot is actually causing, and name its cause. Steam rises because the machine is on; water ripples because the boat cut it; dust blows because there is wind outdoors. INDOORS THERE IS NO WEATHER — in a room, a kitchen, an office or a stockroom the air is still, and paper, cloth, curtains, hanging signs and loose sheets stay exactly as the still shows them. A SHAFT OF LIGHT IS NOT A CAUSE EITHER: "dust motes turning in the window light" is the one piece of invented air movement that survives the sentence above, because it reads as lighting rather than as weather — but motes only move if the air moves, and indoors the air is still. Light falls, lies across a surface and picks out an edge; it carries nothing. If nothing in the shot is causing motion, write nothing here: a still background is correct and costs nothing, while invented ambient motion is the single commonest way a clip goes wrong (a café stockroom came back with the papers taped to the fridge flapping in a wind that cannot exist indoors, because the prompt said "loose paper edges quiver"). EVERYTHING THE SUBJECT DOES NOT TOUCH HOLDS STILL: doors, drawers, lids, fridges and windows stay in the position the still shows them in, and only the subject\'s own hands move them. Never give a prop a motion word as a label — write "the door", never "the swinging door", because Veo animates the adjective. Style & ambiance: ' + style + ', ' + tone + ' mood, cinematic. Then append this exact clause at the end, and note that it is a NOUN LIST on purpose — Google\'s own Veo guidance is that instructive phrasing ("no walls", "don\'t show walls") makes the model render the very thing it names, so what is unwanted is listed as bare nouns and everything wanted is stated positively above: "Negative: on-screen text, subtitles, captions, watermark, logos, speech, lip movement, dialogue, music, extra people, duplicated subject, morphing, warping, reversed playback."\n' +
  '6. CONTINUITY FIELDS, read by CODE: location = the one bible location this shot is set in, spelled EXACTLY as the bible spells it ("" if nowhere in the bible); characters = every bible character visible, exact names (empty list if none); objects = every bible object visible, exact names; time_of_day = one word: dawn, morning, day, afternoon, dusk, night, overcast, storm, or interior.\n' +
  (prep.kids ? '\nKIDS STORY MODE — the film LOOKS like an animated children\'s film, never like photography: rounded, friendly proportions, no photorealistic humans; keep every movement gentle.\n' : '') +
  '\nEach scene object: scene_number (from 1), scene_duration_seconds, narrator_text, visual_scene_description, image_prompt, video_motion_prompt, location, characters, objects, time_of_day.';

const user = 'STORY BIBLE:\n' + JSON.stringify(prep.bible) +
  '\n\nWHAT THE VIEWER SEES ACROSS THE HOOK (the writer\'s own summary):\n' + (hook.summary || '(none)') +
  '\n\nTHE SHOTS, one per numbered line:\n' + lines;

return [{ json: { payload: { model: 'gpt-5.4', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, hook } }];
