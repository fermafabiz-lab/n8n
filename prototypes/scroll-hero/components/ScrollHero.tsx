"use client";

import { useEffect, useRef } from "react";
import { preload } from "react-dom";

/**
 * Scroll-scrubbed frame sequence on a <canvas>.
 *
 * Layout (see globals.css): a 200vh section with a sticky 100vh stage. The
 * frame index is the section's scroll progress mapped onto 0..FRAME_COUNT-1.
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

const FRAME_COUNT = 100;
const PRELOAD_COUNT = 20;
const MAX_DPR = 2;
// Lives beside the frames, and is served the same way: from Caddy's disk on
// the box, from public/ locally. Nothing about the poster is in the image, so
// a new sequence is an upload rather than a rebuild.
const POSTER_SRC = "/frames/poster.webp";

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

    const frames: (HTMLImageElement | null)[] = new Array(FRAME_COUNT).fill(null);
    let loadedUpTo = -1; // every index 0..loadedUpTo is decoded and drawable
    let started = false; // loading has begun (never restarts)
    let firstBatchDone = false;
    let disposed = false;

    let rafId = 0;
    let lastDrawn = -1;
    let sizeDirty = true;
    let cssWidth = 0;
    let cssHeight = 0;

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

    const targetIndex = (): number => {
      const range = section.offsetHeight - window.innerHeight;
      if (range <= 0) return 0;
      const top = section.getBoundingClientRect().top;
      return Math.round(clamp01(-top / range) * (FRAME_COUNT - 1));
    };

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
      if (disposed || !firstBatchDone || !eligible()) return;

      let index = targetIndex();

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
          index = Math.min(index + Math.round(offset * HINT_FRAMES), FRAME_COUNT - 1);
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
      while (loadedUpTo + 1 < FRAME_COUNT && frames[loadedUpTo + 1]) loadedUpTo++;
      section.dataset.loaded = String(loadedUpTo + 1);
      schedule();
    };

    const loadAll = async () => {
      const first: Promise<void>[] = [];
      for (let i = 0; i < PRELOAD_COUNT; i++) first.push(loadFrame(i));
      await Promise.all(first);
      if (disposed) return;
      firstBatchDone = true;
      advance();
      armHint();
      for (let i = PRELOAD_COUNT; i < FRAME_COUNT; i++) {
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
        if (targetIndex() !== 0) return; // not resting on the first frame
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
        // Let the poster (the LCP element) decode and paint before the first
        // batch of frame fetches and decodes competes with it for the main
        // thread. decode() resolves at once if the poster is already there.
        const poster = stage.querySelector("img");
        const posterReady = poster ? poster.decode().catch(() => undefined) : Promise.resolve();
        void posterReady
          .then(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0))))
          .then(() => {
            if (!disposed) void loadAll();
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
      </div>
    </section>
  );
}
