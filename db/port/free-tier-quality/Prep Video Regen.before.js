const r = $json.regen;
if (!r) throw new Error('No regen payload.');
if (!r.imageId) throw new Error('Scene ' + r.id + ' has no Image Media ID — cannot regenerate its video (regenerate/approve its image first).');
if (!r.motionPrompt) throw new Error('Scene ' + r.id + ' has no motion prompt (Video Scenă URL).');
return [{ json: r }];
