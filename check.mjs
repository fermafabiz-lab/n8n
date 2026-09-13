#!/usr/bin/env node
// Run every `npm run check` in this repo, in order, stopping at the first
// failure. There is no root package.json (the repo is two independent apps,
// `remotion/` and `platform/`, each with its own), so this is a plain script
// rather than a third `npm run check` — invoke it directly:
//
//   node check.mjs
//
// What "check" means in each subproject, and what it deliberately does NOT
// do, is written at the top of `remotion/package.json` and
// `platform/package.json`'s own `check:*` entries and their target scripts.
// None of it touches ffmpeg (this environment has no system ffmpeg, and
// Remotion's bundled one is a stripped build missing the filters the mix
// graph needs — see CLAUDE.md), hits ElevenLabs/fal for real, or runs an
// n8n workflow. Those stay verified the way this repo already verifies
// them: a throwaway n8n workflow (execute, inspect, archive) or a real
// request against Railway.
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const subprojects = ['remotion', 'platform'];

for (const dir of subprojects) {
	console.log(`\n=== npm run check  (${dir}/) ===\n`);
	const res = spawnSync('npm', ['run', 'check'], {cwd: join(root, dir), stdio: 'inherit'});
	if (res.status !== 0) {
		console.error(`\n✗ ${dir}/ FAILED (exit ${res.status}) — stopping here, ${subprojects.slice(subprojects.indexOf(dir) + 1).join(', ') || 'nothing'} left unrun.`);
		process.exit(res.status || 1);
	}
}

console.log('\n✓ all checks passed — remotion/ and platform/.');
