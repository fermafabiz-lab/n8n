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

// 2026-09-14 — THE RE-ROLL NOW CARRIES WHAT THE JUDGE FOUND. The whole
// argument is written out in `Motion Resubmit` on the batch path and is not
// repeated here: the short of it is that the judge writes FAULTS ("the sleeve
// stack disappears from her hands"), and quoting a fault into a Veo prompt is
// the exact anti-pattern 2026-09-13 was spent removing, so the SIGNAL — never
// the sentence — is mapped to a positive requirement by a fixed literal table
// that cannot smuggle a negation.
//
// LOCKSTEP PAIR WITH `Motion Resubmit`: CLAUSES, SIGNAL_ORDER, MAX_CLAUSES,
// LEAD_IN and UNSAFE are byte-identical there and must stay so. A rescued
// clip corrected by a different director from its neighbours is a new
// inconsistency, which is the same rule `Prep Video Regen` already follows
// for the model choice.
const CLAUSES = {
  permanence: 'Whatever the subject is holding stays in their hands for the whole shot and is there in the final frame; every prop, garment and piece of furniture keeps the shape, colour and cut it has in the opening frame.',
  untouched: 'Every door, drawer, lid, window and taped-up sheet of paper stays exactly as the opening frame shows it, and moves only in the instant a hand moves it; indoors the air is still.',
  loop: 'One single continuous action, performed once and carried straight through to the final frame; the subject ends the take somewhere new, further along than it began.',
  direction: 'Everything that travels keeps the one direction the action above names and holds that heading to the final frame; the camera keeps the move it was given and travels that way throughout.',
  coherence: 'Solid things keep their own space: feet stay on the ground, people and vehicles pass around each other, and every vehicle that moves has a driver at its controls.',
  morph: 'Everything that changes on screen changes because something physically moves — wheels turn, legs step, hands travel — and every shape keeps its own edges for the whole take.',
};
const SIGNAL_ORDER = ['permanence', 'untouched', 'loop', 'direction', 'coherence', 'morph'];
const MAX_CLAUSES = 3;
const LEAD_IN = 'CORRECTION — the new take MUST hold to this: ';
const UNSAFE = /\b(?:no|not|never|none|nothing|nobody|nor|without|avoid\w*|prevent\w*|stop\w*|remove\w*|don't|doesn't|isn't|aren't|disappear\w*|vanish\w*|duplicat\w*|morph\w*|warp\w*|flicker\w*)\b/i;

// `RG Motion Verdict` sends `problems` as the GATE list ("permanence 0.3"),
// not the judge's prose — that only ever reaches `sd.motionNotes`. Read the
// first word; re-check morph/loop off their own booleans so a partial or
// older verdict payload still corrects what it can.
const fired = [];
const seen = (Array.isArray(v.problems) ? v.problems : []).map((x) => String(x).trim().split(/\s+/)[0].toLowerCase());
if (v.morph === true) seen.push('morph');
if (v.loop === true) seen.push('loop');
seen.forEach((k) => { if (CLAUSES[k] && fired.indexOf(k) < 0) fired.push(k); });

const withheld = fired.filter((k) => UNSAFE.test(CLAUSES[k]));
if (withheld.length) console.log('RG MOTION ' + p.id + ': clause withheld, a negation reached the map — ' + withheld.join(', '));
const used = SIGNAL_ORDER.filter((k) => fired.indexOf(k) >= 0 && withheld.indexOf(k) < 0).slice(0, MAX_CLAUSES);
const correction = used.length ? LEAD_IN + used.map((k) => CLAUSES[k]).join(' ') : '';

// WHERE THE CORRECTION LANDS, and why this path differs from the batch.
//
// The two paths compose the prompt in different places, and that difference
// is what decides where the correction goes. `Current Scene` composes the
// batch prompt once into `videoRequest.prompt` and freezes it, so
// `Motion Resubmit` has to hand `Submit Video` a whole replacement prompt.
// Here the guardrails are composed by `Submit Video Regen` ITSELF on every
// submit, around `$json.motionPrompt` — so the correction only has to join
// the ACTION, and it lands in exactly the slot the producer's own
// "ADJUSTMENT REQUEST — the new video MUST follow this: …" lands in from
// `Evaluate Video Approval`. Nothing has to be duplicated, and no fourth
// copy of WORLD_RULES appears in this repo.
//
// The insert is still at the first `Negative:` boundary rather than an
// append: `Evaluate Video Approval` strips the legacy tail before it hands
// this over, but it FALLS BACK to the raw stored string on a tail-only row,
// and `Submit Video Regen` cuts at that same token — so an appended
// correction on such a row would be thrown away. A head of nothing means the
// stored prompt was a bare tail, and correcting an empty action would submit
// the correction with no shot at all, so that one case keeps today's
// behaviour: new seed, motion prompt untouched.
const baseMotion = String(p.motionPrompt || '');
let motionPrompt = baseMotion;
if (correction) {
  const cut = baseMotion.search(/\s*Negative\s*:/i);
  const head = (cut >= 0 ? baseMotion.slice(0, cut) : baseMotion).trim();
  const tail = cut >= 0 ? baseMotion.slice(cut) : '';
  if (head) motionPrompt = head + ' ' + correction + tail;
}

console.log('RG MOTION ' + p.id + ': resubmitting with seed ' + seed + (dropEndFrame ? ', WITHOUT the end frame (morph)' : ''));
// Printed on every re-roll, empty correction included — one `grep 'RG MOTION'`
// over an execution has to say whether the correction rode along and which
// clauses, without re-running anything.
console.log('RG MOTION ' + p.id + ': correction ' + (used.length ? '(' + used.join(', ') + ')' : '(none)') + (motionPrompt === baseMotion ? ', prompt unchanged' : ', ' + motionPrompt.length + ' chars'));
// `motionPrompt` overrides the key it inherits from `p`, which is what makes
// the DIRECT edge into Submit Video Regen work with no change to that node.
// `baseMotion` is for the OTHER two edges: `Regen Resubmit Guard` (filter
// refusal) and `Regen Cooldown Guard` (a 429) both re-feed `Prep Video
// Regen`'s payload, so a retry after this re-roll arrives carrying the
// UNCORRECTED prompt while still picking the new seed up out of this node.
// Submit Video Regen's expression closes that by preferring this corrected
// prompt when `$json.motionPrompt` still equals the base it was built from —
// which is also what stops a LATER, separate regeneration of the same scene
// (a fresh producer note, a different `motionPrompt`) from being overwritten
// by this stale correction. Matching on the scene id alone would do exactly
// that, because that node reads this one with `.first()`, i.e. its latest run.
return [{ json: Object.assign({}, p, { sceneId: p.id, seed: seed, dropEndFrame: dropEndFrame, attempt: v.attempt, correction: correction, baseMotion: baseMotion, motionPrompt: motionPrompt }) }];
