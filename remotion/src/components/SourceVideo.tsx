import React, {useEffect, useMemo, useState} from 'react';
import {
	AbsoluteFill,
	OffthreadVideo,
	getRemotionEnvironment,
	staticFile,
	useVideoConfig,
} from 'remotion';
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

/**
 * The backdrop plus an explanation — what Studio shows for a dead source.
 *
 * The explanation names the URL that failed and how. It used to say only
 * "Source video unreachable", which is a guess dressed as a finding: the last
 * time this box appeared the URL was reachable, answered 200, and simply was
 * not a video. That one wrong word sent a debugging session looking at props
 * files, codecs and localStorage before anyone tried fetching the URL.
 */
const MissingSource: React.FC<{why?: string; url?: string}> = ({why, url}) => {
	const {width} = useVideoConfig();
	const px = (n: number) => n * (width / 1280);
	return (
		<AbsoluteFill>
			<PreviewBackdrop />
			{why && (
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
						{why} — the graphics are drawn over a test backdrop.
						{url && (
							<div
								style={{
									marginTop: px(6),
									color: '#ffeec2',
									opacity: 0.85,
									wordBreak: 'break-all',
								}}
							>
								{url}
							</div>
						)}
						<div style={{marginTop: px(6)}}>
							Drop an mp4 into remotion/public/ and restart{' '}
							<span style={{whiteSpace: 'nowrap'}}>npm run studio</span>; it is
							picked up automatically.
						</div>
					</div>
				</AbsoluteFill>
			)}
		</AbsoluteFill>
	);
};

type Probe = {state: 'checking'} | {state: 'ok'} | {state: 'dead'; why: string};

/**
 * A file dropped into `public/` is addressed as `/name.mp4` in the props, but
 * Remotion does not serve public assets from the site root — that path has to
 * go through `staticFile()`, and a bare one fails with "was requested but not
 * found. To import assets from the public/ folder, you must wrap them in
 * staticFile()". Every note we had said a leading slash resolved by itself,
 * which was simply wrong, and it cost a full round of "I still see the test
 * backdrop".
 *
 * So the props keep the obvious spelling and this resolves it. Absolute URLs
 * (the render server, Drive, a CDN) and blob/data sources pass through
 * untouched — those are what production actually sends.
 */
const resolveSrc = (src: string): string =>
	!src || /^(https?:|blob:|data:)/i.test(src) ? src : staticFile(src);

export const SourceVideo: React.FC<{src: string}> = ({src}) => {
	const {isRendering} = getRemotionEnvironment();
	const [probe, setProbe] = useState<Probe>({state: 'checking'});
	const url = useMemo(() => resolveSrc(src), [src]);

	useEffect(() => {
		if (isRendering || !src) return;
		let alive = true;
		setProbe({state: 'checking'});
		// One byte is enough to know the URL resolves, and costs nothing even
		// when the file is hundreds of megabytes.
		fetch(url, {headers: {Range: 'bytes=0-0'}})
			.then((r) => {
				if (!alive) return;
				if (!r.ok && r.status !== 206) {
					setProbe({state: 'dead', why: `Source video: HTTP ${r.status}`});
					return;
				}
				// Studio's dev server answers 200 + text/html for EVERY path it does
				// not recognise — its single-page app fallback. So a status check
				// alone cannot tell a served video from a path that does not exist,
				// and this probe, whose entire job is exactly that, passed anything.
				// The failure then surfaced one step later as an undecodable video,
				// under the wrong label. Checking the type is what makes the probe
				// mean something in the environment it actually runs in.
				const type = r.headers.get('content-type') ?? '';
				if (/^text\/html/i.test(type)) {
					setProbe({
						state: 'dead',
						why: 'Source video: that path served a web page, not a video (nothing is there)',
					});
					return;
				}
				setProbe({state: 'ok'});
			})
			.catch(() => {
				if (alive) setProbe({state: 'dead', why: 'Source video unreachable'});
			});
		return () => {
			alive = false;
		};
	}, [url, src, isRendering]);

	// A render gets the bare component: no probe, no handler, so any failure
	// surfaces as a failed render.
	if (isRendering) {
		return src ? <OffthreadVideo src={url} /> : <MissingSource />;
	}

	if (!src) return <MissingSource />;
	// Silent while probing: a flash of "unreachable" on every load would be
	// its own kind of noise.
	if (probe.state !== 'ok') {
		return probe.state === 'dead' ? <MissingSource why={probe.why} url={url} /> : <MissingSource />;
	}

	return (
		<OffthreadVideo
			src={url}
			onError={() =>
				setProbe({state: 'dead', why: 'Source video served, but the browser could not decode it'})
			}
		/>
	);
};
