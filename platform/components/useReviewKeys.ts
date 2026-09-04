"use client";

import { useEffect } from "react";

/**
 * Keyboard review for the scene board.
 *
 * A 71-scene film is 213 decisions — a picture, a take and a clip each. The
 * board offered exactly two ways through them: "Approve all 71", which is
 * approving without looking, or clicking the scene in the filmstrip, clicking
 * Approve, then hunting the strip for the next one that still owes something.
 * That second path is over 400 clicks, and most of them are navigation rather
 * than judgement. There was no way to actually LOOK at each scene quickly, so
 * in practice the bulk button wins and nobody reviews anything.
 *
 * So: the hands never leave the keyboard, and the board finds the next scene
 * itself. `A` approves and advances; the producer's whole job becomes look,
 * press, look, press.
 */

/**
 * The next scene that still owes a decision, starting after `from`.
 *
 * Forward first, then wrapping to what was skipped earlier in the film — so a
 * pass runs in the film's own order and only doubles back once it reaches the
 * end, instead of bouncing between chapters. Returns null when nothing is
 * left, which is what ends the pass rather than looping on the last scene.
 *
 * Pure and exported because this is the whole behaviour of the `A` key, and
 * the alternative — reading it out of a 1100-line component — is how a rule
 * like "must not re-select the scene just approved" gets quietly broken.
 */
export function pickNextOwing<T extends {id: string}>(
  list: T[],
  from: number,
  owes: (item: T) => boolean,
): T | null {
  if (from < 0 || from >= list.length) return null;
  for (let i = from + 1; i < list.length; i++) if (owes(list[i])) return list[i];
  for (let i = 0; i < from; i++) if (owes(list[i])) return list[i];
  return null;
}

export type ReviewKeyHandlers = {
  /** Approve what the current step is deciding on, then advance. */
  approve?: () => void;
  /** Move the selection one scene along the filmstrip. */
  next: () => void;
  prev: () => void;
  /** Put the cursor in the "what should change" box for this scene. */
  reject?: () => void;
  /** Play or pause whatever the monitor is showing. */
  togglePlay?: () => void;
  /** Off while a dialog owns the keyboard, or the board is not on screen. */
  enabled?: boolean;
};

/**
 * True when a keystroke belongs to something the producer is typing into.
 *
 * Without this, `a` in a rewrite note would approve the scene — the single
 * most damaging way to get a shortcut wrong, because the note field is right
 * next to the approve button and is exactly where someone types prose.
 */
const isTyping = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable === true
  );
};

export function useReviewKeys(h: ReviewKeyHandlers) {
  const { approve, next, prev, reject, togglePlay, enabled = true } = h;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Never steal a browser or OS shortcut, and never fire mid-sentence.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(document.activeElement)) return;

      switch (e.key) {
        case "a":
        case "A":
          if (!approve) return;
          e.preventDefault();
          approve();
          return;
        case "j":
        case "J":
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          next();
          return;
        case "k":
        case "K":
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          prev();
          return;
        case "r":
        case "R":
          if (!reject) return;
          e.preventDefault();
          reject();
          return;
        case " ":
          if (!togglePlay) return;
          // Space scrolls the page by default, which on a review screen moves
          // the thing you are looking at out of view.
          e.preventDefault();
          togglePlay();
          return;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approve, next, prev, reject, togglePlay, enabled]);
}
