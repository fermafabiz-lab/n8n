"use client";

import { useEffect, useRef, useState } from "react";
import { driveId, mediaSrc } from "@/lib/media";

/**
 * Plays a clip regardless of where it's hosted.
 *
 * Scene clips are SILENT: the voiceover is no longer burned into them (final
 * assembly mixes whatever voiceover the scene holds at render time, and
 * stretches the picture to it). So when a voice track is supplied, it is
 * layered on top here — the preview then always plays the current take
 * instead of whatever was baked in at generation time.
 *
 * Google Drive's uc?export=download links answer with redirects/HTML instead
 * of a video MIME type, so <video> refuses them. They go through /api/media,
 * which re-serves them with a real Content-Type and — unlike the old Railway
 * proxy — with byte ranges intact, which is what makes the clip seekable. If
 * that fails, we fall back to Drive's own embed player (which can't carry the
 * overlay).
 */

export default function MediaPlayer({
  url,
  audioUrl,
  portrait = false,
  maxHeight = 420,
  fill = false,
}: {
  url: string;
  /** Voiceover to play over the (silent) clip. */
  audioUrl?: string | null;
  portrait?: boolean;
  maxHeight?: number;
  // fill: stretch to the parent (e.g. the monitor screen area); the embedded
  // player letterboxes internally, so nothing gets cropped.
  fill?: boolean;
}) {
  const ratio = portrait ? "9 / 16" : "16 / 9";
  const id = url.includes("drive.google.com") ? driveId(url) : null;
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Keep the overlaid narration glued to the picture. The clip and the take
  // rarely have identical lengths — that mismatch is resolved at assembly by
  // retiming the picture, so here the audio simply runs on past the last
  // frame instead of being cut.
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const sync = () => {
      if (Math.abs(a.currentTime - v.currentTime) > 0.15) a.currentTime = v.currentTime;
    };
    const onPlay = () => {
      sync();
      void a.play().catch(() => {});
    };
    const onPause = () => a.pause();
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", sync);
    v.addEventListener("timeupdate", sync);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", sync);
      v.removeEventListener("timeupdate", sync);
      a.pause();
    };
  }, [url, audioUrl]);

  const frameStyle: React.CSSProperties = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        // No ground of its own. `contain` letterboxes a 16/9 clip inside the
        // monitor's 16/8.6 frame, and a black background here painted those
        // bars black over whatever the frame was set to — a heavy slab on a
        // light page. Transparent lets .scr's own card ground show, which is
        // the stepper card's ground, which is the point.
        background: "transparent",
        border: "none",
        display: "block",
        objectFit: "contain",
      }
    : {
        aspectRatio: ratio,
        width: portrait ? "auto" : "100%",
        height: portrait ? maxHeight : "auto",
        maxWidth: "100%",
        margin: "0 auto",
        display: "block",
        borderRadius: 12,
        background: "#000",
        border: "none",
      };

  if (id && failed) {
    return (
      <iframe
        src={`https://drive.google.com/file/d/${id}/preview`}
        style={frameStyle}
        allow="autoplay; fullscreen"
        allowFullScreen
      />
    );
  }

  return (
    <>
      <video
        ref={videoRef}
        src={mediaSrc(url)}
        controls
        preload="metadata"
        // The clip carries no narration; muting also stops any residual
        // ambience from doubling under the overlaid take.
        muted={!!audioUrl}
        onError={() => setFailed(true)}
        style={frameStyle}
      />
      {audioUrl && <audio ref={audioRef} src={mediaSrc(audioUrl)} preload="metadata" />}
    </>
  );
}
