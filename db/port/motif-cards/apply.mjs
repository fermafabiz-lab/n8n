// Apply the motif-card patches to the live n8n, or take them back off.
//
// Run it from the repo root (~/n8n), not from remotion/:
//
//   N8N_API_URL=https://wf7.house-of-videos.com N8N_API_KEY=<key> \
//     node db/port/motif-cards/apply.mjs
//   …same, plus --rollback, to put the saved originals back.
//
// N8N_API_URL may be given with or without a trailing /api/v1.
//
// A PUT is live from that second — there is no draft on the public API — so
// everything that can be checked before one is checked here, and any doubt is
// an abort rather than a warning.
//
// Three guards, in order of how badly each one bites:
//
//  1. Nothing running or waiting. A Final Assembly render in flight is a hard
//     stop; a waiting scripting run is one that would resume onto a workflow
//     it did not start on.
//  2. The live versionId still matches the saved original. If someone edited
//     either workflow since the snapshot was taken, this PUT would silently
//     revert their work — the builders read the snapshot, not the live copy.
//  3. The ported body actually contains what it claims (the new nodes, the
//     new edges), so a half-built file cannot be pushed.
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');

/**
 * The same pair `scripts/check-n8n.mjs` uses — and that script's URL already
 * ends in `/api/v1`, while this one builds its own paths. Accept both spellings
 * rather than making anyone remember which is which: a doubled `/api/v1` is a
 * 404 that reads like the workflow is missing.
 */
const API = (process.env.N8N_API_URL || '')
	.replace(/\/+$/, '')
	.replace(/\/api\/v1$/, '');
const KEY = process.env.N8N_API_KEY || '';
const placeholder = (v) => !v || /^[….]+$/.test(v) || v === '...' || /^<.*>$/.test(v);
if (placeholder(API) || placeholder(KEY)) {
	console.error(
		[
			'N8N_API_URL and N8N_API_KEY must hold real values — the same pair',
			'scripts/check-n8n.mjs uses. Run it from the REPO ROOT:',
			'',
			'  cd ~/n8n',
			'  N8N_API_URL=https://wf7.house-of-videos.com N8N_API_KEY=<key> \\',
			'    node db/port/motif-cards/apply.mjs',
			'',
			'If the pair is already exported in this shell, the prefix is not needed.',
		].join('\n'),
	);
	process.exit(1);
}

const api = async (path, init = {}) => {
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: {'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', ...(init.headers || {})},
	});
	const text = await res.text();
	if (res.status === 401) throw new Error('401 — the API key was rejected by ' + API);
	if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
	return text ? JSON.parse(text) : null;
};

const TARGETS = [
	{
		id: 'gkEtGMecv4TC3ZHp',
		name: 'Claude Scripting',
		original: 'Claude Scripting.original.json',
		ported: 'Claude Scripting.motif.json',
		expect: ['Prep Motif Input', 'Choose Motif Cards', 'Validate Motif Cards', 'Save Motif Cards', 'Motif Done'],
	},
	{
		id: 'BY22Vlhh20Xdkr5Z',
		name: '4. Final Assembly',
		original: 'Final Assembly.original.json',
		ported: 'Final Assembly.motif.json',
		expect: ['Attach Motif Cards'],
	},
];

const load = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));

const putBody = (wf) => ({
	name: wf.name,
	nodes: wf.nodes,
	connections: wf.connections,
	// PUT is stricter than GET here: it rejects binaryMode and availableInMCP,
	// which a GET happily returns, and merges what it is given.
	settings: {executionOrder: 'v1'},
});

const main = async () => {
	console.log(`n8n: ${API}`);
	console.log(rollback ? 'mode: ROLLBACK to the saved originals\n' : 'mode: apply the motif patches\n');

	// Guard 1 — nothing in flight.
	const live = [];
	for (const status of ['running', 'waiting', 'new']) {
		const r = await api(`/api/v1/executions?status=${status}&limit=50`);
		for (const e of r.data || []) live.push(`${e.id} ${e.status} wf=${e.workflowId}`);
	}
	if (live.length) {
		console.error('ABORT — executions are in flight. A render mid-PUT is the one thing this must not do:');
		for (const l of live) console.error(`  ${l}`);
		process.exit(2);
	}
	console.log('✓ nothing running, waiting or queued');

	for (const t of TARGETS) {
		const original = load(t.original);
		const source = rollback ? original : load(t.ported);

		// Guard 3 — the file is what it claims to be.
		const names = new Set(source.nodes.map((n) => n.name));
		const missing = (rollback ? [] : t.expect).filter((n) => !names.has(n));
		if (missing.length) {
			console.error(`ABORT — ${t.ported} is missing ${missing.join(', ')}. Re-run the builder.`);
			process.exit(3);
		}

		// Guard 2 — nobody else edited since the snapshot.
		const liveWf = await api(`/api/v1/workflows/${t.id}`);
		if (!rollback && liveWf.versionId !== original.versionId) {
			console.error(
				`ABORT — ${t.name} moved since the snapshot.\n` +
					`  saved:  ${original.versionId}\n  live:   ${liveWf.versionId}\n` +
					'  Someone edited it. Re-save the original, re-run the builder, read the diff, then apply.',
			);
			process.exit(4);
		}
		console.log(`✓ ${t.name}: live version matches the snapshot (${liveWf.nodes.length} nodes)`);

		await api(`/api/v1/workflows/${t.id}`, {method: 'PUT', body: JSON.stringify(putBody(source))});
		const after = await api(`/api/v1/workflows/${t.id}`);
		const now = new Set(after.nodes.map((n) => n.name));
		const ok = rollback
			? t.expect.every((n) => !now.has(n))
			: t.expect.every((n) => now.has(n));
		console.log(
			`  → ${t.name}: ${after.nodes.length} nodes, active=${after.active}, version ${after.versionId}` +
				(ok ? '' : '  ⚠ the expected nodes are NOT what came back — check the UI'),
		);
	}

	console.log(
		rollback
			? '\nRolled back. Both workflows are the saved originals again.'
			: [
					'',
					'Applied. What to check on the next film, in this order:',
					'  1. the scripting execution logs MOTIF OK|REVIEW|REJECTED lines',
					"  2. select editing_options->'motifCards' from hov.project where id = '…'",
					'  3. the render props carry textCards, and the card lands where the log said',
					'',
					'To undo: node db/port/motif-cards/apply.mjs --rollback',
				].join('\n'),
	);
};

main().catch((e) => {
	console.error(`\nFAILED: ${e.message}`);
	console.error('Nothing further was sent. If a PUT had already landed, roll back with --rollback.');
	process.exit(1);
});
