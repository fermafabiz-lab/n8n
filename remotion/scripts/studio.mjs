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
import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {connect} from 'node:net';
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

// A Studio already on port 3000 makes everything below pointless: Remotion
// prints one line — "Already running on port 3000" — and just opens a browser
// onto the OLD instance, with the old code and the old props. Same class of
// silent-stale failure this script exists to prevent, so it gets the same
// treatment: stop, and say exactly what to run.
//
// Deliberately does not kill it. The site (platform/, Next.js) defaults to
// port 3000 too, and killing that instead would be a far worse surprise.
const portBusy = await new Promise((resolve) => {
	const sock = connect({port: 3000, host: '127.0.0.1'});
	const done = (v) => {
		sock.destroy();
		resolve(v);
	};
	sock.setTimeout(600);
	sock.on('connect', () => done(true));
	sock.on('error', () => done(false));
	sock.on('timeout', () => done(false));
});
if (portBusy) {
	banner([
		'!! SOMETHING IS ALREADY ON PORT 3000 !!',
		'',
		'Remotion would just reopen THAT instance — old code, old props —',
		'and nothing you changed would show up.',
		'',
		'See what it is:   lsof -i:3000',
		'If it is Studio:  lsof -ti:3000 | xargs kill',
		'Then:             npm run studio',
		'',
		'(The site in platform/ also uses 3000. Check before you kill.)',
	]);
	process.exit(1);
}

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

// Footage: whatever is in public/, picked up automatically.
//
// The old instruction was "drop an mp4 in public/, then copy the fixture and
// edit finalVideoUrl in it" — three steps, two of them hand-editing JSON, to
// express one thing the directory listing already knows. Now dropping the file
// in is the whole procedure. An explicit finalVideoUrl always wins, so nothing
// here can override a deliberate choice.
const publicDir = join(root, 'public');
const pickFootage = () => {
	if (!existsSync(publicDir)) return null;
	const media = readdirSync(publicDir).filter((f) => /\.(mp4|webm|mov)$/i.test(f));
	if (!media.length) return null;
	// test.mp4 by convention, else the newest file — dropping a second video in
	// should switch the preview to it, not leave you staring at the old one.
	const preferred =
		media.find((f) => f.toLowerCase() === 'test.mp4') ??
		media.sort(
			(a, b) => statSync(join(publicDir, b)).mtimeMs - statSync(join(publicDir, a)).mtimeMs,
		)[0];
	return '/' + preferred;
};

let propsPath = props;
const parsed = JSON.parse(readFileSync(props, 'utf8'));
if (parsed.finalVideoUrl) {
	console.log('props:   ' + props.replace(root + '/', ''));
	console.log('footage: ' + parsed.finalVideoUrl + '  (set in the props file)\n');
} else {
	const footage = pickFootage();
	if (footage) {
		// Resolved copy, gitignored, rewritten on every start — never the
		// tracked fixture, so a pull can't collide with it.
		parsed.finalVideoUrl = footage;
		propsPath = join(root, 'trigger', '.studio-props.resolved.json');
		writeFileSync(propsPath, JSON.stringify(parsed, null, '\t'));
		console.log('props:   ' + props.replace(root + '/', ''));
		console.log('footage: public' + footage + '  (found automatically)\n');
	} else {
		console.log('props:   ' + props.replace(root + '/', ''));
		console.log('footage: none — synthetic backdrop.');
		console.log('         Drop an mp4 into remotion/public/ and restart to use real footage.\n');
	}
}

spawn(
	'npx',
	['remotion', 'studio', 'src/index.ts', `--props=${propsPath}`],
	{cwd: root, stdio: 'inherit', shell: false},
).on('exit', (code) => process.exit(code ?? 0));
