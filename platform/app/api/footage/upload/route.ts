/**
 * Manual upload.
 *
 *   POST /api/footage/upload   multipart/form-data
 *        file (video/mp4|webm|quicktime, image/jpeg|png|webp; ≤ 800 MB)
 *        title, description?, filmingDate?, location?, country?, eventName?,
 *        owner?, rights (cleared|attribution_required|manual_review|restricted),
 *        attribution?, notes?
 *
 * The bytes land in the media store under `library/<kind>/<sha>.<ext>` —
 * the same content-addressed layout every scene asset uses — and the row is
 * filed with EXACTLY what the person declared. Nothing about an upload is
 * assumed: rights are their statement (and "I don't know" is manual review),
 * provenance is `unknown` until a person says what the material shows, and
 * the file's hash is its identity so the same clip twice is one row.
 *
 * A poster and the dimensions/duration come from the ffmpeg in the site's
 * own image (the one the narration bundle and the archive attach already
 * use). A probe that fails costs those numbers, never the upload.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { footageAuthorized, footageUsable } from "@/lib/footage/auth";
import { mediaPublicUrl, storeMediaBytes } from "@/lib/media-store";
import { saveUploadedFootage } from "@/lib/data/stock";
import { validateRights } from "@/lib/footage/rights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
const MAX_BYTES = 800 * 1024 * 1024;
const VIDEO = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"]);
const IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);

const text = (v: FormDataEntryValue | null, cap = 400): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, cap) : null;
};

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd}: ${err.message}`));
      else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

/** Width, height and duration from ffprobe; null on any trouble. */
async function probe(file: string): Promise<{ width: number | null; height: number | null; duration: number | null }> {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
      30_000,
    );
    const j = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
    const s = j.streams?.[0];
    const d = Number(j.format?.duration);
    return { width: s?.width ?? null, height: s?.height ?? null, duration: Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : null };
  } catch {
    return { width: null, height: null, duration: null };
  }
}

export async function POST(req: NextRequest) {
  if (!footageAuthorized(req)) return bad(401, "unauthorized");
  if (!footageUsable()) return bad(503, "the footage library needs the Postgres backend");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad(400, "expected multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return bad(400, "file is required");
  if (file.size > MAX_BYTES) return bad(413, "the file is over 800 MB");
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  const mediaType = VIDEO.has(mime) ? "video" : IMAGE.has(mime) ? "image" : null;
  if (!mediaType) return bad(415, `unsupported type ${mime || "(none)"} — mp4, webm, mov, jpg, png or webp`);
  const title = text(form.get("title"), 200) ?? file.name.replace(/\.[a-z0-9]+$/i, "");
  const rightsRaw = String(form.get("rights") ?? "manual_review");
  const rights = (["cleared", "attribution_required", "manual_review", "restricted"] as const).includes(rightsRaw as never)
    ? (rightsRaw as "cleared" | "attribution_required" | "manual_review" | "restricted")
    : "manual_review";

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() ?? (mediaType === "video" ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  // `library` in the scene slot: the store's path convention is
  // <owner>/<field>/<hash>.<ext>, and an upload belongs to the library, not
  // to any one scene. It is copied into a scene's own folder when used.
  const stored = await storeMediaBytes("library", mediaType, buf, { contentType: mime, ext, filename: file.name });
  const mediaUrl = mediaPublicUrl(stored.path);
  if (!mediaUrl) return bad(500, "MEDIA_BASE_URL is not set — the upload has nowhere public to live");

  // Poster + numbers. Best-effort.
  let thumbnailUrl: string | null = mediaType === "image" ? mediaUrl : null;
  let dims: { width: number | null; height: number | null; duration: number | null } = { width: null, height: null, duration: null };
  const work = await mkdtemp(path.join(os.tmpdir(), "upload-"));
  try {
    dims = await probe(stored.abs);
    if (mediaType === "video") {
      const poster = path.join(work, "poster.jpg");
      try {
        await run("ffmpeg", ["-y", "-ss", "1", "-i", stored.abs, "-frames:v", "1", "-q:v", "3", poster], 60_000);
        const p = await storeMediaBytes("library", "image", await readFile(poster), { contentType: "image/jpeg", ext: "jpg", filename: `${stored.hash}-poster.jpg` });
        thumbnailUrl = mediaPublicUrl(p.path) || null;
      } catch {
        thumbnailUrl = null;
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    void writeFile;
  }

  const row = await saveUploadedFootage({
    mediaType,
    title,
    description: text(form.get("description"), 2000),
    sourceUrl: mediaUrl,
    mediaUrl,
    mediaPath: stored.path,
    thumbnailUrl,
    contentHash: stored.hash,
    mimeType: mime,
    sizeBytes: stored.bytes,
    width: dims.width,
    height: dims.height,
    durationSeconds: dims.duration,
    filmingDate: text(form.get("filmingDate"), 40),
    location: text(form.get("location"), 200),
    country: text(form.get("country"), 80),
    eventName: text(form.get("eventName"), 200),
    owner: text(form.get("owner"), 200),
    rightsStatus: rights,
    attribution: text(form.get("attribution"), 300),
    notes: text(form.get("notes"), 1000),
  });
  return NextResponse.json({ ok: true, asset: row, rights: validateRights(row) });
}
