// The video filter refused this scene's clip. Count the attempt PER SCENE
// (static data): the START IMAGE is regenerated with a steer and the SAME
// scene resubmitted in place, up to MAX_ATTEMPTS times, the second steer
// stronger than the first. Only after that does the scene get marked rejected
// and the loop move on.
//
// WHY THE STILL AND NOT THE PROMPT (2026-09-22). This ladder used to rewrite
// the MOTION prompt four times on one seed. Both refusal classes that matter
// are triggered by the picture, not the words: `PROMINENT` was proven so in
// docs/lessons-pipeline.md ("a fully generic prompt with no names still failed
// on the same image"), and `AUDIO_GENERATION_FILTERED` on 2026-09-22 — seven
// generations of one still, three of them with a blank prompt and different
// seeds, all refused; a different still of the same desk passed first time
// (db/port/audio-filter/README.md, db/port/pool-tail-and-refusals/README.md).
// So the ladder now asks for a new still through the same `scene-image-regen`
// webhook the site's Regenerate button fires, waits for it to land, and
// resubmits. The motion prompt is rewritten only when the reason names a
// PERSON, since a real name in the direction re-triggers regardless of the
// still.
const sd = $getWorkflowStaticData('global');
sd.rewrites = sd.rewrites || {};
const cur = $('Current Scene').first().json || {};
const f = cur.fields || {};
const sceneId = cur.id;
const n = (sd.rewrites[sceneId] || 0) + 1;
sd.rewrites[sceneId] = n;
const MAX_ATTEMPTS = 2;
// NOT slice(0, 2000). The marker that says WHICH filter fired sits inside
// `media[0].mediaStatus`, past a kilobyte of request echo, and on a longer
// response the old 2,000-character window cut it off — so every refusal read
// as the generic one. 2026-09-22.
const errText = JSON.stringify($json).slice(0, 20000);
const audioFiltered = errText.includes('AUDIO_GENERATION_FILTERED') || errText.includes('AUDIO_FILTERED');
const prominent = errText.includes('PROMINENT');
const minor = errText.includes('MINOR');
let reason = 'Google video content filter';
if (prominent) reason = 'the shot shows or names a recognizable real person';
else if (minor) reason = 'the shot places a child on screen';
else if (audioFiltered) reason = 'Google refused the generated AUDIO track, not the picture (AUDIO_GENERATION_FILTERED)';
const kind = prominent ? 'person' : (minor ? 'minor' : (audioFiltered ? 'audio' : 'generic'));

// The steer rides to the image model as `Observații Scenă`, which
// `IR Build Request` appends to the stored image prompt as an ADJUSTMENT
// REQUEST — the same slot the producer's own correction uses. The `AUTO-`
// prefix is what tells every other reader of that field (`VRW Build Regen`,
// `Evaluate Image Approval`, `Prep Video Regen`) it is machine text, and
// `IR Write Image` clears it when the new still lands. Phrased as what the
// frame CONTAINS, since an instruction written as an absence is the documented
// way to get the thing named.
const STEER = {
  audio: 'Keep the same moment, place and light, framed on the setting, the objects and the hands: any person is seen from behind or stands outside the frame, every mouth out of view, so the still reads as a quiet room rather than someone about to speak.',
  person: 'Keep the same moment, place and light, with every face turned away from the camera or outside the frame: people from behind, in profile at a distance, or a detail insert of hands and objects.',
  minor: 'Keep the same moment, place and light, with adults only or the empty setting, every child outside the frame.',
  generic: 'Keep the same moment, place and light, framed on the setting, the objects and the light, with any person seen from behind or outside the frame.',
};
const STRONGER = 'Keep the same place and light as a still life: the setting, the objects and the light only, every person outside the frame.';
const steer = 'AUTO-STEER: ' + (n >= 2 ? STRONGER : STEER[kind]);

// What the give-up note tells the producer to DO. `Mark Video Prompt
// Rejected` prints this verbatim after the reason.
const advice = audioFiltered
  ? 'Two new stills were tried automatically and Google still refused the soundtrack it invents for them. Write the image prompt as a moment with nobody about to speak — the room, the objects, hands — regenerate the image, approve it, then press Regenerate video.'
  : 'Two new stills were tried automatically and Google still refused. The picture is what it refuses: rewrite the image prompt so no face or real person is in frame, regenerate the image, approve it, then press Regenerate video.';

console.log('Scene ' + sceneId + ': video filter refusal (' + reason + '), attempt ' + n + '/' + MAX_ATTEMPTS + (n > MAX_ATTEMPTS ? ' — giving up' : ' — regenerating the still'));
return [{ json: {
  sceneId,
  imageId: String(f['Image Media ID'] || ''),
  prompt: String(f['Video Scenă URL'] || ''),
  note: String(f['Observații Scenă'] || ''),
  reason,
  kind,
  advice,
  steer,
  audioFiltered,
  attempt: n,
  giveUp: n > MAX_ATTEMPTS,
} }];
