// Pins where a graphic style's pieces land (src/graphics/GraphicsLayer.ts
// placeGraphics) for the Kids story and Cinematic bundles:
//   - a Cinematic film opens on its own title and its first chapter title
//     gives way to it; bars cover the whole film; leaks sit on chapter
//     changes but never on the first;
//   - a graphic whose scene opens under a full-frame title starts after it;
//   - a character is introduced once, as a card or a contour, never both;
//   - nothing is placed in the cold open.
//
//   npm run check:graphics

import {build} from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Inside the package, so the bundle's bare imports (react, remotion) resolve.
fs.mkdirSync(path.join(__dirname, '..', 'out'), {recursive: true});
const tmp = fs.mkdtempSync(path.join(__dirname, '..', 'out', '.check-graphics-'));
const load = async (file) => {
	const out = path.join(tmp, path.basename(file).replace(/\.tsx?$/, '.mjs'));
	await build({entryPoints: [path.join(__dirname, '..', 'src', 'graphics', file)], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'remotion']});
	return import(pathToFileURL(out).href);
};
const L = await load('GraphicsLayer.tsx');
const S = await load('styles.ts');

let failed = 0, passed = 0;
const ok = (label, cond, detail) => {
	if (cond) { passed++; console.log('  ok   ' + label); }
	else { failed++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
};
const scene = (startSeconds, durationSeconds, chapter) => ({startSeconds, durationSeconds, chapter, narratorText: ''});

console.log('Cinematic');
{
	const scenes = [scene(0, 8, 1), scene(8, 8, 1), scene(16, 8, 2), scene(24, 8, 3)];
	const titles = {1: 'Leaving H10', 2: 'Neon Arteries', 3: 'Corporate Intake'};
	const p = L.placeGraphics({style: S.graphicStyleFor('cineNeon'), items: [{kind: 'slate', sceneIndex: 0, title: 'H10'}, {kind: 'slate', sceneIndex: 2, title: 'Arterial'}], scenes, chapterTitles: titles, blocked: [], filmTitle: 'The Commute'});
	const k = (kind) => p.filter((x) => x.kind === kind);
	ok('opens on the film title', k('filmTitle').length === 1 && k('filmTitle')[0].from < 0.5);
	ok('the first chapter title gives way to it', !k('chapterTitle').some((x) => x.title === 'Leaving H10') && k('chapterTitle').length === 2);
	ok('glitch chapter titles', k('chapterTitle').every((x) => x.design === 'glitch'));
	ok('bars over the whole film', k('letterbox').length === 1 && k('letterbox')[0].from === 0 && k('letterbox')[0].to === 32);
	ok('a slate under the opening title starts after it', k('slate').some((x) => x.title === 'H10' && x.from >= k('filmTitle')[0].to));
	ok('a slate under a chapter title starts after it', k('slate').some((x) => x.title === 'Arterial' && x.from >= 16 + L.CHAPTER_TITLE_SECONDS));
	const m = L.placeGraphics({style: S.graphicStyleFor('cineMemory'), items: [], scenes, chapterTitles: titles, blocked: [], filmTitle: 'The Commute'});
	ok('memory: leaks on chapter changes, never the first, no bars', m.filter((x) => x.kind === 'leak').length === 2 && !m.some((x) => x.kind === 'letterbox') && m.filter((x) => x.kind === 'leak').every((x) => x.from > 10));
	ok('no film title without a name', !L.placeGraphics({style: S.graphicStyleFor('cineFilm'), items: [], scenes, chapterTitles: titles, blocked: []}).some((x) => x.kind === 'filmTitle'));
}

console.log('Kids story');
{
	const scenes = [scene(0, 3, 0), scene(3, 3, 0), scene(6, 8, 1), scene(14, 8, 1), scene(22, 8, 1), scene(30, 8, 1), scene(38, 8, 1)];
	const items = [
		{kind: 'character', sceneIndex: 1, title: 'Teaser', box: [0.1, 0.1, 0.2, 0.2], image: 'x'},
		{kind: 'character', sceneIndex: 2, title: 'Pip', box: [0.1, 0.1, 0.2, 0.2], image: 'x'},
		{kind: 'character', sceneIndex: 3, title: 'Momo', box: [0.1, 0.1, 0.2, 0.2], image: 'y'},
		{kind: 'speech', sceneIndex: 4, text: 'Oh dear!'},
		{kind: 'moment', sceneIndex: 5, label: 'Found it!'},
		{kind: 'celebrate', sceneIndex: 6},
	];
	const all = L.placeGraphics({style: S.graphicStyleFor('kidsAll'), items, scenes, chapterTitles: {1: 'The Blue Thread Trail'}, blocked: []});
	const k = (kind) => all.filter((x) => x.kind === kind);
	ok('nothing in the cold open', !all.some((x) => x.from < 6 && x.kind !== 'chapterTitle'));
	ok('a handwritten chapter title', k('chapterTitle').length === 1 && k('chapterTitle')[0].design === 'kidsTitle');
	ok('the card under the chapter title starts after it', k('card').length === 1 && k('card')[0].title === 'Pip' && k('card')[0].from >= 6 + L.CHAPTER_TITLE_SECONDS);
	ok('the next character gets the contour, not a second card', k('circle').length === 1 && k('circle')[0].title === 'Momo');
	ok('bubble, sticker and confetti land', k('speech').length === 1 && k('sticker').length === 1 && k('confetti').length === 1);
	const story = L.placeGraphics({style: S.graphicStyleFor('kidsStorybook'), items, scenes, chapterTitles: {1: 'The Blue Thread Trail'}, blocked: []});
	ok('storybook: cards only, no bubbles or stickers', !story.some((x) => ['speech', 'sticker', 'circle'].includes(x.kind)) && story.filter((x) => x.kind === 'card').length === 2);
	const play = L.placeGraphics({style: S.graphicStyleFor('kidsPlayful'), items, scenes, chapterTitles: {1: 'x'}, blocked: []});
	ok('playful: contours, never cards; the chapter stays a card of its own', !play.some((x) => x.kind === 'card' || x.kind === 'chapterTitle') && play.filter((x) => x.kind === 'circle').length === 2);
	ok('a contour needs a box', !L.placeGraphics({style: S.graphicStyleFor('kidsPlayful'), items: [{kind: 'character', sceneIndex: 3, title: 'Momo'}], scenes, chapterTitles: {}, blocked: []}).some((x) => x.kind === 'circle'));
}

fs.rmSync(tmp, {recursive: true, force: true});
console.log(failed ? `\n${failed} FAILED` : `\nall graphics checks passed (${passed})`);
process.exit(failed ? 1 : 0);
