/**
 * Airtable → Postgres import.
 *
 * Runs on the box, in a throwaway container that can see both the postgres
 * service and the media volume:
 *
 *   docker run --rm --network n8n_n8n_net \
 *     -v /opt/n8n/media:/media -v /opt/n8n/import:/app -w /app \
 *     --env-file /opt/n8n/import/import.env \
 *     node:20-alpine sh -c 'npm i --no-save --silent pg && node import-from-airtable.mjs'
 *
 * Idempotent: every row is an upsert keyed on the Airtable record id, and a
 * scene's attachments are replaced wholesale. Re-run it as many times as you
 * like — the last run before the cutover is the one that counts.
 *
 * Pass --dry-run to read Airtable and report what WOULD be written, touching
 * neither the database nor the disk.
 *
 * ---------------------------------------------------------------------------
 * The one thing that makes this urgent rather than routine:
 *
 * Airtable attachment URLs EXPIRE. What comes back is a signed
 * v5.airtableusercontent.com link with a few hours of life in it; Airtable
 * keeps the bytes and mints a fresh URL each time you read the record. So the
 * download has to happen in the same pass as the read — collecting every URL
 * first and fetching them afterwards is how you end up with a few hundred
 * dead links and no way to tell which. Hence downloadAttachments() being
 * called inside the per-record loop and not after it.
 * ---------------------------------------------------------------------------
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import pg from "pg";

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID || "applPyJjvNzyxJkbv";
const MEDIA_ROOT = process.env.MEDIA_ROOT || "/media";
const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes("--dry-run");

if (!AIRTABLE_KEY) fail("AIRTABLE_API_KEY is not set");
if (!DATABASE_URL && !DRY_RUN) fail("DATABASE_URL is not set");

const TABLES = {
  projects: "tbl0zT7ilefOqE3xk",
  scripts: "tblUueZa5ADA3A2rA",
  chapters: "tbldVEFHiCyDVdQf9",
  scenes: "tblkNIyOUeLnKqako",
  scriptExamples: "tblnGOKRIkYKU7khh",
  scriptLibrary: "tblRy8Qg0Vl9JXgAw",
  genreProfiles: "tblfhYXhxMkCTfuRT",
  evidence: "tblU26cUiQQV2eNdg",
};

const stats = {
  read: {}, written: {}, files: 0, bytes: 0, skipped: [], repaired: [],
};

// ---------------------------------------------------------------------------
// Airtable
// ---------------------------------------------------------------------------

/** Airtable allows 5 requests/second per base. Stay under it. */
let lastCall = 0;
async function throttle() {
  const wait = 220 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function listAll(tableId) {
  const out = [];
  let offset;
  do {
    await throttle();
    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    });
    if (!res.ok) throw new Error(`Airtable ${tableId}: HTTP ${res.status} ${await res.text()}`);
    const data = await res.json();
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

// ---------------------------------------------------------------------------
// Field coercion
//
// Airtable is loose where the schema is strict, so every value passes through
// one of these. The important ones are num() and the *_at handling: Airtable
// holds zeros that the CHECK constraints now refuse, and those zeros are not
// data — they are the fifteen-nodes-mapping-an-empty-numeric-field bug fossilised
// into the records. Importing them verbatim would fail the load; importing them
// as zero would carry the bug across. They become NULL, and each one is counted
// and reported so the damage is visible instead of laundered.
// ---------------------------------------------------------------------------

const str = (v) => (v === undefined || v === null || v === "" ? null : String(v));
const bool = (v) => v === true;

/** Select fields arrive as {id,name,color}; multi-selects as arrays of those. */
const sel = (v) => (v && typeof v === "object" && !Array.isArray(v) ? str(v.name) : str(v));
const multi = (v) =>
  Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? x.name : String(x))).filter(Boolean) : [];

/**
 * A number, with zero treated as damage only where it actually is.
 *
 * The zeroing bug is specific: `Ordine Scenă`, `Durată Scenă (secunde)` and
 * `Lenght` were written as literal 0 by nodes that mapped them empty, and a
 * scene with no order silently falls out of the batch. Chapters are different
 * — scripting numbers the HOOK chapter **0** — and an earlier version of this
 * helper applied the same guard everywhere, nulling 47 hook markers and
 * reporting them as repairs. Pass `zeroOk` where zero is a value.
 */
function num(v, label, recId, zeroOk = false) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (zeroOk ? n < 0 : n <= 0) {
    stats.repaired.push(`${label} was ${n} on ${recId} → NULL`);
    return null;
  }
  return n;
}

function json(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v)) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * First id out of a linked-record field.
 *
 * Airtable returns these two different ways depending on the endpoint: bare
 * id strings, or {id, name} objects. Both appear in this base.
 */
const link = (v) => {
  if (!Array.isArray(v) || !v.length) return null;
  const first = v[0];
  return typeof first === "object" && first !== null ? str(first.id) : str(first);
};

/** The project of a chapter's first scene — the fallback for legacy chapters. */
function firstSceneProject(sceneLinks, sceneProject) {
  if (!Array.isArray(sceneLinks)) return null;
  for (const s of sceneLinks) {
    const id = typeof s === "object" && s !== null ? s.id : s;
    const pid = sceneProject.get(String(id));
    if (pid) return pid;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Attachments — the part Airtable was doing for free
// ---------------------------------------------------------------------------

const ATTACHMENT_FIELDS = [
  ["Imagine Scenă", "image", true],       // one per scene (unique index)
  ["Video Scenă", "video", true],         // one per scene
  ["Versiuni Imagine", "image_version", false], // many: saved drafts
];

/**
 * Downloads one attachment into the media tree and returns its row.
 *
 * The path is content-addressed: the same bytes always land at the same path,
 * so a re-run overwrites nothing and Caddy's immutable cache header stays
 * honest. Extension comes from the filename, falling back to the MIME type —
 * Remotion and the browser both care.
 */
async function downloadAttachment(sceneId, field, att) {
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
  const ext =
    (att.filename && att.filename.includes(".") ? att.filename.split(".").pop() : null) ||
    (att.type ? att.type.split("/").pop().replace("jpeg", "jpg") : null) ||
    "bin";
  const path = `${sceneId}/${field}/${hash}.${ext}`;
  const abs = join(MEDIA_ROOT, path);

  if (!DRY_RUN) {
    // Same bytes already on disk: skip the write, keep the row.
    let exists = false;
    try {
      const s = await stat(abs);
      exists = s.size === buf.length;
    } catch {}
    if (!exists) {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
    }
  }

  stats.files++;
  stats.bytes += buf.length;

  return {
    scene_id: sceneId,
    field,
    path,
    filename: str(att.filename),
    content_type: str(att.type),
    size_bytes: buf.length,
    width: att.width ?? null,
    height: att.height ?? null,
    source_url: str(att.url),
  };
}

/** Every attachment on one scene record, downloaded now while the URLs live. */
async function downloadAttachments(rec) {
  const rows = [];
  for (const [fieldName, kind, singleOnly] of ATTACHMENT_FIELDS) {
    const list = rec.fields[fieldName];
    if (!Array.isArray(list) || !list.length) continue;
    for (const att of singleOnly ? list.slice(0, 1) : list) {
      try {
        rows.push(await downloadAttachment(rec.id, kind, att));
      } catch (e) {
        // A dead link is a fact worth surfacing, not a reason to abort the
        // whole import — the row still imports, minus that file.
        stats.skipped.push(`${rec.id} ${kind} "${att.filename}": ${e.message}`);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

function upsertSql(table, cols) {
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
  return `insert into hov.${table} (${cols.join(", ")}) values (${params})
          on conflict (id) do update set ${updates}`;
}

async function upsert(client, table, rows) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const sql = upsertSql(table, cols);
  let n = 0;
  for (const row of rows) {
    await client.query(sql, cols.map((c) => row[c]));
    n++;
  }
  stats.written[table] = (stats.written[table] ?? 0) + n;
  return n;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(DRY_RUN ? "DRY RUN — nothing will be written\n" : "Importing Airtable → Postgres\n");

  const client = DRY_RUN ? null : new pg.Client({ connectionString: DATABASE_URL });
  if (client) await client.connect();
  if (client) await client.query("begin");

  try {
    // --- projects ---------------------------------------------------------
    const projects = await listAll(TABLES.projects);
    stats.read.projects = projects.length;
    const projectRows = projects.map((r) => ({
      id: r.id,
      name: str(r.fields["Nume Proiect"]) ?? "Untitled project",
      tone: str(r.fields["Tonalitate"]),
      aspect: sel(r.fields["Format"]) === "9:16" ? "9:16" : "16:9",
      no_captions: bool(r.fields["Fără Subtitrări"]),
      pace: str(r.fields["Pace"]),
      length_seconds: num(r.fields["Lenght"], "project.length_seconds", r.id),
      status: sel(r.fields["Status General"]) ?? "Planificat",
      final_video_url: str(r.fields["Link Video Final"]),
      estimated_finish: str(r.fields["Data Finalizare Estimată"]),
      editing_options: JSON.stringify(json(r.fields["Editing Options"], {})),
      tags: multi(r.fields["Tag-uri Proiect"]),
      language: str(r.fields["Language"]) ?? "",
      style: str(r.fields["Style"]),
      story_bible: str(r.fields["Story Bible"]),
      scene_note: str(r.fields["Scene"]),
      full_narrator_script: str(r.fields["Full Narrator Script"]),
      edited_narrator_script: str(r.fields["Edited Narrator Script"]),
      script_chapters: JSON.stringify(json(r.fields["Script Chapters JSON"], null)),
      script_status: bool(r.fields["Script Status"]),
      voice_id: str(r.fields["Voice ID"]) ?? "",
      research_thin: bool(r.fields["Research Thin"]),
      created_at: r.createdTime,
    }));
    if (client) await upsert(client, "project", projectRows);
    const knownProjects = new Set(projectRows.map((p) => p.id));
    log(`projects        ${projects.length}`);

    // --- scenes: fetched now, written later --------------------------------
    //
    // The read happens here, before chapters, because a chapter's project has
    // to be recoverable from its scenes (see below). The download loop still
    // runs immediately after — signed attachment URLs only survive the few
    // API calls it takes to read the chapters in between.
    const scenes = await listAll(TABLES.scenes);
    stats.read.scenes = scenes.length;

    /** scene id → its project, straight off the scene's Project_ID text. */
    const sceneProject = new Map();
    for (const r of scenes) sceneProject.set(r.id, str(r.fields["Project_ID"]));

    // --- chapters ---------------------------------------------------------
    const chapters = await listAll(TABLES.chapters);
    stats.read.chapters = chapters.length;
    const chapterRows = chapters
      .map((r) => ({
        id: r.id,
        // Only chapters written by the current pipeline carry the "Proiect"
        // link; the ones from May and June predate it and have the field
        // empty. They are not orphans though — their scenes still name the
        // project — so fall back through "Scene 2" rather than dropping a
        // third of the table on the floor.
        project_id: link(r.fields["Proiect"]) ?? firstSceneProject(r.fields["Scene 2"], sceneProject),
        title: str(r.fields["Titlu Capitol"]),
        main_ideas: str(r.fields["Idei Principale"]),
        chapter_script: str(r.fields["Script Capitol"]),
        ordinal: num(r.fields["Ordine"], "chapter.ordinal", r.id, true),
        approval_status: sel(r.fields["Status Aprobare Capitol"]),
        notes: str(r.fields["Observații Capitol"]),
        owner: str(r.fields["Responsabil Capitol"]),
        duration_minutes: num(r.fields["Durată Capitol (minute)"], "chapter.duration_minutes", r.id, true),
        scene_note: str(r.fields["Scene"]),
        created_at: r.createdTime,
      }))
      .filter((c) => {
        // A chapter whose project was deleted in Airtable has nothing to hang
        // off. The FK would reject it; drop it loudly instead.
        if (c.project_id && knownProjects.has(c.project_id)) return true;
        stats.skipped.push(`chapter ${c.id}: project ${c.project_id ?? "(none)"} not found`);
        return false;
      });
    if (client) await upsert(client, "chapter", chapterRows);
    const knownChapters = new Set(chapterRows.map((c) => c.id));
    log(`chapters        ${chapters.length}`);

    // --- scenes (+ their attachments, downloaded inline) -------------------
    // Scenes whose "Ordine Scenă" was zeroed have no order left to import,
    // and scene_order is NOT NULL CHECK > 0. The site already had to cope with
    // exactly this (`Number(...) || index + 1` in getScenes), so mirror it:
    // fall back to the scene's position among its project's records, ordered
    // by creation. Same number the producer is looking at today.
    const byProject = new Map();
    for (const r of scenes) {
      const pid = str(r.fields["Project_ID"]);
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid).push(r);
    }
    for (const list of byProject.values()) {
      list.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
    }
    const fallbackOrder = new Map();
    for (const list of byProject.values()) {
      list.forEach((r, i) => fallbackOrder.set(r.id, i + 1));
    }

    let sceneRows = [];
    let attachmentRows = [];
    let done = 0;
    for (const r of scenes) {
      const pid = str(r.fields["Project_ID"]);
      if (!pid || !knownProjects.has(pid)) {
        stats.skipped.push(`scene ${r.id}: project ${pid ?? "(none)"} not found`);
        continue;
      }
      const chapterId = link(r.fields["Capitol"]);
      const order = num(r.fields["Ordine Scenă"], "scene.scene_order", r.id);

      sceneRows.push({
        id: r.id,
        project_id: pid,
        chapter_id: chapterId && knownChapters.has(chapterId) ? chapterId : null,
        narration: str(r.fields["Script Scenă"]),
        image_prompt: str(r.fields["Imagine First Frame"]),
        motion_prompt: str(r.fields["Video Scenă URL"]),
        visual_prompt: str(r.fields["Prompt Vizual"]),
        last_frame_url: str(r.fields["Imagine Last Frame"]),
        voiceover_url: str(r.fields["Voiceover URL"]),
        scene_final_url: str(r.fields["Scene Final URL"]),
        image_media_id: str(r.fields["Image Media ID"]),
        scene_order: order ?? fallbackOrder.get(r.id) ?? 1,
        duration_seconds: num(r.fields["Durată Scenă (secunde)"], "scene.duration_seconds", r.id),
        production_status: sel(r.fields["Status Producție Scenă"]) ?? "Generare Script",
        scene_approved: bool(r.fields["Aprobare Scenă"]),
        image_approved: bool(r.fields["Aprobare Imagine"]),
        voice_approved: bool(r.fields["Aprobare Voce"]),
        video_approved: bool(r.fields["Aprobare Video"]),
        regen_image: bool(r.fields["Regenerează Imagine"]),
        // A flag that is already set on import is by definition one nobody is
        // clearing — the execution that owned it is long gone. Stamping it
        // with the record's own creation time makes the staleness sweep see it
        // as stale immediately, which is the truth, and surfaces the escape
        // hatch instead of a permanent "Regenerating…".
        regen_image_at: bool(r.fields["Regenerează Imagine"]) ? r.createdTime : null,
        regen_video: bool(r.fields["Regenerează Video"]),
        regen_video_at: bool(r.fields["Regenerează Video"]) ? r.createdTime : null,
        regen_voice: bool(r.fields["Regenerează Voce"]),
        regen_voice_at: bool(r.fields["Regenerează Voce"]) ? r.createdTime : null,
        note: str(r.fields["Observații Scenă"]),
        tags: multi(r.fields["Tag-uri Scenă"]),
        evidence_ref: str(r.fields["Evidence Ref"]),
        needs_fact_check: bool(r.fields["Needs Fact Check"]),
        media_versions: JSON.stringify(json(r.fields["Versiuni Media"], [])),
        created_at: r.createdTime,
      });

      // Inline, while the signed URLs are still alive. See the header note.
      attachmentRows.push(...(await downloadAttachments(r)));

      if (++done % 50 === 0) log(`  …${done}/${scenes.length} scenes, ${stats.files} files`);
    }
    if (client) {
      await upsert(client, "scene", sceneRows);
      // Replace each scene's attachments wholesale so a re-run cannot trip the
      // one-image-one-video unique index with a stale row.
      const touched = [...new Set(attachmentRows.map((a) => a.scene_id))];
      if (touched.length) {
        await client.query(`delete from hov.attachment where scene_id = any($1)`, [touched]);
      }
      await upsert2(client, "attachment", attachmentRows);
    }
    log(`scenes          ${scenes.length}  (${stats.files} files, ${mb(stats.bytes)})`);

    // --- scripts ----------------------------------------------------------
    const scripts = await listAll(TABLES.scripts);
    stats.read.scripts = scripts.length;
    const scriptRows = scripts.map((r) => {
      const pid = link(r.fields["Associated Project"]);
      return {
        id: r.id,
        project_id: pid && knownProjects.has(pid) ? pid : null,
        title: str(r.fields["Script Title"]),
        content: str(r.fields["Script Content"]),
        chapters: str(r.fields["script chapters"]),
        status: sel(r.fields["Status"]),
        language: str(r.fields["Language"]),
        notes: str(r.fields["Observații Script"]),
        summary: str(r.fields["Summary (Observații Script)"]),
        headline: str(r.fields["Headline (Observații Script)"]),
        regenerate: bool(r.fields["Regenerează Video"]),
        created_at: r.createdTime,
      };
    });
    if (client) await upsert(client, "script", scriptRows);
    log(`scripts         ${scripts.length}`);

    // --- evidence ---------------------------------------------------------
    const evidence = await listAll(TABLES.evidence);
    stats.read.evidence = evidence.length;
    const seenRef = new Set();
    const evidenceRows = [];
    for (const r of evidence) {
      const pid = link(r.fields["Proiect"]) ?? str(r.fields["Project_ID"]);
      const ref = str(r.fields["Ref"]);
      if (!pid || !knownProjects.has(pid) || !ref) {
        stats.skipped.push(`evidence ${r.id}: project ${pid ?? "(none)"} / ref ${ref ?? "(none)"}`);
        continue;
      }
      // (project, ref) is unique now — a scene citing E3 has to get one claim,
      // not a coin flip. Airtable could not say that, so duplicates may exist;
      // first one wins and the rest are reported.
      const key = `${pid}|${ref}`;
      if (seenRef.has(key)) {
        stats.skipped.push(`evidence ${r.id}: duplicate ref ${ref} in project ${pid}`);
        continue;
      }
      seenRef.add(key);
      evidenceRows.push({
        id: r.id,
        project_id: pid,
        ref,
        claim: str(r.fields["Claim"]),
        source_name: str(r.fields["Source Name"]),
        source_url: str(r.fields["Source URL"]),
        source_date: str(r.fields["Source Date"]),
        created_at: r.createdTime,
      });
    }
    if (client) await upsert(client, "evidence", evidenceRows);
    log(`evidence        ${evidence.length}`);

    // --- genre profiles ---------------------------------------------------
    const genres = await listAll(TABLES.genreProfiles);
    stats.read.genreProfiles = genres.length;
    const seenTone = new Set();
    const genreRows = [];
    for (const r of genres) {
      const tone = str(r.fields["Tone"]);
      if (!tone) {
        stats.skipped.push(`genre_profile ${r.id}: no tone`);
        continue;
      }
      if (seenTone.has(tone.toLowerCase())) {
        stats.skipped.push(`genre_profile ${r.id}: duplicate tone "${tone}"`);
        continue;
      }
      seenTone.add(tone.toLowerCase());
      genreRows.push({
        id: r.id,
        tone,
        format: str(r.fields["Format"]),
        research: bool(r.fields["Research"]),
        research_brief: str(r.fields["Research Brief"]),
        fact_sheet_framing: str(r.fields["Fact Sheet Framing"]),
        invention: str(r.fields["Invention"]),
        structure: str(r.fields["Structure"]),
        voice: str(r.fields["Voice"]),
        wpm: num(r.fields["WPM"], "genre_profile.wpm", r.id),
        hook_rule: str(r.fields["Hook Rule"]),
        visual: str(r.fields["Visual"]),
        montage_intensity: clamp(r.fields["Montage Intensity"], 0, 2, 1),
        active: bool(r.fields["Active"]),
        created_at: r.createdTime,
      });
    }
    if (client) await upsert(client, "genre_profile", genreRows);
    log(`genre profiles  ${genres.length}`);

    // --- script library ---------------------------------------------------
    const lib = await listAll(TABLES.scriptLibrary);
    stats.read.scriptLibrary = lib.length;
    const libRows = lib.map((r) => ({
      id: r.id,
      title: str(r.fields["Title"]) ?? "Untitled",
      source_url: str(r.fields["Source URL"]),
      category: sel(r.fields["Category"]),
      tone: sel(r.fields["Tone"]),
      raw_transcript: str(r.fields["Raw Transcript"]),
      style_card: str(r.fields["Style Card"]),
      pacing_wpm: num(r.fields["Pacing WPM"], "script_library.pacing_wpm", r.id),
      hook_wpm: num(r.fields["Hook WPM"], "script_library.hook_wpm", r.id),
      duration_seconds: num(r.fields["Duration Seconds"], "script_library.duration_seconds", r.id),
      transcript_source: str(r.fields["Transcript Source"]),
      active: bool(r.fields["Active"]),
      notes: str(r.fields["Notes"]),
      created_at: r.createdTime,
    }));
    if (client) await upsert(client, "script_library", libRows);
    log(`script library  ${lib.length}`);

    // --- script examples --------------------------------------------------
    const examples = await listAll(TABLES.scriptExamples);
    stats.read.scriptExamples = examples.length;
    const exampleRows = examples.map((r) => ({
      id: r.id,
      name: str(r.fields["Nume Exemplu"]) ?? "Untitled",
      content: str(r.fields["Conținut Script"]),
      style: multi(r.fields["Stil"]),
      tags: multi(r.fields["Tag-uri Script"]),
      usage_url: str(r.fields["Link Utilizare Exemplu"]),
      notes: str(r.fields["Observații Script"]),
      created_at: r.createdTime,
    }));
    if (client) await upsert(client, "script_example", exampleRows);
    log(`script examples ${examples.length}`);

    if (client) await client.query(DRY_RUN ? "rollback" : "commit");
  } catch (e) {
    if (client) await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    if (client) await client.end();
  }

  report();
}

/** attachment has no id conflict target worth updating — path is the key. */
async function upsert2(client, table, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  // (scene_id, field, path), not (path): a file may be both a scene's live
  // asset and a saved draft of it, so path alone stopped being unique when
  // drafts landed (db/003). The global unique this used to target is gone.
  const sql = `insert into hov.${table} (${cols.join(", ")}) values (${params})
               on conflict (scene_id, field, path) do nothing`;
  for (const row of rows) await client.query(sql, cols.map((c) => row[c]));
  stats.written[table] = (stats.written[table] ?? 0) + rows.length;
}

function clamp(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const log = (m) => console.log(m);
function fail(m) {
  console.error(`ERROR: ${m}`);
  process.exit(1);
}

function report() {
  log("\n" + "─".repeat(60));
  log(DRY_RUN ? "DRY RUN COMPLETE — nothing written" : "IMPORT COMPLETE");
  log("─".repeat(60));
  log(`files downloaded  ${stats.files} (${mb(stats.bytes)})`);

  if (stats.repaired.length) {
    log(`\nzeros repaired to NULL: ${stats.repaired.length}`);
    log("  (the mapped-empty-numeric-field bug, fossilised in the data)");
    const byCol = new Map();
    for (const r of stats.repaired) {
      const col = r.split(" was ")[0];
      byCol.set(col, (byCol.get(col) ?? 0) + 1);
    }
    for (const [col, n] of [...byCol].sort((a, b) => b[1] - a[1])) {
      log(`  ${String(n).padStart(4)} × ${col}`);
    }
  }
  if (stats.skipped.length) {
    // Grouped, not truncated. A bare "…and 279 more" reads as a long tail of
    // the same harmless thing, and that is exactly the assumption that hides
    // a real one. Every reason gets a line and a count.
    const groups = new Map();
    for (const s of stats.skipped) {
      const key = s.replace(/rec[0-9A-Za-z]{14}/g, "…").replace(/"[^"]*"/g, '"…"');
      if (!groups.has(key)) groups.set(key, { n: 0, sample: s });
      groups.get(key).n++;
    }
    log(`\nskipped: ${stats.skipped.length}, by reason:`);
    for (const [key, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
      log(`  ${String(g.n).padStart(4)} × ${key}`);
      if (g.n > 1) log(`         e.g. ${g.sample}`);
    }
  }
  if (!stats.repaired.length && !stats.skipped.length) log("\nnothing skipped, nothing repaired — clean import");
  log("");
}

main().catch((e) => {
  console.error("\nIMPORT FAILED:", e.message);
  console.error(e.stack);
  process.exit(1);
});
