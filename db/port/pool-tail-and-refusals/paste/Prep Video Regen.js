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
// TWO ENTRY POINTS (2026-09-17), and this node is the only one that can
// tell them apart. Everything below it reads its context off THIS node's
// output, which is why the rest of the tail has no outside reference left
// and can be reached from a webhook at all.
const viaWebhook = (() => { try { return $('Video Regen Webhook').isExecuted; } catch (e) { return false; } })();

// The project row. On the batch path it is the one `IMG Load Project` fetched
// at the top of the run; on the webhook path `VRW Build Regen` carries the
// same row, read from hov.at_project in the same query as the scene. Both are
// the Airtable-shaped `fields` object, so everything after this is identical.
let projF = {};
try {
  projF = viaWebhook ? ($json.projectFields || {}) : ($('IMG Load Project').first().json.fields || {});
} catch (e) { projF = {}; }
let opts = {};
try { opts = JSON.parse(projF['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }

// 16:9 or 9:16, for `RG End Frame Prompt` and `Submit Video Regen`. The batch
// is told by the orchestrator's workflow input; a webhook run has no
// orchestrator, so it reads the project's own `Format` — which is the very
// field the orchestrator itself reads on Resume and Restart
// (`Fetch Project For Resume`: fields['Format'] || '16:9').
let aspectRatio = '16:9';
try {
  aspectRatio = viaWebhook
    ? String($json.aspectRatio || projF['Format'] || '16:9')
    : String($('Receive Batch Input').first().json.Aspect_Ratio || '16:9');
} catch (e) { aspectRatio = '16:9'; }
if (aspectRatio !== '9:16') aspectRatio = '16:9';
const FREE = 'veo-3.1-lite-low-priority';
const PAID = 'veo-3.1-quality';
const base = String(opts.videoModel || FREE);

// Takes already filed for this shot, read from the scene the gate fetched.
let takes = 0;
let sceneNote = '';
try {
  // Same row, fetched by whichever entry point ran: the gate's
  // `Fetch Scene Videos`, or `VRW Load Scene` one node upstream.
  const fields = viaWebhook
    ? ($json.sceneFields || {})
    : (($('Fetch Scene Videos').all().find((x) => x.json && x.json.id === r.id) || { json: {} }).json.fields || {});
  const v = fields['Versiuni Media'];
  const list = Array.isArray(v) ? v : JSON.parse(String(v || '[]'));
  takes = list.filter((e) => e && e.kind === 'video').length;
  sceneNote = String(fields['Observații Scenă'] || '').trim();
} catch (e) { takes = 0; }

// Two free takes the producer has already refused is the evidence that this
// shot is not something the free tier can do. Everything before that is a
// coin flip worth re-flipping for nothing.
const rescue = opts.rescueVideoModel === undefined ? PAID : String(opts.rescueVideoModel);
const model = (base === FREE && takes >= 2 && rescue && rescue !== FREE) ? rescue : base;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// A SEED IS REPRODUCIBLE UNTIL IT IS REFUSED (2026-09-22). A refused clip
// files no take, so `takes` alone re-rolled the identical seed on every press
// of "Regenerate video" after a filter refusal — the one case where
// reproducing the last result is exactly what nobody wants. This path has no
// per-scene refusal counter (it is its own execution), but the machine note
// the ladder leaves behind says the last attempt was refused; when it does,
// the seed is deliberately fresh. Everywhere else it is what it always was.
const wasRefused = /^(AUTO-|REJECTED)/i.test(sceneNote);
const seed = hash(String(r.id || '') + ':' + takes + (wasRefused ? ':refused:' + Date.now() : '')) % 2147483647;
console.log('VIDEO REGEN ' + r.id + ': ' + model + (model === base ? '' : ' (rescue after ' + takes + ' takes)') + ', seed ' + seed + (wasRefused ? ' (fresh — the last attempt was refused)' : ''));

// `opts`, `aspectRatio` and `viaWebhook` ride along so that NOTHING after
// this node has to ask the outside world. `RG End Frame Prompt` and
// `RG Motion Prep` used to parse Editing Options out of `IMG Load Project`
// themselves and `Submit Video Regen` used to read the aspect off
// `Receive Batch Input`; all three now read them here.
return [{ json: Object.assign({}, r, { model: model, seed: seed, takes: takes, opts: opts, aspectRatio: aspectRatio, viaWebhook: viaWebhook }) }];