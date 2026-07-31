"use client";

import { useEffect } from "react";

/**
 * Plays a short two-tone ding when any watched item moves INTO a stage that
 * needs the user (review gates, finished, error), or when a "count:" item
 * changes (a new scene/image/clip landed). The page re-renders itself via
 * AutoRefresh, so this only diffs incoming stages against the last ones seen
 * in this browser session (sessionStorage survives refreshes and remounts).
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
  "voice-review",
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

function playNotes(notes: Array<[number, number]>, gainPeak = 0.18) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
      if (ctx.state === "suspended") return;
    }
    const t0 = ctx.currentTime;
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(gainPeak, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.75);
    }
  } catch {
    // Audio unavailable — never break the page over a chime.
  }
}

// Classic pleasant "ding" — something finished / needs review.
export function ding() {
  playNotes([
    [1318.5, 0],
    [1760, 0.12],
  ]);
}

// Urgent descending triple — production stalled / attention required.
export function alarm() {
  playNotes(
    [
      [880, 0],
      [660, 0.18],
      [440, 0.36],
    ],
    0.22,
  );
}

export function markTitle() {
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
  // key: stable id, stage: current pipeline stage, or "count:N" values that
  // ding on every change (new asset landed).
  items: Array<{ key: string; stage: string }>;
}) {
  const signature = JSON.stringify(items);

  useEffect(() => {
    const store = readStore();
    let changed = false;
    let shouldDing = false;

    for (const { key, stage } of items) {
      const prev = store[key];
      if (prev !== stage) {
        store[key] = stage;
        changed = true;
        // Ding on transitions into alert stages and on any count change —
        // but never on the very first sighting of a key (page load of a
        // fresh session isn't news).
        if (
          prev !== undefined &&
          (ALERT_STAGES.has(stage) || stage.startsWith("count:"))
        ) {
          shouldDing = true;
        }
      }
    }
    if (changed) sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
    if (shouldDing) {
      ding();
      markTitle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return null;
}
