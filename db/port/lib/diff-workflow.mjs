#!/usr/bin/env node
// Diff two n8n workflow exports (the shape GET /workflows/{id} or the MCP
// connector's get_workflow_details / get_workflow_version returns:
// {name, versionId, connections, nodes: [...]}).
//
// This generalizes the ad-hoc python/jq diffing that CLAUDE.md documents
// doing by hand after every MCP node edit — "diff the draft against the
// version you meant to build on, node by node, and confirm the ONLY entry
// that differs is yours" (the speed-picker apply, the motif-cards fixes in
// this session, etc). It runs with no network and no dependencies, so it
// works from inside a Claude Code session that has no outbound HTTP.
//
// Usage:
//   node db/port/lib/diff-workflow.mjs <before.json> <after.json> [options]
//
// Options:
//   --expect a,b,c    fail (exit 1) if any node OTHER than these changed,
//                     or added/removed
//   --allow-connections
//                     don't fail when `connections` differs (still reported)
//   --quiet           print only the summary line + failures
//
// What it checks, and why each one is here:
//
//  1. Which nodes were added / removed / changed (by `name`).
//  2. For every changed node, a line diff of `parameters` — this is the
//     "python/jq ad-hoc" step turned into one command.
//  3. `connections` deep-equality — an unintended splice/re-route is the
//     kind of change that breaks a workflow silently (CLAUDE.md: "check
//     each loop's out[0] actually reaches the next stage").
//  4. Every Google Drive node in `after` has both `resource` and
//     `operation` set, and flags as a REGRESSION any Drive node that had
//     both in `before` but lost either in `after` — the n8n editor is
//     documented (CLAUDE.md, four separate occurrences) to silently strip
//     these on a round-trip through the UI/MCP draft mechanism.
//  5. Every `$('Some Node')` / `$("Some Node")` reference anywhous in any
//     node's `parameters`, checked against the node names that actually
//     exist in `after` — a dangling reference is the
//     "any node referenced by name must be reachable" trap (the
//     restart-scripting tail, `Choose Bible`, `Settings Gate Guard`, etc).
//
// Exit code: 0 if nothing found that this tool considers a hard failure
// (dangling references, a connections diff without --allow-connections, an
// --expect violation, or a Drive resource/operation regression); 1
// otherwise. Everything is printed either way — this is a diff tool, not a
// silent pass/fail gate; read the output.
import {readFileSync} from 'node:fs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = {};
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--expect') flags.expect = (args[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
	else if (args[i] === '--allow-connections') flags.allowConnections = true;
	else if (args[i] === '--quiet') flags.quiet = true;
}

const [beforePath, afterPath] = positional;
if (!beforePath || !afterPath) {
	console.error('usage: node db/port/lib/diff-workflow.mjs <before.json> <after.json> [--expect a,b,c] [--allow-connections] [--quiet]');
	process.exit(2);
}

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const before = load(beforePath);
const after = load(afterPath);

// --- deep equal, no deps -----------------------------------------------
function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return a === b;
	if (typeof a !== 'object') return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
		return true;
	}
	const ak = Object.keys(a).sort();
	const bk = Object.keys(b).sort();
	if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
	return ak.every((k) => deepEqual(a[k], b[k]));
}

// --- minimal line diff (LCS-based) --------------------------------------
// Bounded so a genuinely huge body (thousands of lines) degrades to a
// summary instead of hanging — O(n*m) is fine for the Code-node/prompt
// bodies this tool exists for (tens to a few hundred lines).
function lineDiff(a, b) {
	const A = a.split('\n');
	const B = b.split('\n');
	if (A.length * B.length > 400000) {
		return null; // too big — caller falls back to a byte-length summary
	}
	const n = A.length, m = B.length;
	const dp = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const out = [];
	let i = 0, j = 0;
	while (i < n && j < m) {
		if (A[i] === B[j]) {
			i++; j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			out.push(`  - ${A[i]}`);
			i++;
		} else {
			out.push(`  + ${B[j]}`);
			j++;
		}
	}
	while (i < n) { out.push(`  - ${A[i]}`); i++; }
	while (j < m) { out.push(`  + ${B[j]}`); j++; }
	return out;
}

// --- node maps -----------------------------------------------------------
const beforeNodes = new Map((before.nodes || []).map((n) => [n.name, n]));
const afterNodes = new Map((after.nodes || []).map((n) => [n.name, n]));

const added = [...afterNodes.keys()].filter((n) => !beforeNodes.has(n));
const removed = [...beforeNodes.keys()].filter((n) => !afterNodes.has(n));
const common = [...beforeNodes.keys()].filter((n) => afterNodes.has(n));
const changed = common.filter((n) => !deepEqual(beforeNodes.get(n).parameters, afterNodes.get(n).parameters));
const typeChanged = common.filter(
	(n) => beforeNodes.get(n).type !== afterNodes.get(n).type || beforeNodes.get(n).typeVersion !== afterNodes.get(n).typeVersion,
);

let hardFail = false;
const log = (...a) => console.log(...a);
const logAlways = (...a) => console.log(...a); // printed even under --quiet

logAlways(`${before.name || beforePath} : ${after.name || afterPath}`);
logAlways(`  before ${beforeNodes.size} nodes (${before.versionId || '?'})  →  after ${afterNodes.size} nodes (${after.versionId || '?'})`);
logAlways(`  added ${added.length}, removed ${removed.length}, changed ${changed.length}${typeChanged.length ? `, type/typeVersion changed ${typeChanged.length}` : ''}`);
console.log();

if (added.length) logAlways(`+ added:   ${added.join(', ')}`);
if (removed.length) logAlways(`- removed: ${removed.join(', ')}`);
if (typeChanged.length) logAlways(`! type/typeVersion changed: ${typeChanged.join(', ')}`);
if (changed.length) log(`~ changed parameters: ${changed.join(', ')}`);

// --- --expect: fail if anything OTHER than the named nodes differs ------
if (flags.expect) {
	const touched = new Set([...added, ...removed, ...changed, ...typeChanged]);
	const expectedSet = new Set(flags.expect);
	const unexpected = [...touched].filter((n) => !expectedSet.has(n));
	const missing = flags.expect.filter((n) => !touched.has(n));
	console.log();
	if (unexpected.length) {
		hardFail = true;
		logAlways(`✗ --expect violated — these also changed and were NOT expected: ${unexpected.join(', ')}`);
	}
	if (missing.length) {
		logAlways(`  (note: --expect named ${missing.join(', ')} but nothing about them differs)`);
	}
	if (!unexpected.length) logAlways(`✓ only the expected nodes differ: ${flags.expect.join(', ')}`);
}

// --- per-node parameter diff ----------------------------------------------
// Diffed key by key, not as one JSON.stringify blob: a Code node's `jsCode`
// (or a prompt's `systemMessage`) is a multi-line string, and JSON-encoding
// it collapses every real newline into a literal `\n` — the whole body then
// reads as ONE changed "line", which is exactly the unreadable dump this
// tool exists to replace. Diffed as its own real text instead, the way the
// python/jq ad-hoc diffs in this repo's history actually read it.
function diffParams(before, after) {
	const bp = before ?? {};
	const ap = after ?? {};
	const keys = [...new Set([...Object.keys(bp), ...Object.keys(ap)])].sort();
	const lines = [];
	for (const k of keys) {
		const bv = bp[k];
		const av = ap[k];
		if (deepEqual(bv, av)) continue;
		if (typeof bv === 'string' && typeof av === 'string' && (bv.includes('\n') || av.includes('\n'))) {
			lines.push(`  ${k}:`);
			const d = lineDiff(bv, av);
			if (d === null) lines.push(`    (too large to line-diff: ${bv.length} → ${av.length} bytes)`);
			else for (const l of d) lines.push(`  ${l}`);
		} else if (bv === undefined) {
			lines.push(`  + ${k}: ${JSON.stringify(av)}`);
		} else if (av === undefined) {
			lines.push(`  - ${k}: ${JSON.stringify(bv)}`);
		} else {
			lines.push(`  ~ ${k}: ${JSON.stringify(bv)} → ${JSON.stringify(av)}`);
		}
	}
	return lines;
}

if (!flags.quiet) {
	for (const name of changed) {
		console.log();
		console.log(`── ${name} ──`);
		const d = diffParams(beforeNodes.get(name).parameters, afterNodes.get(name).parameters);
		if (d.length === 0) {
			console.log('  (key order differs only — no semantic change)');
		} else {
			for (const line of d) console.log(line);
		}
	}
}

// --- connections -----------------------------------------------------------
console.log();
const connectionsEqual = deepEqual(before.connections, after.connections);
if (connectionsEqual) {
	logAlways('✓ connections identical');
} else {
	logAlways('✗ connections DIFFER' + (flags.allowConnections ? ' (--allow-connections: not failing)' : ''));
	if (!flags.quiet) {
		const beforeSrc = Object.keys(before.connections || {});
		const afterSrc = Object.keys(after.connections || {});
		const srcAdded = afterSrc.filter((s) => !beforeSrc.includes(s));
		const srcRemoved = beforeSrc.filter((s) => !afterSrc.includes(s));
		const srcChanged = beforeSrc.filter(
			(s) => afterSrc.includes(s) && !deepEqual(before.connections[s], after.connections[s]),
		);
		if (srcAdded.length) console.log(`  new source nodes: ${srcAdded.join(', ')}`);
		if (srcRemoved.length) console.log(`  source nodes lost their outgoing edges: ${srcRemoved.join(', ')}`);
		if (srcChanged.length) console.log(`  outgoing edges changed from: ${srcChanged.join(', ')}`);
	}
	if (!flags.allowConnections) hardFail = true;
}

// --- Google Drive resource/operation guard ---------------------------------
// CLAUDE.md, four documented occurrences: "The import also strips
// parameters.operation from Google Drive nodes" / the UI draft that
// stripped resource+operation off six upload nodes / create_workflow_from_code
// skipping credential assignment on raw Drive HTTP nodes. This is the
// single grep CLAUDE.md gives for it:
//   jq -r '.nodes[]|select(.type|test("googleDrive"))|.name+" "+(.parameters.operation//"MISSING")'
console.log();
const driveNodesAfter = (after.nodes || []).filter((n) => /googleDrive/i.test(n.type || ''));
let driveRegression = false;
if (driveNodesAfter.length === 0) {
	logAlways('  (no Google Drive nodes in `after`)');
} else {
	for (const n of driveNodesAfter) {
		const hasResOp = n.parameters && n.parameters.resource && n.parameters.operation;
		if (hasResOp) continue;
		const beforeNode = beforeNodes.get(n.name);
		const hadBefore = beforeNode && beforeNode.parameters && beforeNode.parameters.resource && beforeNode.parameters.operation;
		if (hadBefore) {
			driveRegression = true;
			logAlways(`✗ ${n.name}: had resource+operation in \`before\`, LOST it in \`after\` (resource=${n.parameters?.resource ?? 'MISSING'} operation=${n.parameters?.operation ?? 'MISSING'})`);
		} else {
			logAlways(`  ⚠ ${n.name}: no resource/operation in \`after\` either (pre-existing, not introduced by this diff — resource=${n.parameters?.resource ?? 'MISSING'} operation=${n.parameters?.operation ?? 'MISSING'})`);
		}
	}
	if (!driveRegression) logAlways(`✓ ${driveNodesAfter.length} Google Drive node(s) in \`after\`, none newly missing resource/operation`);
}
if (driveRegression) hardFail = true;

// --- dangling $('Node Name') references -------------------------------------
console.log();
const refRe = /\$\(\s*(['"])([^'"]+)\1\s*\)/g;
const afterNames = new Set(afterNodes.keys());
const dangling = [];
for (const n of after.nodes || []) {
	const text = JSON.stringify(n.parameters ?? {});
	let m;
	refRe.lastIndex = 0;
	while ((m = refRe.exec(text))) {
		const ref = m[2];
		if (!afterNames.has(ref)) dangling.push({from: n.name, ref});
	}
}
if (dangling.length) {
	hardFail = true;
	logAlways(`✗ dangling $('Node Name') references in \`after\` (node not present under that name):`);
	for (const d of dangling) logAlways(`  ${d.from}  →  $('${d.ref}')`);
} else {
	logAlways(`✓ no dangling $('Node Name') references`);
}

console.log();
console.log(hardFail ? 'RESULT: FAIL — see ✗ lines above' : 'RESULT: OK');
process.exit(hardFail ? 1 : 0);
