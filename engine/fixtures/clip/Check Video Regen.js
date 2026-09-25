// The regeneration path's copy of the poll ceiling. It must move with
// 'Check Job Status' — the two are the same decision about the same Veo
// queue, and a producer who re-shoots one clip deserves the answer sooner
// than the batch, not later. See that node for the measurements.
const item = $input.first().json;
const status = (item.status || '').toLowerCase();
// Per scene in static data (reset by Sort & Cap each pass), 30s a poll
// ('Wait Video Regen'); 20 = ten minutes a clip, the measured ceiling.
// Overrunning it counts as a failed job and goes through 'Regen Resubmit
// Guard' — same rule, same number, as 'Check Job Status'.
const sd = $getWorkflowStaticData('global');
sd.regenPolls = sd.regenPolls || {};
const sceneId = $('Prep Video Regen').first().json.id;
sd.regenPolls[sceneId] = (sd.regenPolls[sceneId] || 0) + 1;
const MAX_POLLS = 20;
const raw = JSON.stringify(item);
const done = status === 'completed' || raw.includes('flow-content.google/video');
let failed = status === 'failed' || status === 'error' || status === 'cancelled';
if (!done && !failed && sd.regenPolls[sceneId] > MAX_POLLS) {
  console.log('Scene ' + sceneId + ': video regen still not done after ' + MAX_POLLS + ' polls — treating as failed so it gets resubmitted.');
  failed = true;
  item.error = 'polling timed out after ' + MAX_POLLS + ' polls';
}
return [{ json: Object.assign({}, item, { done: done && !failed, jobFailed: failed }) }];