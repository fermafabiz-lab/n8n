import React from 'react';
import {Composition} from 'remotion';
import {FinalVideo} from './FinalVideo';
import {FPS, filmMetadata} from './metadata';
import {defaultFinalVideoProps, type FinalVideoProps} from './types';

// Why 24 fps and why a 720p canvas: see metadata.ts, which the Hyperframes
// page (hf/entry.tsx) reads too.
export const RemotionRoot: React.FC = () => {
	return (
		<Composition
			id="FinalVideo"
			component={FinalVideo}
			durationInFrames={300}
			fps={FPS}
			width={1280}
			height={720}
			defaultProps={defaultFinalVideoProps}
			calculateMetadata={async ({props}) => {
				const {durationInFrames, width, height} = filmMetadata(props as FinalVideoProps);
				return {durationInFrames, width, height};
			}}
		/>
	);
};
