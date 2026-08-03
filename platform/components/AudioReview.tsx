"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveVoices,
  changeProjectVoice,
  regenerateVoice,
  saveCastAssignments,
  sceneAction,
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

/**
 * Assembly retimes each shot to its own narration, but only within
 * 0.65×–1.5× (see remotion/server/assemble.mjs). Outside that band the shot
 * either freezes on its last frame or gets its tail cut — the only case where
 * a new take actually justifies re-generating the video.
 */
const STRETCH_MAX = 1.5;
const STRETCH_MIN = 0.65;

function fitProblem(voice: number | undefined, clip: number | undefined): string | null {
  if (!voice || !clip) return null;
  const needed = (voice + 0.35) / clip;
  if (needed > STRETCH_MAX) {
    const frozen = voice + 0.35 - clip * STRETCH_MAX;
    return `Longer than its shot — the picture would hold still for ~${frozen.toFixed(1)}s`;
  }
  if (needed < STRETCH_MIN) return "Much shorter than its shot — the tail gets cut";
  return null;
}

/**
 * Which cast voice reads a scene, in chapters mode. Mirrors AB Pick Voice /
 * VR Pick Voice in n8n exactly — a label computed from a different rule than
 * the audio is worse than no label. Returns -1 for the hook, which keeps the
 * project's own narrator rather than a cast voice.
 */
export function castIndexFor(order: number, castSize: number): number {
  if (castSize <= 0) return -1;
  const ch = Math.floor(order / 100);
  if (ch <= 0) return -1;
  return (ch - 1) % castSize;
}

/** Speaker names in a tagged line, in speaking order (characters mode). */
function speakersOf(narration: string | null): string[] {
  const out: string[] = [];
  for (const m of String(narration ?? "").matchAll(/\[\s*(NARRATOR|CHARACTER:\s*([^\]]+))\s*\]/gi)) {
    const name = m[2] ? m[2].trim() : "Narrator";
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** All characters across the project, in first-appearance order — the same
 *  deterministic rule n8n uses to auto-assign cast voices. */
function discoverCharacters(scenes: Scene[]): string[] {
  const out: string[] = [];
  for (const s of [...scenes].sort((a, b) => a.order - b.order)) {
    for (const name of speakersOf(s.narration)) {
      if (name !== "Narrator" && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

const shortVoice = (id: string) => {
  const [provider, ...rest] = id.split("_");
  const tail = rest.join("_");
  return `${provider} · …${tail.slice(-6)}`;
};

export default function AudioReview({
  projectId,
  scenes,
  mode = "off",
  cast = [],
  castAssign = {},
}: {
  projectId: string;
  scenes: Scene[];
  /** Project multi-voice mode: "off" | "characters" | "chapters". */
  mode?: string;
  cast?: string[];
  castAssign?: Record<string, string>;
}) {
  // How many real chapters the script produced — the hook (order < 100) is not
  // one. n8n reads this from the project's linked chapters because its own
  // loop only ever sees a capped batch; here the whole project is in hand, so
  // counting the scenes gives the same answer.
  const chapterCount =
    new Set(
      scenes.map((s) => Math.floor(s.order / 100)).filter((c) => c > 0),
    ).size || 1;
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playAll, setPlayAll] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [clipDurations, setClipDurations] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showVoice, setShowVoice] = useState(false);
  const [assign, setAssign] = useState<Record<string, string>>(castAssign);
  const characters = useMemo(() => discoverCharacters(scenes), [scenes]);
  const assignDirty =
    mode === "characters" &&
    characters.some((c) => (assign[c] ?? "") !== (castAssign[c] ?? ""));
  const voiceOf = (name: string): string => {
    const a = assign[name];
    if (a && a.includes("_")) return a;
    const i = characters.indexOf(name);
    return cast[(i >= 0 ? i : 0) % Math.max(1, cast.length)] ?? "";
  };
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

  // Shot lengths, for the same reason: knowing both sides is what tells us
  // whether a take still fits the picture it belongs to.
  useEffect(() => {
    let cancelled = false;
    for (const s of scenes) {
      if (!s.videoUrl || clipDurations[s.id] !== undefined) continue;
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = audioSrc(s.videoUrl);
      v.addEventListener("loadedmetadata", () => {
        if (!cancelled && Number.isFinite(v.duration)) {
          setClipDurations((d) => ({ ...d, [s.id]: v.duration }));
        }
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes.filter((s) => s.videoUrl).length]);

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

      {mode === "chapters" && cast.length > 0 && (
        <p className="formmsg ok" style={{ marginBottom: 12 }}>
          Narrator-per-chapter is on: chapter 1 is read by voice #1, chapter 2
          by voice #2… ({cast.length} narrator{cast.length === 1 ? "" : "s"} in
          the cast; the hook keeps the main narrator).
        </p>
      )}

      {mode === "chapters" && cast.length > chapterCount && (
        <p className="formmsg" style={{ marginBottom: 12 }}>
          This script came out as {chapterCount} chapter
          {chapterCount === 1 ? "" : "s"} but the cast has {cast.length} voices,
          so voice{cast.length - chapterCount === 1 ? "" : "s"} #
          {chapterCount + 1}
          {cast.length - chapterCount === 1 ? "" : `–#${cast.length}`} will not
          be used. Chapter count follows the video length (one per ~2 minutes) —
          for a short video, put the voice you want on the chapters first in the
          cast and leave the narrator out of it.
        </p>
      )}

      {mode === "characters" && (
        <div className="card" style={{ padding: "14px 16px", marginBottom: 14 }}>
          <div className="kv" style={{ borderBottom: "none", paddingBottom: 8 }}>
            <h5 style={{ margin: 0 }}>Cast — who speaks with which voice</h5>
            {assignDirty && (
              <button
                className="abtn ok"
                disabled={pending}
                onClick={() => run(() => saveCastAssignments(projectId, assign))}
              >
                Save cast
              </button>
            )}
          </div>
          {characters.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--soft)" }}>
              No character tags found in the scenes yet — dialogue lines appear
              here as <code>[CHARACTER: Name]</code> once the script is written.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {characters.map((name, i) => (
                <div
                  key={name}
                  style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
                >
                  <b style={{ fontSize: 13, minWidth: 140 }}>{name}</b>
                  <select
                    value={voiceOf(name)}
                    onChange={(e) => setAssign((p) => ({ ...p, [name]: e.target.value }))}
                    style={{ width: "auto" }}
                  >
                    {cast.map((v, k) => (
                      <option key={v} value={v}>
                        Voice #{k + 1} — {shortVoice(v)}
                      </option>
                    ))}
                  </select>
                  {i < cast.length ? null : (
                    <span className="chip wait">shares a voice — cast is smaller than the cast list</span>
                  )}
                </div>
              ))}
              <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
                Changing a voice applies to lines you regenerate afterwards —
                already-synthesized takes keep their audio until regenerated.
              </p>
            </div>
          )}
        </div>
      )}

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
          const fit = fitProblem(durations[s.id], clipDurations[s.id]);
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
                    {mode === "chapters" && cast.length > 0 && (() => {
                      const ch = Math.floor(s.order / 100);
                      const vi = castIndexFor(s.order, cast.length);
                      return (
                        <span className="chip">
                          {vi < 0
                            ? "Hook · main narrator"
                            : `Ch. ${ch} · Voice #${vi + 1}`}
                        </span>
                      );
                    })()}
                    {mode === "characters" &&
                      speakersOf(s.narration).map((name) => (
                        <span key={name} className="chip">
                          {name === "Narrator" ? "Narrator" : `🗣 ${name}`}
                        </span>
                      ))}
                    {s.voiceApproved && <span className="chip ok">Approved</span>}
                    {flag && <span className="chip wait">{flag}</span>}
                    {fit && <span className="chip wait">{fit}</span>}
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
                      {/* Only offered when the shot genuinely can't cover the
                          take — every other length difference is absorbed by
                          retiming at assembly, so re-rendering would be
                          paying Flow for nothing. */}
                      {fit && !s.regenVideo && (
                        <button
                          className="abtn"
                          disabled={pending}
                          onClick={() =>
                            run(() => sceneAction(projectId, s.id, "video", "regenerate"))
                          }
                        >
                          🎬 Regenerate video for this scene
                        </button>
                      )}
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
