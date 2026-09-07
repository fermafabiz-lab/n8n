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

// The HOOK is the one clip that decides whether the film is watched at all,
// and there is exactly one per film — the only per-film cost that does not
// grow with the number of scenes. Switchable: hookVideoModel.
const isHook = Number(f['Ordine Scenă']) === 1;
const hookModel = opts.hookVideoModel === undefined ? PAID : String(opts.hookVideoModel);
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
console.log('VIDEO ' + f['Ordine Scenă'] + ': ' + model + ' (' + why + '), seed ' + seed + ', ' + takes + ' previous take(s)');

return [{ json: Object.assign({}, $json, { videoRequest: {
  email: rb.Flow_Email || 'fermafabiz@gmail.com',
  model: model,
  prompt: String(f['Video Scenă URL'] || '') + ' Continuity: everything that moves travels the same way as the subject — no oncoming vehicles, nobody walking or driving against the flow, no reversed motion, and no subject that appears, disappears or duplicates. Audio: quiet natural ambient sound effects that match the scene only — no speech, no voices, no singing, no narration, no music, no soundtrack.',
  startImage: f['Image Media ID'],
  aspectRatio: (rb.Aspect_Ratio === '9:16' ? 'portrait' : 'landscape'),
  seed: seed,
  count: 1,
  async: true,
  captchaRetry: 1,
} }) }];
