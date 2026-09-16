// Who made which film — the read path, and the rule that the four names are
// the SAME four in both places that know them.
//
//   npm run check:created-by
//
// The name is written by the orchestrator's `Normalize Webhook Input` and read
// by derive.ts, so the whitelist exists twice, in two languages. Nothing else
// in the pipeline reads it, which means a drift between those two copies has
// no loud failure at all: the brief would post a name, n8n would drop it, and
// the project would simply come back unnamed. This is what makes that loud.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREATORS, normalizeCreatedBy, buildProject } from '@/lib/data/derive';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0;
const fails = [];
const is = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---- the two copies of the list agree -------------------------------------
// Read out of the node body the repo keeps beside the applied version, so the
// test breaks when somebody adds a fifth person to one side only.
const node = readFileSync(
  join(root, 'db/port/created-by/code/orch-Normalize_Webhook_Input.js'),
  'utf8',
);
const clause = /\[((?:'[A-Za-z]+',?)+)\]\.includes\(String\(b\.created_by/.exec(node);
is('the orchestrator still whitelists created_by', !!clause, true);
if (clause) {
  is(
    'n8n and derive.ts hold the same four names',
    clause[1].split(',').map((s) => s.trim().replace(/'/g, '')),
    [...CREATORS],
  );
}

// ---- the normalizer --------------------------------------------------------
is('four names', [...CREATORS], ['Alex', 'Dan', 'David', 'Iustin']);
for (const who of CREATORS) is(`keeps ${who}`, normalizeCreatedBy(who), who);
is('trims what the form posts', normalizeCreatedBy('  Dan  '), 'Dan');
// Case is NOT repaired: the site posts the exact name, and a near-miss is far
// likelier to be a hand-edited row than a typo worth guessing at.
for (const bad of ['', ' ', 'alex', 'ALEX', 'Bob', '<b>x</b>', null, undefined, 0, {}, ['Alex']])
  is(`refuses ${JSON.stringify(bad)}`, normalizeCreatedBy(bad), null);

// ---- the whole read path, as a row arrives from either backend -------------
const raw = (editing) => ({
  id: 'recTEST', name: 'x', tone: 'Dark', aspectRaw: '16:9', noCaptions: false,
  lengthSeconds: 60, statusRaw: 'În Lucru', finalVideoUrl: null,
  editingRaw: JSON.stringify(editing), language: 'English', voiceId: '',
  createdAt: null, paceRaw: 'Normal',
});
is('read back', buildProject(raw({ createdBy: 'David' })).createdBy, 'David');
is('absent reads as nobody', buildProject(raw({})).createdBy, null);
is('a name nobody has reads as nobody', buildProject(raw({ createdBy: 'Mallory' })).createdBy, null);
is('no options at all', buildProject({ ...raw({}), editingRaw: '' }).createdBy, null);
// It must not disturb what sits beside it in the same jsonb.
const both = buildProject(raw({ createdBy: 'Alex', category: 'documentary', autoApprove: true }));
is('category survives', both.category, 'documentary');
is('autoApprove survives', both.editing.autoApprove, true);

for (const f of fails) console.log('FAIL', f);
console.log(fails.length ? `${fails.length} FAILED, ${pass} passed` : `${pass}/${pass} passed`);
process.exit(fails.length ? 1 : 0);
