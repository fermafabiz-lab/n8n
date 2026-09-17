// Runs the real node bodies (paste/, with original/ as the control) against
// the exact Flow responses this change was built on, including the verbatim
// 200-with-no-image that killed executions 14202 and 14208.
//
//   node db/port/regen-unstick/check.mjs
//
// What it pins: a silent refusal reaches IMG Error Router as a REFUSAL and
// never as a throttle (the cooldown branch re-asks the identical prompt and
// cannot work); a loud refusal and a throttle keep their old classification
// exactly; a good response still decodes; and out-of-credits still throws,
// because that one is deliberately fatal.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const body = (which, f) => fs.readFileSync(path.join(dir, which, f), 'utf8');

let failed = 0, passed = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok  ' : '  FAIL') + ' ' + label + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
};
const ok = (label, cond) => is(label, !!cond, true);

/** Run a Code-node body the way n8n does, returning either its output or its throw. */
function run(src, { nodes = {}, json = {}, items = [] } = {}) {
  const $ = (name) => {
    const n = nodes[name];
    if (!n) throw new Error(`no stub for $('${name}')`);
    const list = Array.isArray(n) ? n : [n];
    return { first: () => ({ json: list[0] }), all: () => list.map((j) => ({ json: j })), item: { json: list[0] }, isExecuted: true };
  };
  const $input = { all: () => items, first: () => items[0] };
  const sd = {};
  const fn = new Function('$', '$json', '$input', '$getWorkflowStaticData', 'console', src);
  const logs = [];
  try {
    return { out: fn($, json, $input, () => sd, { log: (...a) => logs.push(a.join(' ')) }), logs, threw: null };
  } catch (e) {
    return { out: null, logs, threw: e.message };
  }
}

/**
 * The response that killed execution 14208, as n8n recorded it: HTTP 200, a
 * completed job, a generatedImage carrying the prompt and the seed — and no
 * fifeUrl, no mediaGenerationId. Trimmed only in the prompt's length.
 */
const SILENT_REFUSAL = {
  jobId: 'j0917112533798475650i-u2923-email:fermafabiz@gmail.com-bot:google-flow',
  media: [{
    name: 'f2c539a1-c8f9-4b17-beca-6b477ca85bfb',
    workflowId: '3da873f8-56ec-4296-b483-172f5f801dda',
    image: { generatedImage: { seed: 1445767849, mediaVisibility: 'PRIVATE', prompt: 'Reference image 1 is a character sheet of Lazarus shown from several angles: this character (a person, an animal or a creature, exactly as drawn there) …' } },
  }],
};
const GOOD = {
  jobId: 'j-ok',
  media: [{ image: { generatedImage: { seed: 1, fifeUrl: 'https://flow-content.google/img/abc', mediaGenerationId: 'abc-image:uuid' } } }],
};
/** An n8n error item, the shape a Code node emits on its error output. */
const errorItem = (msg) => ({ error: { message: msg, name: 'NodeOperationError' } });

// ---------------------------------------------------------------------------
console.log('Decode Scene Image');
{
  const decode = (which, resp) => run(body(which, 'mg-Decode_Scene_Image.js'), {
    json: resp,
    nodes: { 'Build Image Request': { sceneId: 'recScene1' } },
  });
  const good = decode('paste', GOOD);
  is('a good response still decodes', good.out && good.out[0].json, { sceneId: 'recScene1', url: 'https://flow-content.google/img/abc', mediaId: 'abc-image:uuid' });
  is('the control decodes it identically', decode('original', GOOD).out[0].json, good.out[0].json);

  const bad = decode('paste', SILENT_REFUSAL);
  ok('the silent refusal still throws (it IS a failure)', !!bad.threw);
  ok('and the throw carries the marker', /^FLOW_NO_IMAGE/.test(bad.threw));
  ok('and still carries the response head, for the log', bad.threw.includes('j0917112533798475650i'));
  ok('control: the live body throws WITHOUT a marker', !/FLOW_NO_IMAGE/.test(decode('original', SILENT_REFUSAL).threw));
}

// ---------------------------------------------------------------------------
console.log('IMG Error Router — the classification that decides everything');
{
  const route = (which, item) => run(body(which, 'mg-IMG_Error_Router.js'), { items: [{ json: item }] });
  const verdict = (r) => { const j = r.out[0].json; return { refusal: j.imgRefusal, throttled: j.imgThrottled }; };

  const silent = route('paste', errorItem('FLOW_NO_IMAGE — Google Flow completed the job and returned no image, which is how its content filter refuses quietly. Head: ' + JSON.stringify(SILENT_REFUSAL).slice(0, 400)));
  is('a silent refusal is a REFUSAL, not a throttle', verdict(silent), { refusal: true, throttled: false });
  ok('and says so explicitly', silent.out[0].json.imgNoImage === true);
  // The control is the whole point of this change: today the same item goes
  // to the cooldown branch, which re-asks the identical prompt 20 times.
  is('control: the live router sends it to the cooldown branch', verdict(route('original', errorItem('No image in Flow response. Head: ' + JSON.stringify(SILENT_REFUSAL).slice(0, 400)))), { refusal: false, throttled: false });

  // Everything that already worked must classify byte-identically.
  const cases = [
    ['a loud content refusal', { error: { httpCode: '400', message: 'Image blocked: PROMINENT person detected' } }, { refusal: true, throttled: false }],
    ['a minor refusal', { error: { httpCode: '400', message: 'MINOR present in output' } }, { refusal: true, throttled: false }],
    ['a captcha throttle', { error: { httpCode: '429', message: 'captcha_quality check failed' } }, { refusal: false, throttled: true }],
    ['unusual activity', { error: { message: 'UNUSUAL_ACTIVITY detected, slow down' } }, { refusal: false, throttled: true }],
    ['a plain 503', { error: { httpCode: '503', message: 'Service Unavailable' } }, { refusal: false, throttled: false }],
    ['a timeout', { error: { message: 'ETIMEDOUT' } }, { refusal: false, throttled: false }],
  ];
  for (const [label, item, want] of cases) {
    is(`${label}: unchanged`, verdict(route('paste', item)), want);
    is(`${label}: same as the live router`, verdict(route('paste', item)), verdict(route('original', item)));
  }
  // A throttle whose text happens to contain the marker must still be a
  // refusal — the marker only ever comes from our own throw, and a filter
  // verdict outranks a retry.
  is('marker + throttle words: refusal wins', verdict(route('paste', errorItem('FLOW_NO_IMAGE — … captcha_quality'))), { refusal: true, throttled: false });

  // Out of credits stays fatal, on both bodies.
  for (const which of ['paste', 'original']) {
    const r = route(which, { error: { httpCode: '402', message: 'insufficient credits' } });
    ok(`${which}: 402 still throws`, /out of credits/.test(r.threw || ''));
  }
}

// ---------------------------------------------------------------------------
console.log('Prep Flow Reject — the reason handed to the rewriter');
{
  const prep = (which, errJson) => run(body(which, 'mg-Prep_Flow_Reject.js'), {
    json: errJson,
    nodes: {
      'Loop Images': { id: 'recScene1', fields: { 'Observații Scenă': '', 'Imagine First Frame': 'a prompt' } },
      'Build Image Request': { rawPrompt: 'the prompt that was actually sent' },
    },
  });
  const silent = prep('paste', errorItem('FLOW_NO_IMAGE — Google Flow completed the job and returned no image'));
  ok('a silent refusal gets its own reason', /returned no image at all/.test(silent.out[0].json.reason));
  ok('and it tells the rewriter to assume the strictest reading', /strictest reading/.test(silent.out[0].json.reason));
  ok('the scene and the sent prompt still ride along', silent.out[0].json.sceneId === 'recScene1' && silent.out[0].json.prompt === 'the prompt that was actually sent');
  // The two reasons that already existed must not move.
  for (const [label, msg, want] of [
    ['minor', 'MINOR present', 'the image appears to contain a child (Flow refuses images with minors)'],
    ['prominent person', 'PROMINENT person', 'the image appears to contain a recognizable real person'],
    ['anything else', 'Service Unavailable', 'Google Flow content policy'],
  ]) {
    is(`${label}: reason unchanged`, prep('paste', errorItem(msg)).out[0].json.reason, prep('original', errorItem(msg)).out[0].json.reason);
    is(`${label}: and is the expected text`, prep('paste', errorItem(msg)).out[0].json.reason, want);
  }
}

// ---------------------------------------------------------------------------
console.log('Decode Regen Image');
{
  const decode = (which, resps) => run(body(which, 'mg-Decode_Regen_Image.js'), {
    items: resps.map((r) => ({ json: r })),
    nodes: { 'Split Regen List': [{ id: 'recA' }, { id: 'recB' }].slice(0, resps.length) },
  });
  const good = decode('paste', [GOOD]);
  is('a good regen response still decodes', good.out[0].json, { sceneId: 'recA', url: 'https://flow-content.google/img/abc', mediaId: 'abc-image:uuid' });
  const bad = decode('paste', [SILENT_REFUSAL]);
  ok('a silent refusal throws with the marker', /^FLOW_NO_IMAGE/.test(bad.threw || ''));
  ok('and names the scene, so the rejection writer can say which', bad.threw.includes('recA'));
  ok('control: the live body throws without a marker', !/FLOW_NO_IMAGE/.test(decode('original', [SILENT_REFUSAL]).threw));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
