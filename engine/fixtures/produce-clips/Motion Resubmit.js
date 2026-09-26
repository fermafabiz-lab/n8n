// Send the scene back to Submit Video for one more take — differently.
//
// A plain resubmit would be pointless. `Current Scene` derives the seed from
// the scene id and the number of takes already FILED, and a take rejected
// here is never filed, so the second submission would carry the same seed,
// the same prompt and the same frames — and Veo would return the same clip.
// (The existing `Resubmit Guard` has the same blind spot, harmlessly: it
// retries jobs that FAILED, where an identical request is the right thing.)
// So this node hands Submit Video three overrides, and the expression there
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

// 2026-09-14 — THE RE-ROLL NOW CARRIES WHAT THE JUDGE FOUND.
//
// Until today a re-roll was A NEW SEED AGAINST A BYTE-IDENTICAL BRIEF. The
// judge scored six signals and `Motion Verdict` filed its prose under
// `sd.motionNotes` — a key nothing in either workflow has ever read. So a
// clip rejected because a held object left the subject's hands was sent
// back with exactly the sentence that produced it, and the only thing
// between us and the same clip was the dice.
//
// WHY THE JUDGE'S OWN WORDS CANNOT BE THE CORRECTION. `problems` is written
// as FAULTS — "the sleeve stack disappears from her hands". Pasting that
// into a Veo prompt is precisely the bug the whole of 2026-09-13 was spent
// removing: Google's guidance is that naming an unwanted thing makes the
// model render it, and our own tail saying "nothing appears, disappears or
// duplicates" is what produced a disappearing object. See ../README.md and
// docs/lessons-pipeline.md, "A prompt that names a failure summons it". A
// correction quoting the fault would walk the anti-pattern straight back in
// through the one door that was just closed, on the one path where nobody
// would see it until a producer watched the film.
//
// TWO SHAPES WERE CONSIDERED; THIS IS (a), THE DETERMINISTIC ONE.
//   (b) a second model call that rewrites each fault into a positive
//       requirement. More faithful to the specific fault — and it puts a
//       generative step between the judge and Veo precisely where a leaked
//       negation is invisible, adds a call that can time out inside what is
//       already a retry, and spends latency saying something the fault
//       CATEGORY already implies.
//   (a) a fixed map from SIGNAL to positive clause. Chosen. The signals are
//       a closed set of six, written by `Motion Verdict` two nodes upstream,
//       and each one names a failure MODE rather than an incident:
//       "permanence" is always "something stopped being there", whatever the
//       thing was. So the clause can be authored once, by hand, in the same
//       positive world-state voice as WORLD_RULES — and being a literal it
//       CANNOT smuggle a negation, which is the single property that matters
//       here. What it gives up is specificity: the re-roll is told "whatever
//       the subject is holding stays in their hands" rather than "the sleeve
//       stack stays in her hands". That costs little, because Veo is handed
//       the start frame and the thing is in front of it.
//
// EVERY CLAUSE IS A POSITIVE WORLD-STATE. Read them as a set: not one of
// them names the failure it repairs, and none of them contains "no", "not"
// or a fault noun. `UNSAFE` below enforces that at runtime rather than
// leaving it as a promise in a comment, because the next session to add a
// seventh signal will be editing a plain object literal and will not
// necessarily have read this paragraph.
//
// THIS MAP IS A LOCKSTEP PAIR WITH `RG Motion Resubmit`. The two nodes hold
// byte-identical copies of CLAUSES, SIGNAL_ORDER, MAX_CLAUSES, LEAD_IN and
// UNSAFE — the producer's regeneration must be corrected the same way the
// batch is, or a rescued clip obeys a different director from its
// neighbours. Change both or neither. n8n has no shared module; the
// duplication is the price.
const CLAUSES = {
  permanence: 'Whatever the subject is holding stays in their hands for the whole shot and is there in the final frame; every prop, garment and piece of furniture keeps the shape, colour and cut it has in the opening frame.',
  untouched: 'Every door, drawer, lid, window and taped-up sheet of paper stays exactly as the opening frame shows it, and moves only in the instant a hand moves it; indoors the air is still.',
  loop: 'One single continuous action, performed once and carried straight through to the final frame; the subject ends the take somewhere new, further along than it began.',
  direction: 'Everything that travels keeps the one direction the action above names and holds that heading to the final frame; the camera keeps the move it was given and travels that way throughout.',
  coherence: 'Solid things keep their own space: feet stay on the ground, people and vehicles pass around each other, and every vehicle that moves has a driver at its controls.',
  morph: 'Everything that changes on screen changes because something physically moves — wheels turn, legs step, hands travel — and every shape keeps its own edges for the whole take.',
};

// Priority, and it only bites when more than MAX_CLAUSES fire at once. The
// three the producer actually reported come first (a held object gone, a
// door opening by itself, the eight seconds filled by doing one thing
// twice); `morph` is last because its real remedy is dropping the end frame
// above, and its clause is only there so a morph re-roll is not sent back
// with nothing said at all.
const SIGNAL_ORDER = ['permanence', 'untouched', 'loop', 'direction', 'coherence', 'morph'];

// THE CAP IS THE KNOB TO TURN IF RE-ROLLS COME BACK WORSE. Three clauses is
// ~100 words on top of a prompt that is already ~180, and attention is
// finite: past some length the correction dilutes the action it is meant to
// protect. Three is the café clip's own count (permanence, untouched, loop),
// so it is the smallest cap that would have carried that whole diagnosis.
const MAX_CLAUSES = 3;
const LEAD_IN = 'CORRECTION — the new take MUST hold to this: ';

// The executable half of "every clause is positive". A clause matching this
// is withheld and logged rather than sent: a negation reaching Veo is the
// failure this entire feature exists to avoid, and a re-roll that carries
// one clause fewer is merely today's behaviour for that signal.
const UNSAFE = /\b(?:no|not|never|none|nothing|nobody|nor|without|avoid\w*|prevent\w*|stop\w*|remove\w*|don't|doesn't|isn't|aren't|disappear\w*|vanish\w*|duplicat\w*|morph\w*|warp\w*|flicker\w*)\b/i;

// WHICH SIGNALS FIRED. `Motion Verdict` sends `problems` as the GATE list
// ("permanence 0.3", "untouched 0.4", "morph", "loop") — NOT the judge's
// prose, which never leaves `sd.motionNotes`. The key names lie about that,
// so read the first word and nothing else. `morph`/`loop` are re-checked off
// their own booleans so an older or partial verdict payload still corrects
// what it can; an unrecognised entry is simply ignored, exactly as a missing
// score is ignored one node upstream.
const fired = [];
const seen = (Array.isArray(v.problems) ? v.problems : []).map((p) => String(p).trim().split(/\s+/)[0].toLowerCase());
if (v.morph === true) seen.push('morph');
if (v.loop === true) seen.push('loop');
seen.forEach((k) => { if (CLAUSES[k] && fired.indexOf(k) < 0) fired.push(k); });

const withheld = fired.filter((k) => UNSAFE.test(CLAUSES[k]));
if (withheld.length) console.log('MOTION ' + v.ord + ': clause withheld, a negation reached the map — ' + withheld.join(', '));
const used = SIGNAL_ORDER.filter((k) => fired.indexOf(k) >= 0 && withheld.indexOf(k) < 0).slice(0, MAX_CLAUSES);
const correction = used.length ? LEAD_IN + used.map((k) => CLAUSES[k]).join(' ') : '';

// WHERE THE CORRECTION LANDS, and why it is not simply appended.
//
// `Current Scene` froze this scene's prompt as SHOT_RULES + action +
// WORLD_RULES, and WORLD_RULES ends with the trailing `Negative:` NOUN LIST.
// Appending would put the correction inside that list — the same mistake
// `Evaluate Video Approval` made with the producer's own adjustment note,
// where a human typing "she should keep holding the stack" was handing Veo
// one more thing to avoid. So the insert is at the first `Negative:`
// boundary, with everything from that token onward preserved byte for byte.
// This is the canonical split five nodes already use, read as an index
// instead of a split so the tail survives untouched.
//
// It sits after WORLD_RULES rather than beside the action deliberately: the
// boundary between the action and WORLD_RULES is only findable by matching
// `Current Scene`'s literal wording, which would be a silent coupling to a
// string that changes. `Negative:` is a token every composer in this
// workflow already agrees on.
//
// `Submit Video` copies `cs.videoRequest` WHOLESALE and has never read a
// prompt from anywhere else, so the one-line override there is what makes
// this reach Veo at all. Without that edit this node is a no-op: the seed
// and the end-frame drop still work, the correction is composed and logged
// and thrown away.
//
// `basePrompt` is the staleness guard. `Current Scene` can run a SECOND time
// for the same scene id — `VP Reload Scene` re-enters it after the video
// filter refuses a prompt and `VP Apply` rewrites it — and `Submit Video`
// reads this node with `.first()`, which returns its LATEST run rather than
// the run belonging to the item in hand. Matching on the scene id alone
// would then resurrect a correction built on the REFUSED prompt and undo the
// rewrite that exists to get past the filter. Matching the base string means
// the override applies only to the exact prompt it was derived from.
let basePrompt = '';
let prompt = '';
if (correction) {
  try { basePrompt = String((($('Current Scene').first().json || {}).videoRequest || {}).prompt || ''); } catch (e) { basePrompt = ''; }
  const cut = basePrompt ? basePrompt.search(/\s*Negative\s*:/i) : -1;
  const head = (cut >= 0 ? basePrompt.slice(0, cut) : basePrompt).trim();
  const tail = cut >= 0 ? basePrompt.slice(cut) : '';
  // A head of nothing means the stored prompt was a bare legacy tail (the
  // rare row `Evaluate Video Approval` also guards against). Correcting an
  // empty action would send Veo the correction and no shot at all, so that
  // one case falls back to today's behaviour: new seed, prompt untouched.
  if (head) prompt = head + ' ' + correction + tail;
}

console.log('MOTION ' + v.ord + ': resubmitting with seed ' + seed + (dropEndFrame ? ', WITHOUT the end frame (morph)' : ''));
// Printed on EVERY re-roll, empty correction included, for the same reason
// `Motion Verdict` prints all six signals on every path: the open-work item
// in CLAUDE.md is to watch one real film and count, and `grep 'MOTION '` over
// one execution log has to answer "did the correction ride along, and which
// clauses" without re-running anything.
console.log('MOTION ' + v.ord + ': correction ' + (used.length ? '(' + used.join(', ') + ')' : '(none)') + (prompt ? ', ' + prompt.length + ' chars' : ', prompt unchanged'));
return [{ json: { sceneId: v.sceneId, ord: v.ord, seed: seed, dropEndFrame: dropEndFrame, attempt: v.attempt, correction: correction, basePrompt: basePrompt, prompt: prompt } }];