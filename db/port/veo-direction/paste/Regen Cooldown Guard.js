// Same cooldown as 'Submit Cooldown Guard', for the regeneration submit
// inside the video gate. Re-feeds the regen payload, exactly as 'Regen
// Resubmit Guard' does, because Submit Video Regen reads $json.
const sd = $getWorkflowStaticData('global');
sd.submitCooldowns = sd.submitCooldowns || {};
const payload = $('Prep Video Regen').first().json;
const key = 'regen:' + payload.id;
const n = (sd.submitCooldowns[key] || 0) + 1;
sd.submitCooldowns[key] = n;
const MAX = 20;
const j = $input.first().json || {};
const last = String((j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
if (n > MAX) throw new Error('Submit Video Regen kept failing after ' + MAX + ' cooldowns of 60s — last reason: ' + last);
// The end frame's way out, mirroring `Submit Cooldown Guard` — see that node
// for why there are two levers and why the pause is a timestamp rather than a
// flag reset by Sort & Cap Scenes. `sd.endFrameOffAt` is SHARED with the
// batch path on purpose: if Flow is refusing end frames, it is refusing them
// for the whole instance, and one scene paying to find that out is enough.
let attached = false;
try { const a = $('RG Attach End Frame').first().json; attached = !!(a && a.endImage && a.sceneId === payload.id); } catch (e) { attached = false; }
if (attached) {
  const FAIL_WINDOW_MS = 60 * 60 * 1000;
  if (Date.now() - Number(sd.endFrameFailAt || 0) > FAIL_WINDOW_MS) sd.endFrameFails = 0;
  sd.endFrameFailAt = Date.now();
  sd.endFrameFails = (sd.endFrameFails || 0) + 1;
  if (/end.?image|i2v|final frame/i.test(last) || sd.endFrameFails >= 3) {
    console.log('ENDFRAME: paused for 6h after ' + sd.endFrameFails + ' failed submission(s) carrying one — ' + last);
    sd.endFrameOffAt = Date.now();
  }
}

console.log('Submit Video Regen failed (' + n + '/' + MAX + '), cooling down 60s' + (attached ? ' WITHOUT the end frame' : '') + ': ' + last);
// The payload is re-emitted whole because Submit Video Regen reads $json;
// the two extra keys are what its expression matches the drop against.
return [{ json: Object.assign({}, payload, { sceneId: payload.id, dropEndFrame: attached }) }];