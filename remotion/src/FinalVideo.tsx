import React, {useMemo} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {HookTitle} from './components/HookTitle';
import {IMPACT_CARD_SECONDS, ImpactCard, keyLineFor} from './components/ImpactCard';
import {isTitleLike} from './components/HookTitle';
import {FLASH_LEAD} from './components/LightLeak';
import {OutroCard} from './components/OutroCard';
import {Captions} from './components/Captions';
import {FilmLayer, gradeForTone} from './components/FilmLayer';
import {Transitions, kenBurnsTransform} from './components/Transitions';
import {planMontage, shotAt, shotTransform} from './montage';
import {TextCard} from './components/TextCard';
import {RouteCard} from './components/RouteCard';
import {ScheduleCard} from './components/ScheduleCard';
import {buildTextCards, toMontageCards} from './textCards';
import {SourceVideo} from './components/SourceVideo';
import {presetForTone} from './style';
import {resolveCaptionAccent} from './captionColor';
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
	captionColor,
	montageIntensity,
	showHookTitle = true,
	hookTitle = '',
	showChapterCards = true,
	showEndScreen = true,
	chapterTitles = {},
	evidence,
	textCards,
	showTextCards = true,
	narrationIsSpoken = true,
}) => {
	const {fps} = useVideoConfig();
	const frame = useCurrentFrame();
	const seconds = frame / fps;
	const preset = presetForTone(tone);
	// Resolved once per render, not per caption word: the legibility guard in
	// here bisects, and there is one accent for the whole film.
	const captionAccent = useMemo(() => resolveCaptionAccent(captionColor), [captionColor]);

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
						narrationIsSpoken,
					})
				: [],
		[
			scenes,
			evidence,
			textCards,
			showTextCards,
			showChapterCards,
			hookSeconds,
			narrationIsSpoken,
		],
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
	// Half a frame of lead, because OffthreadVideo samples the source at the
	// CENTRE of a frame's display interval — `(f + 0.5) / fps`, not `f / fps`.
	//
	// That is measured, not assumed, and the assumption cost a round trip: the
	// lead was removed on the reasoning that a frame shows `f / fps`, which
	// would put the picture change at `ceil(cut * fps)`. Rendering the film
	// settled it. The tahiti montage cuts at exactly 22.375s; frame 670 is the
	// old scene and frame 671 is the new one, and 671 is `round(22.375 * 30)`,
	// not `ceil(671.25)`. Centre sampling is the only rule that predicts that.
	//
	// So the frame the picture changes on is `round(cut * fps)`, and asking
	// `shotAt` at `seconds + 0.5 / fps` is exactly how you land on it.
	//
	// The lead is only half the fix, and on its own it was never enough: it
	// corrects for where a boundary sits INSIDE a frame, and until
	// server/assemble.mjs started snapping, the boundaries themselves were
	// wrong — the reported scene starts drifted from the real picture cuts by
	// -0.021s to +0.084s, because the montage encodes each segment to a whole
	// frame of its own 24fps grid and the rounding accumulates down the concat.
	// Half a frame (0.033s) cannot cover 0.084s. Snapping makes the times true;
	// this makes the framing land on the frame the picture actually changes.
	// Remove either one and the mismatch comes back.
	//
	// The epsilon is the third piece, and it is not padding. Both sides reduce
	// to the SAME inequality — `f >= cut * fps - 0.5` — so they can only ever
	// disagree on a tie, and a tie is exactly what a 24fps source in a 30fps
	// composition keeps producing: every cut sits at .0/.25/.5/.75 of a frame,
	// and the .5 ones put the boundary precisely on the comparison. There the
	// two sides are computed by different arithmetic (the decoder's, and this
	// expression's), so a cut whose seconds value is not representable in
	// binary breaks the tie one way for the picture and the other way for the
	// framing. Measured on the tahiti film: 33.9167, 38.9167 and 63.4167 all
	// changed picture on frame N while the framing waited for N+1 — one frame
	// of the NEW scene wearing the OLD scene's framing, which is exactly the
	// "first frame of the scene sits somewhere else and only settles on the
	// second" report. A microsecond is four ten-thousandths of a frame: far
	// below anything the edit can express, far above the 1e-14 the doubles
	// disagree by.
	const shot = shotAt(shots, seconds + 0.5 / fps + 1e-6);
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
	const cardWindowStart = (startSeconds: number) => Math.max(0, startSeconds - FLASH_LEAD);
	const chapterCardUp =
		showChapterCards &&
		chapterStarts.some((s) => {
			const from = cardWindowStart(s.startSeconds);
			return seconds >= from && seconds < from + IMPACT_CARD_SECONDS;
		});

	/**
	 * A card is one Sequence and one duration whatever it holds; only the
	 * drawing differs. Kept as a function rather than a nested ternary because
	 * the list is going to grow — a motif per film is the whole point.
	 */
	const renderCard = (card: (typeof cards)[number], seconds: number) => {
		if (card.variant === 'route') return <RouteCard card={card} seconds={seconds} preset={preset} />;
		if (card.variant === 'schedule')
			return <ScheduleCard card={card} seconds={seconds} preset={preset} />;
		return <TextCard card={card} seconds={seconds} preset={preset} />;
	};

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
					{/* Chapter boundaries only. An ordinary scene cut is already a
					    change of picture in the footage, at every intensity — laying a
					    luminance dip over it made two transitions out of one, and that
					    is what read as a fault. See Transitions. */}
					<Transitions scenes={scenes} tone={tone} chapterCards={showChapterCards} />
					{/* Captions go dark under a card. The card is already text, and
					    the whole reason a card earns its place is that it shows what
					    the narration is NOT saying — printing the spoken line over it
					    would put three copies of one sentence on screen. */}
					{showCaptions && !activeCard && !chapterCardUp && (
						<Captions
							scenes={scenes}
							accent={captionAccent}
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
                            durationInFrames={Math.max(1, Math.round(cs.durationSeconds * fps))}>
							{/* One Sequence, several kinds of card. The planner places TIME
							    and never learns which — so a motif costs it nothing, and the
							    choice belongs here, where the content finally is.
							    The planner may have squeezed the card to fit its scene, so
							    the SHOT owns the duration, not the spec — otherwise the exit
							    fade gets cut off mid-burn. */}
							{renderCard(
								cards[cs.cardIndex as number],
								cs.durationSeconds,
							)}
						</Sequence>
					))}
					{showChapterCards &&
						chapterStarts.map((s) => (
							<Sequence
                                key={`ch-${s.chapter}`}
                                // Led by FLASH_LEAD — see cardWindowStart above.
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
									// old projects rendered before titles were passed in — and
									// it is available only when that text is actually spoken.
									// On a silent film it is a shot note, so borrowing its
									// first eight words would print stage directions as the
									// chapter's title. The card still renders: it owns this
									// boundary's transition, and dropping it would leave the
									// cut with no owner at all.
									keyLine={
										chapterTitles[String(s.chapter ?? 1)] ||
										(narrationIsSpoken ? keyLineFor(s.narratorText) : '')
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
				// Led by FLASH_LEAD, exactly as the chapter card is, so the end
				// screen's flare peaks ON the frame the footage gives way rather
				// than starting there. The duration grows by the same amount, so
				// the film still ends when it always did — the lead is borrowed
				// from the tail of the footage, which the flash is covering.
				(<Sequence
					from={Math.max(0, videoFrames - Math.round(FLASH_LEAD * fps))}
					durationInFrames={outroFrames + Math.round(FLASH_LEAD * fps)}
				>
                    <OutroCard
						channelName={channelName}
						subscribeText={subscribeText}
						palette={palette}
						portrait={aspectRatio === '9:16'}
					/>
                </Sequence>)
			)}
        </AbsoluteFill>
    );
};
