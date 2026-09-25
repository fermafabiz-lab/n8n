const j = $input.first().json;
// A mid-render Railway deploy replaces the container and wipes the
// in-memory job map: the poll answers 404 'job not found' although nothing
// was wrong with the job. The work died with the container, so the only
// recovery is resubmitting — flagged here, routed by 'Render Lost?'.
const httpErr = j.error && typeof j.error === 'object' ? String(j.error.message || j.error.description || '') : (typeof j.error === 'string' && !j.status ? j.error : '');
// 720 polls x 5s = 60 minutes. It was 15 (180 polls) while a film was a
// handful of scenes; a 71-scene film is 142 downloads, 71 breath trims and
// an eight-minute encode, and the ceiling has to be sized for the longest
// film the brief allows (12 minutes), not the shortest. 'Wait Render'
// sleeps 5s BEFORE the first check (measured on 3599: a one-scene ffmpeg
// finished well inside the old 20s and n8n slept all of it). Any change to
// the Wait node has to move this number by the same factor or the ceiling
// moves with it.
const MAX_POLLS = 720;
if (/not.*found|404/i.test(httpErr)) {
  if ($runIndex > MAX_POLLS) throw new Error('assemble job lost repeatedly (' + $runIndex + ' polls) — giving up.');
  return [{ json: { lost: true, status: 'lost' } }];
}
const s = (j.status || '').toLowerCase();
if (s === 'error') {
  throw new Error('assemble failed: ' + (j.error || 'unknown'));
}
if ($runIndex > MAX_POLLS) {
  throw new Error('assemble timed out after ' + $runIndex + ' polls. Last status: ' + s);
}
return [{ json: Object.assign({ lost: false }, j) }];