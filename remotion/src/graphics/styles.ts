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
export type ChapterDesign = 'impactCard' | 'kicker' | 'newsBar' | 'prism' | 'handwritten';

export type GraphicStyleId = 'classic' | 'reportage' | 'editorial' | 'cinematic' | 'handwritten';

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
};

export const GRAPHIC_STYLES: Record<GraphicStyleId, GraphicStyle> = {
	classic: {id: 'classic', label: 'Classic', person: null, place: null, stat: false, chapter: 'impactCard', flash: false},
	reportage: {id: 'reportage', label: 'Reportage', person: 'sideRule', place: 'newsBar', stat: true, chapter: 'newsBar', flash: false},
	editorial: {id: 'editorial', label: 'Editorial', person: 'darkCard', place: 'darkCard', stat: true, chapter: 'kicker', flash: true},
	cinematic: {id: 'cinematic', label: 'Cinematic', person: 'sideRule', place: 'sideRule', stat: false, chapter: 'prism', flash: false},
	handwritten: {id: 'handwritten', label: 'Handwritten', person: 'darkCard', place: 'darkCard', stat: false, chapter: 'handwritten', flash: false},
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
	| {kind: 'stat'; sceneIndex: number; value: number; suffix?: string; label: string; caption?: string};
