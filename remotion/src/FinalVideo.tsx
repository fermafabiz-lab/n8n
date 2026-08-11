import React, {useMemo} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {HookTitle} from './components/HookTitle';
import {
	CARD_FLASH_LEAD,
	IMPACT_CARD_SECONDS,
	ImpactCard,
	keyLineFor,
} from './components/ImpactCard';
import {isTitleLike} from './components/HookTitle';
import {OutroCard} from './components/OutroCard';
import {Captions} from './components/Captions';
import {FilmLayer, gradeForTone} from './components/FilmLayer';
import {Transitions, kenBurnsTransform} from './components/Transitions';
import {planMontage, shotAt, shotTransform} from './montage';
import {TextCard} from './components/TextCard';
import {buildTextCards, toMontageCards} from './textCards';
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
	evidence,
	textCards,
	showTextCards = true,
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
	// The second source the montage can cut to. Re-framing alone gives rhythm
	// without variety — every "cut" is the same tape, differently cropped — so
	// the planner needs material that genuinely differs. Cards are the cheapest
	// such material we have: the Evidence pack and the figures the narration
	// already speaks are both sitting unused.
	const cards = useMemo(
		() =>
			showTextCards
				? buildTextCards({
						scenes,
						evidence,
						explicit: textCards,
						chapterCardsOn: showChapterCards,
						hookSeconds,
					})
				: [],
		[scenes, evidence, textCards, showTextCards, showChapterCards, hookSeconds],
	);

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
				// The planner places TIME; it never sees what a card holds.
				cards: toMontageCards(cards),
			}),
		[scenes, intensity, projectTitle, showChapterCards, cards],
	);
	// Cards are material, not rhythm, so they land even at intensity 0 — turning
	// the montage off must not throw away a sourced claim.
	// Half a frame of lead, which makes a shot boundary land on the NEAREST
	// frame instead of the next one. Scene times arrive as floats from the
	// assembly and almost never sit on a frame line: scene 3 of a real film
	// started at 17.141s while its picture actually cut at 17.133s (frame 514),
	// so the framing changed one frame later than the footage did — a single
	// frame showing the NEW scene at the PREVIOUS scene's framing, then a jump.
	// That lone mismatched frame is what reads as "one frame is zoomed compared
	// to the rest of the scene", and a scene detector sees it as two changes a
	// frame apart where the film has one.
	const shot = shotAt(shots, seconds + 0.5 / fps);
	const activeCard =
		shot?.kind === 'card' && shot.cardIndex !== undefined ? cards[shot.cardIndex] : null;
	// Rendered as Sequences rather than from `shot`, so each card's own clock
	// starts at zero; `activeCard` is only used to know a card is up.
	const cardShots = useMemo(
		() => shots.filter((s) => s.kind === 'card' && s.cardIndex !== undefined),
		[shots],
	);

	// First scene of every chapter >= 1 gets an impact card.
	const chapterStarts = scenes.filter(
		(s, i) => (s.chapter ?? 0) >= 1 && (i === 0 || (scenes[i - 1].chapter ?? 0) !== s.chapter),
	);
	// `activeCard` above covers only the planner's TEXT cards, so the caption was
	// always drawn under a chapter card too — invisible for as long as the chapter
	// card was an opaque panel, and plainly visible the moment its ground became
	// translucent. Same rule, same reason: a card is already text, and printing
	// the spoken line over it puts two of them on screen.
	// The window a card occupies, led so its entrance flash PEAKS on the chapter
	// cut rather than starting there. One helper because three things have to
	// agree on it: the Sequence, the caption suppression below, and anything
	// later that asks "is a card up".
	const cardWindowStart = (startSeconds: number) => Math.max(0, startSeconds - CARD_FLASH_LEAD);
	const chapterCardUp =
		showChapterCards &&
		chapterStarts.some((s) => {
			const from = cardWindowStart(s.startSeconds);
			return seconds >= from && seconds < from + IMPACT_CARD_SECONDS;
		});

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
					{/* Captions go dark under a card. The card is already text, and
					    the whole reason a card earns its place is that it shows what
					    the narration is NOT saying — printing the spoken line over it
					    would put three copies of one sentence on screen. */}
					{showCaptions && !activeCard && !chapterCardUp && (
						<Captions
							scenes={scenes}
							palette={palette}
							preset={preset}
							suppressUntilSeconds={hookSeconds - 0.4}
							portrait={aspectRatio === '9:16'}
						/>
					)}
					{/* Text cards. Each gets its own Sequence so the component's clock
					    starts at zero and its reveal is frame-exact, exactly as the
					    chapter card does. Placement came from the planner, so a card
					    never lands two in a row or over the hook. */}
					{cardShots.map((cs) => (
						<Sequence
							key={`tc-${cs.startSeconds}`}
							from={Math.round(cs.startSeconds * fps)}
							durationInFrames={Math.max(1, Math.round(cs.durationSeconds * fps))}
						>
							<TextCard
								card={cards[cs.cardIndex as number]}
								// The planner may have squeezed the card to fit its scene, so
								// the SHOT owns the duration, not the spec — otherwise the exit
								// fade gets cut off mid-burn.
								seconds={cs.durationSeconds}
								preset={preset}
							/>
						</Sequence>
					))}
					{showChapterCards &&
						chapterStarts.map((s) => (
							<Sequence
                                key={`ch-${s.chapter}`}
                                // Led by CARD_FLASH_LEAD — see cardWindowStart above.
                                from={Math.round(cardWindowStart(s.startSeconds) * fps)}
                                // The card owns its own in/out light leak now, so the
                                // Sequence has to cover the whole window — a shorter one cuts
                                // the exit flash off mid-burn and the card vanishes on a hard
                                // frame.
                                durationInFrames={Math.round(IMPACT_CARD_SECONDS * fps)}>
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
