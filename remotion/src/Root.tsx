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
			// 720p, not 1080p: Railway's plan caps this container at 1GB RAM, and
			// decoding+re-encoding 1080p crashed Chromium outright ("Page crashed!",
			// an OOM kill) even at concurrency=1. Bump back to 1920x1080 once
			// hosted somewhere with more memory.
			width={1280}
			height={720}
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
