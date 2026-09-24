import React from 'react';
import {Sequence, useVideoConfig} from 'remotion';
import type {SceneCaption} from '../types';
import type {GraphicItem, GraphicStyle} from './styles';
import {LowerThird} from './LowerThird';
import {EditorialFlash, HandwrittenTitle, PrismTitle, StatOverlay} from './Overlays';

/** How long a full-frame chapter title holds — the impact card's own window. */
export const CHAPTER_TITLE_SECONDS = 2.8;
const TAG_MAX = 4.8;
const TAG_MIN = 2.2;
const STAT_MAX = 5;
const STAT_MIN = 3;
/** When the flash's brightest frame lands, from its window start. */
const FLASH_HIT = 0.25;

type Window = {from: number; to: number};
const overlaps = (a: Window, b: Window) => a.from < b.to && b.from < a.to;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export type PlacedGraphic =
	| {kind: 'tag'; from: number; to: number; design: NonNullable<GraphicStyle['person']>; title: string; subtitle?: string}
	| {kind: 'stat'; from: number; to: number; item: Extract<GraphicItem, {kind: 'stat'}>}
	| {kind: 'chapterTag'; from: number; to: number; design: 'kicker' | 'newsBar'; title: string; subtitle: string}
	| {kind: 'chapterTitle'; from: number; to: number; design: 'prism' | 'handwritten'; title: string; kicker: string}
	| {kind: 'flash'; from: number; to: number};

/**
 * Where every graphic of a style goes, in seconds. Pure — no React — so the
 * placement can be checked without rendering (scripts/check-graphics.mjs).
 *
 * The rules, each from docs/lessons-render.md or the producer:
 *   - nothing over the cold open (chapter 0): the teaser is its own statement;
 *   - nothing over a full-frame card (`blocked`), which replaces the picture;
 *   - one tag at a time — a second one on the same stretch is dropped, not
 *     stacked;
 *   - a tag or stat fits inside its scene, with air at both ends, or is not
 *     drawn: a graphic that outlives the shot it names labels the wrong shot;
 *   - chapter titles sit on the chapter's first frame, where the cut is.
 */
export function placeGraphics(o: {
	style: GraphicStyle;
	items: GraphicItem[];
	scenes: SceneCaption[];
	chapterTitles: Record<string, string>;
	blocked: Window[];
}): PlacedGraphic[] {
	const {style, items, scenes, chapterTitles, blocked} = o;
	const out: PlacedGraphic[] = [];
	const hasChapters = scenes.some((s) => (s.chapter ?? 0) >= 1);
	const inTeaser = (i: number) => hasChapters && (scenes[i]?.chapter ?? 1) === 0;
	const tags: Window[] = [];

	// Chapter openings first: they own their frames.
	if (style.chapter !== 'impactCard' || style.flash) {
		scenes.forEach((s, i) => {
			const ch = s.chapter ?? 0;
			if (ch < 1 || (i > 0 && (scenes[i - 1].chapter ?? 0) === ch)) return;
			const title = chapterTitles[String(ch)] || '';
			if (style.flash) out.push({kind: 'flash', from: Math.max(0, s.startSeconds - FLASH_HIT), to: s.startSeconds + 0.6});
			if (style.chapter === 'prism' || style.chapter === 'handwritten') {
				if (!title) return;
				out.push({
					kind: 'chapterTitle',
					from: s.startSeconds,
					to: s.startSeconds + CHAPTER_TITLE_SECONDS,
					design: style.chapter,
					title,
					kicker: `Chapter ${ROMAN[ch] ?? ch}`,
				});
			} else if (style.chapter === 'kicker' || style.chapter === 'newsBar') {
				if (!title) return;
				const w = {from: s.startSeconds + 0.2, to: s.startSeconds + Math.min(TAG_MAX, s.durationSeconds - 0.3)};
				if (w.to - w.from < TAG_MIN || blocked.some((b) => overlaps(b, w))) return;
				tags.push(w);
				out.push({kind: 'chapterTag', ...w, design: style.chapter, title, subtitle: `Chapter ${ROMAN[ch] ?? ch}`});
			}
		});
	}

	const titleWindows = out.filter((p) => p.kind === 'chapterTitle') as Window[];
	for (const item of [...items].sort((a, b) => a.sceneIndex - b.sceneIndex)) {
		const s = scenes[item.sceneIndex];
		if (!s || inTeaser(item.sceneIndex)) continue;
		if (item.kind === 'stat') {
			if (!style.stat) continue;
			const w = {from: s.startSeconds + 0.4, to: s.startSeconds + Math.min(STAT_MAX, s.durationSeconds - 0.4)};
			if (w.to - w.from < STAT_MIN) continue;
			if ([...blocked, ...titleWindows].some((b) => overlaps(b, w))) continue;
			out.push({kind: 'stat', ...w, item});
			continue;
		}
		const design = item.kind === 'person' ? style.person : style.place;
		if (!design) continue;
		const w = {from: s.startSeconds + 0.6, to: s.startSeconds + Math.min(TAG_MAX, s.durationSeconds - 0.4)};
		if (w.to - w.from < TAG_MIN) continue;
		if ([...blocked, ...titleWindows, ...tags].some((b) => overlaps(b, w))) continue;
		tags.push(w);
		out.push({kind: 'tag', ...w, design, title: item.title, subtitle: item.subtitle});
	}
	return out.sort((a, b) => a.from - b.from);
}

export const GraphicsLayer: React.FC<{
	placed: PlacedGraphic[];
	accent: string;
	portrait: boolean;
}> = ({placed, accent, portrait}) => {
	const {fps} = useVideoConfig();
	return (
		<>
			{placed.map((p, i) => {
				const from = Math.round(p.from * fps);
				const dur = Math.max(1, Math.round((p.to - p.from) * fps));
				return (
					<Sequence key={`g-${i}-${from}`} from={from} durationInFrames={dur}>
						{p.kind === 'tag' && <LowerThird design={p.design} title={p.title} subtitle={p.subtitle} accent={accent} portrait={portrait} />}
						{p.kind === 'chapterTag' && (
							<LowerThird design={p.design} title={p.title} subtitle={p.subtitle} accent={accent} portrait={portrait} />
						)}
						{p.kind === 'stat' && (
							<StatOverlay
								value={p.item.value}
								suffix={p.item.suffix}
								label={p.item.label}
								caption={p.item.caption}
								accent={accent}
								portrait={portrait}
							/>
						)}
						{p.kind === 'chapterTitle' &&
							(p.design === 'prism' ? (
								<PrismTitle title={p.title} kicker={p.kicker} accent={accent} />
							) : (
								<HandwrittenTitle title={p.title} kicker={p.kicker} accent={accent} />
							))}
						{p.kind === 'flash' && <EditorialFlash hitAt={FLASH_HIT} />}
					</Sequence>
				);
			})}
		</>
	);
};
