const planned = CONS.plan({ f: f, opts: opts, bible: bible, prompt: prompt, prevId: prevId, userRefId: userRefId, isFirstScene: isFirstScene, afterRefusal: afterRefusal, strict: strict, strictNotes: strictNotes });
// count: 1 is mandatory — the API DEFAULTS TO FOUR images. captchaRetry: 1
// because useapi's five captcha retries per request are pure spend while
// Google throttles the account; our own cooldown loop handles that.
const body = CONS.apply({ email: rb.Flow_Email || 'fermafabiz@gmail.com', model: MODEL, prompt: prompt, aspectRatio: aspect, count: 1, captchaRetry: 1 }, planned);
console.log('IMG refs for ' + $json.id + ': ' + (planned.refs.map((r) => r.role + (r.name ? '=' + r.name : '')).join(', ') || 'none') + (strict ? ' [STRICT]' : ''));
return [{ json: { sceneId: $json.id, requestBody: body, refs: planned.refs, used: planned.used, usedReference: planned.refs.length ? planned.refs[0].id : null, castUsed: planned.used.cast, userRefApplied: planned.used.user, strict: strict, rawPrompt: prompt, promptSimilarityToPrev: Number(promptSim.toFixed(2)) } }];
