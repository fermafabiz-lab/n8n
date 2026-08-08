#!/usr/bin/env node
// Migration/health check for the n8n instance the platform talks to.
//
// Written for the move off n8n Cloud: it answers, in one run, the questions
// that otherwise cost an hour of clicking — is the API reachable, did the
// workflow ids survive the import, are the webhooks registered under the
// public URL, and which credentials still need to be re-created (they never
// migrate, since they're encrypted with the old instance's key).
//
//   N8N_API_URL=https://n8n.example.com/api/v1 \
//   N8N_API_KEY=... \
//   node scripts/check-n8n.mjs
//
// Exit code is non-zero when something is actually broken, so it can gate a
// deploy.

const BASE = (process.env.N8N_API_URL || '').replace(/\/$/, '');
const KEY = process.env.N8N_API_KEY;
const RAILWAY = process.env.RENDER_SERVER_URL || 'https://n8n-production-55dd.up.railway.app';

// The pipeline references these by id from inside Execute Workflow nodes, so
// an id that changed during import silently breaks the orchestration.
//
// These are the SELF-HOSTED ids. The import off n8n Cloud did not preserve the
// originals, so every id here was re-read from the instance after the move.
const EXPECTED_WORKFLOWS = {
	'8CienBFfG6SgbB1A': {name: '1. Master Orchestrator', mustBeActive: true},
	gkEtGMecv4TC3ZHp: {name: 'Claude Scripting', mustBeActive: true},
	yHG4DBCDjR3RJzav: {name: '3. Media Generation (Batch)', mustBeActive: true},
	BY22Vlhh20Xdkr5Z: {name: '4. Final Assembly', mustBeActive: true},
};

// Dead n8n Cloud ids. Nothing may reference these any more — an Execute
// Workflow node still pointing at one starts the orchestrator and then calls
// into nothing, which fails silently.
const DEAD_CLOUD_IDS = {
	a9eyVteQcP1ZxtZH: '1. Master Orchestrator',
	auz2GejSQAhvLkCA: 'Claude Scripting',
	u5eVcB6VOGNdTMom: '3. Media Generation (Batch)',
	y8ZPxgUFOxdRpva8: '4. Final Assembly',
};

// Every webhook the website calls. The site derives all of them from
// N8N_NEW_PROJECT_WEBHOOK_URL by replacing the trailing path, so they must
// all live on the same host.
const EXPECTED_WEBHOOKS = [
	'new-project',
	'resume-project',
	'scene-text-regen',
	'scene-image-regen',
	'scene-voice-regen',
	'assemble',
];

// Called by the site but not built yet — reported as a gap, not a failure,
// so the check stays green until it is deliberately added.
const PLANNED_WEBHOOKS = ['restart-scripting'];

// Credentials are encrypted per-instance and NEVER survive an export/import.
const EXPECTED_CREDENTIAL_TYPES = [
	'airtableTokenApi',
	'googleDriveOAuth2Api',
	'openAiApi',
	'httpHeaderAuth', // FAL + Shotstack
];

const problems = [];
const warnings = [];
const ok = [];

async function api(path) {
	const res = await fetch(`${BASE}${path}`, {
		headers: {'X-N8N-API-KEY': KEY, Accept: 'application/json'},
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
	return res.json();
}

async function main() {
	if (!BASE || !KEY) {
		console.error('Set N8N_API_URL (…/api/v1) and N8N_API_KEY first.');
		process.exit(2);
	}
	if (!/^https:\/\//.test(BASE)) {
		warnings.push(`N8N_API_URL is not https (${BASE}) — webhooks from Vercel will fail.`);
	}

	// 1. Reachability + auth.
	let workflows;
	try {
		workflows = (await api('/workflows?limit=200')).data ?? [];
		ok.push(`API reachable, ${workflows.length} workflows visible.`);
	} catch (e) {
		console.error(`\n✗ Cannot reach the n8n API at ${BASE}\n  ${e.message}`);
		console.error('  Check the URL, the API key, and that the instance is public over HTTPS.');
		process.exit(1);
	}

	// 2. Workflow ids survived the import.
	const byId = new Map(workflows.map((w) => [w.id, w]));
	for (const [id, want] of Object.entries(EXPECTED_WORKFLOWS)) {
		const w = byId.get(id);
		if (!w) {
			const sameName = workflows.find((x) => x.name === want.name);
			problems.push(
				sameName
					? `Workflow "${want.name}" exists but its id changed (${sameName.id} ≠ ${id}). ` +
						`Execute Workflow nodes point at the old id — re-import keeping ids, or update the references.`
					: `Workflow "${want.name}" (${id}) is missing entirely.`,
			);
		} else if (want.mustBeActive && !w.active) {
			problems.push(`Workflow "${w.name}" exists but is NOT active — publish it.`);
		} else {
			ok.push(`Workflow "${w.name}" present and active.`);
		}
	}

	// 3. Webhooks registered, and registered under the PUBLIC url.
	const host = BASE.replace(/\/api\/v1$/, '');
	const allNodes = [];
	const fullById = new Map();
	for (const id of Object.keys(EXPECTED_WORKFLOWS)) {
		if (!byId.has(id)) continue;
		try {
			const full = await api(`/workflows/${id}`);
			fullById.set(id, full);
			allNodes.push(...(full.nodes ?? []));
		} catch {
			warnings.push(`Could not read nodes of workflow ${id}.`);
		}
	}
	const paths = new Set(
		allNodes
			.filter((n) => n.type === 'n8n-nodes-base.webhook' && !n.disabled)
			.map((n) => String(n.parameters?.path ?? '')),
	);
	for (const p of EXPECTED_WEBHOOKS) {
		if (paths.has(p)) ok.push(`Webhook /${p} registered.`);
		else problems.push(`Webhook /${p} is missing — the site calls ${host}/webhook/${p}.`);
	}
	for (const p of PLANNED_WEBHOOKS) {
		if (paths.has(p)) ok.push(`Webhook /${p} registered.`);
		else
			warnings.push(
				`Webhook /${p} not built yet — the site's "Restart writing" button will say so. See CLAUDE.md.`,
			);
	}

	// 4. Execute Workflow nodes actually point at ids that exist here. This is
	// the failure the import causes and the one that hides best: the parent
	// starts, calls into a dead cloud id, and nothing downstream ever runs.
	for (const [id, full] of fullById) {
		for (const n of full.nodes ?? []) {
			if (n.type !== 'n8n-nodes-base.executeWorkflow' || n.disabled) continue;
			const target = n.parameters?.workflowId?.value ?? n.parameters?.workflowId;
			const where = `"${EXPECTED_WORKFLOWS[id].name}" → node "${n.name}"`;
			if (typeof target !== 'string' || !target) {
				warnings.push(`${where} has no static workflow id (expression?) — check it by hand.`);
			} else if (DEAD_CLOUD_IDS[target]) {
				problems.push(
					`${where} still points at the DEAD n8n Cloud id ${target} ` +
						`(${DEAD_CLOUD_IDS[target]}). It will call into nothing — repoint it.`,
				);
			} else if (!byId.has(target)) {
				problems.push(`${where} points at ${target}, which does not exist on this instance.`);
			} else {
				ok.push(`${where} → "${byId.get(target).name}".`);
			}
		}
	}

	// 5. Credentials — the one thing an import can never bring along. The API
	// redacts per-node credential bindings, so this only proves the credentials
	// exist; that each node is wired to one still has to be trusted or eyeballed.
	try {
		const creds = (await api('/credentials?limit=200')).data ?? [];
		const haveTypes = new Set(creds.map((c) => c.type));
		for (const t of EXPECTED_CREDENTIAL_TYPES) {
			if (haveTypes.has(t)) ok.push(`Credential type ${t} present.`);
			else problems.push(`No ${t} credential on this instance — re-create it and attach it to the nodes.`);
		}
	} catch {
		// Some self-hosted builds don't expose /credentials to API keys.
		warnings.push('Could not list credentials over the API — check them by hand in the UI.');
	}

	// 6. The render server the workflows call.
	try {
		const res = await fetch(`${RAILWAY}/health`, {signal: AbortSignal.timeout(10000)});
		if (res.ok) ok.push('Render server (Railway) healthy.');
		else warnings.push(`Render server answered HTTP ${res.status}.`);
	} catch (e) {
		warnings.push(`Render server unreachable from here: ${e.message}`);
	}

	const line = (s, mark) => console.log(`${mark} ${s}`);
	console.log('');
	ok.forEach((s) => line(s, '✓'));
	warnings.forEach((s) => line(s, '!'));
	problems.forEach((s) => line(s, '✗'));
	console.log(
		`\n${problems.length ? `${problems.length} blocking problem(s).` : 'No blocking problems.'}` +
			`${warnings.length ? ` ${warnings.length} warning(s).` : ''}\n`,
	);
	process.exit(problems.length ? 1 : 0);
}

main();
