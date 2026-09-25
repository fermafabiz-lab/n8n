/**
 * Graphic styles: WHICH graphics a film carries over its footage — the name
 * tags, place stamps, animated figures and chapter titles — and in which
 * design. Chosen per film by theme, not by category (the producer's call,
 * 2026-09-24: "Story is vast in themes, so according to the theme any of them
 * would go"). "AI picks" resolves to one of these before the render.
 *
 * Each element is modelled on a Hyperframes catalog block the producer picked
 * from the sampler reel (remotion/out/sampler, numbers in brackets):
 *   side rule [01], dark card [02], kicker [03], news bar [04],
 *   count-up stat [05], handwritten title [06], prism title [07],
 *   editorial flash [08].
 *
 * `classic` draws none of them: today's film, full-screen chapter card and all.
 *
 * Plan and status: docs/plans/motion-packs.md ("Graphic styles").
 */

export type LowerThirdDesign = 'sideRule' | 'darkCard' | 'kicker' | 'newsBar';
export type ChapterDesign = 'impactCard' | 'kicker' | 'newsBar' | 'prism' | 'handwritten' | 'kidsTitle' | 'calm' | 'glitch';

export type GraphicStyleId =
	| 'classic'
	// Story and Documentary (2026-09-24)
	| 'reportage'
	| 'editorial'
	| 'cinematic'
	| 'handwritten'
	// Kids story (2026-09-25, remotion/out/sampler/kids-reel.mp4)
	| 'kidsStorybook'
	| 'kidsPlayful'
	| 'kidsAll'
	// Cinematic films — silent, so no tags or figures (sampler cine-reel.mp4)
	| 'cineFilm'
	| 'cineNeon'
	| 'cineMemory';

export type GraphicStyle = {
	id: GraphicStyleId;
	label: string;
	/** Who someone is. */
	person: LowerThirdDesign | null;
	/** Where (and when) we are. */
	place: LowerThirdDesign | null;
	/** A spoken figure drawn over the footage as a count-up. */
	stat: boolean;
	/** How a chapter opens. impactCard is today's full-screen card. */
	chapter: ChapterDesign;
	/** A white editorial flash on each chapter cut. */
	flash: boolean;
	// Kids story [kids-reel 02-06].
	/** A hand-drawn speech bubble near the speaker, with a line they say. */
	speech?: boolean;
	/** A character's first appearance as a still in a hand-drawn frame. */
	characterCard?: boolean;
	/** A wobbly contour drawn around a character, with its name. */
	characterCircle?: boolean;
	/** A sticker that pops on a moment ("Clue found!"). */
	sticker?: boolean;
	/** A confetti burst on the happy ending. */
	confetti?: boolean;
	// Cinematic [cine-reel C1-C4].
	/** The film's own title over its first shot. */
	filmTitle?: boolean;
	/** A typed location / time slate where a sequence opens. */
	slate?: boolean;
	/** 2.39:1 bars over the whole film. */
	letterbox?: boolean;
	/** A warm organic light leak on each chapter change. */
	leaks?: boolean;
};

export const GRAPHIC_STYLES: Record<GraphicStyleId, GraphicStyle> = {
	classic: {id: 'classic', label: 'Classic', person: null, place: null, stat: false, chapter: 'impactCard', flash: false},
	reportage: {id: 'reportage', label: 'Reportage', person: 'sideRule', place: 'newsBar', stat: true, chapter: 'newsBar', flash: false},
	editorial: {id: 'editorial', label: 'Editorial', person: 'darkCard', place: 'darkCard', stat: true, chapter: 'kicker', flash: true},
	cinematic: {id: 'cinematic', label: 'Cinematic', person: 'sideRule', place: 'sideRule', stat: false, chapter: 'prism', flash: false},
	handwritten: {id: 'handwritten', label: 'Handwritten', person: 'darkCard', place: 'darkCard', stat: false, chapter: 'handwritten', flash: false},
	kidsStorybook: {id: 'kidsStorybook', label: 'Storybook', person: null, place: null, stat: false, chapter: 'kidsTitle', flash: false, characterCard: true, confetti: true},
	kidsPlayful: {id: 'kidsPlayful', label: 'Playful', person: null, place: null, stat: false, chapter: 'impactCard', flash: false, speech: true, characterCircle: true, sticker: true, confetti: true},
	kidsAll: {id: 'kidsAll', label: 'Everything', person: null, place: null, stat: false, chapter: 'kidsTitle', flash: false, speech: true, characterCard: true, characterCircle: true, sticker: true, confetti: true},
	cineFilm: {id: 'cineFilm', label: 'Film', person: null, place: null, stat: false, chapter: 'calm', flash: false, filmTitle: true, slate: true, letterbox: true},
	cineNeon: {id: 'cineNeon', label: 'Neon', person: null, place: null, stat: false, chapter: 'glitch', flash: false, filmTitle: true, slate: true, letterbox: true},
	cineMemory: {id: 'cineMemory', label: 'Memory', person: null, place: null, stat: false, chapter: 'calm', flash: false, filmTitle: true, leaks: true},
};

/** Unknown or absent → classic: a typo must never restyle a film. */
export const graphicStyleFor = (id?: string | null): GraphicStyle =>
	GRAPHIC_STYLES[String(id ?? '') as GraphicStyleId] ?? GRAPHIC_STYLES.classic;

/**
 * One graphic the pipeline wants on screen, anchored to a scene by index (the
 * render's own scene list) — the same anchoring the drawn cards use.
 */
export type GraphicItem =
	| {kind: 'person'; sceneIndex: number; title: string; subtitle?: string}
	| {kind: 'place'; sceneIndex: number; title: string; subtitle?: string}
	| {kind: 'stat'; sceneIndex: number; value: number; suffix?: string; label: string; caption?: string}
	/** Where a character is in the frame, normalised [x, y, w, h] 0-1. */
	| {kind: 'character'; sceneIndex: number; title: string; box?: [number, number, number, number]; image?: string}
	| {kind: 'speech'; sceneIndex: number; text: string; box?: [number, number, number, number]}
	| {kind: 'moment'; sceneIndex: number; label: string}
	| {kind: 'celebrate'; sceneIndex: number}
	| {kind: 'slate'; sceneIndex: number; title: string; subtitle?: string};
