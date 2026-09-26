// Pins how a film's motion pack is chosen (src/motion/packs.ts):
// the film's own pick, else its category's default, else classic — and an
// unknown value never changes a film. The site's picker
// (platform/lib/motion-packs.ts) and n8n's Build Remotion Props carry the same
// ids and defaults; this is the render's half.
//
//   npm run check:motion

import {build} from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hov-check-motion-'));
const out = path.join(tmp, 'packs.mjs');
await build({
	entryPoints: [path.join(__dirname, '..', 'src', 'motion', 'packs.ts')],
	outfile: out,
	bundle: true,
	platform: 'node',
	format: 'esm',
	logLevel: 'error',
});
const {packFor, PACKS, DEFAULT_PACK_FOR_CATEGORY} = await import(pathToFileURL(out).href);
fs.rmSync(tmp, {recursive: true, force: true});

let failures = 0;
const check = (ok, what) => {
	console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${what}`);
	if (!ok) failures++;
};
const id = (...a) => packFor(...a).id;

check(id(undefined, undefined) === 'classic', 'no pick, no category → classic (every film made before this)');
check(id(undefined, 'story') === 'editorial', 'a Story film with no pick → editorial (the producer’s default)');
check(id(undefined, 'Story') === 'editorial', 'category is read case-insensitively');
check(id(undefined, 'kids') === 'kidsSticker', 'a Kids story film with no pick → kidsSticker (the producer’s default)');
for (const c of ['documentary', 'cinematic', 'something-new']) {
	check(id(undefined, c) === 'classic', `${c} with no pick → classic`);
}
for (const p of ['classic', 'editorial', 'punch', 'lowerThird']) {
	check(id(p, 'story') === p && id(p, 'kids') === p, `an explicit ${p} wins over any category default`);
}
check(id('classic', 'story') === 'classic', 'picking classic on a Story film is honoured, not overridden');
check(id('flashy', 'story') === 'editorial', 'an unknown pick falls back to the category default');
check(id('flashy', undefined) === 'classic', 'an unknown pick with no category → classic');
check(id('story-punch') === 'punch' && id('lowerthird') === 'lowerThird', 'the storyboard’s first names still resolve');
check(PACKS.classic.captions === 'classic' && PACKS.classic.chapterTitle === 'classic', 'classic is today’s motion on both surfaces');
check(Object.values(DEFAULT_PACK_FOR_CATEGORY).every((p) => p in PACKS), 'every category default names a real pack');

if (failures) {
	console.log(`\n${failures} motion check(s) failed`);
	process.exit(1);
}
console.log('\nall motion checks passed');
