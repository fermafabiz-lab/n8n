// Turn one webhook POST into the payload the `RG *` tail already eats.
//
// The site fires { scene_id } and this decides whether that scene can be
// re-shot at all, then hands `Prep Video Regen` exactly what
// `Evaluate Video Approval` hands it on the batch path — the same
// { id, motionPrompt, imageId, voiceUrl } — plus the project and scene rows
// the batch path gets from `IMG Load Project` and `Fetch Scene Videos`.
//
// WHY IT REFUSES RATHER THAN THROWS. `Prep Video Regen` throws on a scene with
// no Flow asset id or no motion prompt, and it carries no onError, so on the
// batch path that throw kills the whole execution. On this path a throw would
// be worse in a quieter way: the webhook run would die with `Regenerează
// Video` still true and nobody left to clear it, which is the stranded-flag
// dead end CLAUDE.md warns about once per in-flight flag. So every reason to
// stop is decided HERE, before the tail, and each one either clears the flag
// with an explanation or leaves a flag that was already gone alone.
// The POST, read from the webhook node by name rather than from $json:
// $json here is VRW Load Scene's row, and a body that arrived through a
// column alias would be a coupling nobody would expect to matter until the
// day someone renamed a column.
const hook = $('Video Regen Webhook').first().json;
const post = hook.body || hook;
const sceneId = String(post.scene_id || post.sceneId || '').trim();
const row = $input.all()[0] ? $input.all()[0].json : null;

const refuse = (reason, write) => [{ json: { ok: false, write: !!write, sceneId, reason } }];

if (!sceneId) throw new Error('VRW: no scene_id in the webhook body — nothing to regenerate.');
// A scene id that matches no row is the one case worth throwing on: there is
// no flag to clear and no row to write a reason onto, so failing loudly is
// the only way it is ever noticed.
if (!row || !row.scene) throw new Error('VRW: scene ' + sceneId + ' not found.');

const f = row.scene || {};
const projF = row.project || {};
const projectId = String(row.project_id || '');

// The flag is the request. If it is already false, either the producer
// cancelled it or a batch got there first — either way there is nothing to do
// and nothing to write. Ending quietly here is what makes the webhook safe to
// fire twice, which the site does whenever an approved image queues a clip
// and the producer also presses Regenerate.
if (f['Regenerează Video'] !== true) return refuse('the scene is not asking for a new clip (Regenerează Video is already false)', false);

// These two ARE the reasons `Prep Video Regen` throws. Catching them here
// turns "the film dies" into "the scene comes back with a sentence".
if (!f['Image Media ID']) return refuse('this scene has no Flow image id, so there is no still for Veo to animate — regenerate and approve its image first', true);
if (!String(f['Video Scenă URL'] || '').trim()) return refuse('this scene has no shot direction (Video Scenă URL), so there is nothing to shoot — write one in the Video step', true);

// `Observații Scenă` IS NOT A PRODUCER-ONLY FIELD, and that is what makes
// the reordering below dangerous without this line. Five nodes in this
// workflow write MACHINE text into it and none of them ever clears it:
// `VP Apply` ("AUTO-REWRITE-VIDEO (attempt N): the video filter refused
// this scene — …"), `Apply Rewritten Prompt`, `Mark Flow Upload Rejected`,
// `Mark Video Prompt Rejected` and `Mark Regen Filtered` (all "REJECTED by
// …"). `VP Apply` writes that note AND sets `Regenerează Video: true` in
// the same statement, so the very next poll arrives here with a machine
// sentence sitting in the producer's feedback slot.
//
// Before the reordering this was hidden by a bug: the note was appended
// after the legacy "Negative:" tail and `Submit Video Regen` cut it off.
// Strip-then-append fixes the producer's case and would have handed Veo
// "the new video MUST follow this: AUTO-REWRITE-VIDEO (attempt 2): the
// video filter refused this scene …" as a mandatory instruction. Worse, it
// would persist: nothing clears the field, so every later regeneration of
// that scene would carry it again.
//
// `Evaluate Image Approval` one gate upstream already solves this with the
// same test, and this is deliberately the same shape so the two stay
// greppable together. Extend BOTH if a sixth machine writer appears.
let feedback = String(f['Observații Scenă'] || '').trim();
if (/^(AUTO-|REJECTED)/i.test(feedback)) feedback = '';
// 2026-09-13 — WHERE THE PRODUCER'S CORRECTION LANDS IN THE PROMPT.
//
// `Video Scenă URL` holds the motion PROMPT, not a URL (historic field
// name, same everywhere in this workflow).
//
// This node used to build the regeneration brief in this order:
//
//     <stored prompt, legacy "Negative: …" tail and all>
//       + ' ADJUSTMENT REQUEST — the new video MUST follow this: …'
//
// which put the one piece of text a human actually typed AFTER the token
// "Negative:", i.e. inside a list of prohibitions. A producer typing "she
// should keep holding the stack" was handing the model one more thing to
// avoid.
//
// And it was worse than badly placed: it was DELETED. `Submit Video
// Regen` strips the legacy tail with split(/\s*Negative:\s*/i)[0] before
// composing today's guardrails, so on any scene whose stored prompt still
// carries that tail — 368 of the 504 rows written in the three weeks up to
// today — the split cut the prompt at "Negative:" and took everything
// BEFORE it, throwing the ADJUSTMENT REQUEST away with the tail. The
// producer rejected a clip, wrote what was wrong with it, waited a minute
// and a half, and got a re-roll of the identical brief. That is the shape
// of "regenerate does nothing".
//
// So: strip FIRST, then append the correction. The stored prompt is
// reduced to the ACTION ONLY with the same canonical split used by
// `Current Scene`, `End Frame Prompt` and (as an instruction) `VP Rewrite
// AI`, and the producer's words become part of that action. The
// guardrails — shot rules in front, world rules and the trailing noun
// list behind — are composed at submit time by `Submit Video Regen` and
// must not be here.
//
// Two downstream readers get this for free, and both already claimed it
// in their own comments:
//   - `RG End Frame Prompt` draws the after-frame from `motionPrompt` and
//     does NOT strip anything itself, so it was handing nano-banana-2
//     "no subtitles, no lip movement" as drawing instructions.
//   - `RG Motion Prep` judges the finished clip against `motionPrompt`.
//     The brief it scores is now the action plus the human's correction,
//     which is what its comment says it is.
//
// The 'ADJUSTMENT REQUEST — the new video MUST follow this: ' wording is
// quoted verbatim in both of those nodes' comments. If it ever changes,
// change it in all three.
//
// The tail-only edge must NEVER produce an empty prompt. `Prep Video
// Regen` throws "has no motion prompt" on one, and it carries no onError
// setting, so that throw aborts the WHOLE Media Generation execution —
// the batch loop, the image gate and the video gate for every other scene
// — and strands `Regenerează Video` true with no writer left inside the
// run to clear it. A row whose stored prompt is nothing but a tail is
// rare, but "rare" and "takes the film down with it" is not a trade worth
// making for tidiness. Falling back to the raw stored string restores
// exactly the pre-2026-09-13 behaviour for that one case and can only be
// better than nothing.
const storedPrompt = String(f['Video Scenă URL'] || '');
const action = storedPrompt.split(/\s*Negative:\s*/i)[0].trim();
let motionPrompt = action || storedPrompt.trim();
if (feedback) {
  // Defensive, and only against the literal section token: if a producer
  // types "Negative:" in their note, the submit-time split would truncate
  // the prompt at their own words. Softening the colon keeps every word
  // they wrote and leaves nothing downstream can read as a header.
  const note = feedback.replace(/\bNegative\s*:/gi, 'Negative,');
  motionPrompt += ' ADJUSTMENT REQUEST — the new video MUST follow this: ' + note + '.';
}

const regen = { id: sceneId, motionPrompt, imageId: f['Image Media ID'] || '', voiceUrl: f['Voiceover URL'] || '' };

console.log('VRW ' + sceneId + ': regenerating, ' + motionPrompt.length + ' chars of brief' + (feedback ? ', with the producer\'s correction' : ''));

return [{
  json: {
    ok: true,
    sceneId,
    projectId,
    regen,
    // What `Prep Video Regen` reads instead of IMG Load Project / Fetch Scene
    // Videos / Receive Batch Input when it sees this entry point.
    sceneFields: f,
    projectFields: projF,
    aspectRatio: String(projF['Format'] || '16:9') === '9:16' ? '9:16' : '16:9',
  },
}];
