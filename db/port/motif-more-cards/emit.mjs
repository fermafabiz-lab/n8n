// Emit the three Claude Scripting node bodies this feature changes, from the
// one generator that owns them (db/port/motif-cards/add-motif-nodes.mjs), into
// paste/ — so what goes through the MCP connector is a committed file and can
// be byte-compared with the draft afterwards.
//
//   node db/port/motif-more-cards/emit.mjs
//
// The generator writes a whole PUT-ready workflow from a stale original, which
// is not wanted here; only its string constants are. They are evaluated by
// loading the generator's top half as a module (everything before the node
// list), which keeps the prompt, the prep body and the validator glue in one
// place rather than copied into a second file that drifts.
import {readFileSync, writeFileSync, unlinkSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const genDir = join(here, '..', 'motif-cards');
const src = readFileSync(join(genDir, 'add-motif-nodes.mjs'), 'utf8');
const cut = src.indexOf('\nconst nodes = (baseX, baseY) =>');
if (cut < 0) throw new Error('generator layout changed: no `const nodes = (baseX, baseY)`');
const head = src.slice(0, cut) + '\nexport {SYSTEM_MESSAGE, PREP_CODE, VALIDATE_CODE};\n';

const tmp = join(genDir, '.emit-tmp.mjs');
writeFileSync(tmp, head);
try {
	const m = await import(`${tmp}?${Date.now()}`);
	const out = join(here, 'paste');
	mkdirSync(out, {recursive: true});
	const files = {
		'Choose Motif Cards.system.txt': m.SYSTEM_MESSAGE,
		'Prep Motif Input.js': m.PREP_CODE,
		'Validate Motif Cards.js': m.VALIDATE_CODE,
	};
	for (const [name, body] of Object.entries(files)) {
		writeFileSync(join(out, name), body);
		console.log(`${name}: ${body.length} chars`);
	}
} finally {
	unlinkSync(tmp);
}
