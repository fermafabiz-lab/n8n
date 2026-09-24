/**
 * The Hyperframes page: FinalVideo, unchanged, drawn one frame per seek.
 *
 * Hyperframes captures a frame by seeking the page to a time and screenshotting
 * it. Its runtime announces every seek as a window `hf-seek` event whose
 * `waitUntil()` holds the capture until a promise settles — the contract its
 * own GPU adapters use. So the whole bridge is: on `hf-seek`, render the
 * composition at that frame, synchronously (legacy ReactDOM.render, where a
 * setState commits at once — which is what makes `delayRender` holds mean the
 * same as under Remotion), then hold the capture until every `delayRender` is
 * released.
 *
 * Duration comes from a paused, empty GSAP timeline of the film's length:
 * Hyperframes reads a composition's length from `window.__timelines[id]` and
 * refuses a page that registers none. Nothing is animated by it.
 *
 * Props arrive as JSON in `<script id="hov-props">`, written by
 * server/render-hf.mjs, merged over the defaults the way Remotion merges
 * inputProps over a Composition's defaultProps.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import {gsap} from 'gsap';
import {FinalVideo} from '../FinalVideo';
import {FPS, filmMetadata} from '../metadata';
import {defaultFinalVideoProps, type FinalVideoProps} from '../types';
import {TimelineProvider, whenSettled, type VideoConfig} from './remotion-shim';

const COMPOSITION_ID = 'main';
/** Longer than any honest measurement, short of the engine's own stall guard. */
const HOLD_TIMEOUT_MS = 30_000;

const raw = document.getElementById('hov-props')?.textContent;
if (!raw) throw new Error('hf/entry: the page has no <script id="hov-props">');
const props: FinalVideoProps = {...defaultFinalVideoProps, ...JSON.parse(raw)};
const meta = filmMetadata(props);
const config: VideoConfig = {
	id: 'FinalVideo',
	fps: FPS,
	width: meta.width,
	height: meta.height,
	durationInFrames: meta.durationInFrames,
};

const mount = document.getElementById('hov-root');
if (!mount) throw new Error('hf/entry: the page has no #hov-root');

const draw = (frame: number) => {
	// eslint-disable-next-line react/no-deprecated -- synchronous on purpose, see the header
	ReactDOM.render(
		<TimelineProvider frame={frame} config={config}>
			<FinalVideo {...props} />
		</TimelineProvider>,
		mount,
	);
};

window.addEventListener('hf-seek', ((e: CustomEvent<{time: number; waitUntil: (p: Promise<unknown>) => void}>) => {
	const frame = Math.min(config.durationInFrames - 1, Math.max(0, Math.round(e.detail.time * FPS)));
	draw(frame);
	e.detail.waitUntil(whenSettled(HOLD_TIMEOUT_MS));
}) as EventListener);

draw(0);

const w = window as unknown as {__timelines?: Record<string, unknown>};
const timeline = gsap.timeline({paused: true});
timeline.set({}, {}, config.durationInFrames / FPS);
w.__timelines = {...(w.__timelines ?? {}), [COMPOSITION_ID]: timeline};
