"use client";

import { useEffect, useRef } from "react";
import { preload } from "react-dom";

/**
 * Scroll-scrubbed frame sequence on a <canvas>.
 *
 * Layout (see globals.css): a 200vh section with a sticky 100vh stage, so
 * the sequence scrubs across exactly one viewport of scroll. The last frame
 * ends inside the hallway and the next section follows straight after it.
 *
 * Loading: the poster is one more file in the frame directory. Frames
 * 1..PRELOAD_COUNT are fetched in parallel; the canvas takes
 * over from the poster only after the first of them has been drawn. The rest
 * load one at a time, in order, in the background. A scroll position whose
 * frame is not here yet shows the highest loaded frame below it, so the
 * canvas is never blank and never jumps forward past what exists.
 *
 * Drawing: only inside requestAnimationFrame, one draw per frame, skipped
 * when the resolved index has not changed since the last draw. The scroll
 * listener is passive and only asks for a frame.
 *
 * Opt-outs: `prefers-reduced-motion: reduce` and viewports under 768px get
 * the poster only. Nothing is fetched; the CSS has already collapsed the
 * section to one viewport, so the next section follows immediately.
 *
 * Hint: after 2s idle on frame 0 the sequence nudges forward 4 frames and
 * eases back, repeating every idle window until the first real scroll,
 * after which it never runs again.
 */

// How long the sequence is. Two ways to change it, in this order:
//
//   1. `manifest.json` beside the frames — `{"count": 110}`. It is uploaded
//      with them, so a new sequence needs no rebuild. This is the one to use.
//   2. this constant, which answers when there is no manifest.
//
// Keep the constant matching whatever is on the box, so the fallback is right
// rather than merely present.
const FALLBACK_FRAME_COUNT = 110;
const MANIFEST_SRC = "/frames/manifest.json";
// A sanity bound, not a design limit: past this, a manifest is a typo rather
// than a sequence, and 20,000 image loads would take the tab down with it.
const MAX_FRAME_COUNT = 2000;

const PRELOAD_COUNT = 20;
const MAX_DPR = 2;
// Lives beside the frames, and is served the same way: from Caddy's disk on
// the box, from public/ locally. Nothing about the poster is in the image, so
// a new sequence is an upload rather than a rebuild.
const POSTER_SRC = "/frames/poster.webp";

// The copy is gone by this far through the scrub, and the scrim with it.
const COPY_FADE_END = 0.6;

const HINT_IDLE_MS = 2000;
const HINT_FRAMES = 4;
const HINT_OUT_MS = 450;
const HINT_BACK_MS = 1100;

const NARROW_QUERY = "(max-width: 767px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type State = "idle" | "static" | "loading" | "ready";

function frameSrc(index: number): string {
  return `/frames/frame_${String(index + 1).padStart(4, "0")}.webp`;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/**
 * The frame count, from the manifest if there is a usable one.
 *
 * `no-store` on purpose: everything under /frames/ is served `immutable`, and
 * a manifest cached for a year would outlive the sequence it describes — the
 * one file in that directory whose contents change under the same name.
 *
 * A malformed count is REFUSED, never coerced. "110", 0 and 1e9 are all
 * mistakes, and guessing what one meant would scrub through a film that is
 * not there.
 */
async function readFrameCount(signal: AbortSignal): Promise<number> {
  try {
    const res = await fetch(MANIFEST_SRC, { signal, cache: "no-store" });
    if (!res.ok) return FALLBACK_FRAME_COUNT;
    const data = (await res.json()) as { count?: unknown } | null;
    return readCount(data?.count);
  } catch {
    return FALLBACK_FRAME_COUNT;
  }
}

function readCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return FALLBACK_FRAME_COUNT;
  if (raw < 1 || raw > MAX_FRAME_COUNT) return FALLBACK_FRAME_COUNT;
  return raw;
}


export default function ScrollHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Emits <link rel="preload"> for the poster during SSR so it is the first
  // request after the document, which is what keeps LCP short.
  preload(POSTER_SRC, { as: "image", fetchPriority: "high" });

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!section || !stage || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const narrow = window.matchMedia(NARROW_QUERY);
    const reduced = window.matchMedia(REDUCED_MOTION_QUERY);

    // Both are empty until the manifest has answered; nothing draws before
    // then, because `tick` returns while `firstBatchDone` is false.
    let frameCount = FALLBACK_FRAME_COUNT;
    let frames: (HTMLImageElement | null)[] = [];
    const controller = new AbortController();
    let loadedUpTo = -1; // every index 0..loadedUpTo is decoded and drawable
    let started = false; // loading has begun (never restarts)
    let firstBatchDone = false;
    let disposed = false;

    let rafId = 0;
    let lastDrawn = -1;
    let lastFade = -1;
    let sizeDirty = true;
    let cssWidth = 0;
    let cssHeight = 0;
    // Cached so the tick never reads layout for them.
    let sectionH = 0;
    let viewportH = 0;

    let lastScrollY = window.scrollY;
    let userScrolled = false;
    let hintTimer = 0;
    let hintStartedAt = 0; // performance.now() of the running nudge, 0 = none

    const setState = (state: State) => {
      section.dataset.state = state;
    };

    const eligible = () => !narrow.matches && !reduced.matches;
    const isReadyState = () => section.dataset.state === "ready";

    // ---- geometry -------------------------------------------------------

    // ONE layout read per tick, and it is this one. Section and viewport
    // heights are cached by the ResizeObserver instead of being read here,
    // so the tick reads a rect and then only writes.
    const scrolled = (): number => -section.getBoundingClientRect().top;

    const scrubRangePx = () => Math.max(1, sectionH - viewportH);

    // 0..1 across the film.
    const progressFrom = (y: number): number => clamp01(y / scrubRangePx());

    const targetIndexFrom = (y: number): number => Math.round(progressFrom(y) * (frameCount - 1));

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.max(1, Math.round(cssWidth * dpr));
      const h = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      // Either assignment above clears the bitmap, so the caller must redraw.
    };


    const draw = (index: number) => {
      const img = frames[index];
      if (!img) return;
      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      // object-fit: cover
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    };

    // Highest loaded index at or below the target. Loads are sequential so
    // this is normally min(target, loadedUpTo); the walk only matters if a
    // frame failed to load and left a hole.
    const resolveIndex = (target: number): number => {
      let i = Math.min(target, loadedUpTo);
      while (i >= 0 && !frames[i]) i--;
      return i;
    };

    // ---- the one place that draws --------------------------------------

    const tick = () => {
      rafId = 0;
      if (disposed) return;

      // The copy fades on RAW progress, not on the rounded frame index, so it
      // eases continuously instead of stepping once per frame. It runs before
      // everything below: it does not depend on a single frame having loaded,
      // so scrolling during the initial load still fades the words.
      if (!eligible()) return;

      // One read, then writes only.
      const y = scrolled();

      const fade = 1 - clamp01(progressFrom(y) / COPY_FADE_END);
      if (fade !== lastFade) {
        section.style.setProperty("--hero-fade", String(Number(fade.toFixed(3))));
        lastFade = fade;
      }


      if (!firstBatchDone) return;

      let index = targetIndexFrom(y);

      if (hintStartedAt) {
        const elapsed = performance.now() - hintStartedAt;
        if (elapsed >= HINT_OUT_MS + HINT_BACK_MS) {
          hintStartedAt = 0;
          armHint();
        } else {
          const offset =
            elapsed < HINT_OUT_MS
              ? easeOutCubic(elapsed / HINT_OUT_MS)
              : 1 - easeInOutSine((elapsed - HINT_OUT_MS) / HINT_BACK_MS);
          index = Math.min(index + Math.round(offset * HINT_FRAMES), frameCount - 1);
          schedule();
        }
      }

      const shown = resolveIndex(index);
      if (shown < 0) return; // nothing drawable yet: the poster stays

      if (sizeDirty) {
        resizeCanvas();
        sizeDirty = false;
        lastDrawn = -1;
      }
      if (shown === lastDrawn) return;

      draw(shown);
      lastDrawn = shown;
      section.dataset.frame = String(shown);
      if (!isReadyState()) setState("ready"); // first paint happened: swap poster → canvas
    };

    const schedule = () => {
      if (!rafId) rafId = window.requestAnimationFrame(tick);
    };

    // ---- loading --------------------------------------------------------

    const loadFrame = (index: number): Promise<void> =>
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = "async";
        const done = () => {
          frames[index] = img;
          resolve();
        };
        const fail = () => {
          // decode() can reject on memory pressure while the bitmap is still
          // drawable; keep it if so, otherwise leave a hole.
          if (img.complete && img.naturalWidth > 0) done();
          else resolve();
        };
        img.src = frameSrc(index);
        img.decode().then(done, fail);
      });

    const advance = () => {
      while (loadedUpTo + 1 < frameCount && frames[loadedUpTo + 1]) loadedUpTo++;
      section.dataset.loaded = String(loadedUpTo + 1);
      schedule();
    };

    const loadAll = async () => {
      const first: Promise<void>[] = [];
      // A sequence shorter than the preload batch is loaded whole, in one go.
      for (let i = 0; i < Math.min(PRELOAD_COUNT, frameCount); i++) first.push(loadFrame(i));
      await Promise.all(first);
      if (disposed) return;
      firstBatchDone = true;
      advance();
      armHint();
      for (let i = PRELOAD_COUNT; i < frameCount; i++) {
        if (disposed) return;
        await loadFrame(i);
        advance();
      }
    };

    // ---- scroll hint ----------------------------------------------------

    const stopHint = () => {
      if (hintTimer) {
        window.clearTimeout(hintTimer);
        hintTimer = 0;
      }
      hintStartedAt = 0;
    };

    function armHint() {
      if (userScrolled || hintTimer || hintStartedAt || !firstBatchDone) return;
      hintTimer = window.setTimeout(() => {
        hintTimer = 0;
        if (userScrolled || !isReadyState()) return;
        if (document.hidden) {
          armHint(); // try again once the tab is back
          return;
        }
        if (targetIndexFrom(scrolled()) !== 0) return; // not resting on the first frame
        hintStartedAt = performance.now();
        schedule();
      }, HINT_IDLE_MS);
    }

    // ---- mode -----------------------------------------------------------

    const applyMode = () => {
      if (!eligible()) {
        stopHint();
        setState("static");
        return;
      }
      if (!started) {
        started = true;
        setState("loading");
        // The manifest request starts NOW, in parallel with the poster, so
        // asking for the count costs no latency — by the time the gate below
        // opens, a 30-byte file on a warm connection is long back.
        const countReady = readFrameCount(controller.signal);

        // Let the poster (the LCP element) decode and paint before the first
        // batch of frame fetches and decodes competes with it for the main
        // thread. decode() resolves at once if the poster is already there.
        const poster = stage.querySelector("img");
        const posterReady = poster ? poster.decode().catch(() => undefined) : Promise.resolve();
        void posterReady
          .then(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0))))
          .then(() => countReady)
          .then((count) => {
            if (disposed) return;
            // Settled before the first draw, so the scroll-to-frame mapping
            // never changes under the viewer's finger.
            frameCount = count;
            frames = new Array(frameCount).fill(null);
            section.dataset.count = String(frameCount);
            void loadAll();
          });
        return;
      }
      if (firstBatchDone) {
        // Came back from static (viewport grew, motion preference changed):
        // redraw and let the first paint flip the state to ready.
        lastDrawn = -1;
        sizeDirty = true;
        setState("loading");
        schedule();
        armHint();
      } else {
        setState("loading");
      }
    };

    // ---- listeners ------------------------------------------------------

    const onScroll = () => {
      const y = window.scrollY;
      if (y !== lastScrollY) {
        lastScrollY = y;
        if (!userScrolled) {
          userScrolled = true;
          stopHint();
        }
      }
      schedule();
    };

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      cssWidth = rect.width;
      cssHeight = rect.height;
      // Cached here so the tick does not have to read them. This callback is
      // the only place layout is read and written in the same breath, and it
      // runs on resize, not on scroll.
      sectionH = section.offsetHeight;
      viewportH = window.innerHeight;
      sizeDirty = true;
      schedule();
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    narrow.addEventListener("change", applyMode);
    reduced.addEventListener("change", applyMode);
    observer.observe(stage);
    applyMode();

    return () => {
      disposed = true;
      controller.abort();
      stopHint();
      if (rafId) window.cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      narrow.removeEventListener("change", applyMode);
      reduced.removeEventListener("change", applyMode);
    };
  }, []);

  return (
    <section ref={sectionRef} className="hero" data-state="idle" aria-label="Hero">
      <div ref={stageRef} className="hero__stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="hero__poster"
          src={POSTER_SRC}
          alt=""
          width={1600}
          height={900}
          fetchPriority="high"
          decoding="async"
        />
        <canvas ref={canvasRef} className="hero__canvas" aria-hidden="true" />
        {/* Scrim and copy fade together: the scrim exists to hold this text
            up, so it has no reason to outlive it. `pointer-events: none` in
            the CSS keeps the whole layer out of the way of scrolling. */}
        <div className="hero__copy">
          <div className="hero__scrim" aria-hidden="true" />
          <div className="hero__words">
            <h1 className="hero__title">
              Orice temă,
              <br />
              orice format.
            </h1>
            <p className="hero__subtitle">Long form, short form, orice platformă.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
