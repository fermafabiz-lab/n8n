// Builds the Hyperframes page's script and stylesheet from src/hf/entry.tsx.
//
// Two redirections make the unchanged components run outside Remotion:
//
//   `remotion`                  → src/hf/remotion-shim.tsx
//   `@remotion/google-fonts/X`  → a module that bundles X from @fontsource
//
// The fonts come from local files for the reason the Remotion setup fetched
// them once and cached them: a render must not depend on Google answering.
// Each family is loaded in the weights style.ts asks for and nothing else,
// latin-ext included, because ș (U+0219) and ț (U+021B) live in latin-ext and
// without it they render as boxes. A weight asked for but not bundled here
// fails the page at load, loudly, instead of letting the browser fake a bold.

import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

/** Remotion module name → Fontsource package, family name, bundled weights. */
export const FONTS = {
	Outfit: {pkg: 'outfit', family: 'Outfit', weights: ['700']},
	BodoniModa: {pkg: 'bodoni-moda', family: 'Bodoni Moda', weights: ['700']},
	CormorantGaramond: {pkg: 'cormorant-garamond', family: 'Cormorant Garamond', weights: ['600']},
	SpaceGrotesk: {pkg: 'space-grotesk', family: 'Space Grotesk', weights: ['700']},
	Anton: {pkg: 'anton', family: 'Anton', weights: ['400']},
	InterTight: {pkg: 'inter-tight', family: 'Inter Tight', weights: ['600', '700', '800']},
	IBMPlexMono: {pkg: 'ibm-plex-mono', family: 'IBM Plex Mono', weights: ['500']},
	Poppins: {pkg: 'poppins', family: 'Poppins', weights: ['700']},
};

const fontModule = (name) => {
	const font = FONTS[name];
	if (!font) {
		throw new Error(
			`hf-bundle: @remotion/google-fonts/${name} has no local copy — add it to FONTS in server/hf-bundle.mjs`,
		);
	}
	const imports = font.weights
		// The per-weight file, not latin-<w>.css + latin-ext-<w>.css: only the
		// per-weight file declares each subset's unicode-range, and without
		// ranges two faces of one family and weight are ambiguous about which
		// of them draws a given letter. The subsets nobody writes in (cyrillic,
		// greek, vietnamese) ride along as files and are never read.
		.map((w) => `@fontsource/${font.pkg}/${w}.css`)
		.map((css) => `import ${JSON.stringify(css)};`)
		.join('\n');
	return `${imports}
import {delayRender, continueRender} from 'remotion';
const family = ${JSON.stringify(font.family)};
const bundled = ${JSON.stringify(font.weights)};
export const loadFont = (style = 'normal', options = {}) => {
	const weights = options.weights ?? bundled;
	const missing = weights.filter((w) => !bundled.includes(String(w)));
	if (missing.length) throw new Error(family + ' ' + missing.join(',') + ' is not bundled (server/hf-bundle.mjs)');
	// Load now rather than on first use, and hold the first frame until every
	// face is in, as @remotion/google-fonts does — a caption measured in a
	// fallback face is laid out wrong for the whole scene.
	const handle = delayRender('font ' + family);
	Promise.all(weights.map((w) => document.fonts.load(w + ' 32px "' + family + '"', 'aăâîșțAĂÂÎȘȚ019')))
		.then(() => continueRender(handle), () => continueRender(handle));
	return {fontFamily: family};
};
`;
};

const aliases = {
	name: 'hov-remotion-aliases',
	setup(b) {
		b.onResolve({filter: /^remotion$/}, () => ({path: path.join(SRC, 'hf', 'remotion-shim.tsx')}));
		b.onResolve({filter: /^@remotion\/google-fonts\/[A-Za-z0-9]+$/}, (args) => ({
			path: args.path.split('/').pop(),
			namespace: 'hov-font',
		}));
		b.onLoad({filter: /.*/, namespace: 'hov-font'}, (args) => ({
			contents: fontModule(args.path),
			loader: 'js',
			resolveDir: __dirname,
		}));
		// Anything else under @remotion/ is an API nobody has verified here.
		b.onResolve({filter: /^@remotion\//}, (args) => ({
			errors: [{text: `${args.path} is not available to the Hyperframes page (server/hf-bundle.mjs)`}],
		}));
	},
};

/**
 * Bundle into `outdir`: app.js, app.css and the font files it references.
 * Returns the names of the two files the page links.
 */
export async function bundleHfPage(outdir) {
	await build({
		entryPoints: {app: path.join(SRC, 'hf', 'entry.tsx')},
		outdir,
		bundle: true,
		minify: true,
		format: 'iife',
		platform: 'browser',
		target: 'chrome120',
		jsx: 'automatic',
		define: {'process.env.NODE_ENV': '"production"'},
		loader: {'.woff2': 'file', '.woff': 'file'},
		assetNames: 'fonts/[name]-[hash]',
		plugins: [aliases],
		logLevel: 'warning',
	});
	return {script: 'app.js', stylesheet: 'app.css'};
}
