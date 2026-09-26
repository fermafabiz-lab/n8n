#!/usr/bin/env node
// check.mjs — the Kids story caption packs reach the render (2026-09-26).
//
//     node db/port/kids-captions/check.mjs
//
// The two live nodes change in one place each: the motion-pack whitelist
// gains kidsPill, kidsBounce and kidsSticker. Everything else is the body in
// original/ (= db/port/kids-cine-graphics/paste/), byte for byte.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  ok   ' + label);
  else { failures++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
};
const read = (p) => readFileSync(join(here, p), 'utf8');

for (const f of ['fa-Caption_Colour.js', 'orch-Normalize_Webhook_Input.js']) {
  const a = read('original/' + f).split('\n'), b = read('paste/' + f).split('\n');
  const diff = b.filter((l, i) => l !== a[i]);
  ok(`${f}: one line changed, the whitelist`, a.length === b.length && diff.length === 1 && diff[0].includes("'kidsSticker'"), diff.join('\n'));
}

const cc = (file, opts) => new Function('$json', '$', read(file))(
  { body: { scenes: [] } },
  (n) => ({ first: () => ({ json: { fields: { 'Editing Options': JSON.stringify(opts) } } }), all: () => [] }),
)[0].json.body;
ok('Caption Colour passes kidsSticker', cc('paste/fa-Caption_Colour.js', { motionPack: 'kidsSticker' }).motionPack === 'kidsSticker');
ok('Caption Colour still refuses an unknown pack', !('motionPack' in cc('paste/fa-Caption_Colour.js', { motionPack: 'flashy' })));

const norm = (file, body) => JSON.parse(new Function('$json', read(file))({ body })[0].json.editingOptions);
ok('Normalize stores kidsBounce', norm('paste/orch-Normalize_Webhook_Input.js', { motion_pack: 'kidsBounce' }).motionPack === 'kidsBounce');
for (const b of [{}, { motion_pack: 'punch' }, { motion_pack: 'flashy' }])
  ok(`Normalize unchanged for ${JSON.stringify(b)}`, JSON.stringify(norm('paste/orch-Normalize_Webhook_Input.js', b)) === JSON.stringify(norm('original/orch-Normalize_Webhook_Input.js', b)));

console.log(failures ? `\n${failures} FAILED` : '\nall kids-captions checks passed');
process.exit(failures ? 1 : 0);
