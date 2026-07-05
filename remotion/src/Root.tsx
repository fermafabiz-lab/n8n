import React from 'react';
import {Composition} from 'remotion';
import {FinalVideo} from './FinalVideo';
import {defaultFinalVideoProps, type FinalVideoProps} from './types';

const FPS = 30;

export const RemotionRoot: React.FC = () => {
	return (
		<Composition
			id="FinalVideo"
			component={FinalVideo}
			durationInFrames={300}
			fps={FPS}
			width={1920}
			height={1080}
			defaultProps={defaultFinalVideoProps}
			calculateMetadata={async ({props}) => {
				const p = props as FinalVideoProps;
				const videoDurationSeconds = p.scenes.length
					? p.scenes[p.scenes.length - 1].startSeconds +
						p.scenes[p.scenes.length - 1].durationSeconds
					: 0;
				const totalSeconds =
					p.introDurationInSeconds + videoDurationSeconds + p.outroDurationInSeconds;

				return {
					durationInFrames: Math.max(1, Math.round(totalSeconds * FPS)),
				};
			}}
		/>
	);
};
