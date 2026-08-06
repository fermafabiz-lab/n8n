import React, {useEffect, useState} from 'react';
import {AbsoluteFill, OffthreadVideo, getRemotionEnvironment, useVideoConfig} from 'remotion';
import {PreviewBackdrop} from './PreviewBackdrop';

/**
 * The footage layer, and the one place that decides what "no usable source"
 * means.
 *
 * Two jobs, deliberately opposite:
 *
 * - In Studio, a dead source must NOT take the preview down. The assembled
 *   video lives at the render server's /output, which Railway wipes on
 *   redeploy, so props captured from a real execution stop resolving within a
 *   day — and an error overlay instead of the graphics is useless when the
 *   whole point is tuning typography and timing.
 *
 * - In a real render, the opposite: nothing is guarded, a broken source
 *   throws exactly as before, and the render fails loudly. Silently shipping
 *   graphics over a test pattern would be far worse than a failed job.
 *
 * The Studio guard is a PRE-FLIGHT, not a catch, and that distinction was
 * expensive to learn. A dead URL fails inside OffthreadVideo's own effect as
 * a rejected promise, which neither the `onError` prop nor a React error
 * boundary can intercept — Studio's global handler shows "NetworkError: A
 * network error occurred." and the composition is gone. The only way to keep
 * the preview alive is to never mount the video with a URL we haven't
 * confirmed. A one-byte range request answers that; the render server sends
 * CORS headers (server/index.mjs), and local files under public/ are
 * same-origin, so the probe is meaningful for both.
 *
 * `onError` stays as the second layer: a URL that resolves but holds
 * something undecodable fails on the media element instead, and passing a
 * handler is what stops Remotion raising MediaPlaybackError there.
 */

/** The backdrop plus an explanation — what Studio shows for a dead source. */
const MissingSource: React.FC<{explain: boolean}> = ({explain}) => {
	const {width} = useVideoConfig();
	const px = (n: number) => n * (width / 1280);
	return (
		<AbsoluteFill>
			<PreviewBackdrop />
			{explain && (
				<AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center', padding: px(24)}}>
					<div
						style={{
							fontFamily: 'ui-monospace, Menlo, monospace',
							fontSize: px(13),
							lineHeight: 1.5,
							color: '#ffd98a',
							background: 'rgba(0,0,0,0.72)',
							border: '1px solid rgba(245,184,65,0.4)',
							borderRadius: px(8),
							padding: `${px(10)}px ${px(14)}px`,
							maxWidth: '80%',
							textAlign: 'center',
						}}
					>
						Source video unreachable — the graphics are drawn over a test
						backdrop. Put an mp4 in remotion/public/ and set finalVideoUrl to
						/yourfile.mp4
					</div>
				</AbsoluteFill>
			)}
		</AbsoluteFill>
	);
};

type Probe = 'checking' | 'ok' | 'dead';

export const SourceVideo: React.FC<{src: string}> = ({src}) => {
	const {isRendering} = getRemotionEnvironment();
	const [probe, setProbe] = useState<Probe>('checking');

	useEffect(() => {
		if (isRendering || !src) return;
		let alive = true;
		setProbe('checking');
		// One byte is enough to know the URL resolves, and costs nothing even
		// when the file is hundreds of megabytes.
		fetch(src, {headers: {Range: 'bytes=0-0'}})
			.then((r) => {
				if (alive) setProbe(r.ok || r.status === 206 ? 'ok' : 'dead');
			})
			.catch(() => {
				if (alive) setProbe('dead');
			});
		return () => {
			alive = false;
		};
	}, [src, isRendering]);

	// A render gets the bare component: no probe, no handler, so any failure
	// surfaces as a failed render.
	if (isRendering) {
		return src ? <OffthreadVideo src={src} /> : <MissingSource explain={false} />;
	}

	if (!src) return <MissingSource explain={false} />;
	// Silent while probing: a flash of "unreachable" on every load would be
	// its own kind of noise.
	if (probe !== 'ok') return <MissingSource explain={probe === 'dead'} />;

	return <OffthreadVideo src={src} onError={() => setProbe('dead')} />;
};
