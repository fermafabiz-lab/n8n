"use client";

import { useEffect, useRef } from "react";
import { preload } from "react-dom";

/**
 * Scroll-scrubbed frame sequence on a <canvas>.
 *
 * Layout (see globals.css): a 260vh section with a sticky 100vh stage. The
 * first 100vh of track scrubs the film; the last 60vh opens the door.
 *
 * The door: a div sized and placed over the lit doorway of the final frame,
 * in its colour, which grows from that rectangle until it fills the stage and
 * hands off to the section below in the same colour. Scroll writes nothing
 * but transform and opacity — the div's box is set on resize only.
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
//   1. `manifest.json` beside the frames — `{"count": 72}`. It is uploaded
//      with them, so a new sequence needs no rebuild. This is the one to use.
//   2. this constant, which answers when there is no manifest.
//
// Keep the constant matching whatever is on the box, so the fallback is right
// rather than merely present.
const FALLBACK_FRAME_COUNT = 72;
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

/**
 * The doorway in the final frame, as fractions of the FRAME (not the
 * viewport) — the canvas draws cover-cropped, so these are mapped through the
 * same cover transform before they mean anything in pixels.
 *
 * Measured off the real frame 72 on 2026-09-18: the lit opening of the front
 * door, and the mean colour of its bright warm pixels. Like the frame count,
 * the manifest wins over this constant, so re-cutting the film is an upload;
 * this is what answers when the manifest has no door.
 */
const FALLBACK_DOOR: Door = { x: 0.4625, y: 0.3905, w: 0.1099, h: 0.3881, light: "#e4b068" };

// How much scroll the door gets after the sequence ends, as a share of the
// viewport height. Kept in step with the hero's height in globals.css.
const DOOR_TRACK_VH = 60;
// The door finishes covering slightly before the track does, so the colour
// holds for a beat before the stage unpins into the section below.
const DOOR_COVER_AT = 0.9;
// A margin on the final scale so no edge of the div can show at the corners.
const DOOR_OVERSHOOT = 1.04;

type Door = { x: number; y: number; w: number; h: number; light: string };

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
 * A malformed count is REFUSED, never coerced. "72", 0 and 1e9 are all
 * mistakes, and guessing what one meant would scrub through a film that is
 * not there.
 */
async function readManifest(signal: AbortSignal): Promise<{ count: number; door: Door }> {
  const fallback = { count: FALLBACK_FRAME_COUNT, door: FALLBACK_DOOR };
  try {
    const res = await fetch(MANIFEST_SRC, { signal, cache: "no-store" });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { count?: unknown; door?: unknown } | null;
    return { count: readCount(data?.count), door: readDoor(data?.door) };
  } catch {
    return fallback;
  }
}

function readCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return FALLBACK_FRAME_COUNT;
  if (raw < 1 || raw > MAX_FRAME_COUNT) return FALLBACK_FRAME_COUNT;
  return raw;
}

/**
 * A door is refused whole, never patched. A rectangle with three good numbers
 * and one bad one would put the transition somewhere that is not the door,
 * which looks like a bug in the film rather than in the manifest.
 */
function readDoor(raw: unknown): Door {
  if (!raw || typeof raw !== "object") return FALLBACK_DOOR;
  const d = raw as Record<string, unknown>;
  const nums = ["x", "y", "w", "h"].map((k) => d[k]);
  if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) return FALLBACK_DOOR;
  const [x, y, w, h] = nums as number[];
  if (w <= 0 || h <= 0) return FALLBACK_DOOR;
  if (x < 0 || y < 0 || x + w > 1 || y + h > 1) return FALLBACK_DOOR;
  const light = typeof d.light === "string" && /^#[0-9a-f]{6}$/i.test(d.light) ? d.light : FALLBACK_DOOR.light;
  return { x, y, w, h, light };
}

export default function ScrollHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doorRef = useRef<HTMLDivElement>(null);

  // Emits <link rel="preload"> for the poster during SSR so it is the first
  // request after the document, which is what keeps LCP short.
  preload(POSTER_SRC, { as: "image", fetchPriority: "high" });

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const doorEl = doorRef.current;
    if (!section || !stage || !canvas || !doorEl) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const narrow = window.matchMedia(NARROW_QUERY);
    const reduced = window.matchMedia(REDUCED_MOTION_QUERY);

    // Both are empty until the manifest has answered; nothing draws before
    // then, because `tick` returns while `firstBatchDone` is false.
    let frameCount = FALLBACK_FRAME_COUNT;
    let door = FALLBACK_DOOR;
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
    let lastDoorScale = -1;
    let lastDoorOpacity = -1;
    let lastCanvasOpacity = -1;
    let doorTargetScale = 1;

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

    // The hero's track is two stretches: the film scrubs over the first, the
    // door opens over the last DOOR_TRACK_VH of viewport height.
    //
    // ONE layout read per tick, and it is this one. Section and viewport
    // heights are cached by the ResizeObserver instead of being read here,
    // so the tick reads a rect and then only writes.
    const scrolled = (): number => -section.getBoundingClientRect().top;

    const doorTrackPx = () => (viewportH * DOOR_TRACK_VH) / 100;
    const scrubRangePx = () => Math.max(1, sectionH - viewportH - doorTrackPx());

    // 0..1 across the film only.
    const progressFrom = (y: number): number => clamp01(y / scrubRangePx());
    // 0..1 across the door stretch that follows it.
    const doorFrom = (y: number): number => clamp01((y - scrubRangePx()) / doorTrackPx());

    const targetIndexFrom = (y: number): number => Math.round(progressFrom(y) * (frameCount - 1));

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.max(1, Math.round(cssWidth * dpr));
      const h = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      // Either assignment above clears the bitmap, so the caller must redraw.
    };

    /**
     * Places the door div over the doorway and works out how far it has to
     * grow to fill the stage.
     *
     * Runs on RESIZE ONLY, never on scroll: this is the one place that writes
     * layout properties, so the scroll path is left with nothing but transform
     * and opacity. The rect is mapped through the same cover transform the
     * canvas draws with, otherwise the div would drift off the doorway on any
     * viewport that is not the frame's aspect.
     */
    const placeDoor = () => {
      const sample = frames.find((f) => f) ?? null;
      const iw = sample?.naturalWidth || 1600;
      const ih = sample?.naturalHeight || 900;
      if (cssWidth <= 0 || cssHeight <= 0) return;

      const cover = Math.max(cssWidth / iw, cssHeight / ih);
      const dw = iw * cover;
      const dh = ih * cover;
      const ox = (cssWidth - dw) / 2;
      const oy = (cssHeight - dh) / 2;

      const left = ox + door.x * dw;
      const top = oy + door.y * dh;
      const w = Math.max(1, door.w * dw);
      const h = Math.max(1, door.h * dh);

      doorEl.style.left = `${left}px`;
      doorEl.style.top = `${top}px`;
      doorEl.style.width = `${w}px`;
      doorEl.style.height = `${h}px`;
      doorEl.style.background = door.light;
      // One owner for the colour. The section below reads this variable, so a
      // manifest that changes the light changes the handoff too, instead of
      // leaving a hardcoded background behind to drift out of step.
      document.documentElement.style.setProperty("--door-light", door.light);

      // Grown about its own centre, so the reach is to the furthest edge.
      const cx = left + w / 2;
      const cy = top + h / 2;
      const sx = (2 * Math.max(cx, cssWidth - cx)) / w;
      const sy = (2 * Math.max(cy, cssHeight - cy)) / h;
      doorTargetScale = Math.max(sx, sy) * DOOR_OVERSHOOT;
      lastDoorScale = -1; // force the next tick to write the transform
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

      // ---- the door ------------------------------------------------------
      // Scale is exponential rather than linear: apparent size grows by a
      // constant ratio per unit of scroll, which is what reads as moving
      // through the doorway at an even pace. A linear ramp crawls at the
      // start and lurches at the end.
      const d = doorFrom(y);
      const cover = clamp01(d / DOOR_COVER_AT);
      const scale = cover <= 0 ? 1 : Math.pow(doorTargetScale, cover);
      // Fading in over the first stretch hides any mismatch between the div's
      // rectangle and the doorway's real edges — it arrives as light, not as
      // a block dropped on the frame.
      const doorOpacity = clamp01(d / 0.22);
      // The canvas goes once the door is nearly covering, so the browser
      // stops compositing a full-screen bitmap nobody can see.
      const canvasOpacity = 1 - clamp01((d - 0.55) / 0.35);

      if (scale !== lastDoorScale) {
        doorEl.style.transform = `scale(${scale.toFixed(4)})`;
        lastDoorScale = scale;
      }
      if (doorOpacity !== lastDoorOpacity) {
        doorEl.style.opacity = String(Number(doorOpacity.toFixed(3)));
        lastDoorOpacity = doorOpacity;
      }
      if (canvasOpacity !== lastCanvasOpacity) {
        canvas.style.opacity = String(Number(canvasOpacity.toFixed(3)));
        lastCanvasOpacity = canvasOpacity;
      }
      section.dataset.door = d.toFixed(3);

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
        const manifestReady = readManifest(controller.signal);

        // Let the poster (the LCP element) decode and paint before the first
        // batch of frame fetches and decodes competes with it for the main
        // thread. decode() resolves at once if the poster is already there.
        const poster = stage.querySelector("img");
        const posterReady = poster ? poster.decode().catch(() => undefined) : Promise.resolve();
        void posterReady
          .then(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0))))
          .then(() => manifestReady)
          .then((m) => {
            if (disposed) return;
            // Settled before the first draw, so the scroll-to-frame mapping
            // never changes under the viewer's finger.
            frameCount = m.count;
            door = m.door;
            frames = new Array(frameCount).fill(null);
            section.dataset.count = String(frameCount);
            placeDoor();
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
      placeDoor();
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
        {/* The doorway. Its box is written on resize; scroll only ever sets
            transform and opacity on it. */}
        <div ref={doorRef} className="hero__door" aria-hidden="true" />
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
