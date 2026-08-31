/**
 * Everything the two data backends must agree about.
 *
 * A scene's displayed status is not stored anywhere — it is reconstructed
 * from checkboxes and asset existence, for reasons written out at length in
 * `buildScene()` below. That reconstruction is the single most load-bearing
 * piece of logic in the site, and if the Airtable adapter and the Postgres
 * adapter each carried their own copy they would drift, silently, and the
 * whole point of running them side by side (comparing their output) would be
 * lost — two backends can only be compared while they share the derivation
 * and differ only in where the bytes came from.
 *
 * So both adapters do exactly one job: turn their own rows into the neutral
 * `RawProject` / `RawScene` shapes below. Everything after that happens here,
 * once.
 */

export type StatusKind = "wait" | "run" | "done" | "err" | "idle";

export interface EditingOptions {
  captions: boolean;
  hookTitle: boolean;
  chapterCards: boolean;
  endScreen: boolean;
  /** Scene sound effects in the final mix — the Veo clips' own ambience,
   *  ducked under the narration. Off = narration (+ music) only. */
  sfx: boolean;
  /** How loud that ambience sits, 0–1, as `nativeAudio` in the assemble
   *  request. Meaningless while `sfx` is off; the toggle owns silence. */
  sfxLevel: number;
  /** Background music AND the synthesized boom/whoosh/riser accents. Both
   *  are composed here, not in the footage, so they ride one switch. */
  music: boolean;
  /**
   * Whether the pipeline may put drawn cards in this film at all.
   *
   * Separate from `motifCards`, which is the LIST it chose — this is the
   * producer's permission for the feature, and it has to survive the list
   * being empty. Off means Scripting does not spend a model call picking
   * them and Final Assembly draws none even if some were already stored,
   * which matters because a film can be switched off after its cards exist.
   */
  drawnCards: boolean;
  /**
   * The colour a spoken caption word is painted, or null for white.
   *
   * Null is the default and the right one: white with the spoken word marked
   * by BRIGHTNESS is the only choice that reads on every kind of footage —
   * an accent that sits well on a night dock is wrong on snow. A colour is
   * something a film opts into.
   *
   * Stored as a hex; `resolveCaptionAccent()` in remotion/src/captionColor.ts
   * is what finally applies it, and it lifts anything too dark toward white
   * until it clears a luminance floor, because captions carry a heavy drop
   * shadow and a deep accent vanishes into its own shadow.
   */
  captionColor: string | null;
  /** Playback rate of the finished film: 0.9 slow, 1 normal, 1.1 fast.
   *
   *  This is what the creation form's PACE control finally means. Before it
   *  existed, PACE reached exactly two prompt lines in Claude Scripting
   *  (`Pace: Slow`, a hint with no rule) and nothing else read the field —
   *  which is why it demonstrably changed nothing. The rate is applied to the
   *  ALREADY-RENDERED film by the render server, so the picture, the
   *  narration, the music and every baked-in graphic all move together; see
   *  remotion/server/speed.mjs for why no earlier step can own it. */
  speed: number;
  /**
   * Whether the producer has signed the pace off at the audio step.
   *
   * The pace is auditioned by ear, so the picker has to stay live while a
   * take plays — which means the panel cannot tell "still deciding" from
   * "decided" on its own. This is that signal, and nothing but the audio
   * panel reads it: the render resolves `speed` whatever this says.
   * Absent on every project stored before it existed, which reads as false
   * and leaves those films editable, the safe direction.
   */
  speedLocked: boolean;
  /**
   * How the narrator READS — ElevenLabs' generation settings for this film.
   *
   * NULL means "never chosen", and that is not the same as "chosen to be the
   * defaults". Every voice carries its OWN stored settings at ElevenLabs
   * (Bella's are 0.5 / 0.75 / 0), so sending an object we invented would
   * overwrite each voice's own tuning with ours on every single line. Absent
   * therefore means send no `voice_settings` at all, which is exactly what
   * the pipeline did before this existed and what every film already in the
   * database still wants. Same shape as `confirmFinalSettings` omitting
   * `speed`: the field that destroys data is the one nobody meant to send.
   */
  voice: VoiceTone | null;
}

/**
 * The four settings ElevenLabs actually acts on.
 *
 * Read off the API rather than assumed: a voice's stored settings come back as
 * `{stability, similarity_boost, style, use_speaker_boost, speed}`. `speed` is
 * deliberately NOT here — measured on `eleven_multilingual_v2`, the model this
 * pipeline pins, the same sentence at 0.7, 1.0 and 1.2 all came back ~4.2s, so
 * the field is accepted and ignored. Exposing it would have been a second
 * pace control, and the false one: `Editing Options.speed` re-times the
 * finished film with ffmpeg and demonstrably works.
 */
export interface VoiceTone {
  /** 0–1. Low is varied and dramatic, high is flat and consistent. */
  stability: number;
  /** 0–1. How closely a take clings to the original voice. */
  similarity: number;
  /** 0–1. Exaggerates the voice's own manner; 0 is the plainest read. */
  style: number;
  /** Reinforces the resemblance to the speaker. */
  speakerBoost: boolean;
}

/**
 * Read stored voice settings, or null when there is nothing usable.
 *
 * Mirrored by `normalizeVoiceTone()` in remotion/server/tts.mjs and by the
 * expression in n8n's three speech nodes — the same three-way agreement the
 * speed rule already has, and for the same reason: a take synthesized by the
 * batch and one synthesized by a regeneration must come out of the same
 * settings, or one line sounds like a different reading of the same script.
 *
 * Every number is clamped rather than rejected. A value out of range is a
 * slider that moved too far, not a reason to silently drop the producer's
 * whole choice — and ElevenLabs answers 422 for out-of-range, which would
 * turn a bad number into a dead batch.
 */
export function normalizeVoiceTone(value: unknown): VoiceTone | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const unit = (x: unknown, fallback: number): number => {
    const n = Number(x);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  };
  // At least one real number, or this is an empty object left behind by a
  // merge rather than a choice anybody made.
  const named = ["stability", "similarity", "style"];
  if (!named.some((k) => Number.isFinite(Number(v[k])))) return null;
  return {
    stability: unit(v.stability, 0.5),
    similarity: unit(v.similarity, 0.75),
    style: unit(v.style, 0),
    speakerBoost: v.speakerBoost !== false,
  };
}

/** The three PACE values, as speeds. Mirrors SPEED_BY_PACE in speed.mjs. */
export const SPEED_BY_PACE: Record<string, number> = {
  slow: 0.9,
  normal: 1,
  fast: 1.1,
};

/**
 * Read a stored speed, defaulting to 1 for anything missing or unusable.
 *
 * Mirrors `normalizeSpeed()` in remotion/server/speed.mjs — the render server
 * is the one that acts on the number, and it refuses the same values this
 * refuses, so the control can never show a rate the film will not be given.
 * Keep the two in lockstep; a project stored before this existed has no
 * `speed` key at all and reads as 1, which is exactly what those films are.
 */
export function normalizeSpeed(value: unknown): number {
  if (typeof value === "string") {
    const byName = SPEED_BY_PACE[value.trim().toLowerCase()];
    if (byName !== undefined) return byName;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (n < 0.5 || n > 2) return 1;
  if (Math.abs(n - 1) < 0.01) return 1;
  return n;
}

/**
 * How loud the scenes' own ambience sits under the narration, 0–1.
 *
 * The default is the value `Build Timeline` used to hard-code: it started at
 * 0.25, was judged too subtle on a real SFX-only render, and 0.35 is what
 * replaced it. Making it a per-film setting does not change that judgement —
 * it keeps it as the starting point and lets a film that needs more say so.
 *
 * Refuses rather than guesses, like normalizeSpeed: anything unparseable or
 * out of range falls back to the default, so a bad value can never reach the
 * mixer. The floor is 0.05 and not 0 on purpose — silence is what the SFX
 * toggle is for, and a slider that can reach it would be a second, hidden
 * off switch that disagrees with the visible one.
 */
export const SFX_LEVEL_DEFAULT = 0.35;

/**
 * A stored caption colour, or null for the white default.
 *
 * Mirrors `resolveCaptionAccent()` in remotion/src/captionColor.ts, which is
 * the code that actually paints the word: a hex, the explicit opt-outs
 * `none`/`white`/`off`, and nothing else. Anything unrecognised reads as
 * null rather than throwing — a caption colour is not worth failing a render
 * over, and white is always legible.
 *
 * The render normalizes AGAIN on its side, including the luminance lift, so
 * this one only has to keep the stored value clean and the control honest.
 */
export function normalizeCaptionColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || /^(none|white|off)$/i.test(raw)) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return `#${hex.toUpperCase()}`;
}

export function normalizeSfxLevel(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return SFX_LEVEL_DEFAULT;
  if (n < 0.05 || n > 1) return SFX_LEVEL_DEFAULT;
  return Math.round(n * 100) / 100;
}

/**
 * A drawn card the pipeline chose for this film — a route chart, a departure
 * board — as stored on the project by Claude Scripting.
 *
 * The producer sees these in Final touches and can drop any of them before the
 * render. That is deliberate and not a formality: a motif is a decision of
 * TASTE, and this project already has one expensive lesson about a system
 * making a taste decision on its own (the montage planner that passed every
 * acceptance target while producing something a viewer read as a rendering
 * fault). The validator in the pipeline can prove a card is truthful; only a
 * person can say it is wanted.
 */
export interface MotifCard {
  /** Index into the film's scene list, as the pipeline numbered it. */
  sceneIndex: number;
  /** Ordine Scenă — the anchor the render actually resolves against. */
  sceneOrder?: number;
  variant: string;
  /** Small tracked word naming the graphic ("Ruta", "Orar"). */
  label?: string;
  /** Route: the stops, in travel order. */
  stops?: string[];
  /** Schedule: the timetable lines. */
  rows?: Array<{ label: string; value: string }>;
  /** The one line the footage cannot say — a distance, a margin. */
  note?: string;
  /**
   * "ok" — every string on the card was proved against the script.
   * "review" — the provenance is real but the transformation is not something
   * code can check, so it is the one a person should actually look at.
   */
  verdict?: "ok" | "review";
  /** The pipeline's own one-line case for the card. */
  why?: string;
  seconds?: number;
}

export interface Project {
  id: string;
  name: string;
  lengthSeconds: number | null;
  tone: string | null;
  status: string;
  statusKind: StatusKind;
  progress: number; // 0..1
  finalVideoUrl: string | null;
  aspect: "16:9" | "9:16";
  updatedAt: string | null;
  /** First scene's generated image — the dashboard card cover. */
  coverUrl?: string | null;
  /** Overlay options, editable right up to final assembly. */
  editing: EditingOptions;
  /** Drawn cards chosen by the pipeline, droppable in Final touches. */
  motifCards: MotifCard[];
  /** The batch is holding, waiting for those options to be confirmed. */
  awaitingFinalSettings: boolean;
  /** Video category id (lib/categories.ts); older projects have none. */
  category: string | null;
  /** Spoken language ("Română", "English", …) — narrows every voice picker. */
  language: string;
  /** The project's main narrator voice id (empty when none was picked). */
  narratorVoice: string;
  /** "off" | "characters" | "chapters" — how narration voices work. */
  multiVoiceMode: string;
  /** Extra voice ids picked on the form (characters or chapter narrators). */
  cast: string[];
  /** Character name -> voice id overrides (characters mode). */
  castAssign: Record<string, string>;
  /**
   * Chapter number -> voice id overrides (chapters mode), plus "hook" for the
   * opening scene. Without an entry a chapter falls back to its positional
   * cast voice, which is how every project behaved before this existed.
   */
  chapterVoices: Record<string, string>;
}

/**
 * A generated asset the producer chose to keep before replacing it.
 *
 * Regeneration overwrites in place — there is exactly one image and one clip
 * per scene, and the pipeline never keeps what it replaces. So a re-roll that
 * comes back worse used to be unrecoverable; this is the way back.
 */
export interface SceneVersion {
  id: string;
  kind: "image" | "video";
  /** Playable/renderable URL, resolved at read time for image versions. */
  url: string | null;
  /** The prompt that produced it — how you tell two versions apart. */
  prompt: string | null;
  /**
   * Flow media id of an image version. Restoring an image without it leaves
   * the scene unable to generate video at all ("Prep Video Regen" refuses a
   * scene with no Image Media ID), so it travels with the version.
   */
  mediaId: string | null;
  at: string | null;
  /** Filed by a replacing path rather than by the "Save draft" button. */
  auto: boolean;
  /**
   * The asset that was live immediately before the current one — what a
   * producer means by "the previous generation". At most one per kind, and
   * only an automatic keep can claim it: a manual save files the asset that
   * is still on the scene, which is not a previous anything.
   */
  last: boolean;
}

export const MAX_VERSIONS_PER_KIND = 12;

export interface Scene {
  id: string;
  order: number;
  label: string;
  narration: string | null;
  imagePrompt: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  voiceUrl: string | null;
  sceneApproved: boolean;
  rewriteRequested: boolean;
  imageApproved: boolean;
  videoApproved: boolean;
  /** Voice review gate, before any video is generated. */
  voiceApproved: boolean;
  /** n8n clears these once the regeneration lands (or is rejected), so a
   *  set flag means "a regeneration is in flight right now". */
  regenImage: boolean;
  regenVideo: boolean;
  regenVoice: boolean;
  /** "Observații Scenă" — reviewer feedback in, rejection reasons back out. */
  note: string | null;
  /** Refs (E1, E3…) of the Evidence claims backing this scene's narration.
   *  Validated by the scripting workflow — an invented ID never lands here. */
  evidenceRef: string | null;
  /** Scripting couldn't back this scene's factual claim with a real source. */
  needsFactCheck: boolean;
  /** The shot direction that actually decides the clip. */
  videoPrompt: string | null;
  /** Kept drafts, newest last. */
  versions: SceneVersion[];
  status: string;
  statusKind: StatusKind;
}

export interface ScriptInfo {
  id: string;
  content: string;
  status: string;
}

// ---------------------------------------------------------------------------
// The neutral shapes each adapter produces
// ---------------------------------------------------------------------------

export interface RawProject {
  id: string;
  name: string;
  tone: string | null;
  /** Anything; only an exact "9:16" switches the aspect. */
  aspectRaw: unknown;
  noCaptions: boolean;
  lengthSeconds: number | null;
  statusRaw: string;
  finalVideoUrl: string | null;
  /** The Editing Options blob — a JSON string in Airtable, jsonb in Postgres. */
  editingRaw: unknown;
  language: string;
  voiceId: string;
  createdAt: string | null;
  coverUrl?: string | null;
  /** The creation form's PACE choice ("Slow" | "Normal" | "Fast"). It is the
   *  DEFAULT for editing.speed — see the fallback in buildProject. */
  paceRaw?: unknown;
}

export interface RawScene {
  id: string;
  /** Null when the record never got one — see the fallback in buildScene. */
  order: number | null;
  narration: string | null;
  imagePrompt: string | null;
  imageUrl: string | null;
  /** Where the clip was published — Drive, fal, Flow. May be gone. */
  videoUrl: string | null;
  /** Our own copy in the media store, if there is one. */
  storedVideoUrl: string | null;
  voiceUrl: string | null;
  sceneApproved: boolean;
  imageApproved: boolean;
  voiceApproved: boolean;
  videoApproved: boolean;
  regenImage: boolean;
  regenVideo: boolean;
  regenVoice: boolean;
  note: string | null;
  evidenceRef: string | null;
  needsFactCheck: boolean;
  videoPrompt: string | null;
  /** Already joined by the adapter — see buildVersions(). */
  versions: SceneVersion[];
  statusRaw: string;
}

// ---------------------------------------------------------------------------
// Status vocabulary
//
// The values are Romanian because n8n writes them, and the migration to
// Postgres deliberately did NOT translate them — the column holds the same
// strings the Airtable field did. Translation stays here, at display time.
// ---------------------------------------------------------------------------

const STATUS_MAP: Array<{ match: RegExp; kind: StatusKind; progress: number }> = [
  { match: /finalizat|finished|done/, kind: "done", progress: 1 },
  { match: /eroare|failed|error/, kind: "err", progress: 0.3 },
  { match: /setari finale/, kind: "wait", progress: 0.92 },
  { match: /asamblare/, kind: "run", progress: 0.95 },
  { match: /aprobare video/, kind: "wait", progress: 0.85 },
  { match: /generare video/, kind: "run", progress: 0.7 },
  { match: /aprobare voce/, kind: "wait", progress: 0.65 },
  { match: /generare voce/, kind: "run", progress: 0.6 },
  { match: /aprobare imagine/, kind: "wait", progress: 0.55 },
  { match: /generare imagine/, kind: "run", progress: 0.4 },
  { match: /awaiting_approval|aprobare script/, kind: "wait", progress: 0.2 },
  { match: /script/, kind: "run", progress: 0.15 },
  { match: /in lucru|desfasurare/, kind: "run", progress: 0.5 },
  { match: /planificare|planificat/, kind: "wait", progress: 0.05 },
];

const STATUS_LABELS: Array<{ match: RegExp; label: string }> = [
  { match: /^finalizat/, label: "Finished" },
  { match: /setari finale/, label: "Awaiting Final Settings" },
  { match: /asamblare/, label: "Assembling" },
  { match: /asteapta aprobare video/, label: "Awaiting Video Approval" },
  { match: /asteapta aprobare voce/, label: "Awaiting Voice Approval" },
  { match: /asteapta aprobare imagine/, label: "Awaiting Image Approval" },
  { match: /generare voce/, label: "Generating Voice" },
  { match: /asteapta aprobare script|aprobare script/, label: "Awaiting Script Approval" },
  { match: /generare video/, label: "Generating Video" },
  { match: /generare imagine/, label: "Generating Image" },
  { match: /generare script|scriere script/, label: "Writing Script" },
  { match: /video gata/, label: "Video Ready" },
  { match: /^eroare/, label: "Error" },
  { match: /in lucru|in desfasurare/, label: "In Progress" },
  { match: /in asteptare/, label: "Queued" },
  { match: /planificare|planificat/, label: "Planned" },
];

export function normalizeStatus(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function displayStatus(raw: string): string {
  const s = normalizeStatus(raw);
  for (const { match, label } of STATUS_LABELS) {
    if (match.test(s)) {
      // Keep any suffix like " · 7/12" that follows the known status text.
      const extra = raw.match(/\s*[·:]\s*\d.*$/);
      return extra ? `${label}${extra[0]}` : label;
    }
  }
  return raw;
}

export function classifyStatus(raw: string): { kind: StatusKind; progress: number } {
  const s = normalizeStatus(raw);
  for (const { match, kind, progress } of STATUS_MAP) {
    if (match.test(s)) return { kind, progress };
  }
  return { kind: "idle", progress: 0 };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/** Editing Options arrives as a JSON string (Airtable) or an object (jsonb). */
function parseEditing(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return asRecord(JSON.parse(String(raw ?? "{}")));
  } catch {
    return {};
  }
}

/**
 * Motif cards come from a MODEL, through a validator, through jsonb — so this
 * reads defensively and keeps only what can actually be drawn. A malformed
 * card is dropped here rather than rendered as an empty rectangle.
 */
function parseMotifCards(raw: unknown): MotifCard[] {
  if (!Array.isArray(raw)) return [];
  const out: MotifCard[] = [];
  for (const item of raw) {
    const c = asRecord(item);
    const variant = typeof c.variant === "string" ? c.variant : "";
    if (!variant || typeof c.sceneIndex !== "number") continue;
    const stops = Array.isArray(c.stops)
      ? (c.stops as unknown[]).filter((v): v is string => typeof v === "string")
      : undefined;
    const rows = Array.isArray(c.rows)
      ? (c.rows as unknown[])
          .map((r) => asRecord(r))
          .filter((r) => typeof r.label === "string" && typeof r.value === "string")
          .map((r) => ({ label: String(r.label), value: String(r.value) }))
      : undefined;
    out.push({
      sceneIndex: c.sceneIndex,
      ...(typeof c.sceneOrder === "number" ? { sceneOrder: c.sceneOrder } : {}),
      variant,
      ...(typeof c.label === "string" ? { label: c.label } : {}),
      ...(stops?.length ? { stops } : {}),
      ...(rows?.length ? { rows } : {}),
      ...(typeof c.note === "string" ? { note: c.note } : {}),
      ...(c.verdict === "review" || c.verdict === "ok" ? { verdict: c.verdict } : {}),
      ...(typeof c.why === "string" ? { why: c.why } : {}),
      ...(typeof c.seconds === "number" ? { seconds: c.seconds } : {}),
    });
  }
  return out;
}

export function buildProject(r: RawProject): Project {
  const { kind, progress } = classifyStatus(r.statusRaw);
  const opts = parseEditing(r.editingRaw);

  return {
    id: r.id,
    name: r.name || "Untitled project",
    lengthSeconds: r.lengthSeconds,
    tone: r.tone,
    status: displayStatus(r.statusRaw),
    statusKind: kind,
    progress,
    finalVideoUrl: r.finalVideoUrl,
    aspect: r.aspectRaw === "9:16" ? "9:16" : "16:9",
    updatedAt: r.createdAt,
    coverUrl: r.coverUrl ?? null,
    editing: {
      captions: r.noCaptions !== true,
      hookTitle: opts.hookTitle !== false,
      chapterCards: opts.chapterCards !== false,
      endScreen: opts.endScreen !== false,
      // The clips' own sound is the footage's natural audio, so it is ON
      // unless switched off — a film over silent clips sounds dead. Music
      // is the opposite: nothing in it comes from the scene, so it is
      // opt-IN. Both were wrong the other way round once and the result
      // was unrelated stingers over stripped-out ambience.
      sfx: opts.sfx !== false,
      sfxLevel: normalizeSfxLevel(opts.sfxLevel),
      music: opts.music === true,
      // On unless refused, like the other overlays: a film the pipeline found
      // nothing worth drawing in simply gets an empty list.
      drawnCards: opts.drawnCards !== false,
      captionColor: normalizeCaptionColor(opts.captionColor),
      // Editing Options is the OVERRIDE, the project's PACE field the default.
      // Two sources on purpose: PACE is chosen on the brief and stored on the
      // project, so falling back to it means every film already in the
      // database honours the choice its producer made, with nothing to
      // migrate — while a later change on the site writes `speed` and wins.
      // `Build Remotion Props` resolves it in exactly this order, and the two
      // must stay in step or the control would show a rate the render is not
      // using.
      speed:
        opts.speed === undefined || opts.speed === null
          ? normalizeSpeed(r.paceRaw)
          : normalizeSpeed(opts.speed),
      // Strictly `=== true`, so a project with no such key — every film made
      // before the audio step could sign the pace off — reads as unlocked
      // and keeps its control rather than arriving frozen.
      speedLocked: opts.speedLocked === true,
      // No fallback to a project field, unlike `speed`: there is no older
      // column that ever meant this, so "never chosen" is the honest answer
      // for every film made before today — and it is also the answer that
      // leaves each voice reading exactly as it reads now.
      voice: normalizeVoiceTone(opts.voice),
    },
    awaitingFinalSettings: /setari finale/.test(normalizeStatus(r.statusRaw)),
    category: typeof opts.category === "string" ? opts.category : null,
    language: r.language,
    narratorVoice: r.voiceId,
    multiVoiceMode: typeof opts.multiVoiceMode === "string" ? opts.multiVoiceMode : "off",
    cast: Array.isArray(opts.cast)
      ? (opts.cast as unknown[]).filter((v): v is string => typeof v === "string" && v.includes("_"))
      : [],
    motifCards: parseMotifCards(opts.motifCards),
    castAssign: asRecord(opts.castAssign) as Record<string, string>,
    chapterVoices: asRecord(opts.chapterVoices) as Record<string, string>,
  };
}

export function buildScene(r: RawScene, index: number): Scene {
  const rawStatus = r.statusRaw || "—";
  const norm = normalizeStatus(rawStatus);
  const order = r.order ?? index + 1;

  /*
   * Our copy wins over the published link.
   *
   * Airtable read "Scene Final URL" first and fell back to the attachment, on
   * the assumption that the attachment was the raw clip and the URL the muxed
   * one. Measured, that is not true: twelve of twelve stored clips carry an
   * aac track, so the stored file IS the muxed clip.
   *
   * Meanwhile the published link is somebody else's uptime. Of the thirteen
   * scenes not on Drive, eleven fal links still answer months later — but both
   * `flow-content.google` links answer 403, and both of those scenes have a
   * perfectly good copy on our own disk that the old precedence refused to
   * show.
   *
   * The two move together from now on — the ingest endpoint writes the file
   * and Scene Final URL in one transaction — so preferring ours costs nothing
   * and drops a dependency on a host we do not run.
   */
  const videoUrl = r.storedVideoUrl ?? r.videoUrl;

  /*
   * The scene's state, DERIVED — the stored text is a poor witness.
   *
   * n8n only writes that field when a loop physically reaches the scene, and
   * it only ever writes result states: grep the workflow and you find
   * "Așteaptă Aprobare Imagine/Voce/Video" and "Finalizat", never "Generare
   * Imagine" or "Generare Voce". So the value on a scene the batch has not
   * touched yet is still whatever Scripting set at creation — "Generare
   * Script", *Writing script* — which is the one stage that is definitely
   * over: its text is written AND approved.
   *
   * Harmless while every scene fitted in one batch. Past the cap it becomes
   * the main thing the producer sees: on a 15-scene film seven scenes sit at
   * "Writing script" indefinitely, which reads as scripting being stuck and
   * sends everyone hunting for a bug in the wrong workflow.
   *
   * Every gate in the pipeline keys off checkboxes plus "does the asset
   * exist" — exactly what we have here — so the state can be reconstructed
   * instead of trusted. The stored text is kept only where it says something
   * that cannot be derived: an error, an explicit rewrite, and the scripting
   * phase before the scene text is approved.
   */
  const status =
    /eroare|failed|error/.test(norm) || /regenerare text/.test(norm)
      ? rawStatus
      : r.regenImage
        ? "Generare Imagine"
        : r.regenVoice
          ? "Generare Voce"
          : r.regenVideo
            ? "Generare Video"
            : r.videoApproved
              ? "Finalizat"
              : videoUrl
                ? "Așteaptă Aprobare Video"
                : !r.sceneApproved
                  ? rawStatus
                  : // Script approved, nothing generated: the batch simply
                    // has not got to it. "Queued" is the honest word — which
                    // scene is being worked on right now is an estimate, and
                    // ProductionActivity is where that estimate belongs.
                    !r.imageUrl
                    ? "In Asteptare"
                    : !r.imageApproved
                      ? "Așteaptă Aprobare Imagine"
                      : // voiceApproved with no take = a cinematic (silent)
                        // project, where Scripting pre-checks the box and
                        // nothing is ever synthesized.
                        !r.voiceApproved
                        ? r.voiceUrl
                          ? "Așteaptă Aprobare Voce"
                          : "Generare Voce"
                        : "Generare Video";

  const { kind } = classifyStatus(status);

  return {
    id: r.id,
    order,
    label: `S${index + 1}`,
    narration: r.narration,
    imagePrompt: r.imagePrompt,
    imageUrl: r.imageUrl,
    videoUrl,
    voiceUrl: r.voiceUrl,
    sceneApproved: r.sceneApproved,
    rewriteRequested: /regenerare text/.test(norm),
    voiceApproved: r.voiceApproved,
    imageApproved: r.imageApproved,
    videoApproved: r.videoApproved,
    regenImage: r.regenImage,
    regenVideo: r.regenVideo,
    regenVoice: r.regenVoice,
    note: r.note,
    evidenceRef: r.evidenceRef || null,
    needsFactCheck: r.needsFactCheck,
    videoPrompt: r.videoPrompt,
    versions: r.versions,
    status: displayStatus(status),
    statusKind: kind,
  };
}

/**
 * Sort scenes the way the producer sees them, then label them S1..Sn.
 *
 * "Ordine Scenă" is the truth, creation time breaks ties, and records that
 * never got an order sort last rather than at random — without an explicit
 * sort the list used to reshuffle on every 10s refresh.
 */
export function orderScenes<T extends { order: number | null; createdAt: string | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ao = a.order ?? Infinity;
    const bo = b.order ?? Infinity;
    if (ao !== bo) return ao - bo;
    return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
  });
}

/**
 * Join a scene's saved-draft metadata to the files that back it.
 *
 * Shared by both backends for the same reason the status derivation is: the
 * `last` back-fill below is a guess with rules, and two copies of a guess
 * drift. Airtable passes its attachment array; Postgres passes rows from
 * hov.attachment. Both are just {filename, url}.
 */
export function buildVersions(
  raw: unknown,
  files: Array<{ filename?: string | null; url?: string | null }>,
): SceneVersion[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return []; // Hand-edited into nonsense: show none rather than crash.
    }
  }
  if (!Array.isArray(parsed)) return [];

  const byName = new Map<string, string>();
  for (const f of files) if (f?.filename && f?.url) byName.set(f.filename, f.url);

  const out = parsed.flatMap((e): SceneVersion[] => {
    const v = e as Record<string, unknown>;
    const kind = v.kind === "video" ? "video" : "image";
    const url =
      kind === "video"
        ? typeof v.url === "string"
          ? v.url
          : null
        : (byName.get(String(v.file ?? "")) ?? null);
    if (!url) return []; // File is gone — drop the orphan rather than show a dead link.
    return [
      {
        id: String(v.id ?? v.file ?? url),
        kind,
        url,
        prompt: typeof v.prompt === "string" ? v.prompt : null,
        mediaId: typeof v.mediaId === "string" ? v.mediaId : null,
        at: typeof v.at === "string" ? v.at : null,
        auto: v.auto === true,
        last: v.last === true,
      },
    ];
  });

  // Drafts saved before the marker existed carry no `last`, and waiting for
  // the next regeneration to label one would leave old scenes reading as if
  // nothing had ever been kept automatically. The newest automatic keep is
  // the best available answer for those, and the guess is dropped the moment
  // a real marker is written.
  for (const kind of ["image", "video"] as const) {
    const ofKind = out.filter((v) => v.kind === kind);
    if (ofKind.some((v) => v.last)) continue;
    for (let i = ofKind.length - 1; i >= 0; i--) {
      if (ofKind[i].auto) {
        ofKind[i].last = true;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The three tables humans edit by hand
//
// These are the only tables nobody built a screen for, because Airtable's grid
// WAS the screen. `Genre Profiles` says so in its own description: "edit a cell
// here and the next project picks it up, no workflow change needed". That
// property is the reason Airtable cannot simply be switched off — and the
// reason these types exist.
// ---------------------------------------------------------------------------

/**
 * One row per Tonalitate option on the creation form. Claude Scripting fetches
 * the row matching the chosen tone at the start of every run and injects each
 * column into its prompts, falling back to its built-in copy if the row is
 * missing or inactive.
 */
export interface GenreProfile {
  id: string;
  /** Matched case-insensitively against the form's Tone option. */
  tone: string;
  /** What the film calls itself in every prompt: "documentary", "horror story". */
  format: string | null;
  /** On = the web-research step runs before writing. */
  research: boolean;
  researchBrief: string | null;
  /** Ground truth (factual genres) vs setting texture only (fiction). */
  factSheetFraming: string | null;
  /** Forbidden, required, or attributed-claims-only. */
  invention: string | null;
  structure: string | null;
  voice: string | null;
  wpm: number | null;
  hookRule: string | null;
  visual: string | null;
  /** 0 calm, 1 default, 2 aggressive. Read by the Remotion montage planner. */
  montageIntensity: number;
  /** Off = the workflow ignores this row and uses its built-in fallback. */
  active: boolean;
}

export interface LibraryScript {
  id: string;
  title: string;
  sourceUrl: string | null;
  category: string | null;
  tone: string | null;
  styleCard: string | null;
  pacingWpm: number | null;
  hookWpm: number | null;
  durationSeconds: number | null;
  active: boolean;
  notes: string | null;
  /** Length only — the full transcript is far too big to ship to a form. */
  transcriptChars: number;
}

export interface ScriptExample {
  id: string;
  name: string;
  content: string | null;
  style: string[];
  tags: string[];
  usageUrl: string | null;
  notes: string | null;
}

/** What an admin form may change, per table. Anything else is refused. */
export const GENRE_EDITABLE = [
  "tone", "format", "research", "researchBrief", "factSheetFraming", "invention",
  "structure", "voice", "wpm", "hookRule", "visual", "montageIntensity", "active",
] as const;

export const LIBRARY_EDITABLE = [
  "title", "sourceUrl", "category", "tone", "styleCard",
  "pacingWpm", "hookWpm", "durationSeconds", "active", "notes",
] as const;

export const EXAMPLE_EDITABLE = [
  "name", "content", "style", "tags", "usageUrl", "notes",
] as const;

export type GenrePatch = Partial<Pick<GenreProfile, (typeof GENRE_EDITABLE)[number]>>;
export type LibraryPatch = Partial<Pick<LibraryScript, (typeof LIBRARY_EDITABLE)[number]>>;
export type ExamplePatch = Partial<Pick<ScriptExample, (typeof EXAMPLE_EDITABLE)[number]>>;

/**
 * What filing a draft should change, decided without touching any store.
 *
 * The bookkeeping around saved drafts is the fiddly part — de-duplicating
 * against every prior draft, moving the "previous generation" marker, pruning
 * the oldest past the cap — and it is identical whichever backend holds the
 * bytes. Only two things differ per backend: where the file goes, and how a
 * draft is pointed back at the scene.
 *
 * Kept as a pure function so the decision can be reasoned about on its own.
 * `platform/lib/data.ts` still carries the Airtable original inline; the two
 * must agree, and this is the copy that runs.
 */
export function planVersionSave(opts: {
  /** The scene's existing `Versiuni Media` entries, raw. */
  list: Array<Record<string, unknown>>;
  kind: "image" | "video";
  /** Stable identity of the live asset — see the note on de-duplication. */
  key: string;
  auto: boolean;
  prompt: string | null;
  mediaId: string | null;
  /** For video drafts, which store the link rather than a copy. */
  url: string | null;
  nowIso: string;
  /** Monotonic enough to order drafts; the Airtable original uses Date.now(). */
  stamp: number;
}):
  | { action: "duplicate" }
  | { action: "marker"; list: Array<Record<string, unknown>> }
  | {
      action: "file";
      list: Array<Record<string, unknown>>;
      entry: Record<string, unknown>;
      dropped: number;
    } {
  const { list, kind, key, auto } = opts;

  // Already kept. Checked against EVERY draft of this kind, not just the
  // newest: restoring A then B then A again would otherwise file a second
  // copy of A each time round.
  const existing = list.find((e) => e?.kind === kind && e?.key === key);
  if (existing) {
    if (!auto) return { action: "duplicate" };
    // Nothing new to file — but this IS the asset being replaced right now, so
    // it takes the "Last generation" marker over from whoever held it.
    // Without this the label goes stale exactly when de-duplication bites:
    // restore an older draft, regenerate, and the asset just replaced is one
    // that was already on file.
    return {
      action: "marker",
      list: list.map((e) => (e?.kind === kind ? { ...e, last: e === existing } : e)),
    };
  }

  const id = `v${opts.stamp.toString(36)}`;
  const entry: Record<string, unknown> = {
    id,
    kind,
    key,
    auto,
    // Only an automatic keep is a "previous generation": it files the asset a
    // replacement is about to overwrite. A manual save files the asset that is
    // still live, so it claims nothing.
    ...(auto ? { last: true } : {}),
    prompt: opts.prompt,
    at: opts.nowIso,
  };
  if (kind === "image") {
    entry.file = `${id}.png`;
    entry.mediaId = opts.mediaId;
  } else {
    entry.url = opts.url;
  }

  // Oldest-first within the kind, so the cap drops the least useful draft.
  const next = [
    ...(auto ? list.map((e) => (e?.kind === kind ? { ...e, last: false } : e)) : list),
    entry,
  ];
  const ofKind = next.filter((e) => e?.kind === kind);
  const drop = new Set(
    ofKind.slice(0, Math.max(0, ofKind.length - MAX_VERSIONS_PER_KIND)).map((e) => e.id),
  );
  return {
    action: "file",
    list: next.filter((e) => !drop.has(e.id)),
    entry,
    dropped: drop.size,
  };
}
