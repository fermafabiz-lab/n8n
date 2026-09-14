// The LAST frame of the shot, so direction stops being a matter of prose.
//
// OFF BY DEFAULT SINCE 2026-09-14. This chain runs only when a project's
// Editing Options says `"endFrame": true`. Read the gate block below before
// turning it on — the argument for opt-in is written there in full.
//
// useapi supports I2V-FL on every Veo variant, ours included: startImage plus
// endImage, "video ends with this frame" (end-frame-ONLY is not supported,
// which is why this chain is useless without `Image Media ID`). Given both,
// direction stops being rhetoric and becomes geometry.
//
// The end frame is drawn by the same image model that drew the first one,
// with the START frame as its reference, so composition, wardrobe, light and
// style carry over and only what moves has moved. It is scaffolding, not a
// deliverable: nobody reviews it, it is never stored on the scene, and if it
// fails the scene falls back to exactly the single-frame behaviour it has
// today. Images are free on the Ultra plan, so this costs queue time only.
//
// NOTE the mode exclusivity on the VIDEO call: reference_* and character_*
// trigger R2V on Veo and "cannot be combined with startImage / endImage".
const cs = $('Current Scene').first().json;
const f = cs.fields || {};
const rb = $('Receive Batch Input').first().json;

// THE GATE. Two independent ways this chain stays dark, and as of 2026-09-14
// the first of them is the DEFAULT.
//
// (1) OPT-IN: `opts.endFrame === true`, and nothing else, draws an end frame.
//
// SAY IT PLAINLY — THIS IS A REVERSAL OF A SAME-DAY CHANGE, NOT A CONSIDERED
// ROLLOUT. The end frame went live 2026-09-13 at 16:42, default ON, by the
// same author, and was never measured on a real film. CLAUDE.md's own
// open-work section says so in as many words: "None of that is a
// measurement." The only positive evidence that exists is one synthetic clip
// on a throwaway workflow (executions 12930 / 12947, scored direction 1,
// coherent 1, morph false) and those executions are gone with the workflows
// that made them — the record survives only as prose in
// `db/port/veo-direction/README.md`.
//
// Against that: the producer's VERY NEXT clip. The café film
// `recXibIyVuLvMIqy3` is the only real batch that has ever run with this
// chain switched on, and the first clip a human watched from it was rejected
// with seven faults — two of which are this feature's own signature:
//   - the stainless prep table vanishing at 5.25s and returning at 6.25s in a
//     slightly different place: a cross-dissolve between two INDEPENDENTLY
//     DRAWN keyframes whose camera position differs;
//   - "pleacă cu el apoi se întoarce nenatural" — the subject walking away
//     and turning back: an interpolator obeying a terminal constraint whose
//     end pose sits at or near the start pose. It must LAND on the frame it
//     is handed, so a round trip in the picture becomes a round trip in the
//     clip.
//
// THE MIDDLE ROAD WAS MEASURED BEFORE IT WAS REJECTED. The obvious answer —
// "draw the end frame only on the shots where it helps", i.e. a clear A-to-B
// path with ambiguous direction, skipping chained actions, held objects,
// returns and exits — was run against the 16 REAL repaired prompts of that
// film, which is what the pipeline writes from now on. It drew an end frame
// on 0 of 16. Its sub-rules alone: held object 16/16, two-or-more actions
// 15/16, names a camera move 14/16. Script and output in
// `db/port/motion-permanence/endframe/`. A heuristic that never fires is a
// global off switch wearing a heuristic's clothes, so it ships as an off
// switch instead of as a rule nobody can audit. (Its action counter was also
// miscounting: it matched the stillness clauses rule 6 now MANDATES — "the
// trays stay in her hands" — as if they were actions.)
//
// THE STRUCTURAL REASON OUTLIVES THAT HEURISTIC, and it is the part to
// remember: rule 6 (a) mandates a named camera move on EVERY SINGLE SHOT, and
// a moving camera guarantees that two independently drawn keyframes disagree
// about where the static set is. The end frame and rule 6 are not compatible
// for this pipeline's shot vocabulary. Anything that reconciles them has to
// change one of the two, not arbitrate between them shot by shot.
//
// OFF IS NOT A RETURN TO THE BROKEN STATE. ~18 films and 368 scenes were made
// before this chain existed, and the defect the producer complained about
// then — the car reversing into the yard — was diagnosed as the appended
// contradictory continuity clause and fixed at 16:29, twelve minutes BEFORE
// the end frame shipped. Turning this off therefore restores the behaviour
// that produced films the producer accepted, with that clause already gone.
// Direction survives without geometry in two places that need no second
// frame: rule 6 (b)'s hard "DIRECTION IS NOT OPTIONAL" clause with its worked
// counter-example, and `Motion Verdict`, which scores direction on the
// finished clip and re-rolls at a fresh seed below 0.5. `Motion Resubmit`
// already agrees with all of this in its own words — its remedy for a morph
// is to drop the end frame "which is exactly what the film did before end
// frames existed".
//
// It also buys back ~25-30s of queue time per scene (two image generations,
// two ~5.5s captchas) — 33-40 minutes a pass on an 80-scene film — and, on a
// hook scene, one fewer paid veo-3.1-fast generation risked for a frame
// nobody reviews.
//
// WHAT TURNS IT BACK ON: a measured A/B on one real film. The same scenes
// generated with and without an end frame, watched side by side. Not an
// argument — a comparison; this feature has already been shipped on an
// argument once. Nothing is deleted, both chains stay wired, and the trial
// costs one project setting.
//
// (2) sd.endFrameOffAt — a timestamp stamped by `Submit Cooldown Guard` the
// first time Flow rejects a submission carrying an end frame for a reason
// that names one. A TIMESTAMP rather than a boolean, and deliberately NOT
// reset by `Sort & Cap Scenes`: static data outlives the execution, so a flag
// set once would disable end frames for every future film until somebody
// noticed. This is a SEPARATE mechanism from (1) and is left exactly as it
// was — it is what protects a project that has deliberately opted in.
const OFF_FOR_MS = 6 * 60 * 60 * 1000;
const sd = $getWorkflowStaticData('global');
const offUntil = Number(sd.endFrameOffAt || 0) + OFF_FOR_MS;
const off = Date.now() < offUntil;
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
const optedIn = opts.endFrame === true;
const wanted = optedIn && !off;

const startImage = f['Image Media ID'] || '';
// Strip the legacy "Negative:" tail before the image model sees it. Without
// this, nano-banana-2 is handed "no subtitles", "no lip movement" and
// "ambient/atmospheric motion only" as instructions for drawing a single
// still — and, worse, it is handed the tail of a chained action. Scene 3 of
// the café film ended "...and pivots back toward the swinging door", so the
// after-frame was drawn with the subject turned back toward the door, and the
// interpolator then had to LAND there: that is the producer's "walks away
// with it and turns back unnaturally", manufactured by our own end frame.
const motion = String(f['Video Scenă URL'] || '').split(/\s*Negative:\s*/i)[0].trim();
// 2026-09-14: `look` IS GONE, and the variable with it — it had no other
// reader in this node. It carried `Imagine First Frame` / `Prompt Vizual`,
// the scene's own image prompt, appended as "The shot was originally composed
// as: …". `reference_1` below already carries that composition
// pixel-for-pixel, so restating it in words only anchored the "after" onto
// the "before": the model was shown the first frame, told in prose what the
// first frame looks like, and asked for the last one. What comes back is a
// picture too close to the start frame — which leaves the interpolator eight
// seconds to fill and no distance to cover, and eight seconds of nothing to
// do is how a subject ends up performing one reach twice. The motion is the
// only thing that should describe the difference between the two frames.

// Both halves are required. Without the start frame there is nothing holding
// the composition steady, and without the motion there is no "after" to draw.
// Never return zero items — everything downstream is the rest of the batch.
if (!wanted || !startImage || !motion) {
  // The opt-in reason is reported FIRST when it applies: since 2026-09-14 it
  // is the reason nearly every skip has, and a log line blaming a Flow
  // rejection that never happened sends the next session hunting a phantom.
  // The opt-in test is strict `=== true` on purpose: the fail-safe direction is
  // OFF, so anything ambiguous stays off. But there is NO UI for this key —
  // `grep -rn endFrame platform/` is empty — so hand-edited JSON is the only way
  // in, and `"endFrame": "true"` (a string) is the likely first attempt. That
  // would be silently off while the JSON visibly says true, so the reason echoes
  // what was actually seen rather than asserting the key is absent.
  const seen = JSON.stringify(opts.endFrame);
  const why = !wanted ? (!optedIn ? 'end frames are opt-in since 2026-09-14 — Editing Options has endFrame=' + seen + ', needs the boolean true' : 'end frames paused until ' + new Date(offUntil).toISOString() + ' after a Flow rejection') : (!startImage ? 'no start frame' : 'no motion prompt');
  console.log('ENDFRAME ' + (f['Ordine Scenă'] ?? '?') + ': skipped, ' + why);
  return [{ json: { ok: false, sceneId: cs.id, reason: why } }];
}

const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';

// This asks for the END of the motion, not for a new shot. The wording leans
// hard on the reference for everything that must NOT change, because the
// failure mode of an end frame is not a wrong position — it is a
// different-looking scene, which would make Veo morph between two strangers
// instead of moving one.
//
// 2026-09-14: THE CAMERA-MOVE LICENCE IS GONE. The middle sentence used to
// end "…and whatever the camera move has brought into or out of view", which
// is precisely the clause that licensed the two keyframes to disagree about
// where the static set is — and because rule 6 (a) mandates a camera move on
// every shot, that licence applied to every shot in every film. The
// producer's prep table popping out of frame at 5.25s and back at 6.25s in a
// different place IS that clause, rendered. The set is now pinned: only the
// moving subject may differ, the fixtures and the frame do not.
//
// BE HONEST ABOUT WHAT THAT TRADE IS, because "the frame stays exactly where
// the reference put it" pins the CAMERA, not only the set. So on an opted-in
// shot the end frame now depicts a camera that never moved, while the motion
// string handed to Veo still opens with a mandated named move — 14 of the 16
// measured prompts name one. The two no longer agree, and that is a CHOICE:
// given a pipeline where every shot names a camera move, a keyframe pair that
// disagrees about the set is a guaranteed artefact, whereas a terminal frame
// that under-describes the camera is a hint the model can overrule. We would
// rather lose the camera's contribution to the end frame than keep licensing
// the set to move. It is also the reason this feature is opt-in from today
// rather than tuned: with a camera move on every shot there is no wording
// that makes an end frame safe here, only wordings that make it less bad.
const prompt = [
  'This is the FINAL FRAME of a single continuous shot: the same camera, the same subject and the same place as the reference image, a few seconds later, after the following motion has fully completed:',
  motion,
  'Draw the world exactly as the reference image shows it — same characters, same faces, same wardrobe, same vehicles and objects, same setting, same lighting and time of day, same lens and framing style. The ONLY thing that may differ is where the moving subjects have got to: every fixed part of the set — walls, furniture, fittings, doors, signage, parked vehicles, anything nobody touches — stays in exactly the position, size and angle the reference shows it in, and the frame stays exactly where the reference put it. Do not restage the shot, do not change the angle for effect, do not add or remove anyone, and do not put any text on the image.',
].filter(Boolean).join(' ');

// count: 1 is mandatory — this endpoint DEFAULTS TO FOUR images. captchaRetry
// 1 because useapi's five captcha retries are pure spend while Google
// throttles.
const body = {
  email: rb.Flow_Email || 'fermafabiz@gmail.com',
  model: 'nano-banana-2',
  prompt: prompt,
  aspectRatio: aspect,
  count: 1,
  captchaRetry: 1,
  reference_1: startImage,
};

console.log('ENDFRAME ' + (f['Ordine Scenă'] ?? '?') + ': drawing the after-frame from ' + startImage);
return [{ json: { ok: true, sceneId: cs.id, requestBody: body } }];
