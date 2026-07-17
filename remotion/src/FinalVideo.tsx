import React from 'react';
import {
	AbsoluteFill,
	OffthreadVideo,
	Sequence,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {HookTitle} from './components/HookTitle';
import {ImpactCard, keyLineFor} from './components/ImpactCard';
import {OutroCard} from './components/OutroCard';
import {Captions} from './components/Captions';
import {FilmLayer, gradeForTone} from './components/FilmLayer';
import {Transitions, kenBurnsTransform} from './components/Transitions';
import {presetForTone} from './style';
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
	const preset = presetForTone(tone);

	// Give long titles enough time to finish typing before the fade-out.
	const hookSeconds = Math.max(
		hookTitleDurationInSeconds,
		projectTitle.length / preset.typeSpeed + 1.6,
	);

	const videoDurationSeconds = scenes.length
		? scenes[scenes.length - 1].startSeconds + scenes[scenes.length - 1].durationSeconds
		: 0;
	const videoFrames = Math.round(videoDurationSeconds * fps);
	const outroFrames = Math.round(outroDurationInSeconds * fps);

	// First scene of every chapter >= 1 gets an impact card.
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
							transform: kenBurnsTransform(scenes, seconds, preset.energy),
							filter: gradeForTone(tone),
						}}
					>
						<OffthreadVideo src={finalVideoUrl} />
					</AbsoluteFill>
					<FilmLayer tone={tone} />
					<Transitions scenes={scenes} tone={tone} />
					<Captions
						scenes={scenes}
						palette={palette}
						preset={preset}
						suppressUntilSeconds={hookSeconds - 0.4}
					/>
					{chapterStarts.map((s) => (
						<Sequence
							key={`ch-${s.chapter}`}
							from={Math.round(s.startSeconds * fps)}
							durationInFrames={Math.round(2.8 * fps)}
						>
							<ImpactCard
								chapter={s.chapter ?? 1}
								keyLine={keyLineFor(s.narratorText)}
								preset={preset}
							/>
						</Sequence>
					))}
					<Sequence from={0} durationInFrames={Math.round(hookSeconds * fps)}>
						<HookTitle
							title={projectTitle}
							palette={palette}
							preset={preset}
							durationInSeconds={hookSeconds}
						/>
					</Sequence>
				</AbsoluteFill>
			</Sequence>

			<Sequence from={videoFrames} durationInFrames={outroFrames}>
				<OutroCard channelName={channelName} subscribeText={subscribeText} palette={palette} />
			</Sequence>
		</AbsoluteFill>
	);
};
