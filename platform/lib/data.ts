// Data layer — DataAdapter pattern from the platform proposal.
// Today: AirtableAdapter reading the same base n8n already writes to.
// Later: swap in a PostgresAdapter without touching any page or component.
//
// Required env vars (set on Vercel → Project → Settings → Environment Variables):
//   AIRTABLE_API_KEY        personal access token with data.records:read
//   AIRTABLE_BASE_ID        the app... id of the production base
//   AIRTABLE_PROJECTS_TABLE table name or tbl... id for projects (default: "Proiecte")
//   AIRTABLE_SCENES_TABLE   table name or tbl... id for scenes (default: "Scene")
// Without them the app serves demo data so the UI is reviewable before wiring.

export type StatusKind = "wait" | "run" | "done" | "err" | "idle";

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

export interface Scene {
  id: string;
  order: number;
  label: string;
  narration: string | null;
  imagePrompt: string | null;
  /** What the clip DOES — the direction handed to Veo. */
  videoPrompt: string | null;
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
  status: string;
  statusKind: StatusKind;
}

// Airtable status text → semantic kind + rough pipeline progress.
// Keys are lowercased and diacritics-stripped before lookup, so both
// "Așteaptă Aprobare Imagine" and "Asteapta Aprobare Imagine" match.
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

// Airtable status values are Romanian (n8n writes them); the UI is English.
// Translate at display time so nothing in Airtable/n8n has to change.
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

function normalizeStatus(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function displayStatus(raw: string): string {
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

function classifyStatus(raw: string): { kind: StatusKind; progress: number } {
  const s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  for (const { match, kind, progress } of STATUS_MAP) {
    if (match.test(s)) return { kind, progress };
  }
  return { kind: "idle", progress: 0 };
}

// Airtable field names as n8n writes them today. Several have grown
// organically (including the "Lenght" typo) — this is the single place
// that knows about them.
const F = {
  projectName: ["Nume Proiect", "Name", "Nume"],
  projectStatus: ["Status General", "Status"],
  projectLength: ["Lenght", "Length", "Durata"],
  projectTone: ["Tonalitate", "Tone"],
  projectFinalVideo: ["Link Video Final", "Final Video URL"],
  projectAspect: ["Format"],
  projectNoCaptions: ["Fără Subtitrări", "Fara Subtitrari"],
  projectEditing: ["Editing Options"],
  sceneOrder: ["Ordine Scenă", "Ordine Scena"],
  sceneNarration: ["Script Scenă", "Narration", "Narațiune"],
  sceneImage: ["Imagine Scenă", "Imagine Scena"],
  // "Video Scenă URL" holds the motion PROMPT (legacy reuse) — never read
  // it as a link. The muxed clip lives in Scene Final URL + the "Video
  // Scenă" attachment.
  sceneVideo: ["Scene Final URL"],
  sceneVideoAttachment: ["Video Scenă"],
  sceneVoice: ["Voiceover URL"],
  sceneImagePrompt: ["Imagine First Frame"],
  // Despite the name, this holds the MOTION prompt — what Veo is told the
  // shot does. The finished clip lands in "Scene Final URL". It is the field
  // that actually decides what the video shows, and it was invisible to the
  // producer: editing the narration or the image prompt left it untouched,
  // so a clip kept performing the old direction.
  sceneVideoPrompt: ["Video Scenă URL"],
  sceneApproved: ["Aprobare Scenă", "Aprobare Scena"],
  sceneVoiceApproved: ["Aprobare Voce"],
  sceneImageApproved: ["Aprobare Imagine"],
  sceneVideoApproved: ["Aprobare Video"],
  sceneRegenImage: ["Regenerează Imagine", "Regenereaza Imagine"],
  sceneRegenVideo: ["Regenerează Video", "Regenereaza Video"],
  sceneRegenVoice: ["Regenerează Voce", "Regenereaza Voce"],
  sceneNote: ["Observații Scenă", "Observatii Scena"],
  sceneEvidenceRef: ["Evidence Ref"],
  sceneNeedsFactCheck: ["Needs Fact Check"],
  sceneStatus: ["Status Producție Scenă", "Status"],
};

function pick(fields: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) if (fields[n] !== undefined) return fields[n];
  return undefined;
}

function firstAttachmentUrl(v: unknown): string | null {
  if (Array.isArray(v) && v[0] && typeof v[0] === "object") {
    const url = (v[0] as { url?: string }).url;
    return url ?? null;
  }
  return typeof v === "string" && v.startsWith("http") ? v : null;
}

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const PROJECTS_TABLE = process.env.AIRTABLE_PROJECTS_TABLE || "Proiecte";
const SCENES_TABLE = process.env.AIRTABLE_SCENES_TABLE || "Scene";

export const isConfigured = Boolean(API_KEY && BASE_ID);

interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

async function airtableList(table: string, params: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?${params}` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      // Approvals flip in Airtable every few seconds while n8n runs;
      // keep the dashboard near-live without hammering the API.
      next: { revalidate: 10 },
    });
    if (!res.ok) throw new Error(`Airtable ${table}: HTTP ${res.status}`);
    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

function toProject(r: AirtableRecord): Project {
  const status = String(pick(r.fields, F.projectStatus) ?? "—");
  const { kind, progress } = classifyStatus(status);
  // Stored as JSON by n8n; anything missing (or an older project) means the
  // overlay was on.
  let opts: Partial<EditingOptions> = {};
  try {
    opts = JSON.parse(String(pick(r.fields, F.projectEditing) ?? "{}")) ?? {};
  } catch {
    opts = {};
  }
  return {
    id: r.id,
    name: String(pick(r.fields, F.projectName) ?? "Untitled project"),
    lengthSeconds: Number(pick(r.fields, F.projectLength)) || null,
    tone: (pick(r.fields, F.projectTone) as string) ?? null,
    status: displayStatus(status),
    statusKind: kind,
    progress,
    finalVideoUrl: (pick(r.fields, F.projectFinalVideo) as string) ?? null,
    aspect: pick(r.fields, F.projectAspect) === "9:16" ? "9:16" : "16:9",
    updatedAt: r.createdTime,
    editing: {
      captions: pick(r.fields, F.projectNoCaptions) !== true,
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
    awaitingFinalSettings: /setari finale/.test(normalizeStatus(status)),
    category: typeof (opts as { category?: unknown }).category === "string"
      ? String((opts as { category?: string }).category)
      : null,
    // The film's spoken language, as the creation form recorded it. Read so
    // every later voice picker can narrow to voices that speak it, exactly
    // like the creation form does — otherwise swapping a narrator on a
    // Romanian project offers the English library again.
    language: String(r.fields["Language"] ?? ""),
    narratorVoice: String(r.fields["Voice ID"] ?? ""),
    multiVoiceMode: String((opts as { multiVoiceMode?: string }).multiVoiceMode ?? "off"),
    cast: Array.isArray((opts as { cast?: unknown }).cast)
      ? ((opts as { cast?: unknown[] }).cast as unknown[]).filter(
          (v): v is string => typeof v === "string" && v.includes("_"),
        )
      : [],
    castAssign:
      typeof (opts as { castAssign?: unknown }).castAssign === "object" &&
      (opts as { castAssign?: unknown }).castAssign !== null
        ? ((opts as { castAssign?: Record<string, string> }).castAssign as Record<string, string>)
        : {},
    chapterVoices:
      typeof (opts as { chapterVoices?: unknown }).chapterVoices === "object" &&
      (opts as { chapterVoices?: unknown }).chapterVoices !== null
        ? ((opts as { chapterVoices?: Record<string, string> })
            .chapterVoices as Record<string, string>)
        : {},
  };
}

function toScene(r: AirtableRecord, index: number): Scene {
  const rawStatus = String(pick(r.fields, F.sceneStatus) ?? "—");
  const imageApproved = Boolean(pick(r.fields, F.sceneImageApproved));
  const videoApproved = Boolean(pick(r.fields, F.sceneVideoApproved));
  const voiceApproved = Boolean(pick(r.fields, F.sceneVoiceApproved));
  const sceneApproved = Boolean(pick(r.fields, F.sceneApproved));
  const regenImage = Boolean(pick(r.fields, F.sceneRegenImage));
  const regenVoice = Boolean(pick(r.fields, F.sceneRegenVoice));
  const regenVideo = Boolean(pick(r.fields, F.sceneRegenVideo));
  const imageUrl = firstAttachmentUrl(pick(r.fields, F.sceneImage));
  const voiceUrl = (pick(r.fields, F.sceneVoice) as string) ?? null;
  const order = Number(pick(r.fields, F.sceneOrder)) || index + 1;
  const videoUrl =
    ((pick(r.fields, F.sceneVideo) as string) || null) ??
    firstAttachmentUrl(pick(r.fields, F.sceneVideoAttachment));

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
  const norm = normalizeStatus(rawStatus);
  const status =
    /eroare|failed|error/.test(norm) || /regenerare text/.test(norm)
      ? rawStatus
      : regenImage
        ? "Generare Imagine"
        : regenVoice
          ? "Generare Voce"
          : regenVideo
            ? "Generare Video"
            : videoApproved
              ? "Finalizat"
              : videoUrl
                ? "Așteaptă Aprobare Video"
                : !sceneApproved
                  ? rawStatus
                  : // Script approved, nothing generated: the batch simply
                    // has not got to it. "Queued" is the honest word — which
                    // scene is being worked on right now is an estimate, and
                    // ProductionActivity is where that estimate belongs.
                    !imageUrl
                    ? "In Asteptare"
                    : !imageApproved
                      ? "Așteaptă Aprobare Imagine"
                      : // voiceApproved with no take = a cinematic (silent)
                        // project, where Scripting pre-checks the box and
                        // nothing is ever synthesized.
                        !voiceApproved
                        ? voiceUrl
                          ? "Așteaptă Aprobare Voce"
                          : "Generare Voce"
                        : "Generare Video";
  const { kind } = classifyStatus(status);
  return {
    id: r.id,
    order,
    label: `S${index + 1}`,
    narration: (pick(r.fields, F.sceneNarration) as string) ?? null,
    imagePrompt: (pick(r.fields, F.sceneImagePrompt) as string) ?? null,
    // Older rows can hold a URL here instead of a direction; showing that as
    // an editable prompt would invite someone to overwrite a link.
    videoPrompt: ((v) => (v && !/^https?:\/\//i.test(v.trim()) ? v : null))(
      (pick(r.fields, F.sceneVideoPrompt) as string) ?? null,
    ),
    imageUrl,
    videoUrl,
    voiceUrl,
    sceneApproved,
    rewriteRequested: /regenerare text/.test(norm),
    voiceApproved,
    imageApproved,
    videoApproved,
    regenImage,
    regenVideo,
    regenVoice,
    note: (pick(r.fields, F.sceneNote) as string) ?? null,
    evidenceRef: (pick(r.fields, F.sceneEvidenceRef) as string) || null,
    needsFactCheck: Boolean(pick(r.fields, F.sceneNeedsFactCheck)),
    status: displayStatus(status),
    statusKind: kind,
  };
}

/**
 * Ground truth for "did the project actually get created?".
 *
 * The n8n webhook's answer is not evidence — it can time out, or return 200
 * while a later node fails. This asks Airtable directly for a project with
 * this name created in the last few minutes, so the UI never claims success
 * for a record that does not exist.
 */
export async function findRecentProjectByName(
  name: string,
  withinMs = 5 * 60 * 1000,
): Promise<string | null> {
  if (!isConfigured || !name.trim()) return null;
  const escaped = name.trim().replace(/'/g, "\\'");
  const formula = encodeURIComponent(`{Nume Proiect}='${escaped}'`);
  const records = await airtableList(
    PROJECTS_TABLE,
    `pageSize=20&filterByFormula=${formula}`,
  );
  const cutoff = Date.now() - withinMs;
  const fresh = records
    .filter((r) => new Date(r.createdTime).getTime() >= cutoff)
    .sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
  return fresh[0]?.id ?? null;
}

export async function getProjects(): Promise<Project[]> {
  if (!isConfigured) return DEMO_PROJECTS;
  const records = await airtableList(PROJECTS_TABLE, "pageSize=100");

  // One extra query gets every scene image; the earliest scene (by "Ordine
  // Scenă") per project becomes that project's card cover.
  const covers = new Map<string, { order: number; url: string }>();
  try {
    const sceneRecs = await airtableList(
      SCENES_TABLE,
      `filterByFormula=${encodeURIComponent("{Imagine Scenă}!=''")}` +
        `&fields%5B%5D=${encodeURIComponent("Imagine Scenă")}` +
        `&fields%5B%5D=Project_ID&fields%5B%5D=${encodeURIComponent("Ordine Scenă")}`,
    );
    for (const r of sceneRecs) {
      const pid = String(r.fields["Project_ID"] ?? "");
      const url = firstAttachmentUrl(r.fields["Imagine Scenă"]);
      if (!pid || !url) continue;
      const order = Number(r.fields["Ordine Scenă"]) || 9999;
      const cur = covers.get(pid);
      if (!cur || order < cur.order) covers.set(pid, { order, url });
    }
  } catch {
    // Covers are decoration — never fail the dashboard over them.
  }

  return records
    .map((r) => ({ ...toProject(r), coverUrl: covers.get(r.id)?.url ?? null }))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/**
 * Just the production pulse — feeds the nav ticker. Fetches only the status
 * column, so polling it every half minute costs a fraction of getProjects()
 * (which also sweeps the whole Scene table for covers).
 */
export async function getStatusCounts(): Promise<{ run: number; wait: number; err: number }> {
  const counts = { run: 0, wait: 0, err: 0 };
  const tally = (status: string) => {
    const { kind } = classifyStatus(status);
    if (kind === "run") counts.run += 1;
    else if (kind === "wait") counts.wait += 1;
    else if (kind === "err") counts.err += 1;
  };
  if (!isConfigured) {
    // Demo records carry a pre-translated English status string that the
    // Romanian STATUS_MAP won't classify — their statusKind is the truth.
    for (const p of DEMO_PROJECTS) {
      if (p.statusKind === "run" || p.statusKind === "wait" || p.statusKind === "err")
        counts[p.statusKind] += 1;
    }
    return counts;
  }
  // No fields[] restriction: Airtable answers 422 for an unknown field name,
  // and the status column has two candidate names (F.projectStatus). A base
  // using the fallback name would kill the ticker while the dashboard —
  // which fetches full records — worked fine. Full records cost more bytes,
  // but they can't disagree with the rest of the app about field names.
  const records = await airtableList(PROJECTS_TABLE, "pageSize=100");
  for (const r of records) tally(String(pick(r.fields, F.projectStatus) ?? ""));
  return counts;
}

export async function getProject(id: string): Promise<Project | null> {
  if (!isConfigured) return DEMO_PROJECTS.find((p) => p.id === id) ?? DEMO_PROJECTS[0];
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}/${id}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, next: { revalidate: 10 } },
  );
  if (!res.ok) return null;
  return toProject((await res.json()) as AirtableRecord);
}

export async function getScenes(projectId: string): Promise<Scene[]> {
  if (!isConfigured) return DEMO_SCENES;
  // Scene records link to their project via a Project_ID text field.
  const formula = encodeURIComponent(`{Project_ID} = "${projectId}"`);
  const records = await airtableList(SCENES_TABLE, `pageSize=100&filterByFormula=${formula}`);
  // Without an explicit sort, Airtable returns records in an unspecified
  // order that can differ between polls — which made scenes shuffle on
  // every 10s refresh. Sort BEFORE mapping: "Ordine Scenă" is the truth,
  // creation time breaks ties and places records that never got an order
  // (added by hand in Airtable) at the end instead of at random.
  records.sort((a, b) => {
    const ao = Number(pick(a.fields, F.sceneOrder)) || Infinity;
    const bo = Number(pick(b.fields, F.sceneOrder)) || Infinity;
    if (ao !== bo) return ao - bo;
    return new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime();
  });
  const scenes = records.map(toScene);
  return scenes.map((s, i) => ({ ...s, label: `S${i + 1}` }));
}

// ---------- demo data (shown until env vars are set) ----------
const DEMO_PROJECTS: Project[] = [
  {
    id: "demo-1",
    name: "History of Germany in WW2",
    lengthSeconds: 64,
    tone: "Dark",
    status: "Awaiting Image Approval",
    statusKind: "wait",
    progress: 0.62,
    finalVideoUrl: null,
    aspect: "16:9" as const,
    updatedAt: null,
    editing: { captions: true, hookTitle: true, chapterCards: true, endScreen: true, sfx: true, music: false },
    awaitingFinalSettings: false,
    category: "story",
    language: "English",
    narratorVoice: "",
    multiVoiceMode: "off",
    cast: [],
    castAssign: {},
    chapterVoices: {},
  },
  {
    id: "demo-2",
    name: "Lost Cities of the Amazon",
    lengthSeconds: 96,
    tone: "Mystery",
    status: "Generating Video · 7/12",
    statusKind: "run",
    progress: 0.58,
    finalVideoUrl: null,
    aspect: "16:9" as const,
    updatedAt: null,
    editing: { captions: true, hookTitle: true, chapterCards: true, endScreen: true, sfx: true, music: false },
    awaitingFinalSettings: false,
    category: "story",
    language: "English",
    narratorVoice: "",
    multiVoiceMode: "off",
    cast: [],
    castAssign: {},
    chapterVoices: {},
  },
  {
    id: "demo-3",
    name: "Fall of Constantinople",
    lengthSeconds: 64,
    tone: "Epic",
    status: "Error at scene 3",
    statusKind: "err",
    progress: 0.31,
    finalVideoUrl: null,
    aspect: "16:9" as const,
    updatedAt: null,
    editing: { captions: true, hookTitle: true, chapterCards: true, endScreen: true, sfx: true, music: false },
    awaitingFinalSettings: false,
    category: "story",
    language: "English",
    narratorVoice: "",
    multiVoiceMode: "off",
    cast: [],
    castAssign: {},
    chapterVoices: {},
  },
  {
    id: "demo-4",
    name: "The Silk Road Merchants",
    lengthSeconds: 64,
    tone: "Epic",
    status: "Finished",
    statusKind: "done",
    progress: 1,
    finalVideoUrl: "#",
    aspect: "16:9" as const,
    updatedAt: null,
    editing: { captions: true, hookTitle: true, chapterCards: true, endScreen: true, sfx: true, music: false },
    awaitingFinalSettings: false,
    category: "story",
    language: "English",
    narratorVoice: "",
    multiVoiceMode: "off",
    cast: [],
    castAssign: {},
    chapterVoices: {},
  },
];

const DEMO_SCENES: Scene[] = Array.from({ length: 8 }, (_, i) => {
  const kinds: StatusKind[] = ["done", "done", "done", "run", "err", "idle", "idle", "idle"];
  const names = [
    "Hook — dunes of ash",
    "Berlin 1936",
    "Blitzkrieg",
    "The Eastern Front",
    "Stalingrad",
    "D-Day",
    "The Fall of Berlin",
    "Epilogue",
  ];
  return {
    id: `demo-s${i + 1}`,
    order: i + 1,
    label: `S${i + 1}`,
    narration: names[i],
    imagePrompt: null,
    videoPrompt: null,
    imageUrl: null,
    videoUrl: null,
    voiceUrl: null,
    sceneApproved: true,
    rewriteRequested: false,
    regenImage: false,
    regenVideo: false,
    regenVoice: false,
    note: null,
    evidenceRef: i === 1 ? "E1, E2" : null,
    needsFactCheck: false,
    voiceApproved: i < 3,
    imageApproved: i < 4,
    videoApproved: i < 2,
    status: kinds[i] === "run" ? "Generating Video" : kinds[i] === "err" ? "Error" : kinds[i] === "done" ? "Video Ready" : "Queued",
    statusKind: kinds[i],
  };
});

// ---------- writes (Phase B) ----------
// The site never talks to n8n directly. Approvals and regenerations are
// plain Airtable field writes — the exact checkboxes the n8n polling loops
// already watch. Requires the token to also have data.records:write.

async function airtablePatch(
  table: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!isConfigured) return; // demo mode: no-op
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      // typecast lets writes introduce new select options (e.g. the
      // "Regenerare Text" scene status) instead of failing with 422.
      body: JSON.stringify({ fields, typecast: true }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable PATCH ${table}/${recordId}: HTTP ${res.status} — ${body}`);
  }
}

export async function writeSceneApproval(
  sceneId: string,
  kind: "image" | "video",
  action: "approve" | "regenerate",
): Promise<void> {
  // Field names must match the Airtable Scene table exactly (diacritics
  // included) — n8n polls these very checkboxes.
  const fields =
    kind === "image"
      ? action === "approve"
        ? { "Aprobare Imagine": true, "Regenerează Imagine": false }
        : { "Regenerează Imagine": true, "Aprobare Imagine": false }
      : action === "approve"
        ? { "Aprobare Video": true, "Regenerează Video": false }
        : {
            "Regenerează Video": true,
            "Aprobare Video": false,
            // Sort & Cap Scenes treats "Așteaptă Aprobare Video"/"Finalizat"
            // as DONE and sorts them behind the pending ones, where the cap
            // of 8 can drop them. A scene waiting on a regeneration IS
            // outstanding work, so it has to read as such or a fresh batch
            // on a long project would never reach it.
            "Status Producție Scenă": "Generare Video",
          };
  await airtablePatch(SCENES_TABLE, sceneId, fields);
}

export async function writeProjectFields(
  projectId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await airtablePatch(PROJECTS_TABLE, projectId, fields);
}

/**
 * Merge a patch into the project's Editing Options JSON (read-modify-write).
 * The JSON is the schema-free home of category/multi-voice settings, so
 * writers must never blindly overwrite it.
 */
export async function updateEditingOptions(
  projectId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}/${projectId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Airtable: HTTP ${res.status}`);
  const rec = (await res.json()) as AirtableRecord;
  let opts: Record<string, unknown> = {};
  try {
    opts = JSON.parse(String(pick(rec.fields, F.projectEditing) ?? "{}")) ?? {};
  } catch {
    opts = {};
  }
  await airtablePatch(PROJECTS_TABLE, projectId, {
    "Editing Options": JSON.stringify({ ...opts, ...patch }),
  });
}

export async function getProjectScript(projectId: string): Promise<string | null> {
  if (!isConfigured) return DEMO_SCRIPT;
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}/${projectId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, next: { revalidate: 10 } },
  );
  if (!res.ok) return null;
  const rec = (await res.json()) as AirtableRecord;
  const script = pick(rec.fields, [
    "Edited Narrator Script",
    "Full Narrator Script",
    "Script",
  ]);
  return typeof script === "string" && script.trim() ? script : null;
}

const DEMO_SCRIPT = `[CHAPTER 0]
What if the most documented war in history still hides its darkest turn?

[CHAPTER 1]
Berlin, 1936. The stadium roars, the cameras roll, and a nation rehearses
the spectacle it will soon export as war...`;

// ---------- script review (Scripturi table) ----------
// The scripting workflow saves the draft to the Scripturi table and polls
// its Status field: "awaiting_approval" -> reviewer edits "Script Content"
// (keeping the [CHAPTER n: title] markers) -> Status "approved" resumes
// production with the EDITED text. The site edits exactly those fields.

const SCRIPTS_TABLE = process.env.AIRTABLE_SCRIPTS_TABLE || "Scripturi";

export interface ScriptInfo {
  id: string;
  content: string;
  status: string;
}

export async function getProjectScriptInfo(projectId: string): Promise<ScriptInfo | null> {
  if (!isConfigured) {
    return { id: "demo-script", content: DEMO_SCRIPT, status: "awaiting_approval" };
  }
  const projRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}/${projectId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, next: { revalidate: 10 } },
  );
  if (!projRes.ok) return null;
  const proj = (await projRes.json()) as AirtableRecord;
  const links = proj.fields["scripts"];
  const scriptId = Array.isArray(links) && links.length ? String(links[links.length - 1]) : null;
  if (!scriptId) return null;
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCRIPTS_TABLE)}/${scriptId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, next: { revalidate: 10 } },
  );
  if (!res.ok) return null;
  const rec = (await res.json()) as AirtableRecord;
  return {
    id: rec.id,
    content: String(rec.fields["Script Content"] ?? ""),
    status: String(rec.fields["Status"] ?? ""),
  };
}

export async function writeScriptFields(
  scriptId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await airtablePatch(SCRIPTS_TABLE, scriptId, fields);
}

/** Reviewer feedback consumed (and cleared) by the n8n regen chains. */
export async function writeSceneFeedback(sceneId: string, feedback: string): Promise<void> {
  await airtablePatch(SCENES_TABLE, sceneId, { "Observații Scenă": feedback });
}

/**
 * The narration a scene currently holds, and whether a take has already been
 * read of it.
 *
 * Needed BEFORE writing new text: the voiceover is synthesized from
 * "Script Scenă", the media batch never overwrites a voiceover that already
 * exists, and nothing anywhere compares the two afterwards. So an edit made
 * after the audio was recorded desynchronizes the film permanently and in
 * silence — the page keeps showing the new line while the take says the old
 * one. Reading the previous value is what lets the caller notice.
 */
export async function readSceneNarration(
  sceneId: string,
): Promise<{
  narration: string;
  hasVoice: boolean;
  imagePrompt: string;
  imageApproved: boolean;
}> {
  if (!isConfigured)
    return { narration: "", hasVoice: false, imagePrompt: "", imageApproved: false };
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCENES_TABLE)}/${sceneId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  const rec = (await res.json()) as { fields?: Record<string, unknown> };
  const f = rec.fields ?? {};
  return {
    narration: String(f["Script Scenă"] ?? ""),
    hasVoice: Boolean(f["Voiceover URL"]),
    imagePrompt: String(f["Imagine First Frame"] ?? ""),
    imageApproved: Boolean(f["Aprobare Imagine"]),
  };
}

/**
 * Everything `Prep Video Regen` (Media Generation) needs before a video
 * regeneration can be asked for — read BEFORE setting the flag.
 *
 * That node is `onError: null`, so it does not fail the scene, it **kills the
 * whole batch**: it throws when the scene has no `Image Media ID` (the Flow
 * asset the clip starts from) or no motion prompt. Flagging a regeneration
 * blind would therefore take down a run that is busy generating other scenes.
 *
 * `hasClip` is the other half: a scene with no clip yet needs no regeneration
 * at all — the batch's own video loop (`Needs Clip?`) will generate one.
 */
export async function readSceneVideoInputs(sceneId: string): Promise<{
  hasClip: boolean;
  hasImageMediaId: boolean;
  hasMotionPrompt: boolean;
}> {
  if (!isConfigured)
    return { hasClip: false, hasImageMediaId: false, hasMotionPrompt: false };
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCENES_TABLE)}/${sceneId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  const rec = (await res.json()) as { fields?: Record<string, unknown> };
  const f = rec.fields ?? {};
  return {
    hasClip: String(f["Scene Final URL"] ?? "").startsWith("http"),
    hasImageMediaId: String(f["Image Media ID"] ?? "").trim() !== "",
    // Legacy field reuse: "Video Scenă URL" holds the motion PROMPT.
    hasMotionPrompt: String(f["Video Scenă URL"] ?? "").trim() !== "",
  };
}

// Scene-script review: edits land in the same fields n8n reads after the
// "Aprobare Scenă" gate, so approved text/prompts flow straight to TTS and
// image generation.
export async function writeSceneScript(
  sceneId: string,
  fields: { narration?: string; imagePrompt?: string; approve?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (typeof fields.narration === "string") patch["Script Scenă"] = fields.narration;
  if (typeof fields.imagePrompt === "string") patch["Imagine First Frame"] = fields.imagePrompt;
  if (fields.approve) patch["Aprobare Scenă"] = true;
  if (Object.keys(patch).length === 0) return;
  await airtablePatch(SCENES_TABLE, sceneId, patch);
}

/**
 * Ask the scripting workflow for a fresh AI take on one scene's text.
 * No dedicated flag field exists (the token can't create fields), so the
 * request rides on the scene status select — the n8n scene-approval loop
 * watches for "Regenerare Text", rewrites narration + prompts, then sets
 * the status back and leaves the scene unapproved for review.
 */
export async function requestSceneRewrite(sceneId: string): Promise<void> {
  await airtablePatch(SCENES_TABLE, sceneId, {
    "Status Producție Scenă": "Regenerare Text",
    "Aprobare Scenă": false,
  });
}

/**
 * Take a scene back out of "rewrite in flight".
 *
 * The flag above is set by the site and cleared by n8n — on success from
 * `Write Scene Rewrite`, on a refused/failed rewrite from `Mark Scene Regen
 * Failed`. Both live INSIDE the execution, so an execution that dies before
 * reaching either (n8n restarted, the webhook POST never landed, or one of
 * the executions n8n creates and then never runs) leaves the flag set with
 * nobody left to clear it. The scene then shows "Rewriting…" forever, and
 * because that state replaces the whole button row, there is no way back to
 * it from the UI at all.
 *
 * "Generare Script" is the same status `Mark Scene Regen Failed` releases to,
 * so a released scene is indistinguishable from one whose rewrite was
 * refused: unapproved, editable, awaiting review.
 */
export async function releaseSceneRewrite(sceneId: string): Promise<void> {
  await airtablePatch(SCENES_TABLE, sceneId, {
    "Status Producție Scenă": "Generare Script",
  });
}

async function airtableDelete(table: string, ids: string[]): Promise<void> {
  // Airtable deletes at most 10 records per call.
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const qs = batch.map((id) => `records[]=${id}`).join("&");
    const res = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?${qs}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${API_KEY}` } },
    );
    if (!res.ok) {
      throw new Error(`Airtable delete ${table}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
    }
    if (i + 10 < ids.length) await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Permanently removes a project and everything attached to it: its scene
 * records, its Scripturi records, then the project itself. Media files on
 * Drive are intentionally left alone (cheap storage, and finished videos
 * may already be published from there).
 */
export async function deleteProjectDeep(projectId: string): Promise<void> {
  // Linked scripts come from the project record itself.
  const projRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}/${projectId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, cache: "no-store" },
  );
  let scriptIds: string[] = [];
  if (projRes.ok) {
    const proj = (await projRes.json()) as AirtableRecord;
    const linked = proj.fields["scripts"];
    if (Array.isArray(linked)) scriptIds = linked.filter((v) => typeof v === "string");
  }

  const scenes = await airtableList(
    SCENES_TABLE,
    `filterByFormula=${encodeURIComponent(`{Project_ID}='${projectId}'`)}&fields%5B%5D=Project_ID`,
  );
  await airtableDelete(SCENES_TABLE, scenes.map((s) => s.id));
  if (scriptIds.length) await airtableDelete("Scripturi", scriptIds);
  await airtableDelete(PROJECTS_TABLE, [projectId]);
}

// Voice regeneration: n8n's video-approval cycle picks up the flag, runs a
// fresh TTS on the (possibly edited) narration and re-muxes the existing
// clip — no image/video regeneration involved.
/** Generic scene field write, for gates that don't need their own helper. */
export async function writeSceneFields(
  sceneId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await airtablePatch(SCENES_TABLE, sceneId, fields);
}

export async function requestVoiceRegen(
  sceneId: string,
  narration?: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    "Regenerează Voce": true,
    // A fresh take has to be listened to again, and any clip built on the
    // old audio is stale.
    "Aprobare Voce": false,
    "Aprobare Video": false,
  };
  if (typeof narration === "string" && narration.trim()) {
    patch["Script Scenă"] = narration.trim();
  }
  await airtablePatch(SCENES_TABLE, sceneId, patch);
}
