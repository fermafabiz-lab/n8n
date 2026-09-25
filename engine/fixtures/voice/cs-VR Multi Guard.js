const j = $input.first().json;
const s = (j.status || '').toLowerCase();
if (s === 'error') throw new Error('multi-voice TTS failed: ' + (j.error || 'unknown'));
if ($runIndex > 40) throw new Error('multi-voice TTS timed out after ' + $runIndex + ' polls. Last status: ' + s);
return [{ json: j }];