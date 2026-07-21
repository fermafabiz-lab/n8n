"use client";

import { useEffect, useRef } from "react";

/**
 * Plays a short two-tone ding when any watched item moves INTO a stage that
 * needs the user (review gates, finished, error). The page already re-renders
 * itself via AutoRefresh, so this only has to diff the incoming stages
 * against the last ones seen in this browser session.
 *
 * Browsers only allow audio after the user has interacted with the page once
 * (any click/keypress since the tab was opened counts), which matches the
 * "site open in a tab" use case. A ● is also prepended to the tab title so a
 * missed ding is still visible.
 */

// Stages worth interrupting someone for.
const ALERT_STAGES = new Set([
  "script-review",
  "scene-review",
  "image-review",
  "video-review",
  "needs-review",
  "finished",
  "error",
]);

const STORE_KEY = "vf-stage-chime";

function readStore(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

let ctx: AudioContext | null = null;

function ding() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") {
      // No user gesture yet — the browser won't let us play. Skip silently;
      // the title marker still shows.
      void ctx.resume();
      if (ctx.state === "suspended") return;
    }
    const t0 = ctx.currentTime;
    // Two soft sine notes (E6 then A6) with a fast decay — a classic "ding".
    for (const [freq, at] of [
      [1318.5, 0],
      [1760, 0.12],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.18, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.75);
    }
  } catch {
    // Audio unavailable — never break the page over a chime.
  }
}

function markTitle() {
  if (document.visibilityState === "visible") return;
  const original = document.title.replace(/^● /, "");
  document.title = `● ${original}`;
  const clear = () => {
    document.title = original;
    document.removeEventListener("visibilitychange", clear);
  };
  document.addEventListener("visibilitychange", clear);
}

export default function StageChime({
  items,
}: {
  // key: stable id (project id), stage: current pipeline stage.
  items: Array<{ key: string; stage: string }>;
}) {
  const signature = JSON.stringify(items);
  const first = useRef(true);

  useEffect(() => {
    const store = readStore();
    let changed = false;
    let shouldDing = false;

    for (const { key, stage } of items) {
      const prev = store[key];
      if (prev !== stage) {
        store[key] = stage;
        changed = true;
        // Only ding on a *transition* into an alert stage, and never on the
        // very first sighting of this tab (page load isn't news).
        if (prev !== undefined && ALERT_STAGES.has(stage)) shouldDing = true;
      }
    }
    if (changed) sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
    if (shouldDing && !first.current) {
      ding();
      markTitle();
    }
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return null;
}
