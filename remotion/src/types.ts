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
	/**
	 * Evidence ref (E1..E20) this scene's narration leans on, as validated by
	 * `Validate Evidence Refs` in Claude Scripting. Present only on researched
	 * projects; a ref that survived validation is guaranteed to exist in the
	 * pack, so a card built from it can never cite something invented.
	 */
	evidenceRef?: string;
};

/**
 * One row of the Evidence pack (Airtable table `Evidence`, tblU26cUiQQV2eNdg),
 * as Claude Scripting wrote it. The source and date are the reason a claim card
 * is worth showing — the narration never says them aloud.
 */
export type EvidenceClaim = {
	/** E1..E20, matching a scene's `evidenceRef`. */
	ref: string;
	claim: string;
	source: string;
	date?: string;
	url?: string;
};

/**
 * A full-frame text card the montage can cut to. Normally derived in code from
 * the evidence pack or from a figure the narration speaks (see
 * `src/textCards.ts`); supplied explicitly only when something upstream
 * authored it on purpose, which bypasses every derivation gate.
 */
export type TextCardSpec = {
	/** The scene whose narration this card belongs with. */
	sceneIndex: number;
	variant: 'claim' | 'figure';
	/** The line the card is built around: the claim, or the figure itself. */
	headline: string;
	/** What a figure quantifies. Meaningless on a claim card. */
	kicker?: string;
	/** "SOURCE · 1923". The whole point of a claim card. */
	attribution?: string;
	/** How long it needs to be read. */
	seconds: number;
	/**
	 * Shortest it may be squeezed to and still be readable. A claim card is long
	 * by nature and rarely fits a 4-5s scene at full length; without a floor to
	 * shrink to, every one of them was silently dropped.
	 */
	minSeconds: number;
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
	 * How hard the montage cuts: 0 leaves every scene whole (the pre-montage
	 * behaviour), 1 is the default, 2 is aggressive. Omitted = derived from
	 * the tone's editing energy.
	 */
	montageIntensity?: 0 | 1 | 2;
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
	/**
	 * The project's Evidence rows. Cards are built from these, so a researched
	 * project shows its sources on screen instead of only in Airtable. Absent
	 * on fiction projects, which then fall back to figure cards or none.
	 */
	evidence?: EvidenceClaim[];
	/**
	 * Cards authored upstream. Supplying these replaces derivation entirely —
	 * a deliberate card always beats a guessed one.
	 */
	textCards?: TextCardSpec[];
	/** Master switch for text cards. Omitted/true keeps them. */
	showTextCards?: boolean;
	/**
	 * Whether `scenes[].narratorText` is ever HEARD.
	 *
	 * False on a cinematic (silent) project, where that field holds an unspoken
	 * visual beat sheet — stage directions — rather than narration. Three
	 * surfaces read it as if it were spoken and each puts the beat sheet on
	 * screen when it is not: captions print it, the chapter card borrows its
	 * first eight words as a title, and a text card lifts figures out of it.
	 * Captions were the only one the producer could see, which is why the other
	 * two survived so long.
	 *
	 * Omitted/true keeps every existing project rendering exactly as before.
	 */
	narrationIsSpoken?: boolean;
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
	narrationIsSpoken: true,
};

/** Tone → visual language. Lowercased, diacritics-insensitive lookup. */
export const toneKey = (tone: string): string =>
	(tone || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
