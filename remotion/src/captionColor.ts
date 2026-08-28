/**
 * Caption accent — the one place that decides what colour a caption word is.
 *
 * ## Why white is the default
 *
 * The accent used to be `palette.primary`, which nothing upstream ever sets,
 * so every video in the factory got `#E8B84B` — the amber-yellow that is by
 * now the visual signature of generated video. Two things made it louder than
 * a single highlight colour should be: it painted the karaoke word AND every
 * word the keyword rule matched, and that rule counted any capitalised word.
 * Romanian capitalises the first word of every sentence, so on a dialogue
 * script roughly half the words on screen came out yellow.
 *
 * So the default is now no colour at all: white captions, with the spoken word
 * marked by brightness instead of hue. That reads as deliberate on any
 * footage, which a single fixed hue cannot — an accent that sits well on a
 * night dock is wrong on snow.
 *
 * A colour is therefore something a project OPTS IN to, either chosen by the
 * producer or derived from the footage (`POST /caption-color` on the render
 * server), and it arrives here as a concrete hex.
 */

export type CaptionAccent = string | null;

/**
 * Captions are set over footage with a heavy drop shadow, so the danger is a
 * dark accent, not a light one: a deep blue picked off a night scene goes
 * invisible against its own shadow. Anything below this relative luminance is
 * mixed toward white until it clears the bar.
 *
 * 0.32 is where a mid-tone accent still reads as its own hue rather than as
 * off-white — measured against the darkest frames in the tahiti montage, which
 * are the worst case the library currently holds.
 */
const MIN_LUMINANCE = 0.32;

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

type Rgb = {r: number; g: number; b: number};

const parseHex = (value: string): Rgb | null => {
	const m = HEX.exec(value.trim());
	if (!m) return null;
	let hex = m[1];
	if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
	return {
		r: parseInt(hex.slice(0, 2), 16),
		g: parseInt(hex.slice(2, 4), 16),
		b: parseInt(hex.slice(4, 6), 16),
	};
};

const toHex = ({r, g, b}: Rgb): string =>
	'#' +
	[r, g, b]
		.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase();

/** WCAG relative luminance. */
const luminance = ({r, g, b}: Rgb): number => {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const mixToWhite = (c: Rgb, t: number): Rgb => ({
	r: c.r + (255 - c.r) * t,
	g: c.g + (255 - c.g) * t,
	b: c.b + (255 - c.b) * t,
});

/** Lift a too-dark accent just far enough to clear MIN_LUMINANCE, no further. */
const ensureLegible = (c: Rgb): Rgb => {
	if (luminance(c) >= MIN_LUMINANCE) return c;
	// Luminance is monotonic along a mix toward white, so bisection lands on
	// the least amount of washing-out that clears the bar.
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 20; i++) {
		const mid = (lo + hi) / 2;
		if (luminance(mixToWhite(c, mid)) < MIN_LUMINANCE) lo = mid;
		else hi = mid;
	}
	return mixToWhite(c, hi);
};

/**
 * `captionColor` prop → the colour a caption word is actually painted, or
 * null for the colourless default.
 *
 * Accepts a hex (`#7FD1FF`, `#7bf`), the explicit opt-outs `none` / `white`,
 * and nothing else. An unrecognised value — including a literal `auto` that
 * no one resolved to a hex upstream — falls back to white rather than
 * throwing: a caption colour is not worth failing a render over, and white is
 * always legible.
 */
export const resolveCaptionAccent = (captionColor?: string | null): CaptionAccent => {
	if (!captionColor) return null;
	const raw = captionColor.trim();
	if (!raw) return null;
	if (/^(none|white|off)$/i.test(raw)) return null;
	const rgb = parseHex(raw);
	if (!rgb) return null;
	return toHex(ensureLegible(rgb));
};
