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
			// 720p class, not 1080p: renders happen on a modest Railway box and
			// the 720 pixel budget keeps Chromium comfortable. The real
			// dimensions come from calculateMetadata based on the aspect ratio.
			width={1280}
			height={720}
			defaultProps={defaultFinalVideoProps}
			calculateMetadata={async ({props}) => {
				const p = props as FinalVideoProps;
				const videoDurationSeconds = p.scenes.length
					? p.scenes[p.scenes.length - 1].startSeconds +
						p.scenes[p.scenes.length - 1].durationSeconds
					: 0;
				const outroSeconds = p.showEndScreen === false ? 0 : p.outroDurationInSeconds;
				const totalSeconds =
					p.introDurationInSeconds + videoDurationSeconds + outroSeconds;
				const portrait = p.aspectRatio === '9:16';

				return {
					durationInFrames: Math.max(1, Math.round(totalSeconds * FPS)),
					width: portrait ? 720 : 1280,
					height: portrait ? 1280 : 720,
				};
			}}
		/>
	);
};
