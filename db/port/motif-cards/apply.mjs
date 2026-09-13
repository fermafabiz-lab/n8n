#!/usr/bin/env node
// Apply the motif-card patches to the live n8n, or take them back off.
//
// This is the reference implementation of the manifest-driven apply
// pattern in `db/port/lib/` — the original version of this file (see git
// history) hardcoded its own fetch() calls and its own three guards; that
// logic now lives once, in `db/port/lib/n8n-api.mjs` and
// `db/port/lib/apply-workflow.mjs`, with a fourth guard added there
// (post-PUT content verification) that this file gets for free.
//
// MUST be run from a machine with real network access to the n8n host —
// never from inside a Claude Code web session (see the header comment in
// `db/port/lib/n8n-api.mjs` for why).
//
//   N8N_API_URL=https://wf7.house-of-videos.com N8N_API_KEY=<key> \
//     node db/port/motif-cards/apply.mjs
//   …same, plus --rollback, to put the saved originals back.
//
// `manifest.json` beside this file names the two targets (Claude Scripting,
// Final Assembly), their saved `.original.json` snapshots and `.motif.json`
// ported bodies, and which node names each one is expected to add.
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runApply} from '../lib/apply-workflow.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');

runApply({manifestPath: join(here, 'manifest.json'), rollback})
	.then(() => {
		console.log(
			rollback
				? ''
				: [
						'',
						'What to check on the next film, in this order:',
						'  1. the scripting execution logs MOTIF OK|REVIEW|REJECTED lines',
						"  2. select editing_options->'motifCards' from hov.project where id = '…'",
						'  3. the render props carry textCards, and the card lands where the log said',
						'',
						'To undo: node db/port/motif-cards/apply.mjs --rollback',
					].join('\n'),
		);
	})
	.catch((e) => {
		console.error(`\nFAILED: ${e.message}`);
		console.error('Nothing further was sent. If a PUT had already landed, roll back with --rollback.');
		process.exit(1);
	});
