/**
 * Sizing display type to the text it holds.
 *
 * Both title surfaces — the opening hook and the chapter card — carry a line
 * whose length is unknown until render time: a three-word chapter title and an
 * eight-word narration excerpt land on the same card. A fixed size can only be
 * right for one of them, and picking it for the long case is what made a short
 * chapter title sit tiny in the middle of an empty frame.
 *
 * Solving `chars per line` algebraically does not work either — words don't
 * split, so one long word wraps early and the estimate is off by a whole line.
 * The pass below is the same greedy wrap the browser will perform, run at
 * descending sizes until the block fits its line budget and its height.
 */

/** Words per line at a given size, by the greedy pass the browser makes. */
export const linesAtSize = (
	words: string[],
	advance: number,
	wrapWidth: number,
	size: number,
): number => {
	// A word space costs ~0.58 of an average glyph. Measured, not assumed: that
	// is 0.42em in Fraunces caps, far more than the 0.25em a body face uses, and
	// guessing the body-face number put a five-word title on four lines.
	const space = advance * size * 0.58;
	let lines = 1;
	let cur = -1;
	for (const w of words) {
		const ww = w.length * advance * size;
		// A word wider than the whole line does not occupy one line — both title
		// surfaces set `overflow-wrap: anywhere`, so the browser breaks it mid-word
		// across as many lines as it needs. Counting it as one made the fitter
		// approve a size that then overflowed and hyphenlessly split a word.
		if (ww > wrapWidth) {
			lines += (cur < 0 ? 0 : 1) + Math.ceil(ww / wrapWidth) - 1;
			cur = wrapWidth;
			continue;
		}
		if (cur < 0) {
			cur = ww;
		} else if (cur + space + ww <= wrapWidth) {
			cur += space + ww;
		} else {
			lines += 1;
			cur = ww;
		}
	}
	return lines;
};

export type TitleFit = {
	/** Words exactly as they will be set — already cased. */
	words: string[];
	/**
	 * Average glyph advance as a fraction of font size, for THIS face in THIS
	 * case. Lives on the preset (`titleAdvance`) because condensed faces sit at
	 * roughly half a serif's width and a shared guess is wrong for both.
	 */
	advance: number;
	/** Width a line may occupy, in px. Keep the safety margin inside it. */
	wrapWidth: number;
	maxSize: number;
	minSize: number;
	maxLines: number;
	/** The CSS line-height the block is set with. */
	lineHeight: number;
	/** Height the whole block may occupy, in px. */
	maxHeight: number;
};

/** Largest size at which the title fits both its line budget and its height. */
export const fitTitleSize = (o: TitleFit): number => {
	let fontSize = o.minSize;
	for (let s = o.maxSize; s >= o.minSize; s -= o.maxSize / 60) {
		const lines = linesAtSize(o.words, o.advance, o.wrapWidth, s);
		if (lines <= o.maxLines && lines * s * o.lineHeight <= o.maxHeight) {
			fontSize = s;
			break;
		}
	}
	return fontSize;
};
