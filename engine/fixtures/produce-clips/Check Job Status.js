const item = $input.first().json;
const status = (item.status || '').toLowerCase();
// Polls are counted PER SCENE in static data, not with $runIndex — which
// counts every poll of the execution across all scenes, and a pass now
// covers the whole film (Sort & Cap Scenes resets sd.polls each pass).
//
// 30s a poll ('Wait Video'), so MAX_POLLS is the minutes a clip may take
// before the job is treated as FAILED and 'Resubmit Guard' re-shoots it.
// It was 120 — ONE HOUR — "sized for the low-priority Veo queue", a number
// nobody had measured. On 2026-09-24 a producer sat in front of a film whose
// last two scenes never appeared: the batch was alive, writing nothing, 25
// minutes into an hour of asking about a job that was already dead. Stopping
// and restarting production reset the counter, so the hour started again; the
// film had been in that loop across three passes.
//
// The number is measured now. Every legitimate clip we have timed:
//   68, 85, 94, 233, 246, 345 s  batch cadence, engine film, 2026-09-24
//   71, 149 s                    two regens on that same film, same day
//   177 s                        the 2026-09-17 regen measurement
//   88 s steady / 130 s pooled   the 2026-09-18 A/B
//   391 s (6m31)                 the worst legitimate clip ever recorded
// 20 polls = 10 minutes, half again as long as the worst of those, and the
// whole scene is still bounded: 5 resubmits (Resubmit Guard) is 50 minutes
// against the five HOURS this used to allow.
//
// The asymmetry is the reason, and it is worth keeping in mind when this
// number is next revisited: waiting too long costs the producer their day,
// while resubmitting too early costs one clip generation. Those are not the
// same size, so the ceiling belongs just above the worst measured clip —
// not at an hour "to be safe".
const sd = $getWorkflowStaticData('global');
sd.polls = sd.polls || {};
const sceneId = $('Current Scene').first().json.id;
sd.polls[sceneId] = (sd.polls[sceneId] || 0) + 1;
const MAX_POLLS = 20;
const raw = JSON.stringify(item);
const done = status === 'completed' || raw.includes('flow-content.google/video');
let failed = status === 'failed' || status === 'error' || status === 'cancelled';
if (!done && !failed && sd.polls[sceneId] > MAX_POLLS) {
  console.log('Scene ' + sceneId + ': video job still not done after ' + MAX_POLLS + ' polls — treating as failed so it gets resubmitted.');
  failed = true;
  item.error = 'polling timed out after ' + MAX_POLLS + ' polls';
}
// Failed jobs are routed to a resubmit branch instead of throwing here —
// Google intermittently fails generations with VIDEO_GENERATION_TIMED_OUT
// and a resubmit usually succeeds.
return [{ json: Object.assign({}, item, { done: done && !failed, jobFailed: failed }) }];