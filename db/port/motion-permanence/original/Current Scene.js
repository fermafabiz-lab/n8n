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
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const seed = hash(String($json.id || '') + ':' + takes) % 2147483647;

// count is deliberately 1. Two takes per submission is free on the
// low-priority tier, but at three films a day the scarce resource is QUEUE
// TIME, not credits: asking for a second take of every scene halves the
// throughput ceiling to save a click on the tenth of scenes that need it.
// Turning it on also needs somewhere for take B to live — a Flow URL dies in
// about six hours, so it would have to go through the same Drive re-host the
// live clip does before the site could file it as a draft.

// THE DIRECTION CLAUSE, and why the old one made things worse.
//
// The segmenter's rule 6 works: motion prompts really do state direction now
// ("surges right to left out of the substation", "advances away from the
// camera"). What was appended underneath them did not.
//
// The old tail opened with "everything that moves travels the same way as the
// subject — no oncoming vehicles, nobody walking or driving against the flow".
// That is not a general truth, it is a rule that FIGHTS the shots this
// pipeline legitimately writes: scene 101 of the LEGO chase film asks for the
// cruiser right-to-left WITH the Ferrari left-to-right ahead of it, which the
// clause forbids outright. A chase, a crossing, a car pulling out into traffic
// — every one of them breaks it. Handed a prompt and a rule that contradict
// each other, the weakest model on the tier resolves the contradiction
// whichever way it likes, and that is a coin flip on every clip.
//
// "no reversed motion" went with it. It reads two ways (reverse PLAYBACK, or a
// vehicle driving backwards), and it is a negation — naming the thing you do
// not want is a poor way to not get it. What replaces it is positive and sits
// at the FRONT, where a model weights it most: play the action as written, in
// the direction written, starting from the given frame.
//
// What stays is what was never in dispute: solidity, drivers, no popping in
// and out, and the audio guardrail. Parallax is kept too, but phrased as the
// background agreeing with the camera rather than as a ban on anyone moving
// the other way.
const SHOT_RULES = 'Single continuous shot, no cuts and no scene changes. Begin exactly on the given frame and play the action below as written, in the direction written. ';
const WORLD_RULES = ' Physics: solid things stay solid — vehicles, people and objects never pass through each other, never overlap and never sink into the ground; every moving vehicle has its driver (visible, or plausibly hidden by the bodywork); nothing floats, melts or morphs; nobody and nothing appears, disappears or duplicates. Backgrounds and camera move consistently with the subject, so parallax reads correctly. Audio: quiet natural ambient sound effects that match the scene only — no speech, no voices, no singing, no narration, no music, no soundtrack.';
const motionPrompt = SHOT_RULES + String(f['Video Scenă URL'] || '') + WORLD_RULES;

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
