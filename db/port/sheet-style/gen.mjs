// Builds paste/<Node>.after.js from paste/<Node>.before.js (the live body,
// read back through node-body.mjs) plus code/sheet_style.js. Every anchor
// must occur exactly once in the source, so a live body that has drifted
// fails loudly here instead of producing a half-edited node.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const fragment = readFileSync(join(here, 'code/sheet_style.js'), 'utf8').trimEnd();
const OPTS_LINE = "try { opts = JSON.parse(f['Editing Options'] || '{}') || {}; } catch (e) { opts = {}; }";
const once = (src, needle, label) => {
  const n = src.split(needle).length - 1;
  if (n !== 1) throw new Error(`${label}: expected exactly one occurrence, found ${n}`);
};
const edit = (src, steps) => steps.reduce((s, [from, to, label]) => { once(s, from, label); return s.replace(from, to); }, src);
const targets = {
  'Cast Sheet Prep': [
    [OPTS_LINE, OPTS_LINE + '\n' + fragment, 'opts line'],
    ["    prompt: (isProt ? 'The reference image", "    prompt: styleHead + (isProt ? 'The reference image", 'character prompt head'],
    ["one character, one outfit, one age. Photorealistic, natural skin or surface texture, sharp focus.',",
     "one character, one outfit, one age. ' + (kidsStyle ? 'Drawn in exactly that style in every view, the same medium as every frame of the film, clean and sharp.' : 'Photorealistic, natural skin or surface texture, sharp focus.'),",
     'character prompt tail'],
    ["    prompt: 'Product reference sheet of ONE object", "    prompt: styleHead + 'Product reference sheet of ONE object", 'object prompt head'],
    ["' + desc + ' Photorealistic, sharp focus.',",
     "' + desc + (kidsStyle ? ' Drawn in exactly that style in all three views, the same medium as every frame of the film, clean and sharp.' : ' Photorealistic, sharp focus.'),",
     'object prompt tail'],
  ],
  'Set Plate Prep': [
    [OPTS_LINE, OPTS_LINE + '\n' + fragment, 'opts line'],
    ["    prompt: 'Establishing reference plate of ONE location, wide shot at eye level, completely empty of people and vehicles, soft neutral overcast daylight without strong shadows so every part of the place reads clearly, photorealistic, sharp focus, no text, no labels: ' + desc +",
     "    prompt: styleHead + 'Establishing reference plate of ONE location, wide shot at eye level, completely empty of people and vehicles, soft neutral overcast daylight without strong shadows so every part of the place reads clearly, ' + (kidsStyle ? 'drawn in exactly that style, the same medium as every frame of the film, clean and sharp' : 'photorealistic, sharp focus') + ', no text, no labels: ' + desc +",
     'plate prompt'],
  ],
};
for (const [node, steps] of Object.entries(targets)) {
  const before = readFileSync(join(here, `paste/${node}.before.js`), 'utf8');
  const after = edit(before, steps);
  writeFileSync(join(here, `paste/${node}.after.js`), after);
  console.log(`${node}: ${before.length} -> ${after.length} bytes`);
}
