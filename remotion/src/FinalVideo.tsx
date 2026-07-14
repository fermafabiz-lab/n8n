import React from 'react';
import {
	AbsoluteFill,
	OffthreadVideo,
	Sequence,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {HookTitle} from './components/HookTitle';
import {ChapterMarker} from './components/ChapterMarker';
import {OutroCard} from './components/OutroCard';
import {ProgressBar} from './components/ProgressBar';
import {Captions} from './components/Captions';
import {FilmLayer, gradeForTone} from './components/FilmLayer';
import {Transitions, kenBurnsTransform} from './components/Transitions';
import type {FinalVideoProps} from './types';

export const FinalVideo: React.FC<FinalVideoProps> = ({
	finalVideoUrl,
	projectTitle,
	scenes,
	palette,
	channelName,
	subscribeText,
	tone,
	outroDurationInSeconds,
	hookTitleDurationInSeconds,
}) => {
	const {fps} = useVideoConfig();
	const frame = useCurrentFrame();
	const seconds = frame / fps;

	const videoDurationSeconds = scenes.length
		? scenes[scenes.length - 1].startSeconds + scenes[scenes.length - 1].durationSeconds
		: 0;
	const videoFrames = Math.round(videoDurationSeconds * fps);
	const outroFrames = Math.round(outroDurationInSeconds * fps);

	// First scene of every chapter >= 1 gets a lower-third marker.
	const chapterStarts = scenes.filter(
		(s, i) => (s.chapter ?? 0) >= 1 && (i === 0 || (scenes[i - 1].chapter ?? 0) !== s.chapter),
	);

	return (
		<AbsoluteFill style={{backgroundColor: palette.background}}>
			{/* Footage starts on frame 1 — the title plays OVER the hook scene. */}
			<Sequence from={0} durationInFrames={videoFrames}>
				<AbsoluteFill style={{overflow: 'hidden'}}>
					<AbsoluteFill
						style={{
							transform: kenBurnsTransform(scenes, seconds),
							filter: gradeForTone(tone),
						}}
					>
						<OffthreadVideo src={finalVideoUrl} />
					</AbsoluteFill>
					<FilmLayer tone={tone} />
					<Transitions scenes={scenes} tone={tone} />
					<Captions scenes={scenes} palette={palette} />
					{chapterStarts.map((s) => (
						<Sequence
							key={`ch-${s.chapter}`}
							from={Math.round(s.startSeconds * fps)}
							durationInFrames={Math.round(3.5 * fps)}
						>
							<ChapterMarker chapter={s.chapter ?? 1} palette={palette} />
						</Sequence>
					))}
					<Sequence from={0} durationInFrames={Math.round(hookTitleDurationInSeconds * fps)}>
						<HookTitle
							title={projectTitle}
							palette={palette}
							durationInSeconds={hookTitleDurationInSeconds}
						/>
					</Sequence>
				</AbsoluteFill>
			</Sequence>

			<Sequence from={videoFrames} durationInFrames={outroFrames}>
				<OutroCard channelName={channelName} subscribeText={subscribeText} palette={palette} />
			</Sequence>

			{/* Chapter-segmented progress bar, drawn last so it stays on top. */}
			<ProgressBar palette={palette} scenes={scenes} />
		</AbsoluteFill>
	);
};
