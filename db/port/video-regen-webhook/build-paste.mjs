// Builds paste/ from original/ — every edit is a single, named replacement
// made here, so the diff is exactly what this file says. Re-running is
// idempotent (it always starts from original/).
//
//   node db/port/video-regen-webhook/build-paste.mjs
//
// WHAT THIS CHANGE IS. Video regeneration was the only regeneration with no
// webhook of its own: scene text, image and voice each have one on Claude
// Scripting and start in seconds, while a clip could only be re-shot by a
// live Media Generation batch noticing `Regenerează Video` from inside its
// video gate — after that batch had walked the whole film. That is what made
// it slow to start, invisible while it waited, and destroyed by anything
// that stopped the batch (db/port/regen-unstick/README.md).
//
// The webhook needs to reach the `RG *` tail, and CLAUDE.md's restart-scripting
// precedent says a new entry point needs its OWN tail, because the shared one
// reaches back to nodes that only the first entry point executes. That is true
// of this tail today — `Prep Video Regen`, `RG End Frame Prompt`, `RG Motion
// Prep` and `Submit Video Regen` between them reach back to `Receive Batch
// Input`, `IMG Load Project` and `Fetch Scene Videos`.
//
// Copying thirty nodes is not the only way to satisfy that rule, and here it is
// the worse one: the tail carries the world-consistency guardrail and the
// motion judge's question, each of which already lives in more copies than
// anyone can hold (CLAUDE.md, "A prompt fragment always lives in more copies
// than the one you found"). So instead the tail is made SELF-CONTAINED, which
// is the same rule applied to its cause rather than its symptom:
//
//   * `Prep Video Regen` becomes the single node that asks the outside world
//     anything, and it asks whichever entry point actually ran.
//   * The other three read that context off `Prep Video Regen`, which is
//     inside the tail and therefore always executed.
//
// After this, the tail has exactly ONE node with an outside reference, and it
// is guarded on both sides. Any third entry point needs to feed that one node.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const orig = (f) => fs.readFileSync(path.join(dir, 'original', f), 'utf8');
const out = (f, s) => fs.writeFileSync(path.join(dir, 'paste', f), s);

function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected exactly one occurrence of ${JSON.stringify(from.slice(0, 80))}, found ${n}`);
  return src.replace(from, to);
}

// The node the whole dual-path design keys off. Named once here and spliced
// into every body that asks "which door did this run come through", so a
// rename cannot half-apply.
const WEBHOOK = 'Video Regen Webhook';

// The discriminator, verbatim in every body that needs it. `isExecuted` is the
// idiom this workflow already uses sixteen times (`Save User Ref Id`,
// `Save Cast Refs`, `Save Set Plates`); the try/catch is belt-and-braces for
// the one case it does not cover, a workflow version where the node is gone.
const VIA = `const viaWebhook = (() => { try { return $('${WEBHOOK}').isExecuted; } catch (e) { return false; } })();`;

// ---------------------------------------------------------------------------
// 1. Prep Video Regen — the tail's single door, and now its only outside ask.
// ---------------------------------------------------------------------------
{
  let s = orig('mg-Prep_Video_Regen.js');

  s = replaceOnce(s,
    `let opts = {};\ntry { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }`,
    `// TWO ENTRY POINTS (2026-09-17), and this node is the only one that can
// tell them apart. Everything below it reads its context off THIS node's
// output, which is why the rest of the tail has no outside reference left
// and can be reached from a webhook at all.
${VIA}

// The project row. On the batch path it is the one \`IMG Load Project\` fetched
// at the top of the run; on the webhook path \`VRW Build Regen\` carries the
// same row, read from hov.at_project in the same query as the scene. Both are
// the Airtable-shaped \`fields\` object, so everything after this is identical.
let projF = {};
try {
  projF = viaWebhook ? ($json.projectFields || {}) : ($('IMG Load Project').first().json.fields || {});
} catch (e) { projF = {}; }
let opts = {};
try { opts = JSON.parse(projF['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }

// 16:9 or 9:16, for \`RG End Frame Prompt\` and \`Submit Video Regen\`. The batch
// is told by the orchestrator's workflow input; a webhook run has no
// orchestrator, so it reads the project's own \`Format\` — which is the very
// field the orchestrator itself reads on Resume and Restart
// (\`Fetch Project For Resume\`: fields['Format'] || '16:9').
let aspectRatio = '16:9';
try {
  aspectRatio = viaWebhook
    ? String($json.aspectRatio || projF['Format'] || '16:9')
    : String($('Receive Batch Input').first().json.Aspect_Ratio || '16:9');
} catch (e) { aspectRatio = '16:9'; }
if (aspectRatio !== '9:16') aspectRatio = '16:9';`,
    'Prep Video Regen: project context');

  s = replaceOnce(s,
    `  const row = $('Fetch Scene Videos').all().find((x) => x.json && x.json.id === r.id);\n  const v = row ? ((row.json.fields || {})['Versiuni Media']) : null;`,
    `  // Same row, fetched by whichever entry point ran: the gate's
  // \`Fetch Scene Videos\`, or \`VRW Load Scene\` one node upstream.
  const fields = viaWebhook
    ? ($json.sceneFields || {})
    : (($('Fetch Scene Videos').all().find((x) => x.json && x.json.id === r.id) || { json: {} }).json.fields || {});
  const v = fields['Versiuni Media'];`,
    'Prep Video Regen: takes');

  s = replaceOnce(s,
    `return [{ json: Object.assign({}, r, { model: model, seed: seed, takes: takes }) }];`,
    `// \`opts\`, \`aspectRatio\` and \`viaWebhook\` ride along so that NOTHING after
// this node has to ask the outside world. \`RG End Frame Prompt\` and
// \`RG Motion Prep\` used to parse Editing Options out of \`IMG Load Project\`
// themselves and \`Submit Video Regen\` used to read the aspect off
// \`Receive Batch Input\`; all three now read them here.
return [{ json: Object.assign({}, r, { model: model, seed: seed, takes: takes, opts: opts, aspectRatio: aspectRatio, viaWebhook: viaWebhook }) }];`,
    'Prep Video Regen: carry the context');

  out('mg-Prep_Video_Regen.js', s);
}

// ---------------------------------------------------------------------------
// 2. RG End Frame Prompt — read the context off Prep Video Regen ($json).
// ---------------------------------------------------------------------------
{
  let s = orig('mg-RG_End_Frame_Prompt.js');
  s = replaceOnce(s,
    `const rb = $('Receive Batch Input').first().json;`,
    `// 2026-09-17: was \`$('Receive Batch Input').first().json\`, which is the
// orchestrator's workflow-input trigger and does not execute on a webhook
// run. \`Prep Video Regen\` one node upstream resolves the aspect from
// whichever entry point ran, so this reads it from there instead.
// \`Flow_Email\` was never a declared input of that trigger — it always read
// undefined and always fell through to the literal below.
const rb = { Aspect_Ratio: p.aspectRatio || '16:9' };`,
    'RG End Frame Prompt: aspect');
  s = replaceOnce(s,
    `let opts = {};\ntry { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }`,
    `// 2026-09-17: parsed here from \`IMG Load Project\` until the webhook path
// existed. Same object, parsed once in \`Prep Video Regen\` and carried.
const opts = p.opts || {};`,
    'RG End Frame Prompt: opts');
  out('mg-RG_End_Frame_Prompt.js', s);
}

// ---------------------------------------------------------------------------
// 3. RG Motion Prep — same, via $('Prep Video Regen') (it already holds `p`).
// ---------------------------------------------------------------------------
{
  let s = orig('mg-RG_Motion_Prep.js');
  s = replaceOnce(s,
    `let opts = {};\ntry { opts = JSON.parse((($('IMG Load Project').first().json.fields || {})['Editing Options']) || '{}') || {}; } catch (e) { opts = {}; }`,
    `// 2026-09-17: was parsed here from \`IMG Load Project\`, which only the batch
// path executes. \`p\` is \`Prep Video Regen\`, which is inside this tail and
// parsed the same object for both entry points.
const opts = p.opts || {};`,
    'RG Motion Prep: opts');
  out('mg-RG_Motion_Prep.js', s);
}

// ---------------------------------------------------------------------------
// 4. Submit Video Regen — the one expression, not a Code body.
// ---------------------------------------------------------------------------
{
  let s = orig('mg-Submit_Video_Regen.txt');
  s = replaceOnce(s,
    `$('Receive Batch Input').first().json.Aspect_Ratio === '9:16'`,
    `$('Prep Video Regen').first().json.aspectRatio === '9:16'`,
    'Submit Video Regen: aspect');
  out('mg-Submit_Video_Regen.txt', s);
}

// ---------------------------------------------------------------------------
// 5. VRW Build Regen — NEW, and the one place duplication was unavoidable.
//
// `Evaluate Video Approval` composes the regeneration brief: it strips the
// legacy "Negative: …" tail off the stored motion prompt, suppresses a machine
// note sitting in the producer's feedback slot, and appends the producer's own
// correction as an ADJUSTMENT REQUEST. That composition is ninety lines of
// hard-won comments (see db/port/veo-direction/) and the webhook path has to
// produce the byte-identical string or the two doors would shoot different
// films from the same click.
//
// So it is not retyped: it is EXTRACTED from the live body, at build time, by
// the marker lines below. Change `Evaluate Video Approval`, re-run this
// builder, and the copy follows. `check.mjs` then runs BOTH bodies against the
// same recorded rows and fails if their output differs by a byte.
// ---------------------------------------------------------------------------
{
  const eva = orig('mg-Evaluate_Video_Approval.js');
  const lines = eva.split('\n');
  const from = lines.findIndex((l) => l.includes('`Observații Scenă` IS NOT A PRODUCER-ONLY FIELD'));
  const to = lines.findIndex((l) => l.trim().startsWith('regen = { id: r.json.id, motionPrompt,'));
  if (from < 0 || to < 0 || to <= from) {
    throw new Error('VRW Build Regen: could not locate the composition block in Evaluate Video Approval — the markers moved. Re-read that node and fix the markers here rather than retyping the block.');
  }
  // Lines [from, to) are the block; `to` is the assignment, which differs
  // between the two nodes (one picks a scene out of a list, one was handed
  // one) and is written by each caller.
  const block = lines.slice(from, to).map((l) => (l.startsWith('    ') ? l.slice(4) : l)).join('\n');
  if (!/const storedPrompt = /.test(block) || !/ADJUSTMENT REQUEST/.test(block)) {
    throw new Error('VRW Build Regen: the extracted block is not the composition — refusing to write a body that would silently compose nothing.');
  }

  out('mg-VRW_Build_Regen.js', `// Turn one webhook POST into the payload the \`RG *\` tail already eats.
//
// The site fires { scene_id } and this decides whether that scene can be
// re-shot at all, then hands \`Prep Video Regen\` exactly what
// \`Evaluate Video Approval\` hands it on the batch path — the same
// { id, motionPrompt, imageId, voiceUrl } — plus the project and scene rows
// the batch path gets from \`IMG Load Project\` and \`Fetch Scene Videos\`.
//
// WHY IT REFUSES RATHER THAN THROWS. \`Prep Video Regen\` throws on a scene with
// no Flow asset id or no motion prompt, and it carries no onError, so on the
// batch path that throw kills the whole execution. On this path a throw would
// be worse in a quieter way: the webhook run would die with \`Regenerează
// Video\` still true and nobody left to clear it, which is the stranded-flag
// dead end CLAUDE.md warns about once per in-flight flag. So every reason to
// stop is decided HERE, before the tail, and each one either clears the flag
// with an explanation or leaves a flag that was already gone alone.
// The POST, read from the webhook node by name rather than from $json:
// $json here is VRW Load Scene's row, and a body that arrived through a
// column alias would be a coupling nobody would expect to matter until the
// day someone renamed a column.
const hook = $('${WEBHOOK}').first().json;
const post = hook.body || hook;
const sceneId = String(post.scene_id || post.sceneId || '').trim();
const row = $input.all()[0] ? $input.all()[0].json : null;

const refuse = (reason, write) => [{ json: { ok: false, write: !!write, sceneId, reason } }];

if (!sceneId) throw new Error('VRW: no scene_id in the webhook body — nothing to regenerate.');
// A scene id that matches no row is the one case worth throwing on: there is
// no flag to clear and no row to write a reason onto, so failing loudly is
// the only way it is ever noticed.
if (!row || !row.scene) throw new Error('VRW: scene ' + sceneId + ' not found.');

const f = row.scene || {};
const projF = row.project || {};
const projectId = String(row.project_id || '');

// The flag is the request. If it is already false, either the producer
// cancelled it or a batch got there first — either way there is nothing to do
// and nothing to write. Ending quietly here is what makes the webhook safe to
// fire twice, which the site does whenever an approved image queues a clip
// and the producer also presses Regenerate.
if (f['Regenerează Video'] !== true) return refuse('the scene is not asking for a new clip (Regenerează Video is already false)', false);

// These two ARE the reasons \`Prep Video Regen\` throws. Catching them here
// turns "the film dies" into "the scene comes back with a sentence".
if (!f['Image Media ID']) return refuse('this scene has no Flow image id, so there is no still for Veo to animate — regenerate and approve its image first', true);
if (!String(f['Video Scenă URL'] || '').trim()) return refuse('this scene has no shot direction (Video Scenă URL), so there is nothing to shoot — write one in the Video step', true);

${block.split('\n').map((l) => l).join('\n')}

const regen = { id: sceneId, motionPrompt, imageId: f['Image Media ID'] || '', voiceUrl: f['Voiceover URL'] || '' };

console.log('VRW ' + sceneId + ': regenerating, ' + motionPrompt.length + ' chars of brief' + (feedback ? ', with the producer\\'s correction' : ''));

return [{
  json: {
    ok: true,
    sceneId,
    projectId,
    regen,
    // What \`Prep Video Regen\` reads instead of IMG Load Project / Fetch Scene
    // Videos / Receive Batch Input when it sees this entry point.
    sceneFields: f,
    projectFields: projF,
    aspectRatio: String(projF['Format'] || '16:9') === '9:16' ? '9:16' : '16:9',
  },
}];
`);
}

console.log('paste/ rebuilt from original/');
