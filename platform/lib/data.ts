// Data layer — DataAdapter pattern from the platform proposal.
// Today: AirtableAdapter reading the same base n8n already writes to.
// Later: swap in a PostgresAdapter without touching any page or component.
//
// Required env vars (GitHub Secrets — the deploy workflow writes them onto
// the Hetzner box on every deploy; the site left Vercel on 2026-08-13):
//   AIRTABLE_API_KEY        personal access token with data.records:read
//   AIRTABLE_BASE_ID        the app... id of the production base
//   AIRTABLE_PROJECTS_TABLE table name or tbl... id for projects (default: "Proiecte")
//   AIRTABLE_SCENES_TABLE   table name or tbl... id for scenes (default: "Scene")
// Without them the app serves demo data so the UI is reviewable before wiring.

// Data layer — the site's whole view of the pipeline's state.
//
// Two backends live behind these functions, chosen by DATA_BACKEND:
//
//   airtable (default)  the base n8n still reads and writes — the source of truth
//   postgres            the hov database on the box, populated and running in parallel
//
// They are meant to be indistinguishable. Everything that turns a stored row
// into a Project or a Scene — the status derivation above all — lives once, in
// ./data/derive.ts, and both backends call it. What differs is only where the
// rows come from.
//
// Airtable env vars (still required while it is the source of truth):
//   AIRTABLE_API_KEY        personal access token with data.records:read
//   AIRTABLE_BASE_ID        the app... id of the production base
//   AIRTABLE_PROJECTS_TABLE table name or tbl... id for projects (default: "Proiecte")
//   AIRTABLE_SCENES_TABLE   table name or tbl... id for scenes (default: "Scene")
// Without them the app serves demo data so the UI is reviewable before wiring.
//
// Postgres env vars (used only when DATA_BACKEND=postgres):
//   DATABASE_URL            postgresql://hov:...@postgres:5432/hov
//   MEDIA_BASE_URL          https://house-of-videos.com/media

import {
  buildProject,
  buildScene,
  buildVersions,
  classifyStatus,
  MAX_VERSIONS_PER_KIND,
  type RawProject,
  type RawScene,
} from "./data/derive";
import * as pgBackend from "./data/postgres";

export type {
  StatusKind,
  EditingOptions,
  MotifCard,
  Publishing,
  Project,
  Scene,
  SceneVersion,
  ScriptInfo,
  GenreProfile,
  LibraryScript,
  ScriptExample,
} from "./data/derive";
export {
  MAX_VERSIONS_PER_KIND,
  PUBLISHING_STATES,
  normalizePublishing,
  GENRE_EDITABLE,
  LIBRARY_EDITABLE,
  EXAMPLE_EDITABLE,
} from "./data/derive";

import type {
  Project, Scene, ScriptInfo, SceneVersion, StatusKind,
  GenreProfile, LibraryScript, ScriptExample,
} from "./data/derive";

/**
 * Which backend answers. Airtable unless explicitly switched, because
 * Airtable is still what n8n writes — pointing the site at Postgres while the
 * workflows write Airtable would show the producer a frozen picture.
 */
const USE_PG = process.env.DATA_BACKEND === "postgres";


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
  // Saved drafts. The bytes of an image version live in the attachment field
  // (Airtable re-hosts them, so they outlive fal's expiring link); a video
  // version needs no attachment because its Drive link does not expire.
  sceneVersionFiles: ["Versiuni Imagine"],
  sceneVersions: ["Versiuni Media"],
  sceneMediaId: ["Image Media ID"],
  sceneEvidenceRef: ["Evidence Ref"],
  sceneNeedsFactCheck: ["Needs Fact Check"],
  sceneStatus: ["Status Producție Scenă", "Status"],
};

function pick(fields: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) if (fields[n] !== undefined) return fields[n];
  return undefined;
}

/**
 * Saved drafts, joined to their files.
 *
 * The metadata lives in a JSON field and the image bytes in an attachment
 * field, because neither alone is enough: an attachment carries no prompt or
 * Flow id, and a bare URL to fal or Airtable expires. Image entries name a
 * file and get a freshly signed URL on every read; video entries carry their
 * own Drive link, which does not expire.
 */
function readVersions(fields: Record<string, unknown>): SceneVersion[] {
  const raw = pick(fields, F.sceneVersions);
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // Hand-edited into nonsense: show none rather than crash.
  }
  if (!Array.isArray(parsed)) return [];
  const files = pick(fields, F.sceneVersionFiles);
  const byName = new Map<string, string>();
  if (Array.isArray(files)) {
    for (const f of files as Array<{ filename?: string; url?: string }>) {
      if (f?.filename && f?.url) byName.set(f.filename, f.url);
    }
  }
  const out = parsed.flatMap((e): SceneVersion[] => {
    const v = e as Record<string, unknown>;
    const kind = v.kind === "video" ? "video" : "image";
    const url =
      kind === "video"
        ? typeof v.url === "string"
          ? v.url
          : null
        : (byName.get(String(v.file ?? "")) ?? null);
    if (!url) return []; // File deleted from Airtable — drop the orphan.
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

/**
 * Is a real backend wired up, or is the app serving demo data?
 *
 * Callers use this to decide whether a write is a no-op ("Demo mode — nothing
 * was written"), so it has to answer for whichever backend is actually
 * selected. Asking Airtable's env vars while running on Postgres would tell
 * every server action to pretend it wrote something.
 */
export const isConfigured = USE_PG ? pgBackend.isConfigured : Boolean(API_KEY && BASE_ID);

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

/**
 * Airtable record → the neutral shape, and nothing more.
 *
 * All the judgement — status translation, the sfx/music defaults, which keys
 * of Editing Options mean what — lives in buildProject() so the Postgres
 * backend reaches the same answers from different rows.
 */
function toRawProject(r: AirtableRecord): RawProject {
  return {
    id: r.id,
    name: String(pick(r.fields, F.projectName) ?? ""),
    tone: (pick(r.fields, F.projectTone) as string) ?? null,
    aspectRaw: pick(r.fields, F.projectAspect),
    noCaptions: pick(r.fields, F.projectNoCaptions) === true,
    lengthSeconds: Number(pick(r.fields, F.projectLength)) || null,
    statusRaw: String(pick(r.fields, F.projectStatus) ?? "—"),
    finalVideoUrl: (pick(r.fields, F.projectFinalVideo) as string) ?? null,
    editingRaw: pick(r.fields, F.projectEditing),
    // The film's spoken language, as the creation form recorded it. Read so
    // every later voice picker can narrow to voices that speak it — otherwise
    // swapping a narrator on a Romanian project offers the English library.
    language: String(r.fields["Language"] ?? ""),
    paceRaw: r.fields["Pace"],
    voiceId: String(r.fields["Voice ID"] ?? ""),
    createdAt: r.createdTime,
  };
}

function toProject(r: AirtableRecord): Project {
  return buildProject(toRawProject(r));
}

/** Airtable record → the neutral shape. Derivation lives in buildScene(). */
function toRawScene(r: AirtableRecord): RawScene & { createdAt: string | null } {
  const files = pick(r.fields, F.sceneVersionFiles);
  return {
    id: r.id,
    order: Number(pick(r.fields, F.sceneOrder)) || null,
    narration: (pick(r.fields, F.sceneNarration) as string) ?? null,
    imagePrompt: (pick(r.fields, F.sceneImagePrompt) as string) ?? null,
    // Older rows can hold a URL here instead of a direction; showing that as
    // an editable prompt would invite someone to overwrite a link.
    videoPrompt: ((v) => (v && !/^https?:\/\//i.test(v.trim()) ? v : null))(
      (pick(r.fields, F.sceneVideoPrompt) as string) ?? null,
    ),
    imageUrl: firstAttachmentUrl(pick(r.fields, F.sceneImage)),
    videoUrl: (pick(r.fields, F.sceneVideo) as string) || null,
    storedVideoUrl: firstAttachmentUrl(pick(r.fields, F.sceneVideoAttachment)),
    voiceUrl: (pick(r.fields, F.sceneVoice) as string) ?? null,
    sceneApproved: Boolean(pick(r.fields, F.sceneApproved)),
    imageApproved: Boolean(pick(r.fields, F.sceneImageApproved)),
    voiceApproved: Boolean(pick(r.fields, F.sceneVoiceApproved)),
    videoApproved: Boolean(pick(r.fields, F.sceneVideoApproved)),
    regenImage: Boolean(pick(r.fields, F.sceneRegenImage)),
    regenVideo: Boolean(pick(r.fields, F.sceneRegenVideo)),
    regenVoice: Boolean(pick(r.fields, F.sceneRegenVoice)),
    note: (pick(r.fields, F.sceneNote) as string) ?? null,
    evidenceRef: (pick(r.fields, F.sceneEvidenceRef) as string) || null,
    needsFactCheck: Boolean(pick(r.fields, F.sceneNeedsFactCheck)),
    versions: buildVersions(
      pick(r.fields, F.sceneVersions),
      Array.isArray(files) ? (files as Array<{ filename?: string; url?: string }>) : [],
    ),
    statusRaw: String(pick(r.fields, F.sceneStatus) ?? "—"),
    createdAt: r.createdTime,
  };
}

function toScene(r: AirtableRecord, index: number): Scene {
  return buildScene(toRawScene(r), index);
}

export async function findRecentProjectByName(
  name: string,
  withinMs = 5 * 60 * 1000,
): Promise<string | null> {
  if (USE_PG) return pgBackend.findRecentProjectByName(name, withinMs);
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
  if (USE_PG) return pgBackend.getProjects();
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
  if (USE_PG) return pgBackend.getStatusCounts();
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
  if (USE_PG) return pgBackend.getProject(id);
  if (!isConfigured) return DEMO_PROJECTS.find((p) => p.id === id) ?? DEMO_PROJECTS[0];
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}/${id}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, next: { revalidate: 10 } },
  );
  if (!res.ok) return null;
  return toProject((await res.json()) as AirtableRecord);
}

export async function getScenes(projectId: string): Promise<Scene[]> {
  if (USE_PG) return pgBackend.getScenes(projectId);
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
    editing: { captions: true, hookTitle: true, chapterCards: true, endScreen: true, sfx: true, sfxLevel: 0.35, music: false, drawnCards: true, captionColor: null, speed: 1, speedLocked: false, voice: null, autoApprove: false },
    awaitingFinalSettings: false,
    category: "story",
    language: "English",
    narratorVoice: "",
    multiVoiceMode: "off",
    cast: [],
    castAssign: {},
    chapterVoices: {},
    motifCards: [],
    publishing: { state: "review", ytTitle: "", description: "", notes: "", ytUrl: "" },
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
    editing: { captions: true, hookTitle: true, chapterCards: true, endScreen: true, sfx: true, sfxLevel: 0.35, music: false, drawnCards: true, captionColor: null, speed: 1, speedLocked: false, voice: null, autoApprove: false },
    awaitingFinalSettings: false,
    category: "story",
    language: "English",
    narratorVoice: "",
    multiVoiceMode: "off",
    cast: [],
    castAssign: {},
    chapterVoices: {},
    motifCards: [],
    publishing: { state: "review", ytTitle: "", description: "", notes: "", ytUrl: "" },
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
    editing: { captions: true, hookTitle: true, chapterCards: true, endScreen: true, sfx: true, sfxLevel: 0.35, music: false, drawnCards: true, captionColor: null, speed: 1, speedLocked: false, voice: null, autoApprove: false },
    awaitingFinalSettings: false,
    category: "story",
    language: "English",
    narratorVoice: "",
    multiVoiceMode: "off",
    cast: [],
    castAssign: {},
    chapterVoices: {},
    motifCards: [],
    publishing: { state: "review", ytTitle: "", description: "", notes: "", ytUrl: "" },
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
    editing: { captions: true, hookTitle: true, chapterCards: true, endScreen: true, sfx: true, sfxLevel: 0.35, music: false, drawnCards: true, captionColor: null, speed: 1, speedLocked: false, voice: null, autoApprove: false },
    awaitingFinalSettings: false,
    category: "story",
    language: "English",
    narratorVoice: "",
    multiVoiceMode: "off",
    cast: [],
    castAssign: {},
    chapterVoices: {},
    motifCards: [],
    publishing: { state: "review", ytTitle: "", description: "", notes: "", ytUrl: "" },
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
    versions: [],
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
  if (USE_PG) return pgBackend.writeSceneApproval(sceneId, kind, action);
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
  if (USE_PG) return pgBackend.writeProjectFields(projectId, fields);
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
  if (USE_PG) return pgBackend.updateEditingOptions(projectId, patch);
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
  if (USE_PG) return pgBackend.getProjectScript(projectId);
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

export async function getProjectScriptInfo(projectId: string): Promise<ScriptInfo | null> {
  if (USE_PG) return pgBackend.getProjectScriptInfo(projectId);
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
  if (USE_PG) return pgBackend.writeScriptFields(scriptId, fields);
  await airtablePatch(SCRIPTS_TABLE, scriptId, fields);
}

/** Reviewer feedback consumed (and cleared) by the n8n regen chains. */
export async function writeSceneFeedback(sceneId: string, feedback: string): Promise<void> {
  if (USE_PG) return pgBackend.writeSceneFeedback(sceneId, feedback);
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
  if (USE_PG) return pgBackend.readSceneNarration(sceneId);
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
  if (USE_PG) return pgBackend.readSceneVideoInputs(sceneId);
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
export type { EvidenceRow } from "./data/postgres";

/**
 * The film's research pack — the sourced claims its script was written
 * against. Postgres only: the Airtable backend is frozen at the cutover and
 * nothing runs on it, so growing it a new reader would be code for a museum.
 * On that backend this answers empty, which degrades the YouTube description
 * to one without a sources section rather than failing it.
 */
export async function getProjectEvidence(
  projectId: string,
): Promise<import("./data/postgres").EvidenceRow[]> {
  if (USE_PG) return pgBackend.getProjectEvidence(projectId);
  return [];
}

export async function writeSceneScript(
  sceneId: string,
  fields: { narration?: string; imagePrompt?: string; approve?: boolean },
): Promise<void> {
  if (USE_PG) return pgBackend.writeSceneScript(sceneId, fields);
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
async function fetchSceneRecord(
  sceneId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCENES_TABLE)}/${sceneId}`,
    { headers: { Authorization: `Bearer ${API_KEY}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  const rec = (await res.json()) as { fields?: Record<string, unknown> };
  return rec.fields ?? {};
}

/** Copy the live asset aside so a regeneration can be undone. */
/**
 * How many drafts of each kind a scene keeps.
 *
 * Auto-saving on every regeneration means this grows without anyone deciding
 * to grow it, and each image draft is a real file in the base. The oldest of
 * a kind is dropped past this — and the drop is reported, never silent.
 */

/**
 * Identity of the asset currently on the scene, for de-duplication.
 *
 * URLs cannot be compared: an Airtable attachment link is re-signed on every
 * read, so the same picture reads as a different URL each time and every
 * regeneration would stack a duplicate. The Flow media id is stable per
 * generated image, and a Drive link is stable per clip.
 */
function assetKey(
  f: Record<string, unknown>,
  kind: "image" | "video",
  url: string,
): string {
  if (kind === "video") return url;
  const mediaId = pick(f, F.sceneMediaId);
  if (typeof mediaId === "string" && mediaId) return mediaId;
  const att = pick(f, F.sceneImage);
  const name =
    Array.isArray(att) && att[0] && typeof att[0] === "object"
      ? (att[0] as { filename?: string }).filename
      : null;
  return name ?? url;
}

export async function saveVersionOfScene(
  sceneId: string,
  kind: "image" | "video",
  opts: { auto?: boolean } = {},
): Promise<
  { saved: true; dropped: number } | { saved: false; reason: string }
> {
  if (USE_PG) return pgBackend.saveVersionOfScene(sceneId, kind, opts);
  const f = await fetchSceneRecord(sceneId);
  const url =
    kind === "image"
      ? firstAttachmentUrl(pick(f, F.sceneImage))
      : ((pick(f, F.sceneVideo) as string) || null) ??
        firstAttachmentUrl(pick(f, F.sceneVideoAttachment));
  if (!url) {
    return {
      saved: false,
      reason: `There is no ${kind === "image" ? "image" : "clip"} on this scene yet — nothing to save.`,
    };
  }

  const key = assetKey(f, kind, url);

  // Metadata is round-tripped raw rather than through readVersions() — that
  // view drops entries whose file is missing, and going back through it would
  // delete history the moment Airtable was slow to attach a file.
  const rawPrior = pick(f, F.sceneVersions);
  let list: Array<Record<string, unknown>> = [];
  if (typeof rawPrior === "string" && rawPrior.trim()) {
    try {
      const p = JSON.parse(rawPrior);
      if (Array.isArray(p)) list = p as Array<Record<string, unknown>>;
    } catch {
      /* unreadable history: start a fresh list rather than lose the save */
    }
  }

  // Already kept. Checked against EVERY draft of this kind, not just the
  // newest: restoring A then B then A again would otherwise file a second
  // copy of A each time round.
  const existing = list.find((e) => e?.kind === kind && e?.key === key);
  if (existing) {
    if (!opts.auto) {
      return {
        saved: false,
        reason: `This ${kind === "image" ? "image" : "clip"} is already saved as a draft.`,
      };
    }
    // Nothing new to file — but this IS the asset being replaced right now,
    // so it takes the "Last generation" marker over from whoever held it.
    // Without this the label would go stale exactly when de-duplication bites:
    // restore an older draft, then regenerate, and the asset just replaced is
    // one that was already on file.
    const moved = list.map((e) => (e?.kind === kind ? { ...e, last: e === existing } : e));
    await airtablePatch(SCENES_TABLE, sceneId, {
      "Versiuni Media": JSON.stringify(moved),
    });
    return { saved: true, dropped: 0 };
  }

  const id = `v${Date.now().toString(36)}`;
  const entry: Record<string, unknown> = {
    id,
    kind,
    key,
    auto: opts.auto === true,
    // Only an automatic keep is a "previous generation": it files the asset
    // a replacement is about to overwrite. A manual "Save draft" files the
    // asset that is still live, so it claims nothing.
    ...(opts.auto ? { last: true } : {}),
    prompt:
      (pick(f, kind === "image" ? F.sceneImagePrompt : F.sceneVideoPrompt) as string) ??
      null,
    at: new Date().toISOString(),
  };
  const patch: Record<string, unknown> = {};

  if (kind === "image") {
    // Hand Airtable the URL and it re-hosts the bytes; fal's own link is gone
    // within hours, so a version that merely pointed at it would rot.
    entry.file = `${id}.png`;
    entry.mediaId = (pick(f, F.sceneMediaId) as string) ?? null;
  } else {
    // Drive links do not expire, so the clip needs no second copy.
    entry.url = url;
  }

  // Oldest-first within the kind, so the cap drops the least useful draft.
  const next = [
    ...(opts.auto ? list.map((e) => (e?.kind === kind ? { ...e, last: false } : e)) : list),
    entry,
  ];
  const ofKind = next.filter((e) => e?.kind === kind);
  const drop = new Set(
    ofKind.slice(0, Math.max(0, ofKind.length - MAX_VERSIONS_PER_KIND)).map((e) => e.id),
  );
  const kept = next.filter((e) => !drop.has(e.id));

  if (kind === "image") {
    const prior = pick(f, F.sceneVersionFiles);
    const files = Array.isArray(prior)
      ? (prior as Array<{ id?: string; filename?: string }>)
      : [];
    const keptNames = new Set(
      kept.flatMap((e) => (typeof e.file === "string" ? [e.file] : [])),
    );
    patch["Versiuni Imagine"] = [
      // Existing attachments are re-sent by id; re-sending their URL would
      // make Airtable download and store every one of them again.
      ...files.flatMap((a) =>
        a?.id && a?.filename && keptNames.has(a.filename) ? [{ id: a.id }] : [],
      ),
      { url, filename: entry.file as string },
    ];
  }

  patch["Versiuni Media"] = JSON.stringify(kept);
  await airtablePatch(SCENES_TABLE, sceneId, patch);
  return { saved: true, dropped: drop.size };
}

/** Make a saved draft the live asset again. */
export async function restoreVersionOfScene(
  sceneId: string,
  versionId: string,
): Promise<
  { restored: true; kind: "image" | "video" } | { restored: false; reason: string }
> {
  if (USE_PG) return pgBackend.restoreVersionOfScene(sceneId, versionId);
  const f = await fetchSceneRecord(sceneId);
  const version = readVersions(f).find((v) => v.id === versionId);
  if (!version || !version.url) {
    return {
      restored: false,
      reason: "That saved draft is no longer available — its file was removed from Airtable.",
    };
  }

  // Restoring replaces the live asset, so file that one first — otherwise
  // stepping back to an older draft throws away the newer one, which is the
  // exact loss this whole feature exists to prevent. De-duplication makes it
  // a no-op when the live asset is already kept, and a failure here must not
  // block the restore.
  await saveVersionOfScene(sceneId, version.kind, { auto: true }).catch(() => {});

  if (version.kind === "image") {
    const patch: Record<string, unknown> = {
      "Imagine Scenă": [{ url: version.url }],
      // What is on screen changed, so both the picture and the clip built
      // from the previous one go back for review.
      "Aprobare Imagine": false,
      "Aprobare Video": false,
    };
    // Restoring without these leaves a scene that looks right and cannot be
    // filmed: video generation refuses a scene with no Flow media id, and a
    // later re-roll would work from a prompt that made a different picture.
    if (version.mediaId) patch["Image Media ID"] = version.mediaId;
    if (version.prompt) patch["Imagine First Frame"] = version.prompt;
    await airtablePatch(SCENES_TABLE, sceneId, patch);
    return { restored: true, kind: "image" };
  }

  const patch: Record<string, unknown> = {
    "Scene Final URL": version.url,
    "Aprobare Video": false,
  };
  if (version.prompt) patch["Video Scenă URL"] = version.prompt;
  await airtablePatch(SCENES_TABLE, sceneId, patch);
  return { restored: true, kind: "video" };
}

export async function requestSceneRewrite(sceneId: string): Promise<void> {
  if (USE_PG) return pgBackend.requestSceneRewrite(sceneId);
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
  if (USE_PG) return pgBackend.releaseSceneRewrite(sceneId);
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
  if (USE_PG) return pgBackend.deleteProjectDeep(projectId);
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
  if (USE_PG) return pgBackend.writeSceneFields(sceneId, fields);
  await airtablePatch(SCENES_TABLE, sceneId, fields);
}

export async function requestVoiceRegen(
  sceneId: string,
  narration?: string,
): Promise<void> {
  if (USE_PG) return pgBackend.requestVoiceRegen(sceneId, narration);
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

// ---------------------------------------------------------------------------
// The three hand-edited tables
//
// These screens exist to replace Airtable's grid, and they are wired to BOTH
// backends on purpose. A Postgres-only version would look like it worked
// before the cutover — someone edits a genre, sees it saved, and the next film
// quietly ignores it, because Claude Scripting is still reading Airtable. That
// is precisely the class of silent failure this project keeps paying for.
// ---------------------------------------------------------------------------

const GENRES_TABLE = "tblfhYXhxMkCTfuRT";
const LIBRARY_TABLE = "tblRy8Qg0Vl9JXgAw";
const EXAMPLES_TABLE = "tblnGOKRIkYKU7khh";

/** Airtable field name ← domain key, per table. Mirrors hov.airtable_field. */
const GENRE_AT: Record<string, string> = {
  tone: "Tone", format: "Format", research: "Research",
  researchBrief: "Research Brief", factSheetFraming: "Fact Sheet Framing",
  invention: "Invention", structure: "Structure", voice: "Voice", wpm: "WPM",
  hookRule: "Hook Rule", visual: "Visual", montageIntensity: "Montage Intensity",
  active: "Active",
};
const LIBRARY_AT: Record<string, string> = {
  title: "Title", sourceUrl: "Source URL", category: "Category", tone: "Tone",
  styleCard: "Style Card", pacingWpm: "Pacing WPM", hookWpm: "Hook WPM",
  durationSeconds: "Duration Seconds", active: "Active", notes: "Notes",
};
const EXAMPLE_AT: Record<string, string> = {
  name: "Nume Exemplu", content: "Conținut Script", style: "Stil",
  tags: "Tag-uri Script", usageUrl: "Link Utilizare Exemplu",
  notes: "Observații Script",
};

const asNum = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? "") !== "" ? n : null;
};
const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const asArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Translate a domain patch into Airtable's field names. */
function toAirtablePatch(map: Record<string, string>, patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const name = map[k];
    if (!name) throw new Error(`no Airtable field mapped for "${k}"`);
    out[name] = v;
  }
  return out;
}

export async function getGenreProfiles(): Promise<GenreProfile[]> {
  if (USE_PG) return pgBackend.getGenreProfiles();
  if (!isConfigured) return [];
  const recs = await airtableList(GENRES_TABLE, "pageSize=100");
  return recs
    .map((r) => ({
      id: r.id,
      tone: String(r.fields["Tone"] ?? ""),
      format: asStr(r.fields["Format"]),
      research: r.fields["Research"] === true,
      researchBrief: asStr(r.fields["Research Brief"]),
      factSheetFraming: asStr(r.fields["Fact Sheet Framing"]),
      invention: asStr(r.fields["Invention"]),
      structure: asStr(r.fields["Structure"]),
      voice: asStr(r.fields["Voice"]),
      wpm: asNum(r.fields["WPM"]),
      hookRule: asStr(r.fields["Hook Rule"]),
      visual: asStr(r.fields["Visual"]),
      montageIntensity: asNum(r.fields["Montage Intensity"]) ?? 1,
      active: r.fields["Active"] === true,
    }))
    .sort((a, b) => a.tone.toLowerCase().localeCompare(b.tone.toLowerCase()));
}

export async function saveGenreProfile(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (USE_PG) return pgBackend.saveGenreProfile(id, patch);
  await airtablePatch(GENRES_TABLE, id, toAirtablePatch(GENRE_AT, patch));
}

export async function createGenreProfile(tone: string): Promise<string> {
  if (USE_PG) return pgBackend.createGenreProfile(tone);
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${GENRES_TABLE}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { Tone: tone, Active: false }, typecast: true }),
  });
  if (!res.ok) throw new Error(`Airtable create genre: HTTP ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

export async function getLibraryScripts(): Promise<LibraryScript[]> {
  if (USE_PG) return pgBackend.getLibraryScripts();
  if (!isConfigured) return [];
  const recs = await airtableList(LIBRARY_TABLE, "pageSize=100");
  return recs
    .map((r) => ({
      id: r.id,
      title: String(r.fields["Title"] ?? ""),
      sourceUrl: asStr(r.fields["Source URL"]),
      category: asStr(r.fields["Category"]),
      tone: asStr(r.fields["Tone"]),
      styleCard: asStr(r.fields["Style Card"]),
      pacingWpm: asNum(r.fields["Pacing WPM"]),
      hookWpm: asNum(r.fields["Hook WPM"]),
      durationSeconds: asNum(r.fields["Duration Seconds"]),
      active: r.fields["Active"] === true,
      notes: asStr(r.fields["Notes"]),
      transcriptChars: String(r.fields["Raw Transcript"] ?? "").length,
    }))
    .sort((a, b) =>
      a.active === b.active
        ? a.title.toLowerCase().localeCompare(b.title.toLowerCase())
        : a.active
          ? -1
          : 1,
    );
}

export async function saveLibraryScript(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (USE_PG) return pgBackend.saveLibraryScript(id, patch);
  await airtablePatch(LIBRARY_TABLE, id, toAirtablePatch(LIBRARY_AT, patch));
}

export async function getScriptExamples(): Promise<ScriptExample[]> {
  if (USE_PG) return pgBackend.getScriptExamples();
  if (!isConfigured) return [];
  const recs = await airtableList(EXAMPLES_TABLE, "pageSize=100");
  return recs
    .map((r) => ({
      id: r.id,
      name: String(r.fields["Nume Exemplu"] ?? ""),
      content: asStr(r.fields["Conținut Script"]),
      style: asArr(r.fields["Stil"]),
      tags: asArr(r.fields["Tag-uri Script"]),
      usageUrl: asStr(r.fields["Link Utilizare Exemplu"]),
      notes: asStr(r.fields["Observații Script"]),
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export async function saveScriptExample(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (USE_PG) return pgBackend.saveScriptExample(id, patch);
  await airtablePatch(EXAMPLES_TABLE, id, toAirtablePatch(EXAMPLE_AT, patch));
}
