// Per scene (static data, reset by Sort & Cap each pass) — $runIndex would
// count every regeneration of the execution together.
const sd = $getWorkflowStaticData('global');
sd.regenResubmits = sd.regenResubmits || {};
sd.regenPolls = sd.regenPolls || {};
const payload = $('Prep Video Regen').first().json;
const n = (sd.regenResubmits[payload.id] || 0) + 1;
sd.regenResubmits[payload.id] = n;
const MAX = 4;
if (n > MAX) throw new Error('Scene ' + payload.id + ': too many failed video regenerations in this run (' + n + ').');
sd.regenPolls[payload.id] = 0;
// Re-feed the regen payload so Submit Video Regen gets motionPrompt/imageId again.
return [{ json: payload }];