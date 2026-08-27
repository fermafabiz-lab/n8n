"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveVoices,
  changeProjectVoice,
  regenerateVoice,
  reopenStep,
  saveCastAssignments,
  saveChapterVoices,
  sceneAction,
  useChapterNarrators,
  useSingleNarrator,
  type ActionResult,
} from "@/app/actions";
import type { Scene } from "@/lib/data";
import { useVoiceLabels, useVoiceNames } from "@/lib/voice-names";
import { downloadSrc, mediaSrc } from "@/lib/media";
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

/**
 * Drive links are proxied — the native player needs a real MIME type, and
 * /api/media keeps byte ranges intact so a take can actually be scrubbed.
 */
const audioSrc = mediaSrc;

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


export default function AudioReview({
  projectId,
  scenes,
  mode = "off",
  narratorVoice = "",
  cast = [],
  castAssign = {},
  chapterVoices = {},
  language = "",
  projectName = "",
}: {
  projectId: string;
  scenes: Scene[];
  /** Only used to name downloaded files — a take called "S3 narration.mp3"
   *  is indistinguishable from every other project's third take. */
  projectName?: string;
  /** Project multi-voice mode: "off" | "characters" | "chapters". */
  mode?: string;
  /** The project narrator's voice id — offered in the per-scene picker. */
  narratorVoice?: string;
  cast?: string[];
  castAssign?: Record<string, string>;
  /** Chapter number (and "hook") -> voice id, overriding the cast order. */
  chapterVoices?: Record<string, string>;
  /**
   * The film's spoken language. Every picker here narrows to voices that
   * speak it, the same way the creation form does — otherwise a Romanian
   * project offers the English library again the moment a voice is swapped.
   */
  language?: string;
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
  // Per-scene voice choice for the next regeneration. Empty = the mode's own
  // rule (chapter narrator / character voice / project narrator) — exactly
  // today's behaviour. A concrete id is sent with the regen webhook and wins
  // over every rule in n8n, for this one synthesis.
  const [voiceSel, setVoiceSel] = useState<Record<string, string>>({});
  // Scene whose "any other voice" search is open (full library picker).
  const [voiceSearchFor, setVoiceSearchFor] = useState<string | null>(null);
  // Every voice this panel can name: the narrator, the cast, and whatever
  // the chapters were reassigned to.
  const voiceName = useVoiceNames([
    narratorVoice,
    ...cast,
    ...Object.values(chapterVoices),
    // Voices pinned to a single line come from the whole library, so they
    // are not in the cast and have to be looked up too.
    ...Object.values(voiceSel),
  ]);
  const shortVoice = (id: string) => voiceName(id);
  // Cast options name the gender too — see useVoiceLabels.
  const voiceLabel = useVoiceLabels([narratorVoice, ...cast]);
  // The pickable set: the narrator first, then the cast (deduplicated).
  // Narrator alone still yields a useful menu on single-voice projects —
  // offering ONLY the cast made the selector a list of one on exactly the
  // projects that needed it.
  const knownVoices: Array<{ id: string; label: string }> = [
    ...(narratorVoice.includes("_")
      ? [{ id: narratorVoice, label: `${shortVoice(narratorVoice)} — narrator` }]
      : []),
    ...cast
      .filter((v) => v !== narratorVoice)
      .map((v) => ({ id: v, label: shortVoice(v) })),
  ];
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ---- chapters mode -------------------------------------------------
  // Scene order encodes the chapter: 101/102 are chapter 1, 201 chapter 2,
  // anything under 100 is the hook. n8n derives it the same way, and so
  // does castIndexFor above.
  const chapterOf = (s: Scene): number =>
    Number.isFinite(s.order) ? Math.floor(s.order / 100) : 0;
  // Every chapter present, in order, with "hook" first when one exists.
  const chapterKeys = useMemo(() => {
    const nums = [...new Set(scenes.map(chapterOf).filter((c) => c > 0))].sort(
      (a, b) => a - b,
    );
    const keys = nums.map(String);
    return scenes.some((s) => chapterOf(s) === 0) ? ["hook", ...keys] : keys;
  }, [scenes]);
  /** What a chapter is read by today: an explicit pick, else the cast order. */
  const chapterVoiceOf = (key: string): string => {
    const set = chapterVoices[key];
    if (set && set.includes("_")) return set;
    if (key === "hook" || cast.length === 0) return "";
    return cast[(Number(key) - 1) % cast.length] ?? "";
  };
  /** Where a bundled narration download comes from. See /api/audio-bundle. */
  const bundleHref = (chapter: string) =>
    `/api/audio-bundle?project=${encodeURIComponent(projectId)}&chapter=${encodeURIComponent(chapter)}`;
  const [showChapters, setShowChapters] = useState(false);
  const [chapDraft, setChapDraft] = useState<Record<string, string>>({});
  const chapterPick = (key: string): string => chapDraft[key] ?? chapterVoiceOf(key);
  const changedChapters = chapterKeys.filter(
    (k) => chapterPick(k) !== chapterVoiceOf(k) && chapterPick(k).includes("_"),
  );
  // Only the lines whose own chapter changed get re-synthesized; every other
  // take (and its approval) is left alone.
  const scenesToResynth = scenes.filter((s) => {
    const key = chapterOf(s) === 0 ? "hook" : String(chapterOf(s));
    return changedChapters.includes(key);
  });
  const [showSingle, setShowSingle] = useState(false);

  /**
   * The voice a line is currently read by, derived from the same rules n8n
   * applies. Used to re-synthesize only what would actually change: swapping
   * the whole project to Charlie shouldn't touch the chapters Charlie
   * already reads.
   *
   * Characters mode is deliberately excluded — a line there can carry several
   * voices at once, so no single answer exists and every line is redone.
   */
  const effectiveVoiceOf = (s: Scene): string => {
    if (mode !== "chapters") return narratorVoice;
    const ch = chapterOf(s);
    return chapterVoiceOf(ch === 0 ? "hook" : String(ch)) || narratorVoice;
  };
  /** Lines that would really sound different if the project moved to `voice`. */
  const linesNeeding = (voice: string): Scene[] =>
    mode === "characters"
      ? scenes
      : scenes.filter((s) => !s.voiceUrl || effectiveVoiceOf(s) !== voice);

  /**
   * The scenes this pass is actually about.
   *
   * Media generation runs in batches (n8n `Sort & Cap Scenes`, CAP=8) and
   * every gate inside it counts only the batch's own scenes. So a project
   * larger than one batch permanently contains scenes with nothing generated
   * — and treating those as "still being synthesized" was a hard deadlock:
   * `missing` never reached 0, "Approve all" stayed disabled, the batch sat
   * at its voice gate forever, and the producer saw a frozen production with
   * no error anywhere. A picture is what marks a scene as staged: the batch
   * generates the images first, so the scenes with an image are exactly the
   * ones that will be given a take this pass.
   *
   * Falls back to the whole project when nothing has a picture yet, so the
   * "being synthesized" message still reads correctly at the very start.
   */
  const inPlay = useMemo(() => {
    const staged = scenes.filter((s) => s.imageUrl);
    return staged.length > 0 ? staged : scenes;
  }, [scenes]);

  const withAudio = useMemo(() => inPlay.filter((s) => s.voiceUrl), [inPlay]);
  const unapproved = inPlay.filter((s) => !s.voiceApproved && s.voiceUrl);
  const missing = inPlay.filter((s) => !s.voiceUrl).length;
  const approved = inPlay.filter((s) => s.voiceApproved).length;
  /** Scenes beyond this batch — named so the panel can say so out loud. */
  const later = scenes.length - inPlay.length;

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
    <div className="script avoice" style={{ marginTop: 24 }}>
      <div className="sechead">
        <h2>Voice review</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--soft)" }}>
            {approved}/{inPlay.length} approved
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

      {/*
        The narration on its own. It exists nowhere else: the pipeline stores
        one take per scene and only ever joins them inside the final video,
        under the picture. Prominent because these are the two a producer
        actually reaches for — the per-scene ⤓ below is for the odd line.
        Chapter buttons appear only when the film HAS more than one; on a
        single-chapter project they would just repeat the full download.
      */}
      {withAudio.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--dim)" }}>Download</span>
          <a className="btn" href={bundleHref("all")} download>
            ⤓ Full narration
          </a>
          {chapterKeys.length > 1 &&
            chapterKeys.map((k) => (
              <a key={k} className="btn" href={bundleHref(k)} download>
                ⤓ {k === "hook" ? "Hook" : `Chapter ${k}`}
              </a>
            ))}
          <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
            One mp3, takes joined back to back in scene order — the narration
            as the cut plays it.
          </span>
        </div>
      )}

      {withAudio.length === 0 ? (
        <p className="formmsg" style={{ marginBottom: 12 }}>
          Narration is being synthesized for {inPlay.length} scene
          {inPlay.length === 1 ? "" : "s"} — the takes appear here one by one,
          usually within a couple of minutes. The page refreshes itself.
        </p>
      ) : missing > 0 ? (
        <p className="formmsg" style={{ marginBottom: 12 }}>
          {missing} scene{missing === 1 ? "" : "s"} still being synthesized —
          approving unlocks video generation, so it stays locked until every
          line exists.
        </p>
      ) : null}
      {later > 0 && (
        // Said out loud, because the panel now deliberately shows fewer
        // scenes than the film has: production works in batches, and the
        // tail has no picture and no take yet. Silence here read as scenes
        // gone missing.
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--dim)" }}>
          {later} later scene{later === 1 ? "" : "s"} {later === 1 ? "is" : "are"}{" "}
          not part of this pass — production takes them a batch at a time, and
          their takes appear here once their pictures are made.
        </p>
      )}
      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}

      {mode === "chapters" && chapterKeys.length > 0 && (
        <div className="card" style={{ padding: "14px 16px", marginBottom: 14 }}>
          <div className="kv" style={{ borderBottom: "none", paddingBottom: 8 }}>
            <h5 style={{ margin: 0 }}>Narrators — who reads which chapter</h5>
            {!showChapters && (
              <button className="abtn" onClick={() => setShowChapters(true)}>
                🎚 Change chapter narrators
              </button>
            )}
          </div>

          {!showChapters ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chapterKeys.map((key) => {
                const v = chapterVoiceOf(key);
                return (
                  <span key={key} className="chip">
                    {key === "hook" ? "Hook" : `Ch. ${key}`} ·{" "}
                    {v ? shortVoice(v) : "main narrator"}
                  </span>
                );
              })}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {chapterKeys.map((key) => {
                const lines = scenes.filter(
                  (s) => (chapterOf(s) === 0 ? "hook" : String(chapterOf(s))) === key,
                ).length;
                const changed = changedChapters.includes(key);
                return (
                  <div key={key}>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <b style={{ fontSize: 12.5 }}>
                        {key === "hook" ? "Hook" : `Chapter ${key}`}
                      </b>
                      <span className="chip">
                        {lines} line{lines === 1 ? "" : "s"}
                      </span>
                      {changed && <span className="chip wait">will re-synthesize</span>}
                    </div>
                    <VoicePicker
                            language={language}
                      label={
                        key === "hook" && !chapterPick(key)
                          ? "Currently the main narrator — pick a voice to override it"
                          : "Press ▶ to listen"
                      }
                      value={chapterPick(key)}
                      onChange={(v) => setChapDraft((p) => ({ ...p, [key]: v }))}
                    />
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="abtn ok"
                  disabled={pending || changedChapters.length === 0}
                  onClick={() =>
                    run(async () => {
                      const next: Record<string, string> = { ...chapterVoices };
                      for (const k of chapterKeys) {
                        const v = chapterPick(k);
                        if (v.includes("_")) next[k] = v;
                      }
                      const r = await saveChapterVoices(
                        projectId,
                        next,
                        scenesToResynth.map((s) => s.id),
                      );
                      if (r.ok) {
                        setShowChapters(false);
                        setChapDraft({});
                      }
                      return r;
                    })
                  }
                >
                  {changedChapters.length === 0
                    ? "Nothing changed yet"
                    : `Apply — re-synthesize ${scenesToResynth.length} line${scenesToResynth.length === 1 ? "" : "s"}`}
                </button>
                <button
                  className="abtn"
                  onClick={() => {
                    setShowChapters(false);
                    setChapDraft({});
                  }}
                >
                  Cancel
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 11.5, color: "var(--dim)" }}>
                Only the chapters you actually change are re-synthesized — every
                other take keeps its audio and its approval.
              </p>
            </div>
          )}

          {/* Changed your mind entirely: collapse back to one narrator. */}
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            {showSingle ? (
              <>
                <VoicePicker
                            language={language}
                  label="One narrator for the whole video — press ▶ to listen"
                  value={newVoice}
                  onChange={setNewVoice}
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="abtn"
                    disabled={pending || !newVoice.trim()}
                    onClick={() =>
                      run(async () => {
                        const r = await useSingleNarrator(
                          projectId,
                          newVoice.trim(),
                          linesNeeding(newVoice.trim()).map((s) => s.id),
                        );
                        if (r.ok) setShowSingle(false);
                        return r;
                      })
                    }
                  >
                    {newVoice.trim()
                      ? `Use this voice everywhere — re-synthesize ${linesNeeding(newVoice.trim()).length} line${linesNeeding(newVoice.trim()).length === 1 ? "" : "s"}`
                      : "Use this voice everywhere"}
                  </button>
                  {/* Escape hatch: a line pinned to its own voice from the
                      per-scene picker leaves no trace in the chapter map, so
                      the count above can't see it. */}
                  {newVoice.trim() &&
                    linesNeeding(newVoice.trim()).length < scenes.length && (
                      <button
                        className="abtn"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const r = await useSingleNarrator(
                              projectId,
                              newVoice.trim(),
                              scenes.map((s) => s.id),
                            );
                            if (r.ok) setShowSingle(false);
                            return r;
                          })
                        }
                      >
                        Redo all {scenes.length} anyway
                      </button>
                    )}
                  <button className="abtn" onClick={() => setShowSingle(false)}>
                    Cancel
                  </button>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
                  Multi-voice turns off, but only the lines that don&apos;t
                  already use this voice are re-synthesized. Your chapter
                  assignment is kept, so you can switch back.
                </p>
              </>
            ) : (
              <button className="abtn" onClick={() => setShowSingle(true)}>
                🎙 Use a single narrator for the whole video
              </button>
            )}
          </div>
        </div>
      )}

      {/* The way back, offered only to projects that were multi-voice. */}
      {mode === "off" && cast.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button
            className="abtn"
            disabled={pending}
            onClick={() => run(() => useChapterNarrators(projectId))}
          >
            ↩ Back to a narrator per chapter
          </button>
        </div>
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
                    {cast.map((v) => (
                      <option key={v} value={v}>
                        {voiceLabel(v)}
                      </option>
                    ))}
                  </select>
                  {!castAssign[name] && (
                    // Until someone picks, this is n8n's first-appearance
                    // fallback, not a decision. Rendered as a plain <select>
                    // value it looked like a choice already made — which is
                    // how a male character kept a female voice through eight
                    // synthesized takes before anyone listened.
                    <span className="chip wait">auto — picked by speaking order, not chosen</span>
                  )}
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

      {/* Project-wide narrator swap — single-narrator projects only.
          Under multi-voice this button was worse than redundant: it wrote a
          new project Voice ID and redid every line, but the chapter (or
          character) rule then overrode it on the way back, so the takes
          returned unchanged and only the hook actually moved. The mode's own
          panel above is the honest way to change those voices. */}
      <div style={{ marginBottom: 14, display: mode === "off" ? undefined : "none" }}>
        {showVoice ? (
          <div className="card" style={{ padding: "14px 16px" }}>
            <VoicePicker
                            language={language}
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
                      linesNeeding(newVoice.trim()).map((s) => s.id),
                    );
                    if (r.ok) setShowVoice(false);
                    return r;
                  })
                }
              >
                {newVoice.trim()
                  ? `Re-synthesize ${linesNeeding(newVoice.trim()).length} line${linesNeeding(newVoice.trim()).length === 1 ? "" : "s"} with this voice`
                  : "Re-synthesize with this voice"}
              </button>
              <button className="abtn" onClick={() => setShowVoice(false)}>
                Cancel
              </button>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
              Lines already read by this voice are left alone; the rest lose
              their current take.
            </p>
          </div>
        ) : (
          <button className="abtn narrowide" onClick={() => setShowVoice(true)}>
            ♪ Change narrator for the whole project
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {inPlay.map((s, i) => {
          const flag = flagFor(s, durations[s.id]);
          const fit = fitProblem(durations[s.id], clipDurations[s.id]);
          const isPlaying = playingId === s.id;
          const draft = drafts[s.id];
          const dirty = draft !== undefined && draft !== (s.narration ?? "");
          const audioIndex = withAudio.findIndex((w) => w.id === s.id);
          return (
            <div
              className="card take"
              key={s.id}
              style={{
                padding: "12px 14px",
                outline: isPlaying ? "2px solid var(--accent)" : undefined,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <button
                  className="abtn playbtn"
                  disabled={!s.voiceUrl}
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
                    {mode === "chapters" && chapterKeys.length > 0 && (() => {
                      const ch = chapterOf(s);
                      const key = ch === 0 ? "hook" : String(ch);
                      const v = chapterVoiceOf(key);
                      // Naming the voice beats "Voice #2": once chapters can
                      // be reassigned, the position stops matching the cast.
                      return (
                        <span className="chip">
                          {ch === 0 ? "Hook" : `Ch. ${ch}`} ·{" "}
                          {v ? shortVoice(v) : "main narrator"}
                        </span>
                      );
                    })()}
                    {mode === "characters" &&
                      speakersOf(s.narration).map((name) => (
                        <span key={name} className="chip">
                          {name === "Narrator" ? "Narrator" : `🗣 ${name}`}
                        </span>
                      ))}
                    {s.voiceApproved && (
                      <>
                        <span className="chip ok">Approved</span>
                        {/* The way back into a signed-off take. Only this
                            scene loses its approval; the clip goes back with
                            it, since the take is muxed into the cut. */}
                        <button
                          type="button"
                          className="abtn"
                          disabled={pending}
                          onClick={() => run(() => reopenStep(projectId, s.id, "audio"))}
                          style={{ padding: "3px 9px", fontSize: 11.5, lineHeight: 1.4 }}
                          title="Reopen the voice for this scene only — every other scene keeps its approval"
                        >
                          ✎ Make changes
                        </button>
                      </>
                    )}
                    {flag && <span className="chip wait">{flag}</span>}
                    {fit && <span className="chip wait">{fit}</span>}
                    {/* One take on its own. Deliberately the smallest control
                        in the row: it is for the odd line worth pulling out,
                        while the whole-narration and per-chapter downloads at
                        the top are the ones reached for. Works because
                        /api/media is SAME-ORIGIN — a browser ignores the
                        download attribute on a cross-origin link, so a raw
                        Drive href would open a tab instead of saving. */}
                    {s.voiceUrl && (
                      <a
                        className="abtn"
                        href={downloadSrc(
                          s.voiceUrl,
                          `${projectName ? `${projectName} - ` : ""}S${i + 1} narration.mp3`,
                        )}
                        download
                        title="Download this take"
                        style={{ padding: "3px 8px", fontSize: 11.5, lineHeight: 1.4 }}
                      >
                        ⤓
                      </a>
                    )}
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
                      {knownVoices.length > 0 && (
                        <select
                          className="abtn"
                          value={
                            voiceSearchFor === s.id ? "__search" : (voiceSel[s.id] ?? "")
                          }
                          disabled={pending}
                          onChange={(e) => {
                            if (e.target.value === "__search") {
                              setVoiceSearchFor(s.id);
                              return;
                            }
                            setVoiceSearchFor((cur) => (cur === s.id ? null : cur));
                            setVoiceSel((v) => ({ ...v, [s.id]: e.target.value }));
                          }}
                          title="Which voice the next regeneration uses for this scene"
                        >
                          <option value="">Voice: auto</option>
                          {knownVoices.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                          {voiceSel[s.id] &&
                            !knownVoices.some((v) => v.id === voiceSel[s.id]) && (
                              <option value={voiceSel[s.id]}>
                                {shortVoice(voiceSel[s.id])}
                              </option>
                            )}
                          <option value="__search">Any other voice…</option>
                        </select>
                      )}
                      <button
                        className="abtn"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            regenerateVoice(
                              projectId,
                              s.id,
                              draft ?? s.narration ?? "",
                              voiceSel[s.id] || undefined,
                            ),
                          )
                        }
                      >
                        {dirty ? "🎙 Save text & re-synthesize" : "🎙 Regenerate"}
                      </button>
                      {/* Only offered when the shot genuinely can't cover the
                          take — every other length difference is absorbed by
                          retiming at assembly, so re-rendering would be
                          paying Flow for nothing. */}
                      {voiceSearchFor === s.id && (
                        <div style={{ flexBasis: "100%", marginTop: 8 }}>
                          <VoicePicker
                            language={language}
                            label="Voice for this scene — press ▶ to listen, then Regenerate"
                            value={voiceSel[s.id] ?? ""}
                            onChange={(id) => {
                              setVoiceSel((v) => ({ ...v, [s.id]: id }));
                              setVoiceSearchFor(null);
                            }}
                          />
                        </div>
                      )}
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
