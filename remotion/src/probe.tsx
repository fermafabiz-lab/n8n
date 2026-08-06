// Throwaway probe entry: renders the text overlays over synthetic bands so
// typography and framing can be inspected as stills, without any real
// footage. Not part of the production bundle — src/index.ts is.
import React from 'react';
import {AbsoluteFill, Composition, registerRoot} from 'remotion';
import {Captions} from './components/Captions';
import {HookTitle} from './components/HookTitle';
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
			palette={DEFAULT_PALETTE}
			preset={presetForTone('Documentary')}
			portrait={portrait}
		/>
	</AbsoluteFill>
);

const TitleProbe: React.FC<{title: string}> = ({title}) => (
	<AbsoluteFill>
		<Backdrop />
		<HookTitle
			title={title}
			palette={DEFAULT_PALETTE}
			preset={presetForTone('Documentary')}
			durationInSeconds={9}
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
			id="TitlePortrait"
			component={TitleProbe}
			durationInFrames={300}
			fps={30}
			width={720}
			height={1280}
			defaultProps={{
				title:
					'The current crisis of illegal Marrocan immigrants coming into Spain in 2026 and what it means for the border towns of Ceuta and Melilla across the coming decade of policy',
			}}
		/>
	</>
);

registerRoot(ProbeRoot);
