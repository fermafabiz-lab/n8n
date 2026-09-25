import type {SceneCaption} from '../types';
import {VARIANT, VARIANTS, type TransitionStyleId, type VariantId} from './families';

/**
 * Which cuts of a film get a transition. Pure, so it can be checked without
 * rendering (scripts/check-transitions.mjs).
 *
 * Deliberately SPARSE. This repo once laid an effect over every cut (a
 * luminance dip) and it read as "the frames move badly, it looks like an
 * error" — see components/Transitions.tsx. A cut is already a change of
 * picture; a transition is punctuation, so it goes where a step up is worth
 * marking and no more often than MIN_GAP:
 *
 *   - never in the cold open (chapter 0) or on its last cut into chapter 1:
 *     the teaser's rhythm is its own;
 *   - never where something else already owns the cut — a full-frame chapter
 *     card or title, a text card, the hook card, a chapter flash (`blocked`);
 *   - never on a cut whose stills were not extracted (`stills`), because a
 *     transition without its picture would slide in black;
 *   - chapter changes first, then ordinary cuts, earliest first, each at
 *     least MIN_GAP from any other and with both scenes long enough to hold
 *     the window.
 */
export const MIN_GAP_SECONDS = 12;
/** Neither side of a cut may be shorter than this, so no shot is eaten whole. */
const MIN_SCENE_SECONDS = 2;

export type PlannedTransition = {
	/** Index of the incoming scene; the cut is at its startSeconds. */
	cut: number;
	at: number;
	from: number;
	to: number;
	variant: VariantId;
};

type Window = {from: number; to: number};
const overlaps = (a: Window, b: Window) => a.from < b.to && b.from < a.to;

export function planTransitions(o: {
	style: TransitionStyleId;
	scenes: SceneCaption[];
	blocked: Window[];
	/** Cut indices whose two stills exist; null means none were extracted. */
	stills: number[] | null;
	minGap?: number;
}): PlannedTransition[] {
	const {style, scenes, blocked} = o;
	if (style === 'none' || !o.stills || !o.stills.length) return [];
	const minGap = o.minGap ?? MIN_GAP_SECONDS;
	const have = new Set(o.stills);
	const variants = VARIANTS[style];
	// The longest window the family can open, so one rule fits every variant.
	const longest = Math.max(...variants.map((v) => VARIANT[v].length));

	const candidates: {cut: number; at: number; chapter: boolean}[] = [];
	for (let i = 1; i < scenes.length; i++) {
		const prev = scenes[i - 1];
		const s = scenes[i];
		if ((prev.chapter ?? 0) < 1 || (s.chapter ?? 0) < 1) continue;
		if (prev.durationSeconds < MIN_SCENE_SECONDS || s.durationSeconds < MIN_SCENE_SECONDS) continue;
		if (!have.has(i)) continue;
		const w = {from: s.startSeconds - longest, to: s.startSeconds + longest};
		if (blocked.some((b) => overlaps(b, w))) continue;
		candidates.push({cut: i, at: s.startSeconds, chapter: (prev.chapter ?? 0) !== (s.chapter ?? 0)});
	}

	const chosen: {cut: number; at: number}[] = [];
	const fits = (at: number) => chosen.every((c) => Math.abs(c.at - at) >= minGap);
	for (const c of candidates.filter((c) => c.chapter)) if (fits(c.at)) chosen.push(c);
	for (const c of candidates.filter((c) => !c.chapter)) if (fits(c.at)) chosen.push(c);
	chosen.sort((a, b) => a.at - b.at);

	return chosen.map((c, n) => {
		const variant = variants[n % variants.length];
		const v = VARIANT[variant];
		return {cut: c.cut, at: c.at, from: c.at - v.cutAt, to: c.at - v.cutAt + v.length, variant};
	});
}
