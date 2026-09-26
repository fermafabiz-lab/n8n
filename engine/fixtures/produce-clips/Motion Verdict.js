// Read the judge's answer and decide: keep the clip, or spend one more
// generation on it.
//
// Shaped exactly like `Judge Verdict` one stage upstream, and for the same
// reason: bounded per scene per pass, and every way of not getting an answer
// (skipped, unreadable, the HTTP call failed) means KEEP. A judge that can
// take a film down by being unavailable is worse than no judge.
//
// 2026-09-13 (evening) — two new failure modes, `permanence` and `untouched`,
// plus the `loop` boolean. `Motion Prep` now asks the vision model for six
// signals instead of four; this node had to learn to read them or the extra
// questions would have been asked and thrown away. What each one is, and why
// it exists, is in ../README.md — the café clip where the producer counted a
// held object vanishing, the same reach performed twice, papers flapping
// indoors, a fridge door and a room door moving by themselves, a prep table
// popping out and back, and the subject walking away and turning back. The
// prompt fixes (rule 6, `Current Scene`, `Submit Video Regen`) ask Veo not to
// do those things. This node is the half that CHECKS.
//
// AN OLD ANSWER MUST STILL BE SAFE. If a judge reply arrives without the new
// fields — a rolled-back `Motion Prep`, a model that drops a key, a truncated
// completion — `num()` returns null and the boolean is not `true`, so those
// gates simply do not fire and the clip is kept. Absence is never a failure.
const prep = $('Motion Prep').first().json;
const sd = $getWorkflowStaticData('global');
sd.motionRerolls = sd.motionRerolls || {};
sd.motionNotes = sd.motionNotes || {};
const MAX_REROLLS = 1;

// What flows on is the ORIGINAL Extract Video URL item, untouched — this
// node sits in the middle of the download/upload chain and everything after
// it reads Video_Signed_URL / Video_Media_Id.
const keep = (why) => [{ json: Object.assign({}, prep.passthrough || {}, { motionVerdict: why, motionReroll: false }) }];

if (!prep.ok) return keep(prep.reason || 'not judged');

let v = null;
try {
  const text = (($json.choices || [])[0] || {}).message ? String((($json.choices || [])[0] || {}).message.content || '') : '';
  const m = text.match(/\{[\s\S]*\}/);
  v = m ? JSON.parse(m[0]) : null;
} catch (e) { v = null; }
if (!v) {
  console.log('MOTION ' + prep.ord + ': unreadable judge answer, keeping — ' + JSON.stringify($json).slice(0, 200));
  return keep('unreadable');
}

const num = (x) => (typeof x === 'number' && isFinite(x)) ? x : null;
const direction = num(v.direction);
const permanence = num(v.permanence);
const untouched = num(v.untouched);
const coherent = num(v.coherent);
const morph = v.morph === true;
const loop = v.loop === true;
const problems = Array.isArray(v.problems) ? v.problems.map(String).slice(0, 4) : [];

// The thresholds are low ON PURPOSE. A re-roll costs a whole Veo generation
// and a place in the queue, so this only fires when the judge is confident
// the shot contradicts its brief — not when it is merely unenthusiastic.
//
// Why the two new numbers sit where they do:
//
//   permanence 0.5 — the same bar as direction, and deliberately NOT softer
//     than coherence. This is the failure the producer actually reported, and
//     it is also the one a contact sheet reads most reliably: "the stack is in
//     her hand at t=2 and gone at t=3" is a presence question, not a question
//     of taste. It still cannot be set higher: on a sheet sampled a second
//     apart, an object can leave frame because the camera panned, or a person
//     can pass behind a counter, and an honest judge docks a little for
//     anything it loses track of. 0.5 is the point where the model is saying
//     "more vanished than not" rather than "I could not follow it". The
//     question in `Motion Prep` now says so explicitly — a thing that leaves
//     frame because the CAMERA moved has not vanished, and an object it
//     cannot follow scores 1 rather than a guess — because EVERY shot this
//     pipeline writes has a named camera move (rule 6 mandates one), so
//     things entering and leaving frame is the design, not an edge case.
//     Without that carve-out this gate would fire on well-made pans.
//
//   untouched 0.45 — the floor, level with coherence, because this is the
//     score most exposed to FALSE POSITIVES. Plenty of legitimate motion has
//     a cause that is invisible in frame: a door someone opened just off
//     camera, a curtain at an open window, steam, traffic, a crowd, anything
//     outdoors where wind is real. The rule the prompt teaches is about indoor
//     stillness, but the judge is scoring exteriors with the same question, so
//     it will dock them. Setting this any higher would re-roll street scenes
//     for being streets. The question itself now carves exteriors out — wind,
//     weather, water, foliage, traffic, animals and crowds move on their own
//     and score 1 — so the threshold is the second line of defence, not the
//     first. If this gate still fires on ordinary outdoor films, the wording
//     is what to fix, not the number.
//
//   loop — a boolean like morph, and treated like one: no threshold to argue
//     about, it either doubled back or it did not. It is the direct signature
//     of the three-chained-actions bug from the README (the model has more to
//     do than fits in eight seconds, so it performs the first action twice, or
//     walks out and returns). Rule 6 now forbids writing such a brief, but
//     briefs already in Postgres still carry them, and a re-roll at a new seed
//     genuinely does sometimes pace it differently.
//
// SIX SIGNALS FIRING ONE SHARED RE-ROLL IS THE REAL RISK HERE, not any single
// number. Each gate is individually conservative, but they compound: if every
// one of them is wrong about one clip in ten, better than a third of a film
// gets re-rolled. MAX_REROLLS = 1 still caps the SPEND at one extra
// generation per scene — what grows is how often that ceiling is reached. A
// combination rule (three mild dips add up to a re-roll even though no gate
// fires) was considered and deliberately left out: it is exactly how a judge
// starts re-rolling half a film, and there is no fire-rate measurement yet to
// justify it. The measurement comes first — which is why the summary below
// prints all six on EVERY path, kept clips included, so one `grep 'MOTION '`
// over a real film's execution log gives the per-signal rates without
// re-running anything. That is the open-work item in CLAUDE.md ("watch one
// real film and count how many clips the judge re-rolls"), and these two new
// numbers are now part of what it has to count.
const bad = [];
if (direction !== null && direction < 0.5) bad.push('direction ' + direction);
if (permanence !== null && permanence < 0.5) bad.push('permanence ' + permanence);
if (untouched !== null && untouched < 0.45) bad.push('untouched ' + untouched);
if (coherent !== null && coherent < 0.45) bad.push('coherence ' + coherent);
if (morph) bad.push('morph');
if (loop) bad.push('loop');

const summary = 'direction=' + direction + ' permanence=' + permanence + ' untouched=' + untouched + ' coherent=' + coherent + ' morph=' + morph + ' loop=' + loop + (problems.length ? ' — ' + problems.join('; ') : '');
const n = sd.motionRerolls[prep.sceneId] || 0;
if (!bad.length) { console.log('MOTION ' + prep.ord + ': ok, ' + summary); return keep('ok'); }
if (n >= MAX_REROLLS) { console.log('MOTION ' + prep.ord + ': still wrong after ' + n + ' re-roll(s), keeping it (' + bad.join(', ') + '): ' + summary); return keep('wrong-accepted'); }

sd.motionRerolls[prep.sceneId] = n + 1;
sd.motionNotes[prep.sceneId] = (bad.join(', ') + (problems.length ? ': ' + problems.join('; ') : '')).slice(0, 400);
console.log('MOTION ' + prep.ord + ': re-roll ' + (n + 1) + '/' + MAX_REROLLS + ' (' + bad.join(', ') + '): ' + summary);
// `morph` stays the key `Motion Resubmit` reads to drop the end frame — that
// contract is unchanged. `loop` rides along beside it but does NOT drop the
// end frame today, and the omission is on purpose rather than an oversight: a
// loop CAN share morph's root cause (an end frame so close to the start that
// the only way to reach it is to go somewhere and come back), in which case a
// new seed will not help either — but it is just as often the three-actions
// brief, where the end frame is the thing holding the shot together and
// throwing it away would make the clip worse. Wiring loop into dropEndFrame
// is a change to `Motion Resubmit`, to be made when a real film has shown
// which of the two causes is the common one. Passing the flag now means that
// change is one line there and none here.
return [{ json: { sceneId: prep.sceneId, ord: prep.ord, motionReroll: true, morph: morph, loop: loop, attempt: n + 1, problems: bad, discardedMediaId: prep.mediaId } }];