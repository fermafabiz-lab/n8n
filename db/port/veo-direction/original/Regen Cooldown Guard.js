// Same cooldown as 'Submit Cooldown Guard', for the regeneration submit
// inside the video gate. Re-feeds the regen payload, exactly as 'Regen
// Resubmit Guard' does, because Submit Video Regen reads $json.
const sd = $getWorkflowStaticData('global');
sd.submitCooldowns = sd.submitCooldowns || {};
const payload = $('Prep Video Regen').first().json;
const key = 'regen:' + payload.id;
const n = (sd.submitCooldowns[key] || 0) + 1;
sd.submitCooldowns[key] = n;
const MAX = 20;
const j = $input.first().json || {};
const last = String((j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
if (n > MAX) throw new Error('Submit Video Regen kept failing after ' + MAX + ' cooldowns of 60s — last reason: ' + last);
console.log('Submit Video Regen failed (' + n + '/' + MAX + '), cooling down 60s: ' + last);
return [{ json: payload }];