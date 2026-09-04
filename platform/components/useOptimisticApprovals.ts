"use client";

import { useEffect, useMemo, useState } from "react";
import type { Scene } from "@/lib/data";

/**
 * Approvals that show on screen the moment they are pressed.
 *
 * The server action writes the row and revalidates, so the truth arrives with
 * the next render — a second or several later, and up to ten if the write
 * lands just after a refresh tick. Until then nothing on screen moved, which
 * reads as a click that did not register: the producer either waits, unsure,
 * or presses again. On a film where 213 decisions have to be made one at a
 * time, that pause is most of the work.
 *
 * So the press is believed immediately and the server confirms it afterwards.
 * The guess is dropped as soon as the server agrees, and — this is the part
 * that matters — dropped just the same when the server comes back DISAGREEING,
 * because a write can fail. The screen then returns to the truth rather than
 * keeping a green dot the database never accepted.
 */

export type ApprovalKind = "image" | "voice" | "video";

const FIELD = {
  image: "imageApproved",
  voice: "voiceApproved",
  video: "videoApproved",
} as const satisfies Record<ApprovalKind, keyof Scene>;

type Guesses = Record<string, Partial<Record<ApprovalKind, boolean>>>;

export function useOptimisticApprovals(scenes: Scene[]) {
  const [guesses, setGuesses] = useState<Guesses>({});

  /**
   * Drop every guess the server has now answered, whichever way it answered.
   *
   * Keyed on the scene rows themselves, so this runs on each new server
   * render. A guess that is never confirmed — the row vanished, the project
   * was deleted underneath us — goes with the scene it belonged to.
   */
  useEffect(() => {
    setGuesses((prev) => {
      if (!Object.keys(prev).length) return prev;
      const next: Guesses = {};
      for (const [id, kinds] of Object.entries(prev)) {
        const scene = scenes.find((s) => s.id === id);
        if (!scene) continue;
        const keep: Partial<Record<ApprovalKind, boolean>> = {};
        for (const [kind, want] of Object.entries(kinds) as [
          ApprovalKind,
          boolean,
        ][]) {
          if (scene[FIELD[kind]] !== want) keep[kind] = want;
        }
        if (Object.keys(keep).length) next[id] = keep;
      }
      return Object.keys(next).length === Object.keys(prev).length &&
        JSON.stringify(next) === JSON.stringify(prev)
        ? prev
        : next;
    });
  }, [scenes]);

  const view = useMemo(() => {
    if (!Object.keys(guesses).length) return scenes;
    return scenes.map((s) => {
      const g = guesses[s.id];
      if (!g) return s;
      const patched = { ...s };
      for (const [kind, want] of Object.entries(g) as [ApprovalKind, boolean][]) {
        (patched as Record<string, unknown>)[FIELD[kind]] = want;
      }
      return patched;
    });
  }, [scenes, guesses]);

  const guess = (sceneIds: string | string[], kind: ApprovalKind, value = true) =>
    setGuesses((prev) => {
      const next = { ...prev };
      for (const id of Array.isArray(sceneIds) ? sceneIds : [sceneIds]) {
        next[id] = { ...next[id], [kind]: value };
      }
      return next;
    });

  return { view, guess };
}
