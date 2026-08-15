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
  /** Background music AND the synthesized boom/whoosh/riser accents. Both
   *  are composed here, not in the footage, so they ride one switch. */
  music: boolean;
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
}

export interface RawScene {
  id: string;
  /** Null when the record never got one — see the fallback in buildScene. */
  order: number | null;
  narration: string | null;
  imagePrompt: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
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
      music: opts.music === true,
    },
    awaitingFinalSettings: /setari finale/.test(normalizeStatus(r.statusRaw)),
    category: typeof opts.category === "string" ? opts.category : null,
    language: r.language,
    narratorVoice: r.voiceId,
    multiVoiceMode: typeof opts.multiVoiceMode === "string" ? opts.multiVoiceMode : "off",
    cast: Array.isArray(opts.cast)
      ? (opts.cast as unknown[]).filter((v): v is string => typeof v === "string" && v.includes("_"))
      : [],
    castAssign: asRecord(opts.castAssign) as Record<string, string>,
    chapterVoices: asRecord(opts.chapterVoices) as Record<string, string>,
  };
}

export function buildScene(r: RawScene, index: number): Scene {
  const rawStatus = r.statusRaw || "—";
  const norm = normalizeStatus(rawStatus);
  const order = r.order ?? index + 1;

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
              : r.videoUrl
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
    videoUrl: r.videoUrl,
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
