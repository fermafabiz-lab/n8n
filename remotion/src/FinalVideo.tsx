import React, {useMemo} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {HookTitle} from './components/HookTitle';
import {IMPACT_CARD_SECONDS, ImpactCard, keyLineFor} from './components/ImpactCard';
import {isTitleLike} from './components/HookTitle';
import {OutroCard} from './components/OutroCard';
import {Captions} from './components/Captions';
import {FilmLayer, gradeForTone} from './components/FilmLayer';
import {Transitions, kenBurnsTransform} from './components/Transitions';
import {planMontage, shotAt, shotTransform} from './montage';
import {SourceVideo} from './components/SourceVideo';
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
	montageIntensity,
	showHookTitle = true,
	hookTitle = '',
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
	// suppressed every caption). But the old 72-char excerpt cut real titles
	// mid-sentence ("...COMING INTO SPAIN IN…"), which reads worse than small
	// type. The card now shows the whole title and shrinks to fit; this
	// excerpt only guards the pathological paste, an order of magnitude
	// longer than any real title.
	const displayTitle = (() => {
		// A written hook line always wins: if Scripting produced one, it was
		// authored to be a title and needs no rescuing.
		const raw = (hookTitle || projectTitle).split(/\r?\n/)[0].trim();
		if (raw.length <= 200) return raw;
		const cut = raw.slice(0, 200);
		return cut.slice(0, Math.max(60, cut.lastIndexOf(' '))) + '…';
	})();

	// The statement card only works on a real title. A Tema field holding a
	// brief ("A man and a woman talking about equality") opens clean instead —
	// a description set 100px tall is worse than no card at all.
	const titleWorks = Boolean(hookTitle) || isTitleLike(displayTitle);
	const wantsHook = showHookTitle && titleWorks && displayTitle.length > 0;

	// A longer title needs longer on screen to be read, but the hook must
	// never eat the film — hence a ceiling that only rises to 9s for titles
	// that genuinely need it. HookTitle paces its own typing to whatever
	// window it gets, so the text always finishes regardless of this cap.
	// Disabled hook = no title window at all (captions start immediately).
	// No typing to wait for any more — the whole title is up within a second.
	// The window only has to be long enough to read it, so it scales with the
	// word count rather than the character count, and stays well short of
	// eating the film.
	const hookSeconds = wantsHook
		? Math.min(
				6.5,
				Math.max(
					2.8,
					hookTitleDurationInSeconds,
					1.9 + displayTitle.split(/\s+/).filter(Boolean).length * 0.32,
				),
			)
		: 0;

	const videoDurationSeconds = scenes.length
		? scenes[scenes.length - 1].startSeconds + scenes[scenes.length - 1].durationSeconds
		: 0;
	const videoFrames = Math.round(videoDurationSeconds * fps);
	const outroFrames = showEndScreen ? Math.round(outroDurationInSeconds * fps) : 0;

	// The montage: shot boundaries planned across the WHOLE timeline, not per
	// scene. Nothing about the media changes — a shot only re-frames the same
	// continuous footage, and a discontinuous jump in scale and position is
	// what reads as a cut, to the eye and to a scene detector alike. That is
	// how an 8-second scene grid produces bursts of half-second inserts and
	// held shots past ten seconds without generating a single extra clip.
	//
	// Measured against five reference documentaries, our own output used to
	// register as ONE 43-second shot (remotion/reference/editing-benchmarks.json).
	// Intensity 0 restores exactly that, should a project ever want it.
	const intensity: 0 | 1 | 2 =
		montageIntensity !== undefined
			? montageIntensity
			: preset.energy === 2
				? 2
				: 1;
	const shots = useMemo(
		() =>
			planMontage(scenes, {
				intensity,
				// Per project, so two films never share a rhythm, but stable so a
				// re-render of the same project is identical.
				seed: projectTitle || 'house-of-videos',
				// A chapter card already owns its boundary with a light leak;
				// a black frame there too would be two effects on one cut.
				blackPunctuation: !showChapterCards,
			}),
		[scenes, intensity, projectTitle, showChapterCards],
	);
	const shot = intensity === 0 ? null : shotAt(shots, seconds);

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
							transform: shot
								? shotTransform(shot, seconds)
								: kenBurnsTransform(scenes, seconds, preset.energy),
							filter: gradeForTone(tone),
							// A planned black frame punctuates a chapter turn — the
							// footage is simply hidden for its third of a second.
							opacity: shot?.kind === 'black' ? 0 : 1,
						}}
					>
						{/* SourceVideo owns the "no usable source" decision: backdrop in
						    Studio (the assembled video is ephemeral and a dead URL used
						    to take the whole preview down), loud failure in a render. */}
						<SourceVideo src={finalVideoUrl} />
					</AbsoluteFill>
					<FilmLayer tone={tone} />
					{/* With the montage running, the framing jumps ARE the cuts, so
					    the per-scene luminance dip has to go: a dip mid-HOLD would
					    break the very shot that is meant to run across scenes. The
					    chapter treatment stays. */}
					<Transitions
						scenes={scenes}
						tone={tone}
						chapterCards={showChapterCards}
						sceneDips={intensity === 0}
					/>
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
								// The card owns its own in/out light leak now, so the
								// Sequence has to cover the whole window — a shorter one cuts
								// the exit flash off mid-burn and the card vanishes on a hard
								// frame.
								durationInFrames={Math.round(IMPACT_CARD_SECONDS * fps)}
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
					{wantsHook && (
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
