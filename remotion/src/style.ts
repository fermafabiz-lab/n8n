import {loadFont as loadPoppins} from '@remotion/google-fonts/Poppins';
import {loadFont as loadPlayfair} from '@remotion/google-fonts/PlayfairDisplay';
import {loadFont as loadQuicksand} from '@remotion/google-fonts/Quicksand';
import {loadFont as loadOswald} from '@remotion/google-fonts/Oswald';
import {toneKey} from './types';

// Fonts are fetched once at bundle/render time on the render server.
const poppins = loadPoppins('normal', {weights: ['500', '600', '800']});
const playfair = loadPlayfair('normal', {weights: ['700', '800']});
const quicksand = loadQuicksand('normal', {weights: ['600', '700']});
const oswald = loadOswald('normal', {weights: ['600', '700']});

export type StylePreset = {
	/** Display face for the hook title and impact cards. */
	displayFont: string;
	displayWeight: number;
	/** Caption face — always sentence case, never all-caps. */
	captionFont: string;
	uppercaseTitle: boolean;
	/** Typewriter speed for the hook, characters per second. */
	typeSpeed: number;
	/** Impact card background + text accent. */
	cardBg: string;
	cardInk: string;
	/** Editing energy: 0 = calm (no punch-ins), 1 = moderate, 2 = punchy. */
	energy: 0 | 1 | 2;
};

/**
 * Tone → visual direction. This is the "director": one Tonalitate picks the
 * typography, hook animation pace, card palette and cut energy, so a cat
 * story and a war documentary stop sharing the same look.
 */
export const presetForTone = (tone: string): StylePreset => {
	const k = toneKey(tone);
	if (/dark|horror|conspiracy/.test(k)) {
		return {
			displayFont: playfair.fontFamily,
			displayWeight: 800,
			captionFont: poppins.fontFamily,
			uppercaseTitle: true,
			typeSpeed: 14,
			cardBg: '#0D0B10',
			cardInk: '#C8452E',
			energy: 0,
		};
	}
	if (/epic|documentary|dramatic/.test(k)) {
		return {
			displayFont: playfair.fontFamily,
			displayWeight: 700,
			captionFont: poppins.fontFamily,
			uppercaseTitle: true,
			typeSpeed: 18,
			cardBg: '#101826',
			cardInk: '#E8B84B',
			energy: 1,
		};
	}
	if (/motivational/.test(k)) {
		return {
			displayFont: oswald.fontFamily,
			displayWeight: 700,
			captionFont: poppins.fontFamily,
			uppercaseTitle: true,
			typeSpeed: 26,
			cardBg: '#0B0B0B',
			cardInk: '#FFD400',
			energy: 2,
		};
	}
	if (/educativ|educational|corporate/.test(k)) {
		return {
			displayFont: poppins.fontFamily,
			displayWeight: 800,
			captionFont: poppins.fontFamily,
			uppercaseTitle: false,
			typeSpeed: 22,
			cardBg: '#F4F1EA',
			cardInk: '#1D4ED8',
			energy: 0,
		};
	}
	// Cinematic / Emotional / Inspirational — the "two cats in Paris" family:
	// soft rounded display, warm card, gentle motion.
	return {
		displayFont: quicksand.fontFamily,
		displayWeight: 700,
		captionFont: poppins.fontFamily,
		uppercaseTitle: false,
		typeSpeed: 20,
		cardBg: '#F6EFE3',
		cardInk: '#C77B32',
		energy: 1,
	};
};
