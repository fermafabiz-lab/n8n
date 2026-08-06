// Start Remotion Studio on the latest code, and say plainly what happened.
//
// This exists because a silent skip is the worst outcome: `git pull --ff-only`
// refuses whenever anything local is modified — and `npm install` alone dirties
// package-lock.json — so the preview kept coming up on old code while the
// pull's one-line complaint scrolled past inside Remotion's own output. Twice
// that looked like "the fix didn't work".
//
// So: --autostash, so ordinary local churn can't block the update, and a banner
// loud enough to survive the scrollback either way.
import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const banner = (lines) => {
	const width = Math.max(...lines.map((l) => l.length)) + 4;
	console.log('\n' + '='.repeat(width));
	for (const l of lines) console.log('  ' + l);
	console.log('='.repeat(width) + '\n');
};

const git = (args) =>
	execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

let before = '';
try {
	before = git(['rev-parse', 'HEAD']);
	// --autostash: shelve local edits, fast-forward, put them back. Without it
	// a modified lockfile is enough to keep you on stale code indefinitely.
	git(['pull', '--ff-only', '--autostash']);
	const after = git(['rev-parse', 'HEAD']);
	if (after === before) {
		banner(['ALREADY UP TO DATE — running ' + after.slice(0, 7)]);
	} else {
		const log = git(['log', '--oneline', `${before}..${after}`]);
		banner([
			'PULLED ' + before.slice(0, 7) + ' -> ' + after.slice(0, 7),
			...log.split('\n').map((l) => '  ' + l),
			'',
			'If package.json changed, stop and run: npm install',
		]);
	}
} catch (err) {
	banner([
		'!! COULD NOT PULL — STUDIO IS RUNNING OLD CODE !!',
		String(err.stderr || err.message).split('\n')[0],
		'',
		'Fix it in another tab, then restart:',
		'  cd ' + root,
		'  git status        # see what is blocking',
		'  git pull',
	]);
}

// A local props file, if you made one, wins over the committed fixture — that
// way pointing the preview at your own footage never means editing a tracked
// file, and never collides with a pull.
const local = join(root, 'trigger', 'studio-props.local.json');
const props = existsSync(local) ? local : join(root, 'trigger', 'studio-props.json');
console.log('props: ' + props.replace(root + '/', '') + '\n');

spawn(
	'npx',
	['remotion', 'studio', 'src/index.ts', `--props=${props}`],
	{cwd: root, stdio: 'inherit', shell: false},
).on('exit', (code) => process.exit(code ?? 0));
