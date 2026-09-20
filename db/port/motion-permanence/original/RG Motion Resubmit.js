// Back to Submit Video Regen for one more take — differently, and carrying
// the payload, because that node reads `$json` (the reason both guards around
// it re-feed `Prep Video Regen`'s output).
//
// A plain resubmit would return the same clip: `Prep Video Regen` derives the
// seed from the scene id and the takes already FILED, and a take rejected by
// the judge is never filed. See `Motion Resubmit` on the batch path for the
// same reasoning and for why morph is the one verdict a new seed cannot fix.
const v = $json; // RG Motion Verdict, reroll branch
const p = $('Prep Video Regen').first().json;
const sd = $getWorkflowStaticData('global');

// The previous take already spent some of this scene's poll budget; without
// this the new job could be declared timed out on arrival. `Regen Resubmit
// Guard` does the same.
sd.regenPolls = sd.regenPolls || {};
sd.regenPolls[p.id] = 0;

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const seed = hash(String(p.id) + ':rgmotion:' + v.attempt) % 2147483647;
const dropEndFrame = v.morph === true;

console.log('RG MOTION ' + p.id + ': resubmitting with seed ' + seed + (dropEndFrame ? ', WITHOUT the end frame (morph)' : ''));
return [{ json: Object.assign({}, p, { sceneId: p.id, seed: seed, dropEndFrame: dropEndFrame, attempt: v.attempt }) }];
