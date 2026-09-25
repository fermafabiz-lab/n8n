import React from 'react';
import {Sequence, useVideoConfig} from 'remotion';
import type {SceneCaption} from '../types';
import type {GraphicItem, GraphicStyle} from './styles';
import {LowerThird} from './LowerThird';
import {EditorialFlash, HandwrittenTitle, PrismTitle, StatOverlay} from './Overlays';
import {CharacterCard, Confetti, KidsTitle, NameCircle, SpeechBubble, Sticker} from './Kids';
import {CalmTitle, FilmTitle, GlitchTitle, Letterbox, OrganicLeak, Slate} from './Cine';

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
	| {kind: 'chapterTitle'; from: number; to: number; design: 'prism' | 'handwritten' | 'kidsTitle' | 'calm' | 'glitch'; title: string; kicker: string}
	| {kind: 'flash'; from: number; to: number}
	// Kids story
	| {kind: 'speech'; from: number; to: number; text: string; box?: [number, number, number, number]}
	| {kind: 'card'; from: number; to: number; title: string; image: string}
	| {kind: 'circle'; from: number; to: number; title: string; box: [number, number, number, number]}
	| {kind: 'sticker'; from: number; to: number; label: string}
	| {kind: 'confetti'; from: number; to: number}
	// Cinematic
	| {kind: 'filmTitle'; from: number; to: number; title: string; label?: string}
	| {kind: 'slate'; from: number; to: number; title: string; subtitle?: string}
	| {kind: 'letterbox'; from: number; to: number}
	| {kind: 'leak'; from: number; to: number};

/** Graphics that take the whole frame: captions and tags give way to them. */
export const FULL_FRAME_KINDS = new Set<PlacedGraphic['kind']>(['chapterTitle', 'card', 'filmTitle']);
const FULL_TITLES = new Set(['prism', 'handwritten', 'kidsTitle', 'calm', 'glitch']);
const FILM_TITLE_SECONDS = 4.3;
const CARD_MAX = 4.5;

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
	/** The film's name, for a style that opens on its title (Cinematic). */
	filmTitle?: string;
}): PlacedGraphic[] {
	const {style, items, scenes, chapterTitles, blocked} = o;
	const out: PlacedGraphic[] = [];
	const hasChapters = scenes.some((s) => (s.chapter ?? 0) >= 1);
	const inTeaser = (i: number) => hasChapters && (scenes[i]?.chapter ?? 1) === 0;
	const tags: Window[] = [];

	const firstStory = scenes.findIndex((sc) => (sc.chapter ?? 0) >= 1);
	const storyStart = firstStory >= 0 ? scenes[firstStory].startSeconds : 0;
	const filmEnd = scenes.length ? scenes[scenes.length - 1].startSeconds + scenes[scenes.length - 1].durationSeconds : 0;

	// A Cinematic film opens on its own title, over its first story shot; the
	// first chapter's title then gives way to it (two titles on one cut).
	const openedByTitle = !!(style.filmTitle && o.filmTitle && o.filmTitle.trim());
	if (openedByTitle) {
		out.push({kind: 'filmTitle', from: storyStart + 0.2, to: Math.min(filmEnd, storyStart + 0.2 + FILM_TITLE_SECONDS), title: o.filmTitle!.trim()});
	}
	if (style.letterbox && filmEnd > 0) out.push({kind: 'letterbox', from: 0, to: filmEnd});

	// Chapter openings first: they own their frames.
	if (style.chapter !== 'impactCard' || style.flash || style.leaks) {
		scenes.forEach((s, i) => {
			const ch = s.chapter ?? 0;
			if (ch < 1 || (i > 0 && (scenes[i - 1].chapter ?? 0) === ch)) return;
			const title = chapterTitles[String(ch)] || '';
			if (style.flash) out.push({kind: 'flash', from: Math.max(0, s.startSeconds - FLASH_HIT), to: s.startSeconds + 0.6});
			if (style.leaks && i !== firstStory) out.push({kind: 'leak', from: Math.max(0, s.startSeconds - 1.2), to: s.startSeconds + 1.2});
			if (openedByTitle && i === firstStory) return;
			if (FULL_TITLES.has(style.chapter)) {
				if (!title) return;
				out.push({
					kind: 'chapterTitle',
					from: s.startSeconds,
					to: s.startSeconds + CHAPTER_TITLE_SECONDS,
					design: style.chapter as 'prism' | 'handwritten' | 'kidsTitle' | 'calm' | 'glitch',
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

	const titleWindows = out.filter((p) => FULL_FRAME_KINDS.has(p.kind)) as Window[];
	let characters = 0;
	// A graphic starts `lead` into its scene — or, when a full-frame title or
	// card holds the start of the scene, just after it ends, as long as it
	// still fits inside the scene. The chapter's first scene would otherwise
	// never carry anything, and that is exactly where a character first appears.
	const inside = (s: SceneCaption, lead: number, max: number, min: number): Window | null => {
		const end = s.startSeconds + s.durationSeconds - 0.3;
		let from = s.startSeconds + lead;
		for (const b of [...blocked, ...titleWindows]) if (b.from <= from + 0.05 && b.to > from) from = b.to + 0.2;
		const w = {from, to: Math.min(from + max, end)};
		return w.to - w.from >= min ? w : null;
	};
	const free = (w: Window, alsoTags: boolean) =>
		![...blocked, ...titleWindows, ...(alsoTags ? tags : [])].some((b) => overlaps(b, w));
	for (const item of [...items].sort((a, b) => a.sceneIndex - b.sceneIndex)) {
		const s = scenes[item.sceneIndex];
		if (!s || inTeaser(item.sceneIndex)) continue;
		if (item.kind === 'celebrate') {
			if (!style.confetti) continue;
			const w = {from: s.startSeconds + 0.3, to: Math.min(filmEnd, s.startSeconds + 4.3)};
			if (w.to - w.from >= 2 && free(w, false)) out.push({kind: 'confetti', ...w});
			continue;
		}
		if (item.kind === 'character') {
			// Both designs on: the first character gets the card, the next the
			// contour, and so on — one introduction each, never both.
			const wantCard = style.characterCard && item.image && (!style.characterCircle || !item.box || characters % 2 === 0);
			const wantCircle = !wantCard && style.characterCircle && item.box;
			if (wantCard) {
				const w = inside(s, 0.3, CARD_MAX, 2.6);
				if (!w || !free(w, true)) continue;
				out.push({kind: 'card', ...w, title: item.title, image: item.image!});
				titleWindows.push(w);
				characters++;
			} else if (wantCircle) {
				const w = inside(s, 0.4, TAG_MAX, TAG_MIN);
				if (!w || !free(w, true)) continue;
				tags.push(w);
				out.push({kind: 'circle', ...w, title: item.title, box: item.box!});
				characters++;
			}
			continue;
		}
		if (item.kind === 'speech' || item.kind === 'moment' || item.kind === 'slate') {
			const on = item.kind === 'speech' ? style.speech : item.kind === 'moment' ? style.sticker : style.slate;
			if (!on) continue;
			const w = item.kind === 'moment' ? inside(s, 0.8, 3.8, 2.2) : inside(s, item.kind === 'slate' ? 0.3 : 0.5, TAG_MAX, TAG_MIN);
			if (!w || !free(w, true)) continue;
			tags.push(w);
			if (item.kind === 'speech') out.push({kind: 'speech', ...w, text: item.text, box: item.box});
			else if (item.kind === 'moment') out.push({kind: 'sticker', ...w, label: item.label});
			else out.push({kind: 'slate', ...w, title: item.title, subtitle: item.subtitle});
			continue;
		}
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
							<LowerThird design={p.design} title={p.title} subtitle={p.subtitle} accent={accent} portrait={portrait} chapter />
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
						{p.kind === 'chapterTitle' && p.design === 'prism' && <PrismTitle title={p.title} kicker={p.kicker} accent={accent} portrait={portrait} />}
						{p.kind === 'chapterTitle' && p.design === 'handwritten' && <HandwrittenTitle title={p.title} kicker={p.kicker} accent={accent} portrait={portrait} />}
						{p.kind === 'chapterTitle' && p.design === 'kidsTitle' && <KidsTitle title={p.title} accent={accent} portrait={portrait} />}
						{p.kind === 'chapterTitle' && p.design === 'calm' && <CalmTitle title={p.title} kicker={p.kicker.toUpperCase()} portrait={portrait} />}
						{p.kind === 'chapterTitle' && p.design === 'glitch' && <GlitchTitle title={p.title.toUpperCase()} kicker={p.kicker.toUpperCase()} portrait={portrait} />}
						{p.kind === 'flash' && <EditorialFlash hitAt={FLASH_HIT} />}
						{p.kind === 'speech' && <SpeechBubble text={p.text} box={p.box} portrait={portrait} />}
						{p.kind === 'card' && <CharacterCard title={p.title} image={p.image} portrait={portrait} />}
						{p.kind === 'circle' && <NameCircle title={p.title} box={p.box} />}
						{p.kind === 'sticker' && <Sticker label={p.label} accent={accent} portrait={portrait} />}
						{p.kind === 'confetti' && <Confetti />}
						{p.kind === 'filmTitle' && <FilmTitle title={p.title.toUpperCase()} label={p.label} portrait={portrait} />}
						{p.kind === 'slate' && <Slate title={p.title.toUpperCase()} subtitle={p.subtitle?.toUpperCase()} portrait={portrait} />}
						{p.kind === 'letterbox' && <Letterbox />}
						{p.kind === 'leak' && <OrganicLeak />}
					</Sequence>
				);
			})}
		</>
	);
};
