// The end frame for the GATE's regeneration, mirroring `End Frame Prompt` on
// the batch path — see that node for why an end frame exists at all, and for
// the full argument behind the opt-in default below.
//
// OFF BY DEFAULT SINCE 2026-09-14, exactly like the batch path: this chain
// runs only when a project's Editing Options says `"endFrame": true`. The two
// copies must keep agreeing about that as much as about the prompt text — a
// regenerated clip built under different rules from its neighbours' is a new
// inconsistency, which is the trap `Prep Video Regen` already warns about for
// the model choice.
//
// Two things make this copy different rather than a duplicate.
//
// First, THE PAYLOAD HAS TO SURVIVE. `Submit Video Regen` reads `$json`, not
// a node reference (which is why both guards around it re-feed the payload),
// so every node between `Prep Video Regen` and the submit must pass the whole
// payload through untouched. Hence Object.assign rather than a fresh object.
//
// Second, and better: `motionPrompt` here may already carry the producer's
// own correction. `Evaluate Video Approval` appends "ADJUSTMENT REQUEST — the
// new video MUST follow this: <Observații Scenă>" when they typed one. So on
// exactly the failure that started this — "mașina iese din curte" — the note
// they wrote is what the end frame is drawn from. That is the strongest
// version of this feature there is: the after-picture is composed from the
// human's description of what went wrong. It is also the strongest remaining
// case for ever switching this back on, and it is still a case, not evidence.
const p = $json; // Prep Video Regen: {id, motionPrompt, imageId, voiceUrl, model, seed, takes}
const rb = $('Receive Batch Input').first().json;

// THE GATE, mirrored. (1) OPT-IN, the default since 2026-09-14; (2)
// sd.endFrameOffAt, the six-hour cooldown stamped by `Submit Cooldown Guard`
// after Flow rejects a submission carrying an end frame — a separate
// mechanism, left exactly as it was, and what protects a project that HAS
// opted in.
//
// Why opt-in, in short — the long version, with the frame-by-frame and the
// numbers, is in `End Frame Prompt`:
//
//   - The feature went live 2026-09-13 at 16:42, default ON, and was never
//     measured on a real film. CLAUDE.md's open-work says so itself: "None of
//     that is a measurement." The only positive evidence is one synthetic
//     clip on a throwaway workflow whose executions no longer exist.
//   - The producer's very next clip — the café film, the only real batch that
//     has ever run with this on — carried two of the feature's signature
//     artefacts: a prep table cross-dissolving between two independently
//     drawn keyframes whose camera position differs, and a subject walking
//     away and turning back because the interpolator must LAND on the frame
//     it is handed.
//   - The middle road was MEASURED, not argued: a shot-aware "draw it only
//     when it helps" rule, run against the 16 real repaired prompts of that
//     film, drew an end frame on 0 of 16
//     (`db/port/motion-permanence/endframe/`). It is a global off switch
//     wearing a heuristic's clothes, so it ships as an off switch.
//   - The structural reason: rule 6 (a) mandates a named camera move on every
//     single shot, and a moving camera guarantees two independently drawn
//     keyframes disagree about where the static set is.
//   - Off restores the behaviour that made ~18 accepted films, with the
//     contradictory continuity clause — the actual cause of the reversing car
//     — already removed twelve minutes BEFORE this shipped.
//
// THIS IS A REVERSAL OF A SAME-DAY CHANGE, NOT A CONSIDERED ROLLOUT. What
// would turn it back on is a measured A/B on one real film: the same scenes
// regenerated with and without an end frame, watched side by side. Nothing
// here is deleted and the trial costs one project setting.
const OFF_FOR_MS = 6 * 60 * 60 * 1000;
const sd = $getWorkflowStaticData('global');
const offUntil = Number(sd.endFrameOffAt || 0) + OFF_FOR_MS;
const off = Date.now() < offUntil;
let opts = {};
try { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }
const optedIn = opts.endFrame === true;
const wanted = optedIn && !off;

const startImage = p.imageId || '';
const motion = String(p.motionPrompt || '').trim();

// 2026-09-14: `look` IS GONE, and with it the `$('Fetch Scene Videos')`
// lookup that existed solely to feed it — it had no other reader in this
// node, so if the clause is ever restored the lookup has to come back with
// it. It read `Imagine First Frame` / `Prompt Vizual` off the scene row the
// gate had already fetched and appended "The shot was originally composed as:
// …". `reference_1` below already carries that composition pixel-for-pixel,
// so restating it in words only anchored the "after" onto the "before": the
// model was shown the first frame, told in prose what the first frame looks
// like, and asked for the last one. The picture that comes back is too close
// to the start frame, which leaves the interpolator eight seconds to fill and
// no distance to cover. The motion — here, the producer's own correction — is
// the only thing that should describe the difference between the two frames.

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
  console.log('RG ENDFRAME ' + p.id + ': skipped, ' + why);
  return [{ json: Object.assign({}, p, { efOk: false, efReason: why }) }];
}

const aspect = rb.Aspect_Ratio === '9:16' ? '9:16' : '16:9';

// Word for word the batch path's prompt. The two must keep agreeing: a
// regenerated clip whose end frame was composed under different rules from
// its neighbours' is a new inconsistency, which is the trap `Prep Video
// Regen` already warns about for the model choice.
//
// 2026-09-14: the camera-move licence is gone from both copies in the same
// edit. The middle sentence used to end "…and whatever the camera move has
// brought into or out of view" — the clause that let the two keyframes
// disagree about where the static set is, on every shot, because rule 6 (a)
// mandates a camera move on every shot. The producer's prep table popping out
// of frame and back in a different place IS that clause, rendered. The set is
// now pinned: only the moving subject may differ.
//
// The same honest caveat as the batch copy: "the frame stays exactly where the
// reference put it" pins the CAMERA too, so an opted-in end frame depicts a
// camera that never moved while the motion string still opens with a mandated
// named move. That is a deliberate choice, not an oversight — a keyframe pair
// that disagrees about the set is a guaranteed artefact, a terminal frame that
// under-describes the camera is only a hint the model can overrule — and it is
// why the feature is opt-in from today rather than tuned.
const prompt = [
  'This is the FINAL FRAME of a single continuous shot: the same camera, the same subject and the same place as the reference image, a few seconds later, after the following motion has fully completed:',
  motion,
  'Draw the world exactly as the reference image shows it — same characters, same faces, same wardrobe, same vehicles and objects, same setting, same lighting and time of day, same lens and framing style. The ONLY thing that may differ is where the moving subjects have got to: every fixed part of the set — walls, furniture, fittings, doors, signage, parked vehicles, anything nobody touches — stays in exactly the position, size and angle the reference shows it in, and the frame stays exactly where the reference put it. Do not restage the shot, do not change the angle for effect, do not add or remove anyone, and do not put any text on the image.',
].filter(Boolean).join(' ');

const efRequest = {
  email: rb.Flow_Email || 'fermafabiz@gmail.com',
  model: 'nano-banana-2',
  prompt: prompt,
  aspectRatio: aspect,
  count: 1,
  captchaRetry: 1,
  reference_1: startImage,
};

console.log('RG ENDFRAME ' + p.id + ': drawing the after-frame from ' + startImage);
return [{ json: Object.assign({}, p, { efOk: true, efRequest: efRequest }) }];
