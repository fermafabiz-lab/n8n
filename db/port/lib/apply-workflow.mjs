#!/usr/bin/env node
// Apply (or roll back) a set of ported n8n workflows, described by a
// manifest instead of a hardcoded TARGETS array — the generalized form of
// `db/port/motif-cards/apply.mjs`, which had exactly one manifest baked in
// and was never reused. MUST be run from a machine with real network access
// to the n8n host (see the header of `n8n-api.mjs`) — never from inside a
// Claude Code web session.
//
// Usage (from the repo root):
//   N8N_API_URL=https://wf7.house-of-videos.com N8N_API_KEY=<key> \
//     node db/port/lib/apply-workflow.mjs --manifest db/port/<feature>/manifest.json
//   …same, plus --rollback, to put the saved originals back.
//
// Manifest shape (paths are relative to the manifest file's own directory):
//   {
//     "targets": [
//       {
//         "id": "<workflow id>",
//         "name": "<workflow name, for logging>",
//         "original": "<file>.original.json",   // GET snapshot taken before editing
//         "ported": "<file>.ported.json",        // full workflow body ready to PUT
//         "expect": ["Node A", "Node B"]          // node names this port must add/touch
//       }
//     ]
//   }
//
// Four guards, in the order each one bites:
//   1. Nothing running/waiting/new anywhere on the instance.
//   2. The live versionId still matches the saved `original` snapshot.
//   3. `ported` actually contains every node named in `expect`.
//   4. NEW — after the PUT, re-fetch and confirm each `expect` node's
//      `parameters` in the LIVE workflow are byte-identical (deep-equal) to
//      what `ported` said. `apply.mjs` only ever checked that the node
//      NAMES came back; this is the class of divergence that check cannot
//      see — n8n silently normalizing or rejecting part of a parameter
//      payload while still returning 200.
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveEnv, makeApi, assertNothingInFlight, assertVersionUnmoved, putBody} from './n8n-api.mjs';

function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return a === b;
	if (typeof a !== 'object') return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
	const ak = Object.keys(a).sort();
	const bk = Object.keys(b).sort();
	return ak.length === bk.length && ak.every((k, i) => k === bk[i]) && ak.every((k) => deepEqual(a[k], b[k]));
}

// Exported so a feature-specific wrapper (e.g. `motif-cards/apply.mjs`) can
// call it directly with its own fixed manifest path, instead of shelling
// out to this file as a subprocess.
export const runApply = async ({manifestPath, rollback = false}) => {
	const manifestDir = dirname(fileURLToPath(new URL(manifestPath, `file://${process.cwd()}/`)));
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const load = (f) => JSON.parse(readFileSync(join(manifestDir, f), 'utf8'));

	const env = resolveEnv();
	const api = makeApi(env);
	console.log(`n8n: ${env.API}`);
	console.log(rollback ? 'mode: ROLLBACK to the saved originals\n' : 'mode: apply\n');

	await assertNothingInFlight(api);
	console.log('✓ nothing running, waiting or queued\n');

	for (const t of manifest.targets) {
		const original = load(t.original);
		const source = rollback ? original : load(t.ported);

		// Guard 3 — the file is what it claims to be.
		const names = new Set(source.nodes.map((n) => n.name));
		const missing = (rollback ? [] : t.expect || []).filter((n) => !names.has(n));
		if (missing.length) {
			console.error(`ABORT — ${t.ported} is missing ${missing.join(', ')}. Re-run the builder.`);
			process.exit(3);
		}

		// Guard 2 — nobody else edited since the snapshot.
		if (!rollback) {
			await assertVersionUnmoved(api, t.id, original.versionId);
		}
		console.log(`✓ ${t.name}: live version matches the snapshot`);

		await api(`/api/v1/workflows/${t.id}`, {method: 'PUT', body: JSON.stringify(putBody(source))});
		const after = await api(`/api/v1/workflows/${t.id}`);
		const afterByName = new Map(after.nodes.map((n) => [n.name, n]));
		const namesOk = rollback
			? (t.expect || []).every((n) => !afterByName.has(n))
			: (t.expect || []).every((n) => afterByName.has(n));

		// Guard 4 (new) — for an apply (not a rollback), the live parameters
		// of every `expect` node are byte-identical to what `ported` sent.
		let contentOk = true;
		const mismatches = [];
		if (!rollback) {
			for (const n of t.expect || []) {
				const wanted = source.nodes.find((x) => x.name === n);
				const got = afterByName.get(n);
				if (!wanted || !got || !deepEqual(wanted.parameters, got.parameters)) {
					contentOk = false;
					mismatches.push(n);
				}
			}
		}

		console.log(
			`  → ${t.name}: ${after.nodes.length} nodes, active=${after.active}, version ${after.versionId}` +
				(namesOk ? '' : '  ⚠ expected node NAMES did not come back as expected — check the UI') +
				(!contentOk ? `  ⚠ PARAMETERS diverged after the PUT on: ${mismatches.join(', ')} — n8n accepted the write but did not store what was sent` : ''),
		);
		if (!namesOk || !contentOk) {
			console.error(`\nABORT after PUT — ${t.name} did not come back as sent. Investigate before touching the next target.`);
			process.exit(5);
		}
	}

	console.log(
		rollback
			? '\nRolled back. All targets are the saved originals again.'
			: '\nApplied and content-verified. Next: watch the next real execution of each touched workflow.',
	);
};

// CLI entry point — only runs when this file is executed directly (`node
// db/port/lib/apply-workflow.mjs --manifest …`), not when `runApply` is
// imported by a feature-specific wrapper such as `motif-cards/apply.mjs`.
const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], `file://${process.cwd()}/`).href;
if (isMain) {
	const args = process.argv.slice(2);
	const rollback = args.includes('--rollback');
	const manifestIdx = args.indexOf('--manifest');
	if (manifestIdx === -1 || !args[manifestIdx + 1]) {
		console.error('usage: node db/port/lib/apply-workflow.mjs --manifest <path/to/manifest.json> [--rollback]');
		process.exit(2);
	}
	runApply({manifestPath: args[manifestIdx + 1], rollback}).catch((e) => {
		console.error(`\nFAILED: ${e.message}`);
		console.error('If a PUT had already landed for an earlier target, roll that one back by hand or re-run with --rollback.');
		process.exit(1);
	});
}
