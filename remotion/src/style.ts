import {loadFont as loadOutfit} from '@remotion/google-fonts/Outfit';
import {loadFont as loadBodoni} from '@remotion/google-fonts/BodoniModa';
import {loadFont as loadCormorant} from '@remotion/google-fonts/CormorantGaramond';
import {loadFont as loadSpaceGrotesk} from '@remotion/google-fonts/SpaceGrotesk';
import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadInterTight} from '@remotion/google-fonts/InterTight';
import {loadFont as loadPlexMono} from '@remotion/google-fonts/IBMPlexMono';
import {loadFont as loadPoppins} from '@remotion/google-fonts/Poppins';
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
// Outfit replaces Fraunces as the default display face, so the render and the
// site (platform/app/layout.tsx) speak the same type system — a face swapped on
// one side and not the other is the whole point of sharing it, undone. Outfit
// is variable 100-900, so 700 is a real weight and nothing is synthesised.
const outfit = loadOutfit('normal', {
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
// The chapter card is the one surface that deliberately breaks the per-tone
// director above: the producer asked for Poppins Bold on it regardless of tone.
// Note this is the face the comment at the top of this file argues against for
// the DISPLAY role — the objection stands for a hook title set in it, and the
// card gets away with it because the rest of the card changed with it (centred,
// no rule, dark ground). Kept here rather than imported in the component so
// every font load in the render still has exactly one owner.
const poppins = loadPoppins('normal', {weights: ['700'], subsets: ['latin', 'latin-ext']});

/** Display face for the chapter impact card. Tone-independent, on purpose. */
export const cardTitleFont = poppins.fontFamily;
/**
 * Poppins 700 metrics for `fitTitleSize`, which simulates the browser's line
 * breaks and is only as good as these two numbers. MEASURED, with the face
 * actually loaded, via canvas `measureText` — a title-case sample gives an
 * advance of 0.588 and the real chapter title 0.593, against the 0.62 a guess
 * had put here. The space is the bigger correction: a geometric sans sets it at
 * 0.36 of an average glyph where the serif default assumes 0.58, and
 * overestimating every gap makes the fitter drop a size for no reason.
 */
export const CARD_TITLE_ADVANCE = 0.59;
export const CARD_SPACE_RATIO = 0.36;

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
	/**
	 * Word space as a fraction of `titleAdvance`, for THIS face. Optional: a
	 * preset that omits it gets fitType's DEFAULT_SPACE_RATIO, which is what
	 * every tone used before Outfit arrived, so omitting it changes nothing.
	 *
	 * Worth knowing before setting one: that default (0.58) is a TUNING
	 * constant, not a measurement. Measured the same way as the values here,
	 * Fraunces 700 sets its space at 0.2105em — a ratio of 0.287 against its
	 * uppercase advance, or 0.367 against title-case. Nothing about it is 0.58.
	 * So the hook has always assumed a word gap roughly twice as wide as the
	 * face actually sets, which makes it wrap early and pick a size SMALLER than
	 * it needs — conservative, never overflowing, which is exactly why it went
	 * unnoticed. Correcting the default would resize the titles of every tone at
	 * once, and each of their titleAdvance values was tuned with 0.58 in place,
	 * so it is left alone here and set per-preset instead.
	 */
	titleSpaceRatio?: number;
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
		// Outfit: a geometric sans with a slightly squared bowl, which keeps a
		// documentary title matter-of-fact where the old-style serif it replaced
		// editorialised it. Shared with the site, deliberately.
		return {
			displayFont: outfit.fontFamily,
			displayWeight: 700,
			captionFont: interTight.fontFamily,
			kickerFont: plexMono.fontFamily,
			uppercaseTitle: true,
			typeSpeed: 18,
			cardBg: '#101826',
			cardInk: '#E8B84B',
			energy: 1,
			// MEASURED, not inherited — the rule this file already learned the hard
			// way on the Poppins card. Read straight off the hmtx advances of the
			// same Google TTF the loader above fetches, instantiated at wght 700 and
			// averaged over a dozen real chapter/hook titles in the uppercase this
			// preset sets them in. Outfit is meaningfully narrower than the Fraunces
			// it replaces (0.7333 by the same measurement), so keeping 0.72 would
			// have made the fitter overestimate every line and drop a size for
			// nothing.
			titleAdvance: 0.66,
			titleSpaceRatio: 0.29,
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
