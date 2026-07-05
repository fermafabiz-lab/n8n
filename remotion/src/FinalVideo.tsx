import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig} from 'remotion';
import {IntroCard} from './components/IntroCard';
import {OutroCard} from './components/OutroCard';
import {ProgressBar} from './components/ProgressBar';
import {Captions} from './components/Captions';
import type {FinalVideoProps} from './types';

export const FinalVideo: React.FC<FinalVideoProps> = ({
	finalVideoUrl,
	projectTitle,
	scenes,
	palette,
	channelName,
	subscribeText,
	introDurationInSeconds,
	outroDurationInSeconds,
}) => {
	const {fps} = useVideoConfig();

	const introFrames = Math.round(introDurationInSeconds * fps);
	const videoDurationSeconds = scenes.length
		? scenes[scenes.length - 1].startSeconds + scenes[scenes.length - 1].durationSeconds
		: 0;
	const videoFrames = Math.round(videoDurationSeconds * fps);
	const outroFrames = Math.round(outroDurationInSeconds * fps);

	return (
		<AbsoluteFill style={{backgroundColor: palette.background}}>
			<Sequence from={0} durationInFrames={introFrames}>
				<IntroCard title={projectTitle} palette={palette} />
			</Sequence>

			<Sequence from={introFrames} durationInFrames={videoFrames}>
				<AbsoluteFill>
					<OffthreadVideo src={finalVideoUrl} />
					<Captions scenes={scenes} palette={palette} />
				</AbsoluteFill>
			</Sequence>

			<Sequence from={introFrames + videoFrames} durationInFrames={outroFrames}>
				<OutroCard channelName={channelName} subscribeText={subscribeText} palette={palette} />
			</Sequence>

			{/* Progress bar spans the whole video, drawn last so it stays on top. */}
			<ProgressBar palette={palette} />
		</AbsoluteFill>
	);
};
