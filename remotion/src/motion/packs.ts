/**
 * Motion packs: HOW the graphics move, per kind of film.
 *
 * The tone preset (style.ts) owns what the graphics look like — faces,
 * colours, grounds. A pack owns motion only: how captions arrive and mark the
 * spoken word, how a chapter title lands. The two are independent, so a
 * Documentary-toned Story film and an Epic-toned one share a pack and keep
 * their own look.
 *
 * `classic` is today's motion exactly, and it is what every film gets unless
 * a pack is named — by the render server from MOTION_PACKS and the film's
 * category, or by hand for a storyboard render. Nothing a film already looks
 * like changes because this file exists.
 *
 * Plan and status: docs/plans/motion-packs.md.
 */

export type CaptionMotion =
	/** Today's captions: the chunk swaps in place, the spoken word brightens. */
	| 'classic'
	/** Words rise in as they are spoken; the spoken word is underlined in the ink. */
	| 'editorial'
	/** Big uppercase words pop in; the spoken word sits on an ink pill. */
	| 'punch'
	/** The phrase sits in a translucent band, bottom left, behind an ink rule. */
	| 'lowerThird';

export type ChapterTitleMotion =
	/** Today's: each word rises and fades in. */
	| 'classic'
	/** Words fade in while their letter-spacing closes, like a title sequence. */
	| 'tracking'
	/** Words land from slightly too large, hard and fast. */
	| 'slam';

export type MotionPack = {
	id: string;
	/** Shown on storyboards and in the producer's picker. */
	label: string;
	captions: CaptionMotion;
	chapterTitle: ChapterTitleMotion;
};

export const PACKS: Record<string, MotionPack> = {
	classic: {id: 'classic', label: 'Classic (today)', captions: 'classic', chapterTitle: 'classic'},
	'story-editorial': {
		id: 'story-editorial',
		label: 'Story · Editorial',
		captions: 'editorial',
		chapterTitle: 'tracking',
	},
	'story-punch': {id: 'story-punch', label: 'Story · Punch', captions: 'punch', chapterTitle: 'slam'},
	'story-lowerthird': {
		id: 'story-lowerthird',
		label: 'Story · Lower third',
		captions: 'lowerThird',
		chapterTitle: 'classic',
	},
};

/** Unknown or absent → classic, never an error: a typo must not change a film. */
export const packFor = (id?: string | null): MotionPack => PACKS[String(id ?? '')] ?? PACKS.classic;
