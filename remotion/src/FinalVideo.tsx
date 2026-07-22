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
	aspectRatio,
	showCaptions,
	showHookTitle = true,
	showChapterCards = true,
	showEndScreen = true,
	chapterTitles = {},
}) => {
	const {fps} = useVideoConfig();
	const frame = useCurrentFrame();
	const seconds = frame / fps;
	const preset = presetForTone(tone);

	// Titles come from a free-text form field, and people paste entire
	// prompts into it (seen in production: a ~3000-char master prompt became
	// the title, which stretched the hook past the whole video and
	// suppressed every caption). Display a sane excerpt: first line, cut at
	// a word boundary around 70 chars.
	const displayTitle = (() => {
		const firstLine = projectTitle.split(/\r?\n/)[0].trim();
		if (firstLine.length <= 72) return firstLine;
		const cut = firstLine.slice(0, 72);
		return cut.slice(0, Math.max(30, cut.lastIndexOf(' '))) + '…';
	})();

	// Give long titles time to finish typing, but never let the hook eat
	// the video: hard cap at 7s. Disabled hook = no title window at all
	// (captions start immediately).
	const hookSeconds = showHookTitle
		? Math.min(
				7,
				Math.max(hookTitleDurationInSeconds, displayTitle.length / preset.typeSpeed + 1.6),
			)
		: 0;

	const videoDurationSeconds = scenes.length
		? scenes[scenes.length - 1].startSeconds + scenes[scenes.length - 1].durationSeconds
		: 0;
	const videoFrames = Math.round(videoDurationSeconds * fps);
	const outroFrames = showEndScreen ? Math.round(outroDurationInSeconds * fps) : 0;

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
					{showCaptions && (
						<Captions
							scenes={scenes}
							palette={palette}
							preset={preset}
							suppressUntilSeconds={hookSeconds - 0.4}
							portrait={aspectRatio === '9:16'}
						/>
					)}
					{showChapterCards &&
						chapterStarts.map((s) => (
							<Sequence
								key={`ch-${s.chapter}`}
								from={Math.round(s.startSeconds * fps)}
								durationInFrames={Math.round(2.8 * fps)}
							>
								<ImpactCard
									chapter={s.chapter ?? 1}
									// Real chapter title from the script's [CHAPTER n: title]
									// markers; the narration excerpt is only a fallback for
									// old projects rendered before titles were passed in.
									keyLine={
										chapterTitles[String(s.chapter ?? 1)] || keyLineFor(s.narratorText)
									}
									preset={preset}
								/>
							</Sequence>
						))}
					{showHookTitle && (
						<Sequence from={0} durationInFrames={Math.round(hookSeconds * fps)}>
							<HookTitle
								title={displayTitle}
								palette={palette}
								preset={preset}
								durationInSeconds={hookSeconds}
							/>
						</Sequence>
					)}
				</AbsoluteFill>
			</Sequence>

			{outroFrames > 0 && (
				<Sequence from={videoFrames} durationInFrames={outroFrames}>
					<OutroCard
						channelName={channelName}
						subscribeText={subscribeText}
						palette={palette}
						portrait={aspectRatio === '9:16'}
					/>
				</Sequence>
			)}
		</AbsoluteFill>
	);
};
