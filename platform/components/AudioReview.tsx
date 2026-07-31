"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveVoices,
  changeProjectVoice,
  regenerateVoice,
  type ActionResult,
} from "@/app/actions";
import type { Scene } from "@/lib/data";
import RegenBadge from "@/components/RegenBadge";
import VoicePicker from "@/components/VoicePicker";

/**
 * Voice review gate — sits between scene approval and video generation.
 *
 * Video is by far the most expensive step, and until now a voiceover could
 * only be heard after its clip already existed. Reviewing audio first means a
 * mispronunciation costs one re-synthesis instead of a re-render plus a
 * re-mux.
 *
 * The panel is built for scanning, not for clicking through lines: "Play all"
 * runs the whole narration end to end and follows along, and the table flags
 * the lines worth stopping on so the rest never need to be opened.
 */

/** Drive links are proxied — the native player needs a real MIME type. */
const audioSrc = (voiceUrl: string): string => {
  const id = voiceUrl.match(/[?&]id=([\w-]+)/)?.[1] ?? "";
  return id ? `https://n8n-production-55dd.up.railway.app/media?id=${id}` : voiceUrl;
};

/**
 * Narration is written to ~22 words per 8s scene, so a line's duration should
 * land near words / 2.6 seconds. A large miss means the take is clipped,
 * rushed, or the TTS swallowed a chunk — exactly what's worth listening to.
 */
function flagFor(scene: Scene, duration: number | undefined): string | null {
  if (!scene.voiceUrl) return "No audio generated";
  if (duration === undefined) return null;
  if (duration < 1) return "Almost silent";
  const words = (scene.narration ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) return null;
  const expected = words / 2.6;
  if (duration < expected * 0.6) return "Much shorter than the text";
  if (duration > expected * 1.7) return "Much longer than the text";
  return null;
}

export default function AudioReview({
  projectId,
  scenes,
}: {
  projectId: string;
  scenes: Scene[];
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playAll, setPlayAll] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showVoice, setShowVoice] = useState(false);
  const [newVoice, setNewVoice] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const withAudio = useMemo(() => scenes.filter((s) => s.voiceUrl), [scenes]);
  const unapproved = scenes.filter((s) => !s.voiceApproved && s.voiceUrl);
  const missing = scenes.filter((s) => !s.voiceUrl).length;
  const approved = scenes.filter((s) => s.voiceApproved).length;

  // Read every line's real duration once, off-screen, so the table can flag
  // outliers without the reviewer opening a single player.
  useEffect(() => {
    let cancelled = false;
    for (const s of withAudio) {
      if (durations[s.id] !== undefined || !s.voiceUrl) continue;
      const a = new Audio(audioSrc(s.voiceUrl));
      a.preload = "metadata";
      a.addEventListener("loadedmetadata", () => {
        if (!cancelled && Number.isFinite(a.duration)) {
          setDurations((d) => ({ ...d, [s.id]: a.duration }));
        }
      });
      a.addEventListener("error", () => {
        if (!cancelled) setDurations((d) => ({ ...d, [s.id]: 0 }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withAudio.length]);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
    setPlayAll(false);
  };

  const playFrom = (index: number, continuous: boolean) => {
    const scene = withAudio[index];
    if (!scene?.voiceUrl) return stop();
    audioRef.current?.pause();
    const a = new Audio(audioSrc(scene.voiceUrl));
    audioRef.current = a;
    setPlayingId(scene.id);
    setPlayAll(continuous);
    a.onended = () => {
      if (continuous && index + 1 < withAudio.length) playFrom(index + 1, true);
      else stop();
    };
    a.onerror = () => stop();
    void a.play().catch(() => stop());
  };

  useEffect(() => () => audioRef.current?.pause(), []);

  const run = async (fn: () => Promise<ActionResult>) => {
    setPending(true);
    setMsg(await fn());
    setPending(false);
  };

  const fmt = (d: number | undefined) =>
    d === undefined ? "…" : d === 0 ? "—" : `${d.toFixed(1)}s`;
  const totalSeconds = withAudio.reduce((a, s) => a + (durations[s.id] ?? 0), 0);

  return (
    <div className="script" style={{ marginTop: 24 }}>
      <div className="sechead">
        <h2>Voice review</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--soft)" }}>
            {approved}/{scenes.length} approved
          </span>
          <button
            className="btn"
            disabled={withAudio.length === 0}
            onClick={() => (playAll ? stop() : playFrom(0, true))}
          >
            {playAll ? "■ Stop" : "▶ Play all"}
          </button>
          {unapproved.length > 0 && (
            <button
              className="btn gold"
              disabled={pending || missing > 0}
              title={
                missing > 0
                  ? `${missing} scene(s) still have no audio — wait for them before approving.`
                  : undefined
              }
              onClick={() =>
                run(() => approveVoices(projectId, unapproved.map((s) => s.id)))
              }
            >
              {pending ? "…" : `Approve all ${unapproved.length}`}
            </button>
          )}
        </div>
      </div>

      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--soft)" }}>
        Listen before the clips are rendered — video is the expensive step, so
        fixing a line here costs one re-synthesis instead of a re-render.
        {totalSeconds > 0 && (
          <>
            {" "}
            Full narration: <b>{Math.round(totalSeconds)}s</b> across{" "}
            {withAudio.length} lines.
          </>
        )}
      </p>

      {withAudio.length === 0 ? (
        <p className="formmsg" style={{ marginBottom: 12 }}>
          Narration is being synthesized for all {scenes.length} scenes — the
          takes appear here one by one, usually within a couple of minutes. The
          page refreshes itself.
        </p>
      ) : missing > 0 ? (
        <p className="formmsg" style={{ marginBottom: 12 }}>
          {missing} scene{missing === 1 ? "" : "s"} still being synthesized —
          approving unlocks video generation, so it stays locked until every
          line exists.
        </p>
      ) : null}
      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}

      {/* Project-wide narrator swap. */}
      <div style={{ marginBottom: 14 }}>
        {showVoice ? (
          <div className="card" style={{ padding: "14px 16px" }}>
            <VoicePicker
              label="New narrator for the whole project — press ▶ to listen"
              value={newVoice}
              onChange={setNewVoice}
            />
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="abtn"
                disabled={pending || !newVoice.trim()}
                onClick={() =>
                  run(async () => {
                    const r = await changeProjectVoice(
                      projectId,
                      newVoice.trim(),
                      scenes.map((s) => s.id),
                    );
                    if (r.ok) setShowVoice(false);
                    return r;
                  })
                }
              >
                Re-synthesize all with this voice
              </button>
              <button className="abtn" onClick={() => setShowVoice(false)}>
                Cancel
              </button>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
              This replaces the narrator for every line, so it discards all the
              current takes.
            </p>
          </div>
        ) : (
          <button className="abtn" onClick={() => setShowVoice(true)}>
            🎚 Change narrator for the whole project
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {scenes.map((s, i) => {
          const flag = flagFor(s, durations[s.id]);
          const isPlaying = playingId === s.id;
          const draft = drafts[s.id];
          const dirty = draft !== undefined && draft !== (s.narration ?? "");
          const audioIndex = withAudio.findIndex((w) => w.id === s.id);
          return (
            <div
              className="card"
              key={s.id}
              style={{
                padding: "12px 14px",
                outline: isPlaying ? "2px solid var(--amber)" : undefined,
                borderLeft: flag ? "3px solid var(--amber)" : undefined,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <button
                  className="abtn"
                  disabled={!s.voiceUrl}
                  style={{ minWidth: 44, padding: "6px 10px" }}
                  onClick={() => (isPlaying ? stop() : playFrom(audioIndex, false))}
                >
                  {isPlaying ? "■" : "▶"}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginBottom: 4,
                    }}
                  >
                    <b style={{ fontSize: 12.5 }}>S{i + 1}</b>
                    <span
                      style={{ fontSize: 12, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmt(durations[s.id])}
                    </span>
                    {s.voiceApproved && <span className="chip ok">Approved</span>}
                    {flag && <span className="chip wait">{flag}</span>}
                  </div>
                  <textarea
                    value={draft ?? s.narration ?? ""}
                    onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: e.target.value }))}
                    rows={2}
                    spellCheck={false}
                    style={{
                      width: "100%",
                      background: "var(--bg2)",
                      border: "1px solid var(--line2)",
                      borderRadius: 8,
                      color: "var(--ink)",
                      font: "inherit",
                      fontSize: 13,
                      lineHeight: 1.55,
                      padding: "8px 10px",
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                  {s.regenVoice ? (
                    <RegenBadge label="Re-synthesizing…" note={s.note} />
                  ) : (
                    <div className="abtns" style={{ marginTop: 8 }}>
                      {!s.voiceApproved && s.voiceUrl && (
                        <button
                          className="abtn ok"
                          disabled={pending}
                          onClick={() => run(() => approveVoices(projectId, [s.id]))}
                        >
                          Approve
                        </button>
                      )}
                      <button
                        className="abtn"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            regenerateVoice(projectId, s.id, draft ?? s.narration ?? ""),
                          )
                        }
                      >
                        {dirty ? "🎙 Save text & re-synthesize" : "🎙 Regenerate"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
