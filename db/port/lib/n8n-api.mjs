// Thin wrapper around the n8n public REST API, extracted from
// `db/port/motif-cards/apply.mjs` (the one place this pattern existed
// before, used exactly once). Nothing in here does anything a Claude Code
// web session could not have written — the constraint is that it can never
// be RUN from inside one: CLAUDE.md documents that such a session has no
// outbound HTTP, which is why `scripts/check-n8n.mjs` "has to be run from a
// machine that can reach wf7.house-of-videos.com". This module, and
// `apply-workflow.mjs` on top of it, are for that machine — an operator's
// laptop, or a future CI/cron box with real network — never for a Claude
// session to invoke directly.
//
// A PUT to /workflows/{id} is live from the moment it lands — the public API
// has no draft, unlike the n8n UI/MCP connector, which does stage one. So
// every check that can be made before the PUT is made here, and any doubt
// aborts rather than warns.

const placeholder = (v) => !v || /^[….]+$/.test(v) || v === '...' || /^<.*>$/.test(v);

export function resolveEnv(env = process.env) {
	const API = (env.N8N_API_URL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
	const KEY = env.N8N_API_KEY || '';
	if (placeholder(API) || placeholder(KEY)) {
		throw new Error(
			[
				'N8N_API_URL and N8N_API_KEY must hold real values — the same pair scripts/check-n8n.mjs uses.',
				'Run this from a machine that can reach the n8n host, e.g.:',
				'  N8N_API_URL=https://wf7.house-of-videos.com N8N_API_KEY=<key> node <script>',
			].join('\n'),
		);
	}
	return {API, KEY};
}

export function makeApi({API, KEY}) {
	return async function api(path, init = {}) {
		const res = await fetch(`${API}${path}`, {
			...init,
			headers: {'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', ...(init.headers || {})},
		});
		const text = await res.text();
		if (res.status === 401) throw new Error('401 — the API key was rejected by ' + API);
		if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
		return text ? JSON.parse(text) : null;
	};
}

// Guard 1 — nothing in flight. A render mid-PUT, or a scripting run that
// would resume onto a workflow it did not start on, is the one thing a
// write to a live workflow must never risk.
export async function assertNothingInFlight(api) {
	const live = [];
	for (const status of ['running', 'waiting', 'new']) {
		const r = await api(`/api/v1/executions?status=${status}&limit=50`);
		for (const e of r.data || []) live.push(`${e.id} ${e.status} wf=${e.workflowId}`);
	}
	if (live.length) {
		throw new Error(
			'executions are in flight — a render or a run mid-PUT is the one thing this must not do:\n' +
				live.map((l) => `  ${l}`).join('\n'),
		);
	}
}

// Guard 2 — nobody else edited the live workflow since the snapshot this
// apply is built against. The builder reads the SNAPSHOT, not the live
// copy, so applying against a moved workflow would silently revert
// whatever changed it in between.
export async function assertVersionUnmoved(api, id, expectedVersionId) {
	const live = await api(`/api/v1/workflows/${id}`);
	if (live.versionId !== expectedVersionId) {
		throw new Error(
			`workflow ${id} moved since the snapshot.\n` +
				`  snapshot: ${expectedVersionId}\n  live:     ${live.versionId}\n` +
				'  Someone edited it. Re-save the original, re-run the builder, re-diff, then apply.',
		);
	}
	return live;
}

export function putBody(wf) {
	return {
		name: wf.name,
		nodes: wf.nodes,
		connections: wf.connections,
		// PUT is stricter than GET: it rejects `binaryMode` and
		// `availableInMCP`, which GET happily returns, and merges what it is
		// given rather than replacing — so this alone is safe to send.
		settings: {executionOrder: 'v1'},
	};
}
