"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  approveVoices,
  changeProjectVoice,
  regenerateVoice,
  reopenStep,
  reopenPlaybackSpeed,
  rerecordVoices,
  savePlaybackSpeed,
  saveVoiceSettings,
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
import {
  chapterKeys as chapterKeysOf,
  chapterKeyOf as chapterKeyOfOrder,
  chapterOf as chapterOfOrder,
  chapterTitle,
  groupsByChapter,
} from "@/lib/chapters";
import RegenBadge from "@/components/RegenBadge";
import SpeedPicker from "@/components/SpeedPicker";
import VoiceTonePicker from "@/components/VoiceTonePicker";
import { normalizeVoiceTone, type VoiceTone } from "@/lib/data/derive";
import VoicePicker from "@/components/VoicePicker";

/**
 * Play a take at the film's pace.
 *
 * `preservesPitch` is the load-bearing half and it is set explicitly rather
 * than left to the default: the render re-times with ffmpeg `atempo`, which
 * resamples WITHOUT shifting pitch, so a preview that let the browser drop
 * pitch with the rate would audition a slowed narrator as a deeper one — a
 * different voice, not a slower reading, and the producer would be judging
 * something the film will never do. The two vendor-prefixed spellings are
 * still what older WebKit and Gecko read.
 */
function setRate(el: HTMLMediaElement | null, rate: number) {
  if (!el) return;
  const m = el as HTMLMediaElement & {
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  m.preservesPitch = true;
  m.mozPreservesPitch = true;
  m.webkitPreservesPitch = true;
  el.playbackRate = rate;
}

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
 * The generated breath, previewed.
 *
 * ElevenLabs pads every take with near-silence at both ends, and the render
 * cuts it (remotion/server/assemble.mjs) — so a panel that played the raw
 * file would audition a rhythm the film does not have, which is the whole
 * failure the pace preview exists to avoid. These three numbers are the
 * SERVER'S, copied deliberately: a preview trimmed to different thresholds
 * would be a different cut, confidently presented as the real one.
 */
const BREATH_NOISE_DB = -45;
const BREATH_MIN = 0.18;
const BREATH_GUARD = 0.05;

/**
 * Where the speech starts and ends in a decoded take.
 *
 * Measured the way ffmpeg's `silencedetect` measures it: sample MAGNITUDE
 * against the threshold, one sample at a time. That distinction is the whole
 * of a regression worth remembering — this first averaged 20ms windows, and
 * an RMS window sits roughly 15dB under the peak of the same speech, so
 * "-45dB" meant something far stricter here than it did on the server. The
 * preview cut the last words off every take while the render kept them.
 * **Two numbers named the same thing are not the same threshold until they
 * are measured the same way.**
 *
 * Only silence TOUCHING an end counts, so the scan runs inward from each end
 * and stops at the first real sample — a pause mid-sentence is the
 * performance, and neither side cuts it. That also makes it cheap: it reads
 * the padding, never the speech.
 */
function speechBoundsOf(buf: AudioBuffer): { head: number; tail: number } {
  const data = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const total = buf.duration;
  const floor = Math.pow(10, BREATH_NOISE_DB / 20);
  let first = 0;
  while (first < data.length && Math.abs(data[first]) <= floor) first++;
  // Nothing above the floor: a take that reads as silent throughout is left
  // whole. Cutting it to nothing is the one outcome worse than not cutting.
  if (first >= data.length) return { head: 0, tail: total };
  let last = data.length - 1;
  while (last > first && Math.abs(data[last]) <= floor) last--;
  const speechFrom = first / sr;
  const speechTo = (last + 1) / sr;
  // Below BREATH_MIN it is phrasing, not padding, and trimming it is what
  // makes speech sound clipped rather than tight.
  const head =
    speechFrom >= BREATH_MIN ? Math.max(0, speechFrom - BREATH_GUARD) : 0;
  const tail =
    total - speechTo >= BREATH_MIN
      ? Math.min(total, speechTo + BREATH_GUARD)
      : total;
  return tail - head < 0.3 ? { head: 0, tail: total } : { head, tail };
}

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
  const ch = chapterOfOrder(order);
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
  speed = 1,
  speedLocked = false,
  voiceTone = null,
}: {
  projectId: string;
  scenes: Scene[];
  /** How the narrator reads, or null for each voice's own settings. Resolved
   *  by buildProject, like the pace, so this panel and the synthesis can never
   *  disagree about what the film is set to. */
  voiceTone?: VoiceTone | null;
  /**
   * The film's playback rate, resolved by buildProject the same way every
   * other surface resolves it (Editing Options overrides, the brief's Pace
   * word is the fallback). Passed in rather than read here so the panel can
   * never show a rate the render is not using.
   */
  speed?: number;
  /** Whether the pace has been signed off — see EditingOptions.speedLocked. */
  speedLocked?: boolean;
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
    new Set(scenes.map((s) => chapterOfOrder(s.order)).filter((c) => c > 0))
      .size || 1;
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  /**
   * The continuous run in progress, if any: `"all"` for the whole narration,
   * a chapter key for one chapter, null for a single take.
   *
   * One value rather than a flag per button, because the runs are mutually
   * exclusive by nature — pressing Chapter 2 while the film is playing means
   * "play chapter 2 instead", and two booleans would let both read as running.
   */
  const [runKey, setRunKey] = useState<string | null>(null);
  const playAll = runKey === "all";
  const [durations, setDurations] = useState<Record<string, number>>({});
  /** Where the speech sits inside each take — see speechBoundsOf. */
  const [bounds, setBounds] = useState<Record<string, { head: number; tail: number }>>({});
  /**
   * The take, held locally, so playing it cannot stall.
   *
   * The panel already downloads every take to measure it, so this costs one
   * `Blob` and nothing else — and it removes the one thing a cut timed in
   * media seconds cannot survive. Streamed from Drive through /api/media
   * (which answers `no-store`, so each play is a fresh fetch) a take can stop
   * mid-line to rebuffer; wall-clock time keeps running through that and the
   * cut arrives early, on every take, which is what "I can't hear the last
   * words" was. A blob source is already in memory and never waits.
   */
  const [srcs, setSrcs] = useState<Record<string, string>>({});
  const srcsRef = useRef(srcs);
  useEffect(() => {
    srcsRef.current = srcs;
  }, [srcs]);
  /**
   * Which URL each cached take was fetched from.
   *
   * The cache has to be keyed on the take, not on the scene: a re-record is a
   * new Drive file with a new URL, and a per-scene key made every re-recording
   * invisible in this panel while the download button — which never reads the
   * cache — handed back the new one.
   */
  const fetchedFrom = useRef<Record<string, string>>({});
  /** Revoked only on unmount: the measuring effect re-runs as the batch grows
   *  and as takes are replaced, and freeing these in its cleanup would pull
   *  the source out of a take that is playing. A superseded blob is left for
   *  the same reason — it may be the one currently sounding — and they are
   *  bounded by how many re-records happen in one visit. */
  const blobUrls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const u of blobUrls.current) URL.revokeObjectURL(u);
      blobUrls.current = [];
    },
    [],
  );
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

  // ---- pace ----------------------------------------------------------
  /**
   * The pace being auditioned, which is NOT yet the pace of the film — it
   * becomes that only when Save is pressed.
   *
   * Backed by sessionStorage because this page re-renders itself every 10s:
   * an unsaved choice held in component state alone would be thrown away
   * mid-listen by a refresh, which is the one thing an audition control
   * cannot survive. Null means "no draft" and the stored rate shows through,
   * so a saved project reads its own value rather than a remembered one.
   */
  const paceKey = `vf-pace:${projectId}`;
  const [draftRate, setDraftRate] = useState<number | null>(null);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(paceKey);
      if (saved !== null) setDraftRate(Number(saved));
    } catch {}
  }, [paceKey]);
  const pickRate = (v: number) => {
    setDraftRate(v);
    try {
      sessionStorage.setItem(paceKey, String(v));
    } catch {}
  };
  const clearDraft = () => {
    setDraftRate(null);
    try {
      sessionStorage.removeItem(paceKey);
    } catch {}
  };
  /** What the panel plays at, and what Save would store. */
  const rate = draftRate ?? speed;
  const paceDirty = draftRate !== null && Math.abs(draftRate - speed) > 1e-9;

  // ---- voice character -----------------------------------------------
  /**
   * The tone being edited, backed by sessionStorage for the same reason the
   * pace draft is: the page reloads itself every 10 seconds and would
   * otherwise throw the choice away mid-edit.
   *
   * The draft is a two-level value — "no draft" and "a draft that is null"
   * are different things, because null is itself a valid tone ("leave every
   * voice alone"). Held as `{ v: VoiceTone | null } | null` so those two
   * cannot collapse into each other, which they would as a bare null.
   */
  const toneKey = `vf-tone:${projectId}`;
  const [draftTone, setDraftTone] = useState<{ v: VoiceTone | null } | null>(null);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(toneKey);
      if (saved !== null) setDraftTone({ v: normalizeVoiceTone(JSON.parse(saved)) });
    } catch {}
  }, [toneKey]);
  const pickTone = (v: VoiceTone | null) => {
    setDraftTone({ v });
    try {
      sessionStorage.setItem(toneKey, JSON.stringify(v));
    } catch {}
  };
  const clearToneDraft = () => {
    setDraftTone(null);
    try {
      sessionStorage.removeItem(toneKey);
    } catch {}
  };
  const tone = draftTone ? draftTone.v : voiceTone;
  const toneDirty =
    draftTone !== null && JSON.stringify(draftTone.v) !== JSON.stringify(voiceTone);
  /** Named for the chip and the messages. Never the preset's name — the panel
   *  stores numbers, and a label here would be a second table to keep in step
   *  with the picker's. */
  const toneLabel = tone
    ? `stability ${Math.round(tone.stability * 100)} · style ${Math.round(tone.style * 100)}`
    : "each voice's own";

  /** Read by playFrom, which builds each element fresh. A closure over `rate`
   *  would not do: "Play all" schedules the NEXT take from inside the current
   *  one's onended, so a rate changed mid-run would not reach it. */
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
    // Changing the pace while a take is playing retimes it on the spot, which
    // is the whole point of auditioning here — you hear the difference on the
    // line you are already listening to.
    setRate(audioRef.current, rate);
  }, [rate]);

  /**
   * Read by playFrom, which builds each element fresh — same reason the rate
   * is a ref: "Play all" schedules the next take from inside the current one's
   * handler, so a bounds map captured in that closure would be whatever had
   * been decoded when the run started.
   */
  const boundsRef = useRef(bounds);
  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);

  /**
   * The scenes that open a chapter, by id — the ones whose lead-in the render
   * keeps.
   *
   * Derived from the WHOLE film in scene order, not from the takes on screen,
   * because that is the list the render server is given: judged on a partial
   * pass, a scene in the middle of chapter 2 would look like an opener simply
   * because it happened to be first in the batch, and the preview would put a
   * pause where the film has none.
   */
  const chapterOpeners = useMemo(() => {
    const ordered = [...scenes].sort((a, b) => a.order - b.order);
    const out = new Set<string>();
    ordered.forEach((s, i) => {
      if (i === 0 || chapterOfOrder(s.order) !== chapterOfOrder(ordered[i - 1].order)) {
        out.add(s.id);
      }
    });
    return out;
  }, [scenes]);

  // ---- chapters mode -------------------------------------------------
  // The chapter rule itself lives in lib/chapters.ts — n8n's AB Pick Voice,
  // the narration-bundle route and the scene board all derive it the same
  // way, and a private copy here is how "Chapter 2" comes to mean two
  // different sets of scenes on one page.
  const chapterOf = (s: Scene): number => chapterOfOrder(s.order);
  const chapterKeys = useMemo(
    () => chapterKeysOf(scenes.map((s) => s.order)),
    [scenes],
  );
  /**
   * Whether the take list gets chapter headings.
   *
   * Read off the WHOLE film, not the staged pass: production works in batches,
   * so a pass can hold one chapter's scenes while the film has four, and
   * "Chapter 3" over those takes is exactly the context the producer wants —
   * it says where in the film they are. Judged on the pass instead, that
   * heading would vanish precisely when it is most useful. A single-chapter
   * film gets none, because one group is not a grouping.
   */
  const byChapter = useMemo(
    () => groupsByChapter(scenes.map((s) => s.order)),
    [scenes],
  );
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
   * no error anywhere.
   *
   * A TAKE is what marks a scene as staged now: the batch synthesizes every
   * take FIRST and generates images second, so the scenes with a take are
   * exactly the ones staged this pass. (This used to key off images, from
   * the old image-first order — on any pass after the first that hid the
   * fresh takes behind the PREVIOUS batch's pictures for exactly the window
   * the audio-first order created them to fill.)
   *
   * Falls back to the whole project when nothing has a take yet, so the
   * "being synthesized" message still reads correctly at the very start.
   */
  const inPlay = useMemo(() => {
    const staged = scenes.filter((s) => s.voiceUrl);
    return staged.length > 0 ? staged : scenes;
  }, [scenes]);

  const withAudio = useMemo(() => inPlay.filter((s) => s.voiceUrl), [inPlay]);
  /**
   * Read by playFrom, for the same reason the rate and the bounds are refs: a
   * run schedules its next take from inside the current one's handler, so a
   * list captured in that closure is whatever existed when the run started.
   * This page re-renders every 10 seconds and the batch grows underneath it,
   * so that list really does go stale — and for a chapter run it decides where
   * the run ENDS, which is the difference between stopping on the chapter and
   * running into the next one.
   */
  const withAudioRef = useRef(withAudio);
  useEffect(() => {
    withAudioRef.current = withAudio;
  }, [withAudio]);
  /**
   * The half-open range of takes a run covers.
   *
   * Derived on demand rather than stored with the run: a chapter's block can
   * grow while it is playing (a later take lands, the panel re-renders), and a
   * range frozen at the first press would stop short of takes the producer can
   * see on screen.
   *
   * The list is passed in rather than read from one place, because the two
   * callers genuinely want different lists. What is being DRAWN has to measure
   * the render's own `withAudio` — the ref is only synced in an effect, so
   * during the render where a take arrives it still holds the previous list,
   * and a heading would draw itself disabled over a chapter that now has
   * takes. What is PLAYING has to measure the ref, because it is running from
   * inside a closure that may be several renders old.
   */
  const rangeIn = (
    list: Scene[],
    key: string,
  ): { from: number; to: number } => {
    if (key === "all") return { from: 0, to: list.length };
    let from = -1;
    let to = 0;
    list.forEach((s, i) => {
      if (chapterKeyOfOrder(s.order) !== key) return;
      if (from < 0) from = i;
      to = i + 1;
    });
    return from < 0 ? { from: 0, to: 0 } : { from, to };
  };
  /** The run's range as playback sees it — see rangeIn. */
  const runRange = (key: string) => rangeIn(withAudioRef.current, key);
  const unapproved = inPlay.filter((s) => !s.voiceApproved && s.voiceUrl);
  const missing = inPlay.filter((s) => !s.voiceUrl).length;
  const approved = inPlay.filter((s) => s.voiceApproved).length;
  /** Scenes beyond this batch — named so the panel can say so out loud. */
  const later = scenes.length - inPlay.length;

  // Read every line's length once, off-screen, so the table can flag outliers
  // without the reviewer opening a single player.
  //
  // The number kept is the length the FILM will use: the take decoded, its
  // generated padding located, and the speech measured between. Every reader
  // wants that one — `flagFor` judges speech against word count, `fitProblem`
  // against the shot, and the render's scene length is `voiceDur + 0.35` off
  // exactly this. Reporting the raw file length would leave all three
  // measuring silence.
  useEffect(() => {
    let cancelled = false;
    let ctx: AudioContext | null = null;
    (async () => {
      for (const s of withAudio) {
        // Keyed on the URL, not on "have we measured this scene before".
        //
        // A re-recorded take is a NEW Drive file — `VR Upload Audio` names it
        // `<scene>-v<timestamp>.mp3` and `VR Write Voice` stores the new id —
        // so `voiceUrl` changes every time. Skipping on "this scene already
        // has a duration" therefore kept the FIRST take forever: the blob,
        // the length and the trim bounds all stayed with the recording that
        // had been replaced, and the panel played it. Downloading the same
        // scene gave the new take, because that link goes to the real URL and
        // never touches this cache — which is exactly how it was spotted.
        //
        // Claimed BEFORE the await so a re-render arriving mid-fetch does not
        // start the same download twice.
        if (cancelled || !s.voiceUrl || fetchedFrom.current[s.id] === s.voiceUrl) continue;
        fetchedFrom.current[s.id] = s.voiceUrl;
        try {
          const res = await fetch(audioSrc(s.voiceUrl));
          if (!res.ok) throw new Error(String(res.status));
          const bytes = await res.arrayBuffer();
          // Kept as a local source BEFORE decoding, because decodeAudioData
          // detaches the buffer it is handed. The Blob copies the bytes, so
          // the decode below still gets them.
          const url = URL.createObjectURL(
            new Blob([bytes], {
              type: res.headers.get("content-type") || "audio/mpeg",
            }),
          );
          blobUrls.current.push(url);
          if (!cancelled) setSrcs((p) => ({ ...p, [s.id]: url }));
          // Created lazily and only once: an AudioContext per take would hit
          // the browser's cap on a long film. It stays suspended — nothing
          // here plays through it, it only decodes.
          ctx =
            ctx ??
            new (window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext })
                .webkitAudioContext)();
          const buf = await ctx.decodeAudioData(bytes);
          if (cancelled) return;
          const b = speechBoundsOf(buf);
          setBounds((p) => ({ ...p, [s.id]: b }));
          setDurations((d) => ({ ...d, [s.id]: b.tail - b.head }));
        } catch {
          // Undecodable or unreachable: fall back to the container's own
          // duration and no trimming, which is exactly the old behaviour.
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
      }
    })();
    return () => {
      cancelled = true;
      void ctx?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Keyed on every take's URL, not on how many there are. A re-record
    // replaces a take without changing the count, so `withAudio.length` never
    // moved and this effect never re-ran — the panel went on playing the
    // recording the producer had just replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withAudio.map((s) => `${s.id}:${s.voiceUrl}`).join("|")]);

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

  /**
   * The take is stopped by a timer, not by `ended`, because it now ends before
   * the file does. `timeupdate` fires only about four times a second, which
   * would overshoot the cut by up to a quarter of the very pause being
   * removed; a timer lands on it.
   *
   * But a timer counts WALL CLOCK while the cut lives in MEDIA time, and the
   * two part company the instant the stream stalls to buffer. Every take here
   * is a fresh fetch of a Drive file through /api/media, which answers
   * `no-store`, so stalling is routine rather than rare — and a blind timer
   * then cut short by however long the take had spent waiting, on every line.
   * So the timer no longer decides anything: it re-reads `currentTime` and
   * waits out whatever is genuinely left. It can only ever be late now, never
   * early, which is the right direction for a control the producer is
   * listening to.
   */
  const stopTimer = useRef<number | null>(null);
  const clearStop = () => {
    if (stopTimer.current !== null) {
      window.clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  };
  const armStop = (a: HTMLAudioElement, tail: number, done: () => void) => {
    clearStop();
    // A frame either side of the cut is under the ear's resolution, and
    // insisting on exactness here is what turns a stalled stream into a
    // 50ms poll that can never satisfy itself.
    const slack = 0.03;
    const left = () => (tail - a.currentTime) / (a.playbackRate || 1);
    // Waiting on the take is right; waiting on it forever is not. A stream
    // that stalls and never recovers would otherwise leave "Play all" stopped
    // on a line with no error to explain it, so the take gets its own length
    // again plus ten seconds and then the run moves on.
    const giveUpAt = Date.now() + left() * 1000 * 2 + 10_000;
    const tick = () => {
      stopTimer.current = null;
      if (left() <= slack || a.ended || Date.now() > giveUpAt) return done();
      stopTimer.current = window.setTimeout(tick, Math.max(50, left() * 1000));
    };
    if (left() <= slack) return done();
    stopTimer.current = window.setTimeout(tick, left() * 1000);
  };

  const stop = () => {
    clearStop();
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
    setRunKey(null);
  };

  /**
   * Play one take, and carry on through `run` when there is one.
   *
   * `run` is the run's identity, not a boolean, so the take that finishes
   * knows where its run ENDS: the film for "all", the chapter's own block for
   * a chapter key. A chapter run therefore stops on the chapter rather than
   * spilling into the next one, and it opens with that chapter's generated
   * lead-in for free — the first take of a chapter is a chapter opener, which
   * is already the one case that keeps its breath.
   */
  const playFrom = (index: number, run: string | null) => {
    const scene = withAudioRef.current[index];
    if (!scene?.voiceUrl) return stop();
    clearStop();
    audioRef.current?.pause();
    // The downloaded copy when there is one, so the take cannot stall; the
    // stream only for a take whose fetch or decode failed, which is also the
    // case that has no bounds and therefore no cut to miss.
    const a = new Audio(srcsRef.current[scene.id] ?? audioSrc(scene.voiceUrl));
    setRate(a, rateRef.current);
    audioRef.current = a;
    setPlayingId(scene.id);
    setRunKey(run);
    const next = () => {
      clearStop();
      if (run && index + 1 < runRange(run).to) playFrom(index + 1, run);
      else stop();
    };
    // The film's own cut, previewed: skip the generated lead-in and stop at
    // the last word — except on a scene that OPENS A CHAPTER, which keeps its
    // lead-in exactly as the render does, so the break between chapters is
    // audible here too.
    const b = boundsRef.current[scene.id];
    const opener = chapterOpeners.has(scene.id);
    const head = b && !opener ? b.head : 0;
    const tail = b ? b.tail : null;
    if (head > 0) {
      // currentTime before metadata is loaded is ignored, so seek on the first
      // moment the element knows how long it is.
      if (a.readyState >= 1) a.currentTime = head;
      else a.addEventListener("loadedmetadata", () => (a.currentTime = head), {once: true});
    }
    if (tail !== null) {
      // Deliberately NOT `{once: true}`: `playing` fires again after every
      // buffering stall, and re-reading the clock there is what keeps the cut
      // measured in the take rather than on the wall. `waiting` re-arms for
      // the same reason from the other side. Both check the element is still
      // the current one — a paused predecessor that resumes must not re-arm
      // the cut for a take the panel has already moved past.
      const rearm = () => {
        if (audioRef.current === a) armStop(a, tail, next);
      };
      a.addEventListener("playing", rearm);
      a.addEventListener("waiting", rearm);
    }
    a.onended = next;
    a.onerror = () => stop();
    void a.play().catch(() => stop());
  };

  /**
   * Re-arm the cut when the pace changes mid-take.
   *
   * The timer was measured in real seconds against the rate in force when it
   * was set, so leaving it alone would cut early on a slower pace and late on
   * a faster one — and late means the padding this is removing gets played,
   * which is exactly the thing the producer is listening for. Placed after
   * playFrom so it can use armStop and stop without forward references.
   */
  useEffect(() => {
    const a = audioRef.current;
    if (!a || stopTimer.current === null || !playingId) return;
    const tail = boundsRef.current[playingId]?.tail;
    if (tail === undefined) return;
    const i = withAudioRef.current.findIndex((w) => w.id === playingId);
    armStop(a, tail, () => {
      if (runKey && i >= 0 && i + 1 < runRange(runKey).to) playFrom(i + 1, runKey);
      else stop();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  useEffect(() => () => {
    clearStop();
    audioRef.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<ActionResult>) => {
    setPending(true);
    setMsg(await fn());
    setPending(false);
  };

  const fmt = (d: number | undefined) =>
    d === undefined ? "…" : d === 0 ? "—" : `${d.toFixed(1)}s`;
  /**
   * A take's length in the finished film, which is its own length only at 1×.
   *
   * Shown as "3.2s → 4.0s" so the raw figure survives: `flagFor` and
   * `fitProblem` both judge the RECORDING (against its word count and against
   * its shot), and neither question is about the pace — the retime scales the
   * picture and the voice together, so a take that fits its shot at 1× fits it
   * at every rate. Replacing the number rather than extending it would have
   * made those two flags read as though they were measuring the retimed value.
   */
  const fmtAtPace = (d: number | undefined) =>
    d === undefined || d === 0 || rate === 1 ? null : `${(d / rate).toFixed(1)}s`;
  const totalSeconds = withAudio.reduce((a, s) => a + (durations[s.id] ?? 0), 0);

  return (
    <div className="script avoice reviewpanel" style={{ marginTop: 24 }}>
      <div className="sechead">
        <h2>Voice review</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--soft)" }}>
            {approved}/{inPlay.length} approved
          </span>
          <button
            className="btn"
            disabled={withAudio.length === 0}
            onClick={() => (playAll ? stop() : playFrom(0, "all"))}
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
            {withAudio.length} lines
            {/* At any pace but 1× the take lengths stop being the film's
                lengths, and this is the number the producer is actually
                after. Said here rather than in the pace card so the running
                time is stated once, in the place it was already stated. */}
            {rate !== 1 && (
              <>
                {" "}
                — <b>{Math.round(totalSeconds / rate)}s</b> at {rate}×
              </>
            )}
            .
          </>
        )}
      </p>

      {/* Said out loud, because the numbers above and the playback below are
          both the FILM's, not the file's — and a length that quietly differs
          from the mp3 you can download would read as a bug. */}
      {Object.keys(bounds).length > 0 && (
        <p style={{ margin: "-6px 0 12px", fontSize: 11.5, color: "var(--dim)" }}>
          These are the film&apos;s own lengths: ElevenLabs leaves a beat of
          silence at both ends of every take, and the render cuts it — except
          where a chapter opens, which keeps its lead-in so the break between
          chapters is audible. What you play here is cut the same way.
        </p>
      )}

      {/*
        Pace, decided here rather than at Final touches.

        This is the cheapest moment it can be decided: the takes exist, the
        pictures and clips do not, so a film that turns out too slow costs one
        click instead of a re-render — and until now the control lived only on
        screens that come AFTER every clip has been paid for.

        It writes the same Editing Options.speed those screens write. One
        stored value behind three doors, never a fourth setting.
      */}
      {withAudio.length > 0 && (
        <div className="card" style={{ padding: "14px 16px", marginBottom: 14 }}>
          <div className="kv" style={{ borderBottom: "none", paddingBottom: 8 }}>
            <h5 style={{ margin: 0 }}>Pace — how fast the finished film plays</h5>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Always the STORED rate, never the draft — the picker below
                  already shows what is selected, and a chip that agreed with
                  it would leave nothing on screen saying the choice has not
                  been written yet. */}
              <span
                className={
                  speedLocked ? "chip ok" : paceDirty ? "chip wait" : "chip"
                }
              >
                {speed === 1 ? "Normal" : `${speed}×`}
                {speedLocked ? " · saved" : paceDirty ? " · not saved yet" : ""}
              </span>
              {speedLocked && (
                // The way back, the same shape every other signed-off step on
                // this page offers. Without it the first Save would be
                // permanent, which is not a decision anyone should have to
                // make from a preview.
                <button
                  className="abtn"
                  disabled={pending}
                  onClick={() => run(() => reopenPlaybackSpeed(projectId))}
                  title="Reopen the pace — the film keeps this one until you save a new one"
                >
                  ✎ Make changes
                </button>
              )}
            </div>
          </div>

          {speedLocked ? (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--soft)" }}>
              Signed off. The film renders at{" "}
              <b>{speed === 1 ? "normal speed" : `${speed}×`}</b>
              {speed !== 1 && totalSeconds > 0 && (
                <>
                  {" "}
                  — {Math.round(totalSeconds)}s of narration becomes{" "}
                  <b>{Math.round(totalSeconds / speed)}s</b>
                </>
              )}
              . Press <b>Make changes</b> to pick a different one.
            </p>
          ) : (
            <>
              <SpeedPicker value={rate} disabled={pending} onChange={pickRate} />
              {/* Deliberately does not repeat "pitch unchanged" — SpeedPicker's
                  own note says it one line above, and the same caveat twice in
                  one card reads as two different claims. */}
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 11.5,
                  color: "var(--dim)",
                  maxWidth: 620,
                }}
              >
                Nothing is stored until you save — try the rates against the
                takes first. Every take you play here follows the one selected,
                including while it is playing, so you hear the change on the
                line you are already listening to. It is the same time-stretch
                the render applies, so this is what the film will sound like.
              </p>
              {/* A plain row, not `.abtns` — that class stretches each button
                  to fill the width, which is right for the per-scene controls
                  and far too loud for a card-level commit. Matches the
                  Apply/Cancel rows on the chapter and narrator cards. */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  marginTop: 10,
                }}
              >
                <button
                  className="abtn ok"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await savePlaybackSpeed(projectId, rate);
                      // Only on success: a cleared draft after a failed write
                      // would silently drop the choice back to the stored rate
                      // while the error message says it was not saved.
                      if (r.ok) clearDraft();
                      return r;
                    })
                  }
                >
                  {pending
                    ? "…"
                    : paceDirty
                      ? `✓ Save pace — ${rate === 1 ? "Normal" : `${rate}×`}`
                      : "✓ Save this pace"}
                </button>
                {paceDirty && (
                  <button className="abtn" disabled={pending} onClick={clearDraft}>
                    Cancel — keep {speed === 1 ? "Normal" : `${speed}×`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/*
        How the narrator READS — the same Editing Options.voice the brief sets,
        so this is the second door onto one stored value rather than a second
        setting. It sits under the pace because the two answer neighbouring
        questions, and because both are decided here for the same reason: the
        takes exist and no picture has been paid for yet.

        The card is NOT gated on `withAudio.length` the way the pace card is.
        The pace preview needs a take to retime; this one is a choice about
        lines not yet recorded, and it is most useful precisely while the first
        batch is still being synthesized.

        No silent-film guard here, deliberately: a cinematic project never
        renders this panel at all — the project page drops the whole Audio step
        for it — so a second check would be dead code pretending to be a rule.
      */}
      {
        <div className="card" style={{ padding: "14px 16px", marginBottom: 14 }}>
          <div className="kv" style={{ borderBottom: "none", paddingBottom: 8 }}>
            <h5 style={{ margin: 0 }}>Voice character — how the narrator reads</h5>
            {/* The STORED tone, never the draft, for the same reason as the
                pace chip: the picker below already shows the selection, and a
                chip agreeing with it would leave nothing on screen saying the
                choice has not been written. */}
            <span className={toneDirty ? "chip wait" : voiceTone ? "chip ok" : "chip"}>
              {voiceTone
                ? `stability ${Math.round(voiceTone.stability * 100)} · style ${Math.round(voiceTone.style * 100)}`
                : "voice default"}
              {toneDirty ? " · not saved yet" : ""}
            </span>
          </div>

          <VoiceTonePicker
            value={tone}
            disabled={pending}
            onChange={pickTone}
            footnote="Unlike the pace, this cannot be heard on the takes you already have — a generation setting only shows up in a fresh recording. Save it, then re-record a line (or all of them) to hear it."
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button
              className="abtn ok"
              disabled={pending || !toneDirty}
              onClick={() =>
                run(async () => {
                  const r = await saveVoiceSettings(projectId, tone);
                  // Only on success — a cleared draft after a failed write
                  // would drop the choice back to the stored tone while the
                  // message says it was not saved.
                  if (r.ok) clearToneDraft();
                  return r;
                })
              }
            >
              {pending ? "…" : toneDirty ? `✓ Save — ${toneLabel}` : "✓ Saved"}
            </button>
            {toneDirty && (
              <button className="abtn" disabled={pending} onClick={clearToneDraft}>
                Cancel
              </button>
            )}
            {/* The only way to actually hear the setting. Offered once the
                takes exist and the tone is stored — re-recording against an
                unsaved draft would synthesize with the OLD tone and read as
                the control doing nothing. */}
            {withAudio.length > 0 && !toneDirty && (
              <button
                className="abtn"
                disabled={pending}
                title={`Re-synthesize all ${withAudio.length} takes with the saved voice character`}
                onClick={() =>
                  run(() =>
                    rerecordVoices(
                      projectId,
                      withAudio.map((s) => ({ id: s.id, narration: s.narration ?? "" })),
                    ),
                  )
                }
              >
                ↻ Re-record all {withAudio.length}
              </button>
            )}
          </div>
        </div>
      }

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
          // A chapter break: shown when this take opens a chapter the previous
          // one did not belong to.
          //
          // The heading itself is still a label — the play control beside it
          // is the thing that acts, and it is here rather than in the header
          // row because a chapter is not addressable from there: this is the
          // one place on screen that says where a chapter begins. (The rule it
          // looks like it breaks — "a label, never a control", written when
          // the filmstrip's chapter tabs were the comparison — was about
          // NAVIGATION: a button that scrolls you to a list you are already
          // scrolling does nothing. Playing the chapter is not nothing.)
          const chapterKey = chapterKeyOfOrder(s.order);
          const opensChapter =
            byChapter &&
            (i === 0 || chapterKeyOfOrder(inPlay[i - 1].order) !== chapterKey);
          // Measured against the list being drawn, not the playback ref.
          const chapterRun = opensChapter ? rangeIn(withAudio, chapterKey) : null;
          const chapterPlaying = runKey === chapterKey;
          return (
            <Fragment key={s.id}>
              {opensChapter && (
                <div className="chdiv">
                  <button
                    className="abtn playbtn chplay"
                    disabled={!chapterRun || chapterRun.to === chapterRun.from}
                    title={
                      chapterPlaying
                        ? "Stop"
                        : `Play ${chapterTitle(chapterKey)} — ${
                            (chapterRun?.to ?? 0) - (chapterRun?.from ?? 0)
                          } take(s)`
                    }
                    onClick={() =>
                      chapterPlaying
                        ? stop()
                        : playFrom(rangeIn(withAudio, chapterKey).from, chapterKey)
                    }
                  >
                    {chapterPlaying ? "■" : "▶"}
                  </button>
                  <span>{chapterTitle(chapterKey)}</span>
                </div>
              )}
            <div
              className="card take"
              style={{
                padding: "12px 14px",
                outline: isPlaying ? "2px solid var(--accent)" : undefined,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <button
                  className="abtn playbtn"
                  disabled={!s.voiceUrl}
                  onClick={() => (isPlaying ? stop() : playFrom(audioIndex, null))}
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
                      {/* The same X → Y the running total shows, per line, so
                          the pace can be judged against the scene it will
                          actually change rather than against the film's sum. */}
                      {fmtAtPace(durations[s.id]) && (
                        <>
                          {" → "}
                          <b style={{ color: "var(--soft)" }}>
                            {fmtAtPace(durations[s.id])}
                          </b>
                        </>
                      )}
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
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
