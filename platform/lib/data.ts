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
}

export interface Scene {
  id: string;
  order: number;
  label: string;
  narration: string | null;
  imagePrompt: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  sceneApproved: boolean;
  imageApproved: boolean;
  videoApproved: boolean;
  status: string;
  statusKind: StatusKind;
}

// Airtable status text → semantic kind + rough pipeline progress.
// Keys are lowercased and diacritics-stripped before lookup, so both
// "Așteaptă Aprobare Imagine" and "Asteapta Aprobare Imagine" match.
const STATUS_MAP: Array<{ match: RegExp; kind: StatusKind; progress: number }> = [
  { match: /finalizat|finished|done/, kind: "done", progress: 1 },
  { match: /eroare|failed|error/, kind: "err", progress: 0.3 },
  { match: /aprobare video/, kind: "wait", progress: 0.85 },
  { match: /generare video/, kind: "run", progress: 0.7 },
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
  { match: /asteapta aprobare video/, label: "Awaiting Video Approval" },
  { match: /asteapta aprobare imagine/, label: "Awaiting Image Approval" },
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
  sceneOrder: ["Ordine Scenă", "Ordine Scena"],
  sceneNarration: ["Script Scenă", "Narration", "Narațiune"],
  sceneImage: ["Imagine Scenă", "Imagine Scena"],
  // "Video Scenă URL" holds the motion PROMPT (legacy reuse) — never read
  // it as a link. The muxed clip lives in Scene Final URL + the "Video
  // Scenă" attachment.
  sceneVideo: ["Scene Final URL"],
  sceneVideoAttachment: ["Video Scenă"],
  sceneImagePrompt: ["Imagine First Frame"],
  sceneApproved: ["Aprobare Scenă", "Aprobare Scena"],
  sceneImageApproved: ["Aprobare Imagine"],
  sceneVideoApproved: ["Aprobare Video"],
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
  };
}

function toScene(r: AirtableRecord, index: number): Scene {
  const status = String(pick(r.fields, F.sceneStatus) ?? "—");
  const { kind } = classifyStatus(status);
  const order = Number(pick(r.fields, F.sceneOrder)) || index + 1;
  const videoUrl =
    ((pick(r.fields, F.sceneVideo) as string) || null) ??
    firstAttachmentUrl(pick(r.fields, F.sceneVideoAttachment));
  return {
    id: r.id,
    order,
    label: `S${index + 1}`,
    narration: (pick(r.fields, F.sceneNarration) as string) ?? null,
    imagePrompt: (pick(r.fields, F.sceneImagePrompt) as string) ?? null,
    imageUrl: firstAttachmentUrl(pick(r.fields, F.sceneImage)),
    videoUrl,
    sceneApproved: Boolean(pick(r.fields, F.sceneApproved)),
    imageApproved: Boolean(pick(r.fields, F.sceneImageApproved)),
    videoApproved: Boolean(pick(r.fields, F.sceneVideoApproved)),
    status: displayStatus(status),
    statusKind: kind,
  };
}

export async function getProjects(): Promise<Project[]> {
  if (!isConfigured) return DEMO_PROJECTS;
  const records = await airtableList(PROJECTS_TABLE, "pageSize=100");
  return records
    .map(toProject)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
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
  const scenes = records.map(toScene);
  scenes.sort((a, b) => a.order - b.order);
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
    imageUrl: null,
    videoUrl: null,
    sceneApproved: true,
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
      body: JSON.stringify({ fields }),
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
        : { "Regenerează Video": true, "Aprobare Video": false };
  await airtablePatch(SCENES_TABLE, sceneId, fields);
}

export async function writeProjectFields(
  projectId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await airtablePatch(PROJECTS_TABLE, projectId, fields);
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
