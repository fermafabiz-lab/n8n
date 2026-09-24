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

// WITH THE VIDEO POOL ON, THIS NODE MUST NOT WAIT IN PLACE (2026-09-24).
// The serial loop below (Wait Submit Cooldown → Submit Video, up to twenty
// times) is right when one scene is all there is. In the pool it froze the
// whole film: Pool Tick is the only thing that polls the clips already in
// flight on the OTHER accounts, and it does not run while this loop spins. On
// the Rome film (16578) that was two stalls of 13m53 and 12m35 — 26 of the
// clip phase's 63 minutes — each ending with three clips from three accounts
// landing inside a minute, finished long before anyone collected them.
// So in the pool this node only DECIDES: Pool Cooldown? sends the result to
// Pool Record, which puts the scene back at the head of the queue and rests
// its account for a minute, and Pool Tick keeps polling everyone else. Past
// MAX the scene is set aside for the next pass, as MAX_POLLS does for a clip
// that never finishes, rather than killing a film with clips in flight.
let inPool = false;
try { inPool = Boolean($('Pool Tick').first().json.pool); } catch (e) { inPool = false; }
if (n > MAX) {
  if (inPool) {
    console.log('Submit Video kept failing after ' + MAX + ' cooldowns — setting scene ' + key + ' aside for the next pass: ' + last);
    return [{ json: { cooldown: n, lastError: last, sceneId: key, dropEndFrame: false, inPool: true, giveUp: true } }];
  }
  throw new Error('Submit Video kept failing after ' + MAX + ' cooldowns of 60s — last reason: ' + last);
}

// THE END FRAME'S WAY OUT, and the only place it can be taken.
//
// `Submit Video` is reached again from `Wait Submit Cooldown` without passing
// through `End Frame Prompt`, so the Code node that decides whether to draw an
// end frame never sees this retry — only the jsonBody expression does, and an
// expression cannot read static data. Hence two levers, one for each reach:
//   dropEndFrame, read by Submit Video's expression → THIS scene's retry goes
//     out as a plain start-frame submission, which is exactly what the film
//     did before end frames existed;
//   sd.endFrameOffAt, read by End Frame Prompt → every LATER scene skips the
//     end frame for six hours (End Frame Prompt explains why it is a
//     timestamp and not a flag reset by Sort & Cap Scenes).
// The second only trips when this looks systematic rather than unlucky: the
// reason names the end frame, or three submissions carrying one have failed
// inside the same window. Without it, a tier that turned out not to accept
// I2V-FL would cost every scene of an eighty-scene film twenty cooldowns of
// 60s and then kill the batch — the failure mode a quality feature must never
// have.
let attached = false;
try { const a = $('Attach End Frame').first().json; attached = !!(a && a.endImage && a.sceneId === key); } catch (e) { attached = false; }
if (attached) {
  const FAIL_WINDOW_MS = 60 * 60 * 1000;
  if (Date.now() - Number(sd.endFrameFailAt || 0) > FAIL_WINDOW_MS) sd.endFrameFails = 0;
  sd.endFrameFailAt = Date.now();
  sd.endFrameFails = (sd.endFrameFails || 0) + 1;
  if (/end.?image|i2v|final frame/i.test(last) || sd.endFrameFails >= 3) {
    console.log('ENDFRAME: paused for 6h after ' + sd.endFrameFails + ' failed submission(s) carrying one — ' + last);
    sd.endFrameOffAt = Date.now();
  }
}

console.log('Submit Video failed (' + n + '/' + MAX + '), ' + (inPool ? 'resting its account 60s while the pool polls the others' : 'cooling down 60s') + (attached ? ' WITHOUT the end frame' : '') + ': ' + last);
return [{ json: { cooldown: n, lastError: last, sceneId: key, dropEndFrame: attached, inPool: inPool, giveUp: false } }];
