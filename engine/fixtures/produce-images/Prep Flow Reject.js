// Context for the auto-rewrite: the scene, the prompt that was ACTUALLY
// sent, and WHY the image was refused.
//
// Images are generated ON Google Flow (since 2026-09-02), so a refusal is
// Flow's own content filter at GENERATION time — no image was made. The
// upload-time refusals this chain was first built for (MINOR / prominent
// people at Upload Asset To Flow) can now only come from the producer's
// reference photo, which is uploaded once per pass and never lands here.
// Either way the cure is the same: rewrite the prompt, never resubmit the
// refused text. The scene id and note are read from Loop Images rather
// than from the error, which is what lets one chain serve every entry.
//
// The rewrite is retried IN PLACE (Apply Rewritten Prompt → IMG Reload
// Scene → Needs Image?), so this node runs once per attempt for the same
// scene. Attempts are counted per scene per pass in static data (Sort & Cap
// resets sd.imgRewrites); after MAX the scene is handed to a human.
const scene = $('Loop Images').first().json || {};
const f = scene.fields || {};
const errText = JSON.stringify($json).slice(0, 1500);
const service = 'Google Flow';
let reason = service + ' content policy';
if (errText.includes('FLOW_NO_IMAGE')) reason = service + ' ran the job and returned no image at all — its silent refusal, which names no cause. Assume the strictest reading: something in the prompt or its reference sheets reads as a real person, a minor, or unsafe content';
else if (errText.includes('MINOR')) reason = 'the image appears to contain a child (Flow refuses images with minors)';
else if (errText.includes('PROMINENT') || errText.includes('FACE')) reason = 'the image appears to contain a recognizable real person';
// After an in-place rewrite the Loop Images item still holds the ORIGINAL
// text; the prompt that was sent is Build Image Request's latest run.
let prompt = '';
try { prompt = String($('Build Image Request').first().json.rawPrompt || ''); } catch (e) {}
if (!prompt) prompt = String(f['Imagine First Frame'] || '');
const note = String(f['Observații Scenă'] || '');
const sd = $getWorkflowStaticData('global');
sd.imgRewrites = sd.imgRewrites || {};
const n = (sd.imgRewrites[scene.id] || 0) + 1;
sd.imgRewrites[scene.id] = n;
const MAX = 4;
// A scene that arrives already carrying a refusal note from an earlier pass
// starts one rung further up the escalation ladder.
const attempt = n + (/AUTO-REWRITE|REJECTED/.test(note) ? 1 : 0);
console.log('Image refused for ' + scene.id + ' by ' + service + ' (attempt ' + n + '/' + MAX + ')');
return [{ json: {
  sceneId: scene.id,
  prompt,
  note,
  service,
  reason,
  attempt,
  giveUp: n > MAX,
} }];