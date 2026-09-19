// `watermark_open_once` crosses a webhook body, a Code node and a jsonb column
// before it reaches a render — and it has no loud failure anywhere on that
// path. The brief would post the choice, n8n would drop it, and the film would
// come back announcing every source in full: exactly what the producer asked
// it not to do, and indistinguishable from "the feature does not work".
//
// So this runs the orchestrator's REAL node body — the file that was pasted
// into n8n, not a paraphrase of it — against fixtures, with no n8n and no
// network, and then checks the site's read side agrees with it.
//
//   node db/port/watermark-open-once/check.mjs
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
    fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    console.log(`FAIL ${label} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
};

// ---- run the node body ----------------------------------------------------
// An n8n Code node is a function body with `$json` in scope that returns an
// array of items. Wrapping it in `new Function` is what makes this a test of
// the SHIPPED text rather than of a second implementation of it.
const body = readFileSync(join(here, 'paste', 'orch-Normalize_Webhook_Input.js'), 'utf8');
const run = (webhookBody) => {
  const fn = new Function('$json', body);
  const out = fn({ body: webhookBody });
  return JSON.parse(out[0].json.editingOptions);
};

const BRIEF = { name: 'A film', category: 'story', length: 60 };
const opts = (extra) => run({ ...BRIEF, ...extra });

is('yes stores the switch on', opts({ watermark_open_once: 'yes' }).watermarkOpenOnce, true);
is('no stores it off', opts({ watermark_open_once: 'no' }).watermarkOpenOnce, false);
// The one that matters: every film made before this existed, and every brief
// that does not mention it, must keep announcing every source.
is('absent is off', opts({}).watermarkOpenOnce, false);
// A hand-typed string is not a yes. Same strictness as `endFrame` next door,
// and for the same reason: there is no UI that can produce these, so anything
// but the exact value is a mistake and must fail towards the loud default.
is('a truthy string is not a yes', opts({ watermark_open_once: 'true' }).watermarkOpenOnce, false);
is('nor is 1', opts({ watermark_open_once: 1 }).watermarkOpenOnce, false);
is('a real boolean is', opts({ watermark_open_once: true }).watermarkOpenOnce, true);

// The key travels in the SAME blob as everything else the brief chose, so a
// mistake in the block above would be visible as a neighbour going missing.
const full = opts({ watermark_open_once: 'yes', music: 'yes', drawn_cards: 'no' });
is('its neighbours are untouched', [full.music, full.drawnCards, full.chapterCards], [true, false, true]);

// ---- the site posts the name this node reads ------------------------------
// Two spellings, in two languages, either side of an HTTP boundary. A drift
// is silent, which is the whole reason this file exists.
const form = readFileSync(join(root, 'platform/app/new/NewVideoForm.tsx'), 'utf8');
const actions = readFileSync(join(root, 'platform/app/actions.ts'), 'utf8');
is('the brief posts the field', /name="watermark_open_once"/.test(form), true);
is('and createProject forwards it to the webhook', /watermark_open_once:/.test(actions), true);
// The values have to be the node's vocabulary, not a boolean or a label.
is('as the yes|no the node reads', /watermark_open_once"\s+value=\{[^}]*"yes"\s*:\s*"no"\}/.test(form), true);

// ---- and the read side agrees ---------------------------------------------
const derive = readFileSync(join(root, 'platform/lib/data/derive.ts'), 'utf8');
is(
  'derive.ts still refuses anything but a real true',
  /watermarkOpenOnce:\s*opts\.watermarkOpenOnce === true/.test(derive),
  true,
);

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) {
  for (const f of fails) console.log(`  ${f}`);
  process.exit(1);
}
