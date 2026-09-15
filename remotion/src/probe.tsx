// Throwaway probe entry: renders the text overlays over synthetic bands so
// typography and framing can be inspected as stills, without any real
// footage. Not part of the production bundle — src/index.ts is.
import React from 'react';
import {AbsoluteFill, Composition, registerRoot} from 'remotion';
import {Captions} from './components/Captions';
import {HookCard} from './components/HookCard';
import {ImpactCard} from './components/ImpactCard';
import {TimelineCard} from './components/TimelineCard';
import {TextCard} from './components/TextCard';
import {CompareCard} from './components/CompareCard';
import {StepsCard} from './components/StepsCard';
import {DEFAULT_PALETTE, type SceneCaption} from './types';
import {presetForTone} from './style';

const BANDS = ['#3A3F4B', '#55606E', '#2B2F38', '#6B5A44'];

const Backdrop: React.FC = () => (
	<AbsoluteFill style={{flexDirection: 'column'}}>
		{BANDS.map((c) => (
			<div key={c} style={{flex: 1, background: c}} />
		))}
	</AbsoluteFill>
);

const SCENES: SceneCaption[] = [
	{
		narratorText: 'extraordinary immigration circumstances overwhelming',
		startSeconds: 0,
		durationSeconds: 10,
		speechSeconds: 9,
	},
];

const CaptionProbe: React.FC<{portrait: boolean}> = ({portrait}) => (
	<AbsoluteFill>
		<Backdrop />
		<Captions
			scenes={SCENES}
			accent={null}
			preset={presetForTone('Documentary')}
			portrait={portrait}
		/>
	</AbsoluteFill>
);

/**
 * The hook's card over the bands — one probe per style that draws one. The
 * question is the retired opening title's successor and is the long case; the
 * slate and the figure are the two other layouts HookCard holds.
 */
const HookProbe: React.FC<{
	tone: string;
	style: 'question' | 'figure' | 'slate';
	line1: string;
	line2: string;
}> = ({tone, style, line1, line2}) => (
	<AbsoluteFill>
		<Backdrop />
		<HookCard
			plan={{style, silent: style === 'slate', beats: [], card: {line1, line2, source: 'E2'}}}
			seconds={4.2}
			preset={presetForTone(tone)}
			evidence={[{ref: 'E2', claim: '', source: 'Federal Reserve Bulletin', date: '1931'}]}
		/>
	</AbsoluteFill>
);

const CardProbe: React.FC<{keyLine: string}> = ({keyLine}) => (
	<AbsoluteFill>
		<Backdrop />
		<ImpactCard chapter={2} keyLine={keyLine} preset={presetForTone('Documentary')} />
	</AbsoluteFill>
);

/**
 * The timeline motif over the bands, so the proportional spacing and the two
 * rows of type can be looked at without a film. The years are the Boyd film's
 * own, which is the case the motif was built for: 1941 to 1975 with the two
 * late marks close together, so the legibility concession is exercised rather
 * than assumed.
 */
const TimelineProbe: React.FC = () => (
	<AbsoluteFill>
		<Backdrop />
		<TimelineCard
			card={{
				sceneIndex: 7,
				variant: 'timeline',
				headline: '',
				label: 'Anii',
				marks: [
					{at: '1941', label: 'as a dealer'},
					{at: '1952', label: 'all the savings'},
					{at: '1962', label: 'the hard yes'},
					{at: '1966', label: 'family buys out'},
					{at: '1975', label: 'co-found Boyd Gaming'},
				],
				note: '34 de ani',
				seconds: 4,
				minSeconds: 2.8,
			}}
			seconds={4}
			preset={presetForTone('Documentary')}
		/>
	</AbsoluteFill>
);


/**
 * The figure card, which is the one almost every film actually gets. Rendered
 * as a still at several moments it is the only way to see the digits mid-roll:
 * the whole point of the reveal is that no single frame shows the finished
 * number until it has landed.
 */
const FigureProbe: React.FC<{tone: string; headline: string; kicker: string}> = ({
	tone,
	headline,
	kicker,
}) => (
	<AbsoluteFill>
		<Backdrop />
		<TextCard
			card={{
				sceneIndex: 4,
				variant: 'figure',
				headline,
				kicker,
				seconds: 2.4,
				minSeconds: 1.7,
			}}
			seconds={2.4}
			preset={presetForTone(tone)}
		/>
	</AbsoluteFill>
);

/** The two motifs added on 2026-09-09, over the bands. */
const CompareProbe: React.FC<{tone: string}> = ({tone}) => (
	<AbsoluteFill>
		<Backdrop />
		<CompareCard
			card={{
				sceneIndex: 5,
				variant: 'compare',
				headline: '',
				label: 'Crews',
				sides: [
					{label: 'women on the crews', value: '38%'},
					{label: 'women in command', value: '6%'},
				],
				note: 'six times fewer',
				seconds: 3.4,
				minSeconds: 2.8,
			}}
			seconds={3.4}
			preset={presetForTone(tone)}
		/>
	</AbsoluteFill>
);

const StepsProbe: React.FC<{tone: string}> = ({tone}) => (
	<AbsoluteFill>
		<Backdrop />
		<StepsCard
			card={{
				sceneIndex: 6,
				variant: 'steps',
				headline: '',
				label: 'The race',
				steps: [
					{label: 'leaves the clearing'},
					{label: 'over roots and firm earth'},
					{label: 'a shallow pebbled dip'},
					{label: 'the pale petals'},
				],
				note: 'four stages, one pace',
				seconds: 3.8,
				minSeconds: 3,
			}}
			seconds={3.8}
			preset={presetForTone(tone)}
		/>
	</AbsoluteFill>
);

export const ProbeRoot: React.FC = () => (
	<>
		<Composition
			id="CaptionsPortrait"
			component={CaptionProbe}
			durationInFrames={300}
			fps={30}
			width={720}
			height={1280}
			defaultProps={{portrait: true}}
		/>
		<Composition
			id="CaptionsLandscape"
			component={CaptionProbe}
			durationInFrames={300}
			fps={30}
			width={1280}
			height={720}
			defaultProps={{portrait: false}}
		/>
		<Composition
			id="HookQuestionPortrait"
			component={HookProbe}
			durationInFrames={126}
			fps={30}
			width={720}
			height={1280}
			defaultProps={{
				tone: 'Documentary',
				style: 'question' as const,
				line1: 'Cum a ieșit un student dintr-o bancă cu banii, neobservat?',
				line2: '',
			}}
		/>
		<Composition
			id="HookSlateLandscape"
			component={HookProbe}
			durationInFrames={126}
			fps={30}
			width={1280}
			height={720}
			defaultProps={{
				tone: 'Dark',
				style: 'slate' as const,
				line1: 'Banca Națională, Ploiești',
				line2: '14 martie 1931',
			}}
		/>
		<Composition
			id="HookFigureLandscape"
			component={HookProbe}
			durationInFrames={126}
			fps={30}
			width={1280}
			height={720}
			defaultProps={{
				tone: 'Motivational',
				style: 'figure' as const,
				line1: '4 million',
				line2: 'dollars, carried out in one bag',
			}}
		/>
		<Composition
			id="CardPortrait"
			component={CardProbe}
			durationInFrames={90}
			fps={30}
			width={720}
			height={1280}
			defaultProps={{keyLine: 'What Fairness Costs'}}
		/>
		<Composition
			id="TimelineLandscape"
			component={TimelineProbe}
			durationInFrames={120}
			fps={30}
			width={1280}
			height={720}
		/>
		<Composition
			id="TimelinePortrait"
			component={TimelineProbe}
			durationInFrames={120}
			fps={30}
			width={720}
			height={1280}
		/>
		<Composition
			id="CardLandscape"
			component={CardProbe}
			durationInFrames={90}
			fps={30}
			width={1280}
			height={720}
			defaultProps={{keyLine: 'What Fairness Costs'}}
		/>
		<Composition
			id="FigureLandscape"
			component={FigureProbe}
			durationInFrames={72}
			fps={30}
			width={1280}
			height={720}
			defaultProps={{tone: 'Documentary', headline: '1907', kicker: 'On 10 August'}}
		/>
		<Composition
			id="FigurePortrait"
			component={FigureProbe}
			durationInFrames={72}
			fps={30}
			width={720}
			height={1280}
			defaultProps={{tone: 'Motivational', headline: '38%', kicker: 'of women in the trade'}}
		/>
		<Composition
			id="CompareLandscape"
			component={CompareProbe}
			durationInFrames={102}
			fps={30}
			width={1280}
			height={720}
			defaultProps={{tone: 'Documentary'}}
		/>
		<Composition
			id="StepsLandscape"
			component={StepsProbe}
			durationInFrames={114}
			fps={30}
			width={1280}
			height={720}
			defaultProps={{tone: 'Cinematic'}}
		/>
		<Composition
			id="StepsPortrait"
			component={StepsProbe}
			durationInFrames={114}
			fps={30}
			width={720}
			height={1280}
			defaultProps={{tone: 'Motivational'}}
		/>
	</>
);

registerRoot(ProbeRoot);
