// Generate Scene Image failed (its quick retries are OFF on purpose: a burst
// of identical requests is exactly what trips Flow's unusual-activity
// filter). Sort the failure into the three things that can be done about it:
//  - a content refusal  -> the rewrite-in-place ladder (Prep Flow Reject);
//  - out of credits (402) -> fatal, the run dies loudly, never loops;
//  - everything else (429, 503, captcha_quality, timeouts, 5xx)
//                        -> IMG Cooldown Guard, i.e. time, then the same request.
const j = $input.first().json || {};
const text = JSON.stringify(j).slice(0, 2000);
const status = Number((j.error && (j.error.httpCode || j.error.statusCode)) || j.httpCode || j.statusCode || (/"httpCode":"?(\d{3})/.exec(text) || [])[1] || 0);
if (status === 402 || /insufficient credits|out of credits|"402"/i.test(text)) throw new Error('Google Flow: out of credits — ' + text.slice(0, 300));
// Decode Scene Image's silent refusal (2026-09-17): a completed Flow job
// that returned no image at all. It is a content refusal with none of the
// words below in it, so it is matched FIRST and by an exact marker rather
// than left to the prose regexes — and it must never be read as a throttle,
// because time does not change a filter's verdict and the cooldown branch
// would re-ask the identical prompt twenty times before killing the film.
const noImage = text.includes('FLOW_NO_IMAGE');
const throttled = !noImage && /captcha_quality|UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC/i.test(text);
const refusal = noImage || (!throttled && /PROMINENT|MINOR|FILTER|SAFETY|content policy|content_policy|blocked/i.test(text));
return [{ json: Object.assign({}, j, { imgRefusal: refusal, imgThrottled: throttled, imgNoImage: noImage, imgStatus: status }) }];