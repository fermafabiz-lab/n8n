// Flow image generation failed for a reason that is not a content refusal:
// 429, 503, a captcha_quality throttle, a timeout. The cure is TIME, not a
// fourth attempt one second later. Hold a minute and try again, at most
// MAX times per scene per pass; then die with the last reason, exactly as
// Submit Cooldown Guard does for videos. The Wait is 60s ON PURPOSE: under
// 65s n8n keeps the execution in memory and this counter (static data)
// survives; a longer Wait suspends the run to the database and the count
// would not. Sort & Cap Scenes resets the counters at the start of every pass.
//
// A FLAGGED ACCOUNT IS ROUTED AROUND, NOT WAITED OUT (2026-09-23). A throttle
// (`PUBLIC_ERROR_UNUSUAL_ACTIVITY`, `TOO_MUCH_TRAFFIC`, captcha_quality) used to
// hold five cooldowns — five minutes — and then ask the SAME account again. On
// the Rome film `houseofvideos01` refused 12 of 20 image requests that way,
// each refusal a five-minute stop for the whole image phase while
// `fermafabiz` (1 refusal in 26) and `houseofvideos02` sat idle; the producer
// read it as a frozen production and stopped it twice. Now the account that was
// refused is marked avoided for 30 minutes — useapi's own quarantine for a
// throttled account — and when another account the film runs on is free, the
// retry goes there after a few seconds (IMG Account picks it). Only when every
// account is avoided does the old five-minute hold apply.
const ACCOUNTS = [
  'fermafabiz@gmail.com',
  'houseofvideos01@gmail.com',
  'houseofvideos02@gmail.com',
];
const AVOID_MS = 30 * 60 * 1000;

const sd = $getWorkflowStaticData('global');
sd.imgCooldowns = sd.imgCooldowns || {};
sd.imgAvoid = sd.imgAvoid || {};
const sceneId = $('Build Image Request').first().json.sceneId;
const key = sceneId;
const n = (sd.imgCooldowns[key] || 0) + 1;
sd.imgCooldowns[key] = n;
const MAX = 20;
const j = $input.first().json || {};
const last = String(j.lastError || (j.error && (j.error.message || j.error.description)) || j.message || JSON.stringify(j)).slice(0, 300);
if (n > MAX) throw new Error('Flow image generation kept failing after ' + MAX + ' cooldowns of 60s — last reason: ' + last);

const throttled = !!j.imgThrottled;

// The account this attempt went to, as IMG Account chose it.
let used = '';
try { used = String($('IMG Account').first().json.imgAccount || ''); } catch (e) { used = ''; }
let inUse = [];
try {
  $('Assign Accounts').all().forEach(function (x) {
    const e = String((x.json && x.json.flowEmail) || '');
    if (e && inUse.indexOf(e) < 0) inUse.push(e);
  });
} catch (e) { inUse = []; }
inUse.sort(function (a, b) { return ACCOUNTS.indexOf(a) - ACCOUNTS.indexOf(b); });

let failover = false;
if (throttled && used) {
  const now = Date.now();
  sd.imgAvoid[used] = now + AVOID_MS;
  const alt = inUse.find(function (a) { return a !== used && Number(sd.imgAvoid[a] || 0) <= now; });
  if (alt) {
    failover = true;
    console.log('Flow image ' + sceneId + ': ' + used + ' refused (' + last.slice(0, 120) + ') — avoiding it for 30 min and retrying on ' + alt + ' now');
  }
}

// A throttle with nowhere else to go still needs TIME: five cooldowns per try.
const holds = failover ? 1 : (throttled ? 5 : 1);
const retryNow = failover || n % holds === 0;
if (!failover) {
  console.log('Flow image ' + sceneId + ' failed (' + n + '/' + MAX + '), cooling down 60s' + (retryNow ? ', then retrying' : '') + ': ' + last);
}
return [{ json: { cooldown: n, retryNow: retryNow, failover: failover, waitSeconds: failover ? 5 : 60, imgThrottled: throttled, lastError: last } }];
