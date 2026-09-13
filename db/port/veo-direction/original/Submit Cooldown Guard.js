// Submit Video failed after its own three quick retries. That is usually
// the Flow account being throttled — 'captcha_quality:
// PUBLIC_ERROR_UNUSUAL_ACTIVITY after 5 attempts' killed the whole Vegas
// batch at 8981 — and the cure is time, not a fourth attempt one second
// later. Hold a minute and try again, at most MAX times per scene per run;
// then die with the last reason, exactly as before. The Wait is 60s ON
// PURPOSE: under 65s n8n keeps the execution in memory, so this counter
// (static data) survives; a longer Wait suspends the run to the database
// and the count would not.
// (Sort & Cap Scenes resets the counters at the start of every pass.)
const sd = $getWorkflowStaticData('global');
sd.submitCooldowns = sd.submitCooldowns || {};
const key = $('Current Scene').first().json.id;
const n = (sd.submitCooldowns[key] || 0) + 1;
sd.submitCooldowns[key] = n;
const MAX = 20;
const j = $input.first().json || {};
const last = String((j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
if (n > MAX) throw new Error('Submit Video kept failing after ' + MAX + ' cooldowns of 60s — last reason: ' + last);
console.log('Submit Video failed (' + n + '/' + MAX + '), cooling down 60s: ' + last);
return [{ json: { cooldown: n, lastError: last } }];