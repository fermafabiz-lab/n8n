// Hands-off by step crosses the same four boundaries every brief field does —
// a form, a webhook body, the orchestrator's `Normalize Webhook Input` and a
// jsonb column — before AutoPilot reads it, and a drift anywhere on that path
// is silent: the brief would post "Images and Video", n8n would drop it, and
// the film would come back asking for every approval by hand, or approving
// everything. Indistinguishable from "the feature does not work".
//
// So this runs the orchestrator's REAL node body — the file pasted into n8n,
// and the one it replaced — against fixtures, with no n8n and no network:
//   - the new body stores the list, whitelisted, in pipeline order;
//   - for every brief that does not send the list, it answers BYTE FOR BYTE
//     what the old body answered (the change is purely additive);
//   - its whitelist is the site's AUTO_STEPS;
//   - the site posts the field this node reads, and reads it back.
//
//   node db/port/hands-off-steps/check.mjs          (prints the fixtures'
//   expected outputs with --print, for comparing a live test run)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

let pass = 0;
const fails = [];
const is = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
    console.log(`OK   ${label} -> ${JSON.stringify(got)}`);
  } else {
    fails.push(label);
    console.log(`FAIL ${label} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
};

const load = (f) => {
  const fn = new Function('$json', readFileSync(join(here, 'paste', f), 'utf8'));
  return (body) => fn({ body })[0].json;
};
const NEW = load('orch-Normalize_Webhook_Input.js');
const OLD = load('orch-Normalize_Webhook_Input.before.js');
const opts = (body) => JSON.parse(NEW(body).editingOptions);

// Every field the brief can send, so the byte-for-byte comparison covers
// every branch of the body, not just the default path.
export const RICH = {
  name: 'A film', category: 'documentary', length: 180, tone: 'Documentary', pace: 'Normal', language: 'English',
  voice_id: 'elevenlabs_abc', aspect: '9:16', captions: 'no', lore: 'some lore',
  category_options: { multi_voice: 'chapters' }, cast_voices: ['v1', 'v2'], speed: 0.9,
  sfx: 'no', sfx_level: 0.5, music: 'yes', music_level: 0.3, caption_color: '#ff8800',
  voice_tone: { stability: 0.4, similarity: 0.7, style: 0.2, speakerBoost: false },
  series: { id: 'recABCDEFGHIJKLMN', refs: { castRefs: { Ana: 'x' } } },
  hook_style: 'figure', chapter_cards: 'no', end_screen: 'no', auto_approve: 'yes', drawn_cards: 'no',
  watermark_open_once: 'yes', watermark_scale: 1.2, video_model: 'veo-3.1-fast', flow_accounts: 3, video_pool: 'yes',
  brief: 'the angle', must_haves: ['a', 'b'], style_refs: ['recABCDEFGHIJKLMN'], created_by: 'Dan',
};
export const MINIMAL = { name: 'A film', category: 'story', length: 60, created_by: 'Alex' };

// ---- purely additive ---------------------------------------------------------
for (const [label, body] of [
  ['a rich brief', RICH],
  ['a minimal brief', MINIMAL],
  ['a brief with hands-off off', { ...MINIMAL, auto_approve: 'no' }],
  ['a form-trigger shaped body', {}],
]) {
  is(`${label} without the list: byte-identical to the old body`, JSON.stringify(NEW(body)) === JSON.stringify(OLD(body)), true);
}

// ---- the list ---------------------------------------------------------------
is('the steps chosen are stored', opts({ ...MINIMAL, auto_approve: 'yes', auto_approve_steps: 'images,video' }).autoApproveSteps, ['images', 'video']);
is('…and the switch follows them', opts({ ...MINIMAL, auto_approve: 'yes', auto_approve_steps: 'images,video' }).autoApprove, true);
is('an empty list is stored as chosen-nothing', opts({ ...MINIMAL, auto_approve: 'no', auto_approve_steps: '' }).autoApproveSteps, []);
is('…and the switch is off even if it said yes', opts({ ...MINIMAL, auto_approve: 'yes', auto_approve_steps: '' }).autoApprove, false);
is('pipeline order, each once, unknown dropped', opts({ ...MINIMAL, auto_approve_steps: 'final,script,bogus,final, images ' }).autoApproveSteps, ['script', 'images', 'final']);
is('an array is read too', opts({ ...MINIMAL, auto_approve_steps: ['video', 'audio'] }).autoApproveSteps, ['audio', 'video']);
is('absent: no list at all (the site reads the old switch)', 'autoApproveSteps' in opts({ ...MINIMAL, auto_approve: 'yes' }), false);
is('…and the switch as before', opts({ ...MINIMAL, auto_approve: 'yes' }).autoApprove, true);
const withList = opts({ ...RICH, auto_approve_steps: 'scenes,final' });
const without = opts(RICH);
delete withList.autoApproveSteps;
is('adding the list changes nothing else in the blob', withList, without);

// ---- the node's whitelist is the site's --------------------------------------
const lib = readFileSync(join(root, 'platform/lib/hands-off.ts'), 'utf8');
const siteSteps = JSON.parse(lib.match(/export const AUTO_STEPS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const node = readFileSync(join(here, 'paste', 'orch-Normalize_Webhook_Input.js'), 'utf8');
const nodeSteps = JSON.parse(node.match(/const steps = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
is("the node's list equals the site's AUTO_STEPS, order included", nodeSteps, siteSteps);

// ---- the site posts what this node reads, and reads it back ------------------
const form = readFileSync(join(root, 'platform/app/new/NewVideoForm.tsx'), 'utf8');
const actions = readFileSync(join(root, 'platform/app/actions.ts'), 'utf8');
const derive = readFileSync(join(root, 'platform/lib/data/derive.ts'), 'utf8');
is('the brief posts the field', /name="auto_approve_steps"/.test(form), true);
is('createProject forwards it, whitelisted', /normalizeAutoSteps\(formData\.get\("auto_approve_steps"\)\)/.test(actions) && /auto_approve_steps: steps\.join\(","\)/.test(actions), true);
is('…and still sends the switch for an n8n that has not learned the list', /auto_approve: steps\.length > 0 \? "yes" : "no"/.test(actions), true);
is('derive.ts reads the list through autoStepsOf', /autoApproveSteps: autoStepsOf\(opts\)/.test(derive), true);
is('the tick approves only the chosen steps', ['auto.has("script")', 'auto.has("scenes")', 'auto.has("audio")', 'auto.has("images")', 'auto.has("video")', 'auto.has("final")'].every((k) => actions.includes(k)), true);

if (process.argv.includes('--print')) {
  console.log('\nEXPECTED minimal+steps:', NEW({ ...MINIMAL, auto_approve: 'yes', auto_approve_steps: 'images,video' }).editingOptions);
  console.log('EXPECTED rich (no list):', NEW(RICH).editingOptions);
}

console.log(`\n${pass}/${pass + fails.length} passed`);
process.exit(fails.length ? 1 : 0);
