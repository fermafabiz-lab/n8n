const j = $input.first().json;
const s = (j.status || '').toLowerCase();
if (s === 'error') throw new Error('multi-voice TTS failed: ' + (j.error || 'unknown'));
// Per scene in static data (reset by Sort & Cap each pass) — $runIndex
// would count every scene's polls together, and a pass covers the film.
const sd = $getWorkflowStaticData('global');
sd.multiPolls = sd.multiPolls || {};
const sceneId = $('AB Current Scene').first().json.id;
sd.multiPolls[sceneId] = (sd.multiPolls[sceneId] || 0) + 1;
if (sd.multiPolls[sceneId] > 40) throw new Error('multi-voice TTS timed out after ' + sd.multiPolls[sceneId] + ' polls on scene ' + sceneId + '. Last status: ' + s);
return [{ json: j }];