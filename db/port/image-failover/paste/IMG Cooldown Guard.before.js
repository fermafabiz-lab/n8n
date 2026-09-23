// Flow image generation failed for a reason that is not a content refusal:
// 429, 503, a captcha_quality throttle, a timeout. The cure is TIME, not a
// fourth attempt one second later. Hold a minute and try again, at most
// MAX times per scene per pass; then die with the last reason, exactly as
// Submit Cooldown Guard does for videos. The Wait is 60s ON PURPOSE: under
// 65s n8n keeps the execution in memory and this counter (static data)
// survives; a longer Wait suspends the run to the database and the count
// would not. Sort & Cap Scenes resets the counters at the start of every pass.
const sd = $getWorkflowStaticData('global');
sd.imgCooldowns = sd.imgCooldowns || {};
const sceneId = $('Build Image Request').first().json.sceneId;
const key = sceneId;
const n = (sd.imgCooldowns[key] || 0) + 1;
sd.imgCooldowns[key] = n;
const MAX = 20;
const j = $input.first().json || {};
const last = String(j.lastError || (j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
if (n > MAX) throw new Error('Flow image generation kept failing after ' + MAX + ' cooldowns of 60s — last reason: ' + last);
// A throttle needs TIME, not attempts: hold five cooldowns (5 min) per try.
const throttled = !!j.imgThrottled;
const holds = throttled ? 5 : 1;
const retryNow = n % holds === 0;
console.log('Flow image ' + sceneId + ' failed (' + n + '/' + MAX + '), cooling down 60s' + (retryNow ? ', then retrying' : '') + ': ' + last);
return [{ json: { cooldown: n, retryNow: retryNow, imgThrottled: throttled, lastError: last } }];
