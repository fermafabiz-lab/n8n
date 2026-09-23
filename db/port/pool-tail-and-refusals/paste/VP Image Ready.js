// Has the new still landed? `VP Fire Image Regen` posted the scene to the
// `scene-image-regen` webhook, which answers "Workflow was started" and runs on
// its own execution for ~50 s. This node reads the scene row `VP Image Check`
// just fetched and decides: ready, wait, or give up.
//
// Polls are counted PER SCENE AND ATTEMPT in static data, not with $runIndex
// (which counts every run in the execution across all scenes).
const sd = $getWorkflowStaticData('global');
sd.imageWaits = sd.imageWaits || {};
const vp = $('VP Prep').first().json || {};
const id = String(vp.sceneId || '');
const key = id + ':' + String(vp.attempt || 0);
sd.imageWaits[key] = (sd.imageWaits[key] || 0) + 1;
const polls = sd.imageWaits[key];
// 16 × 15 s = 4 minutes. The regeneration lands in about 50 s; a run that
// died leaves the flag up, and four minutes is long enough to be sure.
const MAX_WAITS = 16;

const row = $input.first().json || {};
const oldId = String(vp.imageId || '');
const newId = String(row.image_media_id || '');
const flagUp = row.regen_image === true;
const note = String(row.note || '');

// `IR Write Image` writes the new id, clears the flag and empties the note in
// one PATCH — so a changed id with the flag down is the whole signal.
const ready = newId !== '' && newId !== oldId && !flagUp;
// `IR Mark Rejected` clears the flag and writes a REJECTED note without
// changing the id: Flow refused the new still too. Nothing more to wait for.
const refused = !flagUp && newId === oldId && /^(Image regeneration REJECTED|REJECTED)/i.test(note);

let state = 'wait';
if (ready) state = 'ready';
else if (refused) state = 'timeout';
else if (polls >= MAX_WAITS) state = 'timeout';

console.log('VP IMAGE ' + id + ' attempt ' + vp.attempt + ': ' + state + ' after ' + polls + ' poll(s)' + (ready ? ' — new still ' + newId.slice(-12) : (refused ? ' — Flow refused the new still too' : '')));
return [{ json: { state: state, polls: polls, newImageId: ready ? newId : '' } }];
