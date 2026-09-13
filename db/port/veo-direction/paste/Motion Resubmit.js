// Send the scene back to Submit Video for one more take — differently.
//
// A plain resubmit would be pointless. `Current Scene` derives the seed from
// the scene id and the number of takes already FILED, and a take rejected
// here is never filed, so the second submission would carry the same seed,
// the same prompt and the same frames — and Veo would return the same clip.
// (The existing `Resubmit Guard` has the same blind spot, harmlessly: it
// retries jobs that FAILED, where an identical request is the right thing.)
// So this node hands Submit Video two overrides, and the expression there
// applies them only when the scene ids match.
const v = $json; // Motion Verdict, reroll branch
const sd = $getWorkflowStaticData('global');

// Polls are counted per scene and the previous take already spent some of
// them; without this the new job could be declared timed out on arrival.
// `Resubmit Guard` does exactly the same for the same reason.
sd.polls = sd.polls || {};
sd.polls[v.sceneId] = 0;

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const seed = hash(String(v.sceneId) + ':motion:' + v.attempt) % 2147483647;

// MORPH IS THE ONE VERDICT A DIFFERENT SEED CANNOT FIX. It means the two
// frames were too far apart for the interpolator, so it dissolved between
// them instead of moving anything — and the same two frames will dissolve
// again at any seed. The right answer is to give up the end frame for this
// scene and let Veo animate freely from the still, which is exactly what the
// film did before end frames existed.
const dropEndFrame = v.morph === true;

console.log('MOTION ' + v.ord + ': resubmitting with seed ' + seed + (dropEndFrame ? ', WITHOUT the end frame (morph)' : ''));
return [{ json: { sceneId: v.sceneId, ord: v.ord, seed: seed, dropEndFrame: dropEndFrame, attempt: v.attempt } }];
