// Runs the two committed n8n node bodies for the motion packs against stubs:
//   Final Assembly `Caption Colour` hands category + motionPack to the render,
//   orchestrator `Normalize Webhook Input` stores the brief's motion_pack.
// No n8n, no network.   node db/port/motion-packs/check.mjs
import {readFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${what}`); if (!ok) failures++; };

const cc = readFileSync(join(here, 'paste', 'fa-Caption_Colour.js'), 'utf8');
const runCC = (opts) => {
	const $ = () => ({first: () => ({json: {fields: {'Editing Options': JSON.stringify(opts)}}})});
	return new Function('$json', '$', cc)({body: {tone: 'Documentary'}}, $)[0].json.body;
};
check(runCC({category: 'story'}).category === 'story' && runCC({category: 'story'}).motionPack === undefined, 'Story with no pick: category sent, motionPack absent (render defaults it)');
check(runCC({category: 'story', motionPack: 'punch'}).motionPack === 'punch', 'an explicit pick is sent');
check(runCC({motionPack: 'flashy'}).motionPack === undefined, 'an unknown pick is not sent');
check(runCC({motionPack: null}).motionPack === undefined, 'null (Auto) is not sent');
check(runCC({}).category === undefined, 'no category stored → none sent (old films stay classic)');
check(runCC({captionColor: '#abc', category: 'kids'}).captionColor === '#AABBCC', 'caption colour still works as before');

const nw = readFileSync(join(here, 'paste', 'orch-Normalize_Webhook_Input.js'), 'utf8');
const orig = readFileSync(join(here, 'original', 'orch-Normalize_Webhook_Input.js'), 'utf8');
const runNW = (src, body) => {
	const out = new Function('$json', '$input', '$', src)({body}, {first: () => ({json: {body}}), all: () => [{json: {body}}]}, () => ({first: () => ({json: {}})}));
	return JSON.parse(out[0].json.editingOptions);
};
const brief = {'Nume Proiect': 'x', category: 'story', Tonalitate: 'Epic', Lenght: 60};
let a, b;
try { a = runNW(orig, brief); b = runNW(nw, brief); } catch (e) { console.log('  harness:', e.message); }
if (a && b) {
	check(JSON.stringify(a) === JSON.stringify(b), 'a brief without motion_pack stores byte-identical options');
	check(runNW(nw, {...brief, motion_pack: 'lowerThird'}).motionPack === 'lowerThird', 'motion_pack=lowerThird is stored');
	check(!('motionPack' in runNW(nw, {...brief, motion_pack: ''})), 'Auto ("") stores nothing');
	check(!('motionPack' in runNW(nw, {...brief, motion_pack: 'x'})), 'an unknown value stores nothing');
}
if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall motion-pack node checks passed');
