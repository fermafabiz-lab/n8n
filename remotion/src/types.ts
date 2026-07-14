export type SceneCaption = {
	/** Narration text spoken during this scene (from Airtable "Script Scenă"). */
	narratorText: string;
	/** Seconds from the start of the assembled video where this scene begins. */
	startSeconds: number;
	/** Real duration of this scene's clip, in seconds (from the assemble step's ffprobe). */
	durationSeconds: number;
	/** Chapter number derived from "Ordine Scenă" (ord/100): 0 = hook, 1+ = chapters. */
	chapter?: number;
};

export type Palette = {
	primary: string;
	secondary: string;
	background: string;
	text: string;
};

export const DEFAULT_PALETTE: Palette = {
	primary: '#E8B84B',
	secondary: '#1C1C24',
	background: '#0B0B0F',
	text: '#F5F5F0',
};

export type FinalVideoProps = {
	/** URL of the ffmpeg-assembled video (voices already aligned per scene). */
	finalVideoUrl: string;
	projectTitle: string;
	scenes: SceneCaption[];
	palette: Palette;
	channelName: string;
	subscribeText: string;
	/** Project tone (Tonalitate) — drives color grade and transition style. */
	tone: string;
	/**
	 * Kept for compatibility; the intro card was replaced by the hook title
	 * overlay (the video now starts on frame 1), so this defaults to 0.
	 */
	introDurationInSeconds: number;
	outroDurationInSeconds: number;
	/** How long the cinematic title stays over the hook scene. */
	hookTitleDurationInSeconds: number;
};

export const defaultFinalVideoProps: FinalVideoProps = {
	finalVideoUrl: '',
	projectTitle: 'Untitled Project',
	scenes: [],
	palette: DEFAULT_PALETTE,
	channelName: 'Video Factory',
	subscribeText: 'Subscribe for more',
	tone: 'Dark',
	introDurationInSeconds: 0,
	outroDurationInSeconds: 4,
	hookTitleDurationInSeconds: 3.5,
};

/** Tone → visual language. Lowercased, diacritics-insensitive lookup. */
export const toneKey = (tone: string): string =>
	(tone || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
