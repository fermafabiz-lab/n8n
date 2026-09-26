// The scene, unchanged, plus the video request built for it.
//
// Built HERE because three edges reach Submit Video — the first submit, the
// resubmit guard and the cooldown retry — and all three read
// $('Current Scene'), so deciding once per scene keeps them agreeing and
// needs no rewiring.
const f = $json.fields || {};
const rb = $('Receive Batch Input').first().json;

let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }

// FREE BY DEFAULT, and that is the business model rather than a saving.
// veo-3.1-lite-low-priority costs 0 credits on Ultra $199 at any volume. At
// three films a day of eighty scenes — 7,200 clips a month — the same work on
// Fast would be 72,000 credits against an allowance of 25,050, so no paid
// tier can be the default at this scale. Credits buy the exceptions.
const FREE = 'veo-3.1-lite-low-priority';
const PAID = 'veo-3.1-quality';
const base = String(opts.videoModel || FREE);

// How many takes of this shot already exist. `Versiuni Media` is the draft
// list the site keeps, and every regeneration files the outgoing clip there,
// so its length is the number of times this shot has already been tried.
// at_scene emits it as TEXT, hence the parse.
let takes = 0;
try {
  const v = f['Versiuni Media'];
  const list = Array.isArray(v) ? v : JSON.parse(String(v || '[]'));
  takes = list.filter((e) => e && e.kind === 'video').length;
} catch (e) { takes = 0; }

// The HOOK decides whether the film is watched at all, and since 2026-09-11
// it is SEVERAL shots (every scene of chapter 0, orders 1..99), not one. That
// changed the arithmetic: 4-5 hook shots on Quality would be 400-500 credits
// a film, and at three films a day the hooks alone would outspend the 25,050
// monthly allowance. Fast (10 credits a clip) is the producer's choice —
// visibly better than free, ~50 credits a film. Switchable: hookVideoModel.
const ORD = Number(f['Ordine Scenă']);
const isHook = Number.isFinite(ORD) && ORD >= 1 && ORD < 100;
const HOOK_DEFAULT = 'veo-3.1-fast';
const hookModel = opts.hookVideoModel === undefined ? HOOK_DEFAULT : String(opts.hookVideoModel);
let model = base;
let why = 'default';
if (base === FREE && isHook && hookModel && hookModel !== FREE) { model = hookModel; why = 'hook'; }

// A seed makes a re-roll a DIFFERENT take rather than another coin flip, and
// makes a first take reproducible. Derived from the scene id and the number
// of takes already filed, so nothing has to be stored anywhere.
//
// A SEED IS REPRODUCIBLE UNTIL IT IS REFUSED (2026-09-22). A clip the content
// filter refuses files no take, so `takes` stays 0 and every resubmit the
// rewrite ladder made carried the IDENTICAL seed — four attempts were one
// attempt four times (db/port/audio-filter/README.md). `VP Prep` counts the
// refusals per scene in static data; once that counter is non-zero it goes
// into the hash, the same way `Motion Resubmit` mixes its own attempt in, so
// each retry after a refusal is a different roll. Everywhere else the seed is
// exactly what it was.
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
let refused = 0;
try { refused = Number((($getWorkflowStaticData('global').rewrites) || {})[String($json.id || '')] || 0) || 0; } catch (e) { refused = 0; }
const seed = hash(String($json.id || '') + ':' + takes + (refused ? ':refused:' + refused : '')) % 2147483647;

// count is deliberately 1. Two takes per submission is free on the
// low-priority tier, but at three films a day the scarce resource is QUEUE
// TIME, not credits: asking for a second take of every scene halves the
// throughput ceiling to save a click on the tenth of scenes that need it.
// Turning it on also needs somewhere for take B to live — a Flow URL dies in
// about six hours, so it would have to go through the same Drive re-host the
// live clip does before the site could file it as a draft.

// THE PROMPT TAIL, and why it is phrased the way it is.
//
// Round one (2026-09-13 16:42) removed the clause that fought the shot —
// "everything that moves travels the same way as the subject — no oncoming
// vehicles" — which forbade chases and crossings the segmenter legitimately
// writes. That was right and it stays gone.
//
// Round two, the same evening, after a café film came back with a held object
// vanishing, a fridge door opening by itself, papers flapping indoors and the
// subject walking out of frame and back: THIS TAIL WAS ITSELF PART OF THE
// PROBLEM. It read "nothing floats, melts or morphs; nobody and nothing
// appears, disappears or duplicates" — and Google's own Veo guidance is
// explicit that instructive phrasing ("no walls", "don't show walls") makes
// the model render the thing it names, and that what is unwanted belongs in a
// bare NOUN LIST instead. We were naming "disappears", "duplicates" and
// "morphs" in the positive prompt and then getting them.
//
// So everything wanted is now stated as a positive world-state, and one noun
// list at the end carries everything unwanted. Object permanence and prop
// stillness are stated explicitly because they are the two failures the
// producer actually reported, and neither was covered before: nothing here
// used to say that what a character picks up stays in their hands, or that a
// door nobody touches does not move.
//
// The same three changes are in the segmenter (Claude Scripting rule 6) and in
// `Submit Video Regen`. All three must keep agreeing.
const SHOT_RULES = 'One continuous take, filmed in a single unbroken shot. Begin exactly on the given frame and play the action below as written, in the direction written. ';
const WORLD_RULES = ' Keep the world consistent for the whole take: every person, vehicle and object holds its shape, size, colour and identity from first frame to last, and each one stays whole and solid, resting on the ground and passing around other things rather than through them. Whatever the subject is holding stays in their hands until the end of the shot, and anything they pick up stays picked up. Everything the subject does not touch holds still exactly as the first frame shows it — doors, drawers, lids, windows and taped-up paper move only when a hand moves them, and indoors the air is still. Every moving vehicle has its driver. The background moves only as the camera moves, so parallax reads correctly. Audio: quiet natural room tone plus the sounds the action itself makes. Negative: speech, voices, dialogue, singing, narration, music, soundtrack, on-screen text, subtitles, captions, watermark, logos, extra people, duplicated subject, morphing, warping, reversed playback.';
// STRIP ANY LEGACY "Negative:" TAIL OFF THE STORED PROMPT BEFORE COMPOSING.
//
// Two reasons, and the second is the one that makes this urgent.
//
// (1) It repairs every film ALREADY in the database. 368 of the 504 scenes
// written in the last three weeks still end with the old contradictory clause
// ("nothing travels against the flow … no reversed motion"), because the
// segmenter wrote it there hours or days before the 16:42 fix. Stripping at
// submit time fixes all of them at once, with no backfill and no re-scripting.
//
// (2) Without it, everything WORLD_RULES says lands AFTER the token
// "Negative:" — so the physics guardrail is composed inside the negative
// block, and we were asking Veo to avoid solid objects staying solid. Whether
// the model parses "Negative:" as a section header is not something we can
// prove from here, but writing the prompt that way is indefensible either way.
//
// The stored prompt should be the ACTION ONLY. That is what the segmenter now
// writes, what the site's textarea has always written, and what this line
// enforces for everything written before today.
const storedMotion = String(f['Video Scenă URL'] || '').split(/\s*Negative:\s*/i)[0].trim();
const motionPrompt = SHOT_RULES + storedMotion + WORLD_RULES;

console.log('VIDEO ' + f['Ordine Scenă'] + ': ' + model + ' (' + why + '), seed ' + seed + ', ' + takes + ' previous take(s)');

return [{ json: Object.assign({}, $json, { videoRequest: {
  email: rb.Flow_Email || 'fermafabiz@gmail.com',
  model: model,
  prompt: motionPrompt,
  startImage: f['Image Media ID'],
  aspectRatio: (rb.Aspect_Ratio === '9:16' ? 'portrait' : 'landscape'),
  seed: seed,
  count: 1,
  async: true,
  captchaRetry: 1,
} }) }];
