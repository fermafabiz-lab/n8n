const planned = CONS.plan({ f: f, opts: opts, bible: bible, prompt: prompt, prevId: prevId, userRefId: userRefId, isFirstScene: isFirstScene, afterRefusal: rejectedBefore, strict: false, strictNotes: '' });
// count: 1 is mandatory (the API defaults to four); captchaRetry: 1 so a
// throttled account does not spend five captcha solves per request.
const body = CONS.apply({ email: 'fermafabiz@gmail.com', model: MODEL, prompt: prompt, aspectRatio: aspect, count: 1, captchaRetry: 1 }, planned);
console.log('IR refs for ' + scene.id + ': ' + (planned.refs.map((r) => r.role + (r.name ? '=' + r.name : '')).join(', ') || 'none'));
return [{ json: {
  sceneId: scene.id,
  prompt: prompt,
  requestBody: body,
  refs: planned.refs,
  usedReference: planned.refs.length ? planned.refs[0].id : null,
  refIsUser: planned.used.user,
  aspect: aspect,
} }];
