// Runs the real node bodies — paste/ against original/ as the control — on
// rows read out of Postgres, and pins the three things this change could
// silently get wrong.
//
//   node db/port/video-regen-webhook/check.mjs
//
// 1. THE TWO DOORS SHOOT THE SAME FILM. `Evaluate Video Approval` (batch) and
//    `VRW Build Regen` (webhook) must compose the byte-identical
//    { id, motionPrompt, imageId, voiceUrl }. The webhook's copy of that
//    composition is EXTRACTED from the gate's body by build-paste.mjs, and
//    this is what proves the extraction landed: same stripped action, same
//    ADJUSTMENT REQUEST, same machine-note suppression.
//
// 2. THE BATCH PATH DID NOT MOVE. Every edited node is run the way the batch
//    runs it and compared against the ORIGINAL body on the same input. The
//    only permitted difference is the three keys `Prep Video Regen` now
//    carries for its downstream readers.
//
// 3. THE TAIL IS SELF-CONTAINED. After `Prep Video Regen`, no node in the
//    tail may call $('Receive Batch Input'), $('IMG Load Project') or
//    $('Fetch Scene Videos') — those are the references that made the tail
//    unshareable, and a new one reintroduces the whole class.
import fs from 'node:fs';
import path from 'node:path';
import * as F from './fixtures.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname);
const body = (which, f) => fs.readFileSync(path.join(dir, which, f), 'utf8');

let failed = 0, passed = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};
const ok = (label, cond) => is(label, !!cond, true);

/**
 * Run a Code-node body the way n8n does.
 *
 * `nodes` is the ONLY thing that decides `isExecuted`: a name that is not a
 * key did not execute on this path, and `.first()` on it throws exactly the
 * way n8n's does. That is the whole point — a guard that works only because
 * every stub answers `true` would prove nothing.
 */
function run(src, { nodes = {}, json = {}, items = [] } = {}) {
  const $ = (name) => {
    const present = Object.prototype.hasOwnProperty.call(nodes, name);
    const list = present ? (Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]]) : [];
    const need = () => {
      if (!present) throw new Error(`Referenced node is unexecuted: '${name}'`);
      return list;
    };
    return {
      get isExecuted() { return present; },
      first: () => ({ json: need()[0] }),
      all: () => need().map((j) => ({ json: j })),
      get item() { return { json: need()[0] }; },
    };
  };
  const $input = { all: () => items, first: () => items[0] };
  const sd = {};
  const logs = [];
  const fn = new Function('$', '$json', '$input', '$getWorkflowStaticData', 'console', src);
  try {
    return { out: fn($, json, $input, () => sd, { log: (...a) => logs.push(a.join(' ')) }), logs, threw: null };
  } catch (e) {
    return { out: null, logs, threw: e.message };
  }
}

// ---------------------------------------------------------------------------
console.log('1. The two doors compose the same brief');
// ---------------------------------------------------------------------------
{
  /** The gate, as the batch runs it: a list of scene rows plus Sort & Cap. */
  const gate = (fields) => run(body('original', 'mg-Evaluate_Video_Approval.js'), {
    nodes: { 'Sort & Cap Scenes': [{ id: F.SCENE_ID }] },
    items: [{ json: { id: F.SCENE_ID, fields } }],
  });
  /** The webhook, as n8n runs it: the POST body plus one joined row. */
  const hook = (fields, project = F.projectFields(), sceneId = F.SCENE_ID) => run(body('paste', 'mg-VRW_Build_Regen.js'), {
    json: { scene: fields, project, project_id: F.PROJECT_ID },
    nodes: { 'Video Regen Webhook': { body: { scene_id: sceneId } } },
    items: [{ json: { scene: fields, project, project_id: F.PROJECT_ID } }],
  });

  const cases = [
    ['a clean scene', F.sceneFields()],
    ['with the producer\'s correction', F.sceneFields({ 'Observații Scenă': 'she should keep holding the stack' })],
    ['with a machine note in the feedback slot', F.sceneFields({ 'Observații Scenă': 'AUTO-REWRITE-VIDEO (attempt 2): the video filter refused this scene' })],
    ['with a REJECTED note', F.sceneFields({ 'Observații Scenă': 'REJECTED by the video filter — rewrite the image prompt' })],
    ['a producer who typed "Negative:"', F.sceneFields({ 'Observații Scenă': 'Negative: no birds this time' })],
    ['a prompt that is nothing but a tail', F.sceneFields({ 'Video Scenă URL': 'Negative: on-screen text, subtitles.' })],
    ['no voiceover yet', F.sceneFields({ 'Voiceover URL': '' })],
  ];
  for (const [label, fields] of cases) {
    const g = gate(fields).out[0].json.regen;
    const h = hook(fields).out[0].json.regen;
    is(`${label}: identical payload`, h, g);
  }

  // And the composition really is doing its job, not agreeing on nothing.
  const plain = gate(F.sceneFields()).out[0].json.regen;
  is('the legacy Negative: tail is stripped', plain.motionPrompt, F.MOTION_ACTION);
  const noted = hook(F.sceneFields({ 'Observații Scenă': 'she should keep holding the stack' })).out[0].json.regen;
  is('the correction is appended, after the strip', noted.motionPrompt,
    F.MOTION_ACTION + ' ADJUSTMENT REQUEST — the new video MUST follow this: she should keep holding the stack.');
  ok('a machine note is not handed to Veo', !/ADJUSTMENT REQUEST/.test(hook(F.sceneFields({ 'Observații Scenă': 'AUTO-REWRITE-VIDEO (attempt 2): x' })).out[0].json.regen.motionPrompt));
  is('the image id rides along', noted.imageId, F.IMAGE_ID);
  is('the voice url rides along', noted.voiceUrl, F.VOICE_URL);

  // The webhook's own refusals — the reason it exists rather than letting
  // Prep Video Regen throw into a stranded flag.
  const refusal = (fields) => hook(fields).out[0].json;
  is('flag already cleared: stop, write nothing', (({ ok: o, write }) => ({ ok: o, write }))(refusal(F.sceneFields({ 'Regenerează Video': false }))), { ok: false, write: false });
  is('no Flow image id: refuse AND clear the flag', (({ ok: o, write }) => ({ ok: o, write }))(refusal(F.sceneFields({ 'Image Media ID': '' }))), { ok: false, write: true });
  is('no shot direction: refuse AND clear the flag', (({ ok: o, write }) => ({ ok: o, write }))(refusal(F.sceneFields({ 'Video Scenă URL': '   ' }))), { ok: false, write: true });
  ok('a missing scene_id throws (nothing to clear, must be loud)', /no scene_id/.test(run(body('paste', 'mg-VRW_Build_Regen.js'), {
    nodes: { 'Video Regen Webhook': { body: {} } }, items: [{ json: { scene: F.sceneFields() } }],
  }).threw || ''));
  // VRW Load Scene carries alwaysOutputData, so a scene id that matches no
  // row arrives as one empty item rather than as no run at all.
  ok('an unknown scene throws', /not found/.test(run(body('paste', 'mg-VRW_Build_Regen.js'), {
    nodes: { 'Video Regen Webhook': { body: { scene_id: 'recNope' } } }, items: [{ json: {} }],
  }).threw || ''));
  ok('a raw (unwrapped) POST body is accepted too', hook(F.sceneFields()).out[0].json.ok === true);

  // What Prep Video Regen needs from this node, and the aspect it derives.
  const built = hook(F.sceneFields()).out[0].json;
  is('carries the scene row', built.sceneFields['Image Media ID'], F.IMAGE_ID);
  is('carries the project row', built.projectFields['Format'], '16:9');
  is('aspect: landscape project', built.aspectRatio, '16:9');
  is('aspect: portrait project', hook(F.sceneFields(), F.projectFields({ Format: '9:16' })).out[0].json.aspectRatio, '9:16');
  is('aspect: a project with no Format at all', hook(F.sceneFields(), F.projectFields({ Format: undefined })).out[0].json.aspectRatio, '16:9');
}

// ---------------------------------------------------------------------------
console.log('2. Prep Video Regen: both doors, and the batch path unmoved');
// ---------------------------------------------------------------------------
const REGEN = { id: F.SCENE_ID, motionPrompt: F.MOTION_ACTION, imageId: F.IMAGE_ID, voiceUrl: F.VOICE_URL };
{
  const batch = (which, over = {}) => run(body(which, 'mg-Prep_Video_Regen.js'), {
    json: { regen: REGEN },
    nodes: {
      'Receive Batch Input': { Project_ID: F.PROJECT_ID, Aspect_Ratio: '16:9', ...over.rb },
      'IMG Load Project': { id: F.PROJECT_ID, fields: over.project || F.projectFields() },
      'Fetch Scene Videos': [{ id: F.SCENE_ID, fields: F.sceneFields() }],
    },
  });
  const hook = (over = {}) => run(body('paste', 'mg-Prep_Video_Regen.js'), {
    json: {
      regen: REGEN, sceneFields: F.sceneFields(), projectFields: over.project || F.projectFields(),
      aspectRatio: over.aspectRatio || '16:9',
    },
    nodes: { 'Video Regen Webhook': { body: { scene_id: F.SCENE_ID } } },
  });

  const live = batch('original').out[0].json;
  const now = batch('paste').out[0].json;
  const via = hook().out[0].json;

  ok('the control still runs', !!live);
  is('batch path: model unchanged', now.model, live.model);
  is('batch path: seed unchanged', now.seed, live.seed);
  is('batch path: takes unchanged', now.takes, live.takes);
  is('batch path: one filed take is counted', live.takes, 1);
  is('batch path: nothing else moved', (({ opts, aspectRatio, viaWebhook, ...rest }) => rest)(now), live);
  is('the only new keys are the three the tail now reads',
    Object.keys(now).filter((k) => !(k in live)).sort(), ['aspectRatio', 'opts', 'viaWebhook']);

  is('webhook path: same model', via.model, live.model);
  is('webhook path: same seed', via.seed, live.seed);
  is('webhook path: same takes', via.takes, live.takes);
  is('webhook path: same payload', (({ opts, aspectRatio, viaWebhook, ...rest }) => rest)(via), (({ opts, aspectRatio, viaWebhook, ...rest }) => rest)(now));
  is('the doors are distinguishable', [now.viaWebhook, via.viaWebhook], [false, true]);

  // The context both readers downstream now depend on.
  is('opts parsed on the batch path', now.opts.category, 'story');
  is('opts parsed on the webhook path', via.opts.category, 'story');
  is('aspect on the batch path', now.aspectRatio, '16:9');
  is('aspect on the webhook path', via.aspectRatio, '16:9');
  is('portrait survives the webhook', hook({ aspectRatio: '9:16' }).out[0].json.aspectRatio, '9:16');
  is('a nonsense aspect is clamped, never passed on', batch('paste', { rb: { Aspect_Ratio: 'square' } }).out[0].json.aspectRatio, '16:9');
  is('unparseable Editing Options degrades to {}', batch('paste', { project: F.projectFields({ 'Editing Options': '{not json' }) }).out[0].json.opts, {});

  // The rescue rule, which is what `takes` exists for: two refused free takes
  // promote the third to the paid model. It must fire the same on both doors.
  const threeTakes = JSON.stringify([1, 2].map((n) => ({ kind: 'video', id: 'v' + n })));
  const batch3 = run(body('paste', 'mg-Prep_Video_Regen.js'), {
    json: { regen: REGEN },
    nodes: {
      'Receive Batch Input': { Aspect_Ratio: '16:9' },
      'IMG Load Project': { fields: F.projectFields() },
      'Fetch Scene Videos': [{ id: F.SCENE_ID, fields: F.sceneFields({ 'Versiuni Media': threeTakes }) }],
    },
  }).out[0].json;
  const hook3 = run(body('paste', 'mg-Prep_Video_Regen.js'), {
    json: { regen: REGEN, sceneFields: F.sceneFields({ 'Versiuni Media': threeTakes }), projectFields: F.projectFields(), aspectRatio: '16:9' },
    nodes: { 'Video Regen Webhook': {} },
  }).out[0].json;
  is('two refused takes promote to the paid model (batch)', batch3.model, 'veo-3.1-quality');
  is('…and identically through the webhook', hook3.model, batch3.model);
  is('…with the same seed, so the re-roll is the same re-roll', hook3.seed, batch3.seed);

  // The throws that make VRW Build Regen's refusals necessary are still there.
  const noImage = run(body('paste', 'mg-Prep_Video_Regen.js'), {
    json: { regen: { ...REGEN, imageId: '' } }, nodes: { 'Video Regen Webhook': {} },
  });
  ok('still throws without an image id (the batch contract is unchanged)', /no Image Media ID/.test(noImage.threw || ''));
}

// ---------------------------------------------------------------------------
console.log('3. The three readers no longer ask the outside world');
// ---------------------------------------------------------------------------
{
  const P = {
    id: F.SCENE_ID, motionPrompt: F.MOTION_ACTION, imageId: F.IMAGE_ID, voiceUrl: F.VOICE_URL,
    model: 'veo-3.1-lite-low-priority', seed: 12345, takes: 1,
    opts: JSON.parse(F.EDITING_OPTIONS), aspectRatio: '16:9', viaWebhook: true,
  };

  // RG End Frame Prompt: batch (original, with the two nodes) vs webhook
  // (paste, with NEITHER node stubbed — an unguarded reference would throw).
  const efLive = run(body('original', 'mg-RG_End_Frame_Prompt.js'), {
    json: P,
    nodes: { 'Receive Batch Input': { Aspect_Ratio: '16:9' }, 'IMG Load Project': { fields: F.projectFields() } },
  });
  const efNew = run(body('paste', 'mg-RG_End_Frame_Prompt.js'), { json: P, nodes: {} });
  ok('RG End Frame Prompt: the control runs', !efLive.threw);
  ok('RG End Frame Prompt: runs with no outside nodes at all', !efNew.threw);
  is('RG End Frame Prompt: identical output', efNew.out[0].json, efLive.out[0].json);
  // With end frames OFF this node only echoes its input, so the interesting
  // comparison is the REQUEST it builds — which is where the aspect and the
  // opt-in actually land. Turn the opt-in on and compare that.
  const ON = JSON.stringify({ ...JSON.parse(F.EDITING_OPTIONS), endFrame: true });
  const onOpts = F.projectFields({ 'Editing Options': ON });
  const efReq = (which, nodes, json) => run(body(which, 'mg-RG_End_Frame_Prompt.js'), { json, nodes }).out[0].json.efRequest;
  const liveReq = (aspect) => efReq('original', { 'Receive Batch Input': { Aspect_Ratio: aspect }, 'IMG Load Project': { fields: onOpts } }, P);
  const newReq = (aspect) => efReq('paste', {}, { ...P, aspectRatio: aspect, opts: JSON.parse(ON) });
  ok('RG End Frame Prompt: endFrame opt-in still builds a request', !!liveReq('16:9'));
  is('RG End Frame Prompt: the request is identical, landscape', newReq('16:9'), liveReq('16:9'));
  is('RG End Frame Prompt: the request is identical, portrait', newReq('9:16'), liveReq('9:16'));
  is('RG End Frame Prompt: and portrait really reached the request', newReq('9:16').aspectRatio, '9:16');
  is('RG End Frame Prompt: endFrame off means no request at all',
    run(body('paste', 'mg-RG_End_Frame_Prompt.js'), { json: P, nodes: {} }).out[0].json.efOk, false);

  // RG Motion Prep: same shape, with $('Prep Video Regen') as its input.
  const EV = { Video_Signed_URL: 'https://flow-content.google/video/abc?sig=x', Video_Media_Id: 'abc-video:uuid' };
  const mpLive = run(body('original', 'mg-RG_Motion_Prep.js'), {
    json: EV, nodes: { 'Prep Video Regen': P, 'IMG Load Project': { fields: F.projectFields() } },
  });
  const mpNew = run(body('paste', 'mg-RG_Motion_Prep.js'), { json: EV, nodes: { 'Prep Video Regen': P } });
  ok('RG Motion Prep: the control runs', !mpLive.threw);
  ok('RG Motion Prep: runs without IMG Load Project', !mpNew.threw);
  is('RG Motion Prep: identical output', mpNew.out[0].json, mpLive.out[0].json);
  ok('RG Motion Prep: it really did build a question', mpNew.out[0].json.ok === true && mpNew.out[0].json.ask.includes('permanence'));
  // The one escape hatch a film can use at 2 a.m. must still work through opts.
  const offOpts = { ...JSON.parse(F.EDITING_OPTIONS), motionJudge: false };
  const mpOff = run(body('paste', 'mg-RG_Motion_Prep.js'), { json: EV, nodes: { 'Prep Video Regen': { ...P, opts: offOpts } } });
  is('RG Motion Prep: motionJudge:false still turns it off', mpOff.out[0].json.reason, 'motionJudge: false');
}

// ---------------------------------------------------------------------------
console.log('4. Submit Video Regen, and the tail has no outside references left');
// ---------------------------------------------------------------------------
{
  const live = body('original', 'mg-Submit_Video_Regen.txt');
  const now = body('paste', 'mg-Submit_Video_Regen.txt');
  is('exactly one thing changed', live.replace("$('Receive Batch Input').first().json.Aspect_Ratio", "$('Prep Video Regen').first().json.aspectRatio"), now);
  ok('it reads the aspect off Prep Video Regen', now.includes("$('Prep Video Regen').first().json.aspectRatio === '9:16'"));
  ok('and no longer off the orchestrator trigger', !now.includes('Receive Batch Input'));
  // The guardrail prompt is the thing a careless edit here would maul.
  for (const phrase of [
    'One continuous take, filmed in a single unbroken shot.',
    'Whatever the subject is holding stays in their hands until the end of the shot',
    'indoors the air is still',
    'Negative: speech, voices, dialogue',
  ]) ok(`guardrail intact: "${phrase.slice(0, 44)}…"`, now.includes(phrase));

  // THE RULE THIS WHOLE CHANGE EXISTS TO RESTORE. Every node from
  // RG End Frame Prompt onward must be reachable from either door, which
  // means none of them may name a node only one door executes.
  const OUTSIDE = ['Receive Batch Input', 'IMG Load Project', 'Fetch Scene Videos'];
  const downstream = [
    'mg-RG_End_Frame_Prompt.js', 'mg-RG_Motion_Prep.js', 'mg-Submit_Video_Regen.txt',
  ];
  // A mention in a comment is history — several of these bodies explain what
  // they USED to read and from where, and that is worth keeping. A call is
  // the bug. So strip comments first and scan what is left.
  const code = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  ok('the comment stripper is not eating code', code("const a = 1; // $('IMG Load Project')").includes('const a = 1;') && !code("x // $('IMG Load Project')").includes('IMG Load'));
  for (const f of downstream) {
    const src = code(body('paste', f));
    for (const name of OUTSIDE) {
      ok(`${f}: never calls $('${name}')`, !src.includes(`$('${name}')`));
    }
    // …and the history really is still written down where it was removed.
    ok(`${f}: still runs`, body('paste', f).length > 100);
  }
  // Prep Video Regen is allowed to — it is the one door-aware node — but only
  // behind the guard.
  const prep = body('paste', 'mg-Prep_Video_Regen.js');
  ok('Prep Video Regen owns the discriminator', prep.includes("$('Video Regen Webhook').isExecuted"));
  // Every remaining call to a one-door node sits on the batch side of a
  // `viaWebhook ?` ternary, so the webhook path never evaluates it. The
  // behavioural proof is above (it ran with none of them stubbed); this is
  // the textual one, so a future edit that drops the ternary is caught here
  // even if nobody re-runs the behavioural case.
  // Every remaining call to a one-door node must sit on the BATCH arm of a
  // `viaWebhook ? … : …` ternary, so the webhook path never evaluates it.
  // The behavioural proof is section 3 (the readers ran with none of those
  // nodes stubbed); this is the textual one, so an edit that drops a ternary
  // is caught here even if nobody re-reads the behavioural case. The ternary
  // is sometimes written across three lines, hence the small window.
  const prepLines = code(prep).split('\n');
  for (const name of OUTSIDE) {
    const call = `$('${name}')`;
    const hits = prepLines.map((l, i) => [l, i]).filter(([l]) => l.includes(call));
    ok(`Prep Video Regen: ${call} is called exactly once`, hits.length === 1);
    for (const [line, i] of hits) {
      const window = prepLines.slice(Math.max(0, i - 2), i + 1).join('\n');
      const tern = window.indexOf('viaWebhook');
      const at = window.indexOf(call);
      const between = tern >= 0 && at > tern ? window.slice(tern, at) : '';
      ok(`Prep Video Regen: ${call} sits on the batch arm of a viaWebhook ternary`,
        /\?/.test(between) && /:/.test(between.slice(between.indexOf('?'))));
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
