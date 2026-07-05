export type SceneCaption = {
	/** Narration text spoken during this scene (from Airtable "Script Scenă"). */
	narratorText: string;
	/** Seconds from the start of the assembled video where this scene begins. */
	startSeconds: number;
	/** Real duration of this scene's clip, in seconds (from fal ffmpeg metadata). */
	durationSeconds: number;
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
	/** URL of the video already stitched by fal ffmpeg-api/compose (Phase 1 input). */
	finalVideoUrl: string;
	projectTitle: string;
	scenes: SceneCaption[];
	palette: Palette;
	channelName: string;
	subscribeText: string;
	introDurationInSeconds: number;
	outroDurationInSeconds: number;
};

export const defaultFinalVideoProps: FinalVideoProps = {
	finalVideoUrl: '',
	projectTitle: 'Untitled Project',
	scenes: [],
	palette: DEFAULT_PALETTE,
	channelName: 'Your Channel',
	subscribeText: 'Subscribe for more',
	introDurationInSeconds: 2.5,
	outroDurationInSeconds: 3,
};
