"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Scene } from "@/lib/data";
import { mediaSrc } from "@/lib/media";
import styles from "./RoughCut.module.css";

/**
 * The film so far, playable at any point in production.
 *
 * Until now the producer gave 213 approvals one asset at a time and saw the
 * result exactly once — at the end, after a render that takes about 95 minutes
 * for an eight-minute film. If the pacing was wrong, that is when they found
 * out. Every part was reviewed; the film never was.
 *
 * Nothing new has to be generated to fix that. The scenes already hold the
 * clip and the take, and MediaPlayer already lays a voice over a silent clip —
 * this only puts them in order and plays them.
 *
 * **It works before any clip exists**, which is the part that matters most: a
 * scene with only a picture and a take plays as a still under its narration,
 * which is an animatic, and it is how real productions watch a film long
 * before it is shot. So the rough cut is available from the audio step onward
 * rather than at the very end.
 *
 * What it deliberately is NOT: the render. No montage framing, no captions
 * burned in, no chapter cards, no music, no breath trimming, and scene
 * lengths here are the take's own rather than the assembler's `voiceDur +
 * 0.35`. It is for judging pace, order and whether the story lands — the
 * things you cannot see in a filmstrip. The panel says so out loud, because a
 * preview mistaken for the final cut would send someone chasing differences
 * that are supposed to be there.
 */

type Cue = {
  scene: Scene;
  /** What carries the picture: a clip, a still, or nothing yet. */
  kind: "clip" | "still" | "blank";
  src: string | null;
  voice: string | null;
};

/** A still with no take still needs to be on screen long enough to read. */
const SILENT_STILL_SECONDS = 2.5;

export default function RoughCut({
  scenes,
  portrait = false,
  onClose,
}: {
  scenes: Scene[];
  portrait?: boolean;
  onClose: () => void;
}) {
  const cues = useMemo<Cue[]>(
    () =>
      scenes.map((scene) => {
        const clip = scene.videoUrl ? mediaSrc(scene.videoUrl) : null;
        const still = scene.imageUrl ? mediaSrc(scene.imageUrl) : null;
        return {
          scene,
          kind: clip ? "clip" : still ? "still" : "blank",
          src: clip ?? still,
          voice: scene.voiceUrl ? mediaSrc(scene.voiceUrl) : null,
        };
      }),
    [scenes],
  );

  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cue = cues[at] ?? null;
  const made = cues.filter((c) => c.kind !== "blank").length;

  const clearStill = () => {
    if (stillTimer.current) clearTimeout(stillTimer.current);
    stillTimer.current = null;
  };

  const goTo = useCallback((i: number) => {
    clearStill();
    setAt((prev) => {
      const next = Math.max(0, Math.min(cues.length - 1, i));
      return next === prev ? prev : next;
    });
  }, [cues.length]);

  /** End of a scene: the next one, or stop on the last. */
  const advance = useCallback(() => {
    clearStill();
    setAt((i) => {
      if (i + 1 >= cues.length) {
        setPlaying(false);
        return i;
      }
      return i + 1;
    });
  }, [cues.length]);

  /**
   * Drive whatever this scene is made of.
   *
   * The TAKE owns the timing wherever there is one — that is what the
   * assembler does too, giving each scene the length of its own narration and
   * stretching the picture to fit. Without a take, the clip's own length
   * decides; without either, a fixed beat so a still is readable rather than
   * flashing past.
   */
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    clearStill();
    if (v) {
      v.currentTime = 0;
      if (playing) void v.play().catch(() => {});
      else v.pause();
    }
    if (a) {
      a.currentTime = 0;
      if (playing) void a.play().catch(() => {});
      else a.pause();
    }
    if (playing && !a && cue?.kind !== "clip") {
      stillTimer.current = setTimeout(advance, SILENT_STILL_SECONDS * 1000);
    }
    return clearStill;
  }, [at, playing, cue?.kind, advance]);

  /**
   * The overlay owns the keyboard while it is up.
   *
   * SceneBoard's review keys listen on window, so without this `A` would
   * approve the scene behind the panel — a decision made on a film the
   * producer is watching rather than on the asset they are looking at.
   */
  useEffect(() => {
    document.body.dataset.overlay = "rough-cut";
    return () => {
      delete document.body.dataset.overlay;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") goTo(at + 1);
      else if (e.key === "ArrowLeft") goTo(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, goTo, onClose]);

  if (!cue) return null;

  return (
    <div className={styles.shade} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <h3>Rough cut</h3>
            {/* Stated rather than implied: this is not the render, and someone
                comparing it against the finished film must know why they
                differ before they start hunting for a bug. */}
            <p className={styles.caveat}>
              Order, pace and voice — no montage framing, captions, chapter
              cards or music. {made} of {cues.length} scenes have something to
              show.
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={`${styles.screen} ${portrait ? styles.portrait : ""}`}>
          {cue.kind === "clip" && cue.src ? (
            <video
              // Keyed so a new scene mounts a fresh element: reusing one and
              // swapping src leaves the previous frame on screen until the
              // next one decodes, which reads as a stutter at every cut.
              key={cue.scene.id}
              ref={videoRef}
              src={cue.src}
              muted
              playsInline
              onEnded={cue.voice ? undefined : advance}
              className={styles.media}
            />
          ) : cue.kind === "still" && cue.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={cue.scene.id} src={cue.src} alt="" className={styles.media} />
          ) : (
            <div className={styles.blank}>
              <span>{cue.scene.label}</span>
              <em>nothing generated yet</em>
            </div>
          )}

          {cue.voice && (
            <audio
              key={`${cue.scene.id}-voice`}
              ref={audioRef}
              src={cue.voice}
              onEnded={advance}
            />
          )}

          {cue.scene.narration && (
            <p className={styles.line}>{cue.scene.narration}</p>
          )}
        </div>

        <div className={styles.bar}>
          <button type="button" className={styles.play} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"}
          </button>
          <span className={styles.pos}>
            {cue.scene.label} · {at + 1} of {cues.length}
          </span>
          {/* One tick per scene: the shape of the film at a glance, and the
              only place its holes are visible as holes rather than as a list. */}
          <div className={styles.ticks}>
            {cues.map((c, i) => (
              <button
                key={c.scene.id}
                type="button"
                aria-label={c.scene.label}
                title={`${c.scene.label} — ${c.kind === "clip" ? "clip" : c.kind === "still" ? "still" : "not made yet"}`}
                className={`${styles.tick} ${
                  c.kind === "blank" ? styles.none : styles[c.kind]
                } ${i === at ? styles.here : ""}`}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
