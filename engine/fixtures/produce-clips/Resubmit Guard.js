// Cap video resubmits PER SCENE (static data, reset by Sort & Cap each pass)
// so a persistent Google failure can't loop forever. Used to be $runIndex,
// i.e. five resubmits for the whole execution — far too few now that a pass
// covers the whole film.
const sd = $getWorkflowStaticData('global');
sd.resubmits = sd.resubmits || {};
sd.polls = sd.polls || {};
const sceneId = $('Current Scene').first().json.id;
const n = (sd.resubmits[sceneId] || 0) + 1;
sd.resubmits[sceneId] = n;
const MAX = 5;
if (n > MAX) {
  const err = ($json.error || $json.status || 'unknown');
  throw new Error('Scene ' + sceneId + ': too many failed video generations (' + n + '). Last job status/error: ' + String(err).slice(0, 200));
}
sd.polls[sceneId] = 0;
console.log('Scene ' + sceneId + ': resubmitting video (' + n + '/' + MAX + ').');
return [{ json: { resubmit: true, attempt: n } }];