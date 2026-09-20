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
 *
 * WHY THE SYNC BELOW DOES NOT SEEK (2026-09-20). Reviewing scenes one by one
 * had become unusable: press play, the clip loads, then either freezes or
 * "loads slower than it plays" until the two collide and stop. The cause was
 * measured, not guessed, and it was this effect.
 *
 * The picture is fast — every scene clip is stored on the box and Caddy
 * answers a byte range in ~25 ms. The VOICEOVER is not: all 48 takes of the
 * film under review live on Google Drive, none has a local copy, and a ranged
 * GET to Drive measured 1383 ms cold and 593-730 ms warm — 20 to 50 times the
 * local file. `/api/media` also marked every 206 `no-store`, so nothing was
 * ever reused.
 *
 * On top of that this effect used to hard-seek the audio whenever it drifted
 * more than 0.15 s, on `timeupdate` — which fires about four times a second.
 * Every correction was a fresh Drive round trip; during that second the audio
 * produced nothing, so the drift grew past 0.15 s again and the next
 * `timeupdate` seeked again. The audio could never catch up and the seek
 * storm dragged the picture down with it. A 0.15 s tolerance is tighter than
 * the media clock's own resolution, so on a slow source it could not have
 * settled even in principle.
 *
 * So: correct on the DELIBERATE moments only (play, and the user scrubbing),
 * nudge `playbackRate` for ordinary drift, and keep one rate-limited hard
 * seek for real desync. Nothing here fires on a timer faster than the drift
 * it is correcting.
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

    // Drift big enough to hear as lip-sync error. Well above the media
    // clock's resolution, so ordinary jitter never trips it.
    const HARD = 1;
    // Below this, do nothing at all — chasing it costs more than it buys.
    const SOFT = 0.12;
    // A seek on a slow source is expensive and self-defeating; never more
    // than one every few seconds, whatever the drift says.
    const RESEEK_MS = 3000;
    let lastSeek = 0;

    /** The deliberate moments: starting, and the producer scrubbing. */
    const hardSync = () => {
      lastSeek = Date.now();
      try {
        a.playbackRate = 1;
        a.currentTime = v.currentTime;
      } catch {
        /* seeking before metadata is ignored; the next play() fixes it */
      }
    };

    // Ordinary drift is corrected by running the audio a little faster or
    // slower, which costs nothing and is inaudible at these ratios. A seek is
    // the last resort, not the first: it discards the audio's buffer, which
    // on a slow source guarantees the next stall.
    const drift = () => {
      if (a.paused || v.paused || v.seeking) return;
      const d = v.currentTime - a.currentTime;
      const ad = Math.abs(d);
      if (ad < SOFT) {
        if (a.playbackRate !== 1) a.playbackRate = 1;
        return;
      }
      if (ad > HARD && Date.now() - lastSeek > RESEEK_MS) {
        hardSync();
        return;
      }
      // ±6%: enough to close a 0.9 s gap inside fifteen seconds, far below
      // the ~10% where a voice starts to sound wrong.
      a.playbackRate = d > 0 ? 1.06 : 0.94;
    };

    const onPlay = () => {
      hardSync();
      void a.play().catch(() => {});
    };
    const onPause = () => {
      a.pause();
      a.playbackRate = 1;
    };
    // The audio ran out of buffer. Correcting now would seek a source that is
    // already waiting for bytes, which is what made this loop pathological.
    const onWaiting = () => {
      a.playbackRate = 1;
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", hardSync);
    v.addEventListener("timeupdate", drift);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("stalled", onWaiting);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", hardSync);
      v.removeEventListener("timeupdate", drift);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("stalled", onWaiting);
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
      {/*
        `auto`, not `metadata`. A take is tens of kilobytes — the whole file
        costs one request, where `metadata` leaves the browser to range its
        way through a source that answers each range in about a second. There
        is nothing to save by fetching it lazily and a stall to lose.
      */}
      {audioUrl && <audio ref={audioRef} src={mediaSrc(audioUrl)} preload="auto" />}
    </>
  );
}
