const r = $json.regen;
if (!r) throw new Error('No regen payload.');
if (!r.imageId) throw new Error('Scene ' + r.id + ' has no Image Media ID — cannot regenerate its video (regenerate/approve its image first).');
if (!r.motionPrompt) throw new Error('Scene ' + r.id + ' has no motion prompt (Video Scenă URL).');

// Which model this re-roll deserves. Same rule as Current Scene, and the two
// must keep agreeing — a rescued clip that obeys a different rule from its
// neighbours is a new inconsistency.
//
// This is where the rescue actually fires: the main path only submits scenes
// with NO clip at all, so a scene on its third attempt can only arrive here.
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
const FREE = 'veo-3.1-lite-low-priority';
const PAID = 'veo-3.1-quality';
const base = String(opts.videoModel || FREE);

// Takes already filed for this shot, read from the scene the gate fetched.
let takes = 0;
try {
  const row = $('Fetch Scene Videos').all().find((x) => x.json && x.json.id === r.id);
  const v = row ? ((row.json.fields || {})['Versiuni Media']) : null;
  const list = Array.isArray(v) ? v : JSON.parse(String(v || '[]'));
  takes = list.filter((e) => e && e.kind === 'video').length;
} catch (e) { takes = 0; }

// Two free takes the producer has already refused is the evidence that this
// shot is not something the free tier can do. Everything before that is a
// coin flip worth re-flipping for nothing.
const rescue = opts.rescueVideoModel === undefined ? PAID : String(opts.rescueVideoModel);
const model = (base === FREE && takes >= 2 && rescue && rescue !== FREE) ? rescue : base;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const seed = hash(String(r.id || '') + ':' + takes) % 2147483647;
console.log('VIDEO REGEN ' + r.id + ': ' + model + (model === base ? '' : ' (rescue after ' + takes + ' takes)') + ', seed ' + seed);

return [{ json: Object.assign({}, r, { model: model, seed: seed, takes: takes }) }];
