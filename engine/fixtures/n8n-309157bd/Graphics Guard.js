const j = $input.first().json;
// Same deploy-wipes-the-job recovery as Render Guard: 404 from the status
// poll means the container restarted mid-render, not that the render broke.
const httpErr = j.error && typeof j.error === 'object' ? String(j.error.message || j.error.description || '') : (typeof j.error === 'string' && !j.status ? j.error : '');
// The Remotion pass is headless Chrome on software GL at concurrency 1 —
// measured at ~2 frames a second (CLAUDE.md, "where a final assembly's
// minutes actually go"). A 60s film is ~1800 frames and 15 minutes; an
// 8-minute film is ~11,500 frames and ~95 minutes; the 12-minute brief is
// ~2.5 hours. The old cap of 360 polls (30 min) was sized for short films
// and would have killed every long one at the half-hour mark with a
// "timed out" that reads as a hang. 2160 polls x 5s = 3 hours. Move the
// Wait node and this number moves with it, or the ceiling silently shrinks.
// Doubled for a 1080p render, because that is what 1080p costs: 2.09x the
// time per frame (measured, 0.107s against 0.224s), which puts an eight-minute
// film at roughly 3.3 hours — past the three-hour ceiling this constant was
// raised to on 2 September. A film that renders slower than the guard allows
// does not fail slowly, it fails at the cap and reads as a hang.
const hd = (() => {
  try { return $('Build Timeline').first().json.resolution === '1080p'; } catch (e) { return false; }
})();
const MAX_POLLS = hd ? 4320 : 2160;
if (/not.*found|404/i.test(httpErr)) {
  if ($runIndex > MAX_POLLS) throw new Error('graphics job lost repeatedly (' + $runIndex + ' polls) — giving up.');
  return [{ json: { lost: true, status: 'lost' } }];
}
const s = (j.status || '').toLowerCase();
if (s === 'error') throw new Error('Remotion render failed: ' + (j.error || 'unknown'));
if ($runIndex > MAX_POLLS) throw new Error('Remotion render timed out after ' + $runIndex + ' polls. Last status: ' + s + ' progress: ' + (j.progress || 0));
return [{ json: Object.assign({ lost: false }, j) }];