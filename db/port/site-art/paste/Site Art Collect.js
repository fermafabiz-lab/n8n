// Flow answers /google-flow/images synchronously: media[0].image.generatedImage
// carries the signed fifeUrl (which dies within hours, so the next node fetches
// it in the same run) and the mediaGenerationId, which is the durable handle.
//
// Routing follows IMG Error Router's precedent with one deliberate difference:
// a throttle ABORTS here rather than cooling down and retrying. The film
// pipeline grinds through a throttle because a film is at stake; site art must
// yield to production rather than add load to the same account.
const r = $input.first().json || {};
const raw = JSON.stringify(r);

if (r.error || r.code >= 400) {
  if (/402/.test(raw)) throw new Error('FLOW 402: out of credits, stop.');
  if (/captcha_quality|UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC/i.test(raw))
    throw new Error('FLOW THROTTLED: Google is limiting the account. Stop, do not retry.');
  if (/PROMINENT|MINOR|FILTER|SAFETY|content policy|blocked/i.test(raw))
    throw new Error('FLOW REFUSED the prompt. Reword it by hand: ' + raw.slice(0, 400));
  throw new Error('FLOW ERROR: ' + raw.slice(0, 400));
}

const m0 = (r.media || [])[0] || {};
const gi = (m0.image && m0.image.generatedImage) || {};
const url = gi.fifeUrl || '';
const mediaId = gi.mediaGenerationId || '';
if (!url) throw new Error('FLOW: no fifeUrl in the answer: ' + raw.slice(0, 400));

console.log('SITE ART: got ' + mediaId);
return [{ json: { url, mediaId } }];
