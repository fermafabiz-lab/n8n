export type SceneCaption = {
	/** Narration text spoken during this scene (from Airtable "Script Scenă"). */
	narratorText: string;
	/** Seconds from the start of the assembled video where this scene begins. */
	startSeconds: number;
	/** Real duration of this scene's clip, in seconds (from the assemble step's ffprobe). */
	durationSeconds: number;
	/** Chapter number derived from "Ordine Scenă" (ord/100): 0 = hook, 1+ = chapters. */
	chapter?: number;
	/**
	 * Real narration length in seconds (measured by the assemble step).
	 * Captions pace words over this window, not over the silence-padded
	 * scene duration.
	 */
	speechSeconds?: number;
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
	/** "16:9" (landscape, default) or "9:16" (vertical/Shorts). */
	aspectRatio: string;
	/** Master switch for karaoke captions. */
	showCaptions: boolean;
	/**
	 * A hook line written FOR the screen, if Scripting produced one. Falls
	 * back to the project title — but that field holds a brief far more often
	 * than a title, so the card judges it before showing anything.
	 */
	hookTitle?: string;
	/** Individual overlay toggles — omitted/true keeps the element. */
	showHookTitle?: boolean;
	showChapterCards?: boolean;
	showEndScreen?: boolean;
	/** Chapter number -> real chapter title (from the script's [CHAPTER n: title] markers). */
	chapterTitles?: Record<string, string>;
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
	aspectRatio: '16:9',
	showCaptions: true,
	hookTitle: '',
	showHookTitle: true,
	showChapterCards: true,
	showEndScreen: true,
	chapterTitles: {},
};

/** Tone → visual language. Lowercased, diacritics-insensitive lookup. */
export const toneKey = (tone: string): string =>
	(tone || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
