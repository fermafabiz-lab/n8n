/**
 * Motion packs: HOW the graphics move.
 *
 * The tone preset (style.ts) owns what the graphics look like — faces,
 * colours, grounds. A pack owns motion only: how captions arrive and mark the
 * spoken word, how a chapter title lands. The two are independent, so a
 * Documentary-toned film and an Epic-toned one can share a pack and keep
 * their own look.
 *
 * The producer picks a pack per film, on the brief or in Final touches
 * (`Editing Options.motionPack`). When nothing is picked the category decides
 * (`DEFAULT_PACK_FOR_CATEGORY`): Story films get Editorial, the producer's
 * choice on 2026-09-24 after the first storyboard; every other category keeps
 * classic, today's motion exactly, until a pack is designed for it.
 *
 * The same four ids and the same defaults live in platform/lib/motion-packs.ts
 * (the site's picker) and in n8n's Build Remotion Props. Change one, change all
 * three — `npm run check:motion` pins the render side.
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
	| 'lowerThird'
	// Kids story (2026-09-26), from the catalog's caption-pill-karaoke,
	// caption-gradient-fill and caption-emoji-pop, in a rounded face:
	/** The phrase in a white pill; the spoken word turns a warm colour. */
	| 'kidsPill'
	/** Words bounce in as they are spoken; the spoken word is coloured and bigger. */
	| 'kidsBounce'
	/** Thick white-outlined words that squeeze in, like stickers. */
	| 'kidsSticker';

export type ChapterTitleMotion =
	/** Today's: each word rises and fades in. */
	| 'classic'
	/** Words fade in while their letter-spacing closes, like a title sequence. */
	| 'tracking'
	/** Words land from slightly too large, hard and fast. */
	| 'slam';

export type MotionPackId = 'classic' | 'editorial' | 'punch' | 'lowerThird' | 'kidsPill' | 'kidsBounce' | 'kidsSticker';

export type MotionPack = {
	id: MotionPackId;
	/** Shown on storyboards and in the producer's picker. */
	label: string;
	captions: CaptionMotion;
	chapterTitle: ChapterTitleMotion;
};

export const PACKS: Record<MotionPackId, MotionPack> = {
	classic: {id: 'classic', label: 'Classic', captions: 'classic', chapterTitle: 'classic'},
	editorial: {id: 'editorial', label: 'Editorial', captions: 'editorial', chapterTitle: 'tracking'},
	punch: {id: 'punch', label: 'Punch', captions: 'punch', chapterTitle: 'slam'},
	lowerThird: {id: 'lowerThird', label: 'Lower third', captions: 'lowerThird', chapterTitle: 'classic'},
	kidsPill: {id: 'kidsPill', label: 'Pill', captions: 'kidsPill', chapterTitle: 'classic'},
	kidsBounce: {id: 'kidsBounce', label: 'Bounce', captions: 'kidsBounce', chapterTitle: 'classic'},
	kidsSticker: {id: 'kidsSticker', label: 'Sticker', captions: 'kidsSticker', chapterTitle: 'classic'},
};

/** What a film gets when nobody picked a pack. Categories not listed: classic. */
export const DEFAULT_PACK_FOR_CATEGORY: Record<string, MotionPackId> = {
	story: 'editorial',
	// The producer's pick on 2026-09-26, from the three Kids styles.
	kids: 'kidsSticker',
};

/** The storyboard's first names, still accepted so old fixtures keep rendering. */
const ALIASES: Record<string, MotionPackId> = {
	'story-editorial': 'editorial',
	'story-punch': 'punch',
	'story-lowerthird': 'lowerThird',
	lowerthird: 'lowerThird',
};

const known = (id: unknown): MotionPackId | null => {
	const s = String(id ?? '').trim();
	if (!s) return null;
	if (s in PACKS) return s as MotionPackId;
	return ALIASES[s] ?? ALIASES[s.toLowerCase()] ?? null;
};

/**
 * The pack a film is drawn with: the one picked for it, else its category's
 * default, else classic. An unknown value is ignored rather than trusted — a
 * typo must never change how a film looks.
 */
export const packFor = (motionPack?: string | null, category?: string | null): MotionPack => {
	const picked = known(motionPack);
	if (picked) return PACKS[picked];
	const byCategory = DEFAULT_PACK_FOR_CATEGORY[String(category ?? '').trim().toLowerCase()];
	return PACKS[byCategory ?? 'classic'];
};
