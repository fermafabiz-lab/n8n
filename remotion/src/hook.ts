/**
 * The cold open — what Claude Scripting planned for the first seconds of the
 * film, and where those seconds end.
 *
 * Since 2026-09-11 the hook is a TEASER of several fast shots (every scene of
 * chapter 0, orders 1..99), not one eight-second scene under a title card.
 * Scripting chooses a style, writes one beat per shot, and stores the plan as
 * `Editing Options.hookPlan`; Final Assembly hands it here untouched. The
 * render's job is small and exact: know where the hook ends, draw the one
 * card a style asks for, and keep every other graphic off those shots.
 *
 * Everything in this file is pure so `npm run check:hook` can walk it without
 * React: the window a card occupies is the kind of thing that is right in a
 * still and wrong on the boundary frame.
 */

import type {SceneCaption} from './types';

export type HookStyle = 'teaser' | 'question' | 'figure' | 'slate' | 'action' | 'cliffhanger';

export const HOOK_STYLES: readonly HookStyle[] = [
	'teaser',
	'question',
	'figure',
	'slate',
	'action',
	'cliffhanger',
];

/** The styles whose beats are shot notes rather than narration. */
export const SILENT_HOOK_STYLES: readonly HookStyle[] = ['slate', 'action', 'cliffhanger'];

export type HookPlan = {
	style: HookStyle;
	/** Nothing is spoken over these shots; the film's first word is the story's. */
	silent: boolean;
	/** One line per shot, in order — narration for a spoken style, shot notes for a silent one. */
	beats: string[];
	/**
	 * The ONE card a style may put on screen. `question` sets line1 to the
	 * question; `figure` sets line1 to the number and line2 to what it counts;
	 * `slate` sets line1 to the place and line2 to the date. Every other style
	 * leaves it empty and draws nothing.
	 */
	card: {line1: string; line2: string; source: string};
	chosenBy?: 'ai' | 'producer';
};

/**
 * The plan as it arrives — through a model, a guard, jsonb and an n8n Code
 * node — read defensively. Anything malformed is `null`, and a null plan draws
 * nothing: a film made before the hook system existed must render exactly as
 * it did, and a broken plan must never take the render down.
 */
export const normalizeHookPlan = (raw: unknown): HookPlan | null => {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const style = String(r.style ?? '').trim().toLowerCase() as HookStyle;
	if (!HOOK_STYLES.includes(style)) return null;
	const beats = Array.isArray(r.beats)
		? r.beats.map((b) => String(b ?? '').trim()).filter(Boolean)
		: [];
	const c = r.card && typeof r.card === 'object' ? (r.card as Record<string, unknown>) : {};
	const line = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
	return {
		style,
		silent: r.silent === true || SILENT_HOOK_STYLES.includes(style),
		beats,
		card: {line1: line(c.line1), line2: line(c.line2), source: line(c.source)},
		chosenBy: r.chosenBy === 'producer' ? 'producer' : 'ai',
	};
};

/**
 * Where the hook ends: the start of the first story scene (chapter >= 1).
 *
 * Derived from the scenes and never from the plan, because the scenes carry
 * the timings the montage actually encoded — a plan says how many beats were
 * WRITTEN, the scene list says how many clips were MADE. A film whose first
 * scene is already chapter 1 has no hook and answers 0.
 */
export const hookEndSeconds = (scenes: SceneCaption[]): number => {
	for (const s of scenes) {
		if ((s.chapter ?? 0) >= 1) return s.startSeconds;
	}
	// Every scene is chapter 0 — a fixture, or a film that is only a hook.
	// Then nothing is "after" the hook, and no card should hold the frame.
	return 0;
};

export type HookCardWindow = {
	/** Seconds into the film the card is first drawn. */
	from: number;
	/** Seconds into the film the card is gone. */
	to: number;
};

/**
 * Enter and leave a little inside the flash-in and the hook boundary. The card
 * must be GONE before the chapter card's flare peaks on the first story frame,
 * or two full-frame text elements share the cut — the one-owner rule every
 * boundary in this render obeys.
 */
const CARD_LEAD_IN = 0.45;
const CARD_CLEAR_BEFORE_END = 0.55;
/** A card that would live shorter than this cannot be read; it is not drawn. */
const CARD_MIN_SECONDS = 1.6;
/** A question or a figure is read in a few seconds; a slate is held over its one shot. */
const CARD_MAX_SECONDS: Record<HookStyle, number> = {
	teaser: 0,
	action: 0,
	cliffhanger: 0,
	question: 4.2,
	figure: 4.2,
	slate: 6,
};

/**
 * When the plan's card is on screen, or null when this hook has no card —
 * because the style draws none, the text is empty, or the hook is too short
 * to hold one.
 */
export const hookCardWindow = (plan: HookPlan | null, hookEnd: number): HookCardWindow | null => {
	if (!plan || !plan.card.line1 || CARD_MAX_SECONDS[plan.style] <= 0) return null;
	if (!(hookEnd > 0)) return null;
	const from = CARD_LEAD_IN;
	const to = Math.min(hookEnd - CARD_CLEAR_BEFORE_END, from + CARD_MAX_SECONDS[plan.style]);
	if (to - from < CARD_MIN_SECONDS) return null;
	return {from, to};
};
