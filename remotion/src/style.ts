import {loadFont as loadFraunces} from '@remotion/google-fonts/Fraunces';
import {loadFont as loadBodoni} from '@remotion/google-fonts/BodoniModa';
import {loadFont as loadCormorant} from '@remotion/google-fonts/CormorantGaramond';
import {loadFont as loadSpaceGrotesk} from '@remotion/google-fonts/SpaceGrotesk';
import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadInterTight} from '@remotion/google-fonts/InterTight';
import {loadFont as loadPlexMono} from '@remotion/google-fonts/IBMPlexMono';
import {toneKey} from './types';

// Fonts are fetched once at bundle/render time on the render server, so the
// first render after a deploy pays for all of them and every later one is free.
//
// Poppins and Quicksand used to carry the display and caption roles here.
// Both are among the most heavily used faces in template video tools, and that
// association is most of why the graphics read as generated no matter how the
// motion was tuned. The set below is chosen to read editorial instead:
// high-contrast and old-style serifs for display, a tight grotesque for
// captions, and a mono for the small tracked kicker — that last one is the
// cheapest "made by a person" signal available.
// Every family is pinned to latin + latin-ext, and the second half is not
// optional: the producer writes in Romanian, and ș (U+0219) / ț (U+021B) live
// in latin-ext — loading only 'latin' renders those as missing-glyph boxes in
// chapter titles and captions. Naming the subsets also cuts the request count
// hard; left to its default, one family fetched 21 files per render because it
// pulled cyrillic, greek and vietnamese as well. The list is repeated per call
// rather than shared, because each family declares its own subset union.
const fraunces = loadFraunces('normal', {
	weights: ['700'],
	subsets: ['latin', 'latin-ext'],
});
const bodoni = loadBodoni('normal', {weights: ['700'], subsets: ['latin', 'latin-ext']});
const cormorant = loadCormorant('normal', {
	weights: ['600'],
	subsets: ['latin', 'latin-ext'],
});
const spaceGrotesk = loadSpaceGrotesk('normal', {
	weights: ['700'],
	subsets: ['latin', 'latin-ext'],
});
// Anton ships a single weight. Asking for 700 would make the browser
// synthesise a fake bold, which smears the letterforms.
const anton = loadAnton('normal', {weights: ['400'], subsets: ['latin', 'latin-ext']});
const interTight = loadInterTight('normal', {
	weights: ['600', '700', '800'],
	subsets: ['latin', 'latin-ext'],
});
const plexMono = loadPlexMono('normal', {
	weights: ['500'],
	subsets: ['latin', 'latin-ext'],
});

export type StylePreset = {
	/** Display face for the hook title and impact cards. */
	displayFont: string;
	displayWeight: number;
	/** Caption face — always sentence case, never all-caps. */
	captionFont: string;
	/** Small tracked label face (chapter eyebrow). Mono, always uppercase. */
	kickerFont: string;
	uppercaseTitle: boolean;
	/** Typewriter speed for the hook, characters per second. */
	typeSpeed: number;
	/** Impact card background + text accent. */
	cardBg: string;
	cardInk: string;
	/** Editing energy: 0 = calm (no punch-ins), 1 = moderate, 2 = punchy. */
	energy: 0 | 1 | 2;
	/**
	 * Average glyph advance as a fraction of font size, for THIS face in the
	 * case the title card sets it. The hook sizes itself by simulating the
	 * line breaks, and a simulation is only as good as this number — a shared
	 * guess put Fraunces caps on four lines when two were right. Measured per
	 * family: condensed faces (Anton) sit far below the serifs.
	 */
	titleAdvance: number;
};

/**
 * Tone → visual direction. This is the "director": one Tonalitate picks the
 * typography, hook animation pace, card palette and cut energy, so a cat
 * story and a war documentary stop sharing the same look.
 */
export const presetForTone = (tone: string): StylePreset => {
	const k = toneKey(tone);
	if (/dark|horror|conspiracy/.test(k)) {
		// Bodoni's hairline serifs at high contrast are the editorial-dread
		// register — the same face book covers in this genre use.
		return {
			displayFont: bodoni.fontFamily,
			displayWeight: 700,
			captionFont: interTight.fontFamily,
			kickerFont: plexMono.fontFamily,
			uppercaseTitle: true,
			typeSpeed: 14,
			cardBg: '#0D0B10',
			cardInk: '#C8452E',
			energy: 0,
			titleAdvance: 0.7, // Bodoni Moda, uppercase
		};
	}
	if (/epic|documentary|dramatic/.test(k)) {
		// Fraunces is an old-style serif with real quirk in its terminals; it
		// reads as a commissioned typeface rather than a default one.
		return {
			displayFont: fraunces.fontFamily,
			displayWeight: 700,
			captionFont: interTight.fontFamily,
			kickerFont: plexMono.fontFamily,
			uppercaseTitle: true,
			typeSpeed: 18,
			cardBg: '#101826',
			cardInk: '#E8B84B',
			energy: 1,
			titleAdvance: 0.72, // Fraunces, uppercase
		};
	}
	if (/motivational/.test(k)) {
		return {
			displayFont: anton.fontFamily,
			displayWeight: 400, // Anton's only weight — see the loader above.
			captionFont: interTight.fontFamily,
			kickerFont: plexMono.fontFamily,
			uppercaseTitle: true,
			typeSpeed: 26,
			cardBg: '#0B0B0B',
			cardInk: '#FFD400',
			energy: 2,
			titleAdvance: 0.46, // Anton is condensed — nearly half a serif's width
		};
	}
	if (/educativ|educational|corporate/.test(k)) {
		return {
			displayFont: spaceGrotesk.fontFamily,
			displayWeight: 700,
			captionFont: interTight.fontFamily,
			kickerFont: plexMono.fontFamily,
			uppercaseTitle: false,
			typeSpeed: 22,
			cardBg: '#F4F1EA',
			cardInk: '#1D4ED8',
			energy: 0,
			titleAdvance: 0.6, // Space Grotesk, mixed case
		};
	}
	// Cinematic / Emotional / Inspirational — the "two cats in Paris" family:
	// Cormorant's light old-style forms carry warmth without going soft the way
	// a rounded sans does.
	return {
		displayFont: cormorant.fontFamily,
		displayWeight: 600,
		captionFont: interTight.fontFamily,
		kickerFont: plexMono.fontFamily,
		uppercaseTitle: false,
		typeSpeed: 20,
		cardBg: '#F6EFE3',
		cardInk: '#C77B32',
		energy: 1,
		titleAdvance: 0.44, // Cormorant is narrow
	};
};
