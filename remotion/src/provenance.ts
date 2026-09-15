/**
 * What the source watermark prints — the render's half of visual provenance.
 *
 * Deliberately a LOOKUP and nothing else. The classification is made once, on
 * the site (platform/lib/provenance.ts), stored on the scene, and handed to the
 * render in the props; nothing here decides what a picture is. That separation
 * is the whole reason the label can be trusted: a renderer that re-derived
 * provenance could disagree with the record the producer approved.
 *
 * The labels, `providerLabel`, `formatSourceWatermark` and `attributionFor` are
 * mirrored from platform/lib/provenance.ts — two packages, no shared module,
 * the same rule `normalizeSpeed` lives under. Change one, change both, and
 * `npm run check:watermark` in each pins the table.
 */

export type VisualOrigin =
	| 'ai_generated'
	| 'ai_reconstruction'
	| 'actual_footage'
	| 'illustrative_footage'
	| 'archival_footage'
	| 'archival_photo'
	| 'real_stock'
	| 'unknown';

/**
 * Everything the badge can be built from, exactly as `hov.at_scene` emits it
 * (db/009) and `Source Watermark` in Final Assembly copies it.
 */
export type VisualProvenance = {
	visualOrigin: VisualOrigin;
	/** Free string: "wikimedia", "internet_archive", "reuters", "producer_upload"… */
	provider?: string;
	sourceTitle?: string;
	sourceUrl?: string;
	sourceCreator?: string;
	/** The date of the ORIGINAL as a person stated it — never a catalogue's. */
	originalDate?: string;
	originalLocation?: string;
	eventName?: string;
	isExactEventMatch?: boolean;
	rightsStatus?: string;
	licenseName?: string;
	/** The licence demands a credit — see `attributionFor`. */
	attributionRequired?: boolean;
	attributionText?: string;
	provenanceConfidence?: number;
	manuallyVerified?: boolean;
};

export const ORIGIN_LABELS: Record<VisualOrigin, string> = {
	ai_generated: 'AI GENERATED',
	ai_reconstruction: 'AI RECONSTRUCTION',
	actual_footage: 'ACTUAL FOOTAGE',
	illustrative_footage: 'ILLUSTRATIVE FOOTAGE',
	archival_footage: 'ARCHIVAL FOOTAGE',
	archival_photo: 'ARCHIVAL PHOTO',
	real_stock: 'REAL FOOTAGE',
	// Never "ACTUAL FOOTAGE", and never nothing: on a documentary, saying
	// nothing about a picture's origin reads as a claim that it is real.
	unknown: 'SOURCE UNVERIFIED',
};

// In lockstep with platform/lib/provenance.ts — the site's chips and the
// film's watermark must name a source the same way.
const PROVIDER_LABELS: Record<string, string> = {
	wikimedia: 'Wikimedia Commons',
	eu_av: 'EU Audiovisual Service',
	dvids: 'DVIDS',
	nasa: 'NASA',
	internet_archive: 'Internet Archive',
	europeana: 'Europeana',
	loc: 'Library of Congress',
	wellcome: 'Wellcome Collection',
	flickr: 'Flickr',
	openverse: 'Openverse',
	pexels: 'Pexels',
	pixabay: 'Pixabay',
	unsplash: 'Unsplash',
	destockd: 'Destockd',
	url_import: 'URL import',
	user_upload: 'Manual upload',
};

/**
 * A provider's display name. Unknown providers are title-cased rather than
 * dropped, so a new archive reads correctly the day it appears with no code
 * change here.
 */
export const providerLabel = (provider?: string | null): string | null => {
	const raw = String(provider ?? '').trim();
	if (!raw) return null;
	const known = PROVIDER_LABELS[raw.toLowerCase()];
	if (known) return known;
	return raw
		.replace(/[_-]+/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
		.join(' ');
};

/**
 * A creator string fit to print.
 *
 * Wikimedia Commons answers the author field with the wiki TEMPLATE that
 * renders it, so a real photographer arrives as "Template:Helmut Laux" —
 * measured on the Bundesarchiv photo of Stalin and Ribbentrop, which is CC BY-SA
 * and therefore one whose credit we are obliged to print correctly.
 */
const cleanCreator = (v?: string | null): string => String(v ?? '').trim().replace(/^Template:\s*/i, '');

export const getSourceLabel = (p?: VisualProvenance | null): string => {
	const o = p?.visualOrigin;
	return (o && ORIGIN_LABELS[o]) || ORIGIN_LABELS.unknown;
};

/**
 * The badge: a label, and the smaller line under it when — and only when —
 * somebody actually stated who, where or when.
 *
 * The archive's own date is not a source for this. It is the upload date often
 * enough (Commons dates a 1969 NASA reel 2015-06-12) that printing it would be
 * publishing a guess as a fact, on the one overlay whose entire job is telling
 * the truth about the picture.
 */
export const formatSourceWatermark = (
	p?: VisualProvenance | null,
): {label: string; source: string | null} => {
	const label = getSourceLabel(p);
	if (!p) return {label, source: null};
	const who = cleanCreator(p.sourceCreator) || providerLabel(p.provider);
	const parts = [who, String(p.originalLocation ?? '').trim(), String(p.originalDate ?? '').trim()].filter(
		(v): v is string => Boolean(v),
	);
	return {label, source: parts.length ? `Source: ${parts.join(' · ')}` : null};
};

/**
 * The credit a licence OBLIGES us to print, or null.
 *
 * Drawn whether or not the watermark is switched on — that is the point of it
 * being a separate function and a separate element. See
 * docs/source-watermark-license-separation.md.
 */
export const attributionFor = (p?: VisualProvenance | null): string | null => {
	if (!p) return null;
	const ready = String(p.attributionText ?? '').trim();
	if (ready) return ready;
	if (!p.attributionRequired) return null;
	const parts = [
		cleanCreator(p.sourceCreator),
		providerLabel(p.provider),
		String(p.licenseName ?? '').trim(),
	].filter((v): v is string => Boolean(v));
	return parts.length ? parts.join(' · ') : null;
};

/**
 * Where the badge sits and how big it is — the one owner of those numbers.
 *
 * They lived inline in `SourceWatermark.tsx` until the site grew a PREVIEW of
 * this overlay (`platform/components/WatermarkPreview.tsx`). A preview whose
 * geometry is copied out of JSX is a preview that silently stops matching the
 * film the first time someone nudges a padding, and the whole point of it is
 * to be trusted. So the numbers are named here, consumed by the component,
 * and mirrored once in `platform/lib/provenance.ts` — pinned on both sides by
 * `npm run check:watermark` here and `npm run check:footage` there.
 *
 * Every value is in FRAME pixels, and the frame is 1280×720 (or 720×1280
 * portrait) — the render's real size, not 1080p; see Root.tsx on why. A
 * preview therefore draws the badge at these exact sizes inside a frame of
 * `frame`, and scales the whole frame down, rather than scaling each number.
 */
export type WatermarkGeometry = {
	frame: {width: number; height: number};
	/** Distance from the frame's left edge and bottom edge to the stack. */
	left: number;
	bottom: number;
	maxWidth: number;
	/** Between the label, the source line and the credit. */
	gap: number;
	label: {fontSize: number; padding: string};
	source: {fontSize: number};
	credit: {fontSize: number};
};

export const WATERMARK_LAYOUT: {
	landscape: WatermarkGeometry;
	portrait: WatermarkGeometry;
} = {
	landscape: {
		frame: {width: 1280, height: 720},
		left: 90,
		bottom: 30,
		maxWidth: 700,
		gap: 3,
		label: {fontSize: 16, padding: '5px 12px'},
		source: {fontSize: 13},
		credit: {fontSize: 12},
	},
	portrait: {
		frame: {width: 720, height: 1280},
		// Lifted clear of the platform's own bottom chrome, and of the captions
		// that are bottom-anchored at 280.
		left: 44,
		bottom: 232,
		maxWidth: 560,
		gap: 3,
		label: {fontSize: 17, padding: '5px 11px'},
		source: {fontSize: 14},
		credit: {fontSize: 13},
	},
};

/** The colours and weights, shared by both orientations. Mirrored with the above. */
export const WATERMARK_STYLE = {
	/** The badge never reaches full opacity — it is a claim, not a headline. */
	peakOpacity: 0.88,
	labelWeight: 600,
	labelLetterSpacing: '0.14em',
	labelColor: '#FFFFFF',
	labelBackground: 'rgba(0,0,0,0.42)',
	labelBorder: '1px solid rgba(255,255,255,0.16)',
	labelRadius: 6,
	labelLineHeight: 1.2,
	sourceLetterSpacing: '0.05em',
	sourceColor: 'rgba(255,255,255,0.9)',
	creditLetterSpacing: '0.04em',
	creditColor: 'rgba(255,255,255,0.82)',
	lineBackground: 'rgba(0,0,0,0.34)',
	lineRadius: 5,
	linePadding: '3px 9px',
	lineLineHeight: 1.25,
	textShadow: '0 2px 8px rgba(0,0,0,0.75)',
} as const;

/**
 * The scene bands the watermark is drawn over.
 *
 * Consecutive scenes carrying the SAME badge are merged into one band, so a
 * documentary that runs six archive scenes together shows one steady label
 * instead of six identical ones blinking apart and back at every cut — while a
 * change from ARCHIVAL FOOTAGE to AI GENERATED still fades, which is the one
 * moment the viewer needs to notice it.
 */
export type WatermarkBand = {
	startSeconds: number;
	endSeconds: number;
	label: string;
	source: string | null;
	credit: string | null;
};

export const planWatermarkBands = (
	scenes: {startSeconds: number; durationSeconds: number; provenance?: VisualProvenance}[],
	opts: {showLabel: boolean},
): WatermarkBand[] => {
	const bands: WatermarkBand[] = [];
	for (const s of scenes) {
		const p = s.provenance;
		if (!p) continue;
		const {label, source} = formatSourceWatermark(p);
		const credit = attributionFor(p);
		// With the label switched off only the licence obligation remains, so a
		// scene that owes nothing draws nothing at all.
		if (!opts.showLabel && !credit) continue;
		const band: WatermarkBand = {
			startSeconds: s.startSeconds,
			endSeconds: s.startSeconds + s.durationSeconds,
			label: opts.showLabel ? label : '',
			source: opts.showLabel ? source : null,
			credit,
		};
		const prev = bands[bands.length - 1];
		if (
			prev &&
			Math.abs(prev.endSeconds - band.startSeconds) < 1e-6 &&
			prev.label === band.label &&
			prev.source === band.source &&
			prev.credit === band.credit
		) {
			prev.endSeconds = band.endSeconds;
			continue;
		}
		bands.push(band);
	}
	return bands;
};
