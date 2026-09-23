// The video filter refused this scene's clip. Count the rewrite PER SCENE
// (static data, reset by Sort & Cap each pass): the prompt is rewritten and
// the SAME scene resubmitted in place, up to MAX_REWRITES times, each
// rewrite more conservative than the last. Only after that does the scene
// get marked rejected and the loop move on — by then the trigger is almost
// certainly the start image, which no prompt can fix (see CLAUDE.md,
// "Content filters").
const sd = $getWorkflowStaticData('global');
sd.rewrites = sd.rewrites || {};
const cur = $('Current Scene').first().json || {};
const f = cur.fields || {};
const sceneId = cur.id;
const n = (sd.rewrites[sceneId] || 0) + 1;
sd.rewrites[sceneId] = n;
const MAX_REWRITES = 4;
// NOT slice(0, 2000). The marker that says WHICH filter fired sits inside
// `media[0].mediaStatus`, past a kilobyte of request echo, and on a longer
// response the old 2,000-character window cut it off — so every refusal read
// as the generic one. 2026-09-22.
const errText = JSON.stringify($json).slice(0, 20000);
let reason = 'Google video content filter';
// THE AUDIO ARM, and why a scene without it is a wild goose chase.
//
// Veo 3.1 generates a soundtrack alongside the picture, and Google refuses
// that soundtrack on its own terms: `PUBLIC_ERROR_AUDIO_FILTERED` /
// `AUDIO_GENERATION_FILTERED`. It contains the substring FILTER, so
// `Filter Failure?` routes it here — into the ladder that rewrites the
// MOTION prompt, which is not what was refused. Four rewrites later the
// scene is marked rejected and told the start image shows a face.
//
// Found on scene 106 of the New York film (`rec34uf9V2Castw3B`), whose
// start image is an extreme close-up of a hand on a desk with no face in
// it at all. Full account: db/port/audio-filter/README.md.
const audioFiltered = errText.includes('AUDIO_GENERATION_FILTERED') || errText.includes('AUDIO_FILTERED');
if (errText.includes('PROMINENT')) reason = 'the motion prompt names or depicts a recognizable real person';
else if (errText.includes('MINOR')) reason = 'the motion prompt places a child on screen';
else if (audioFiltered) reason = 'Google refused the generated AUDIO track, not the picture (AUDIO_GENERATION_FILTERED)';
// What the give-up note should tell the producer to DO. `Mark Video Prompt
// Rejected` prints this verbatim, so the advice travels with the diagnosis
// instead of being one hardcoded sentence that fits only one refusal.
const advice = audioFiltered
  ? 'Rewriting the shot direction cannot fix this — the picture was never the problem. Veo invents a soundtrack for the still it is given, and this one made it invent something Google stops (a still of someone about to speak, take a call or sing is the usual cause). Regenerate the IMAGE as a shot with nobody in it about to talk, approve it, then press Regenerate video.'
  : 'The START IMAGE is most likely what Google refuses: regenerate the image so no face or real person is in frame, approve it, then press Regenerate video.';
console.log('Scene ' + sceneId + ': video filter refusal (' + reason + '), rewrite ' + n + '/' + MAX_REWRITES + (n > MAX_REWRITES ? ' — giving up' : ''));
return [{ json: {
  sceneId,
  prompt: String(f['Video Scenă URL'] || ''),
  note: String(f['Observații Scenă'] || ''),
  reason,
  advice,
  audioFiltered,
  attempt: n,
  giveUp: n > MAX_REWRITES,
} }];
