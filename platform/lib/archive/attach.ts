/**
 * Turn an archive asset into a scene's picture AND its clip.
 *
 * This is the whole reason Documentary mode needs no change in n8n. The
 * batch's `Needs Image?` skips a scene that already holds an image and
 * `Needs Clip?` skips one that already holds a clip, so a scene that arrives
 * with both is simply never generated — the gates still ask for the same
 * approvals, Final Assembly still receives an ordinary mp4. What the site
 * has to do is produce both assets itself, here, with the ffmpeg that has
 * been in its own image since the narration bundle.
 *
 * Two kinds of asset, two recipes:
 *
 * - A STILL becomes an image (the still itself, full quality) and a clip: a
 *   Ken Burns move over it, `seconds` long at 24 fps. The zoom is a constant-
 *   velocity push, because that is what a rostrum camera does and easing it
 *   makes it visibly decelerate for no reason (same rule as `kenBurnsTransform`
 *   in the render). Direction alternates by scene order so two stills in a
 *   row do not breathe in unison.
 *
 * - A VIDEO becomes a clip — `seconds` from `offsetSeconds`, cut STRAIGHT
 *   FROM THE URL with `-ss` before `-i`, so a 46-minute, 553 MB NASA reel
 *   costs the bytes of its eight seconds and the index — and an image: the
 *   clip's own first frame, which is exactly what `Imagine Scenă` is for a
 *   Veo scene too (the start frame).
 *
 * Both land in the media store under the scene, content-addressed like every
 * other asset, and the scene row is updated in ONE transaction with the
 * attachment rows: a scene must never hold a new clip while still claiming
 * to await the old one, because the batch's gates read those very columns.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { attachStockToScene, getSceneForFootage, getStockMedia, setStockStatus, type StockMedia } from "@/lib/data/stock";
import { mediaPublicUrl, storeMediaBytes } from "@/lib/media-store";
import { classifyVisualOrigin } from "@/lib/provenance";
import { assessProvenance } from "@/lib/footage/provenance";
import { buildFootageRequest } from "@/lib/footage/request";
import { renderable, usableAutomatically, validateRights } from "@/lib/footage/rights";
import { providerById } from "@/lib/footage/registry";

/**
 * Where the bytes actually are, asked of the provider at use time. A NASA
 * search result holds only its preview, an Internet Archive item is a
 * directory of renditions, an Unsplash download has to be announced first —
 * so a provider with a resolver is the authority, and its failure is a
 * failure (falling back to the stored URL would attach a thumbnail as the
 * clip). A provider without one stored the file itself.
 */
async function resolveMediaUrl(stock: StockMedia): Promise<string> {
  const p = providerById(stock.provider);
  if (!p?.resolveDownload) return stock.downloadUrl;
  const r = await p.resolveDownload(stock);
  if (!r.url) throw new Error(`${p.displayName} resolved no download for ${stock.providerAssetId}`);
  return r.url;
}

const USER_AGENT = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const FPS = 24;
/** The clip length Veo makes, and what every downstream retime is tuned for. */
export const DEFAULT_SECONDS = 8;
export const MIN_SECONDS = 3;
export const MAX_SECONDS = 20;
/** How far a Ken Burns push travels — 12% is a move you feel, not one you see. */
const KEN_BURNS_ZOOM = 0.12;
const MAX_STILL_BYTES = 60 * 1024 * 1024;

export interface AttachInput {
  sceneId: string;
  stockId: string;
  portrait: boolean;
  /** Where in a stock VIDEO the segment starts. Ignored for stills. */
  offsetSeconds: number;
  seconds: number;
  /** Alternates the Ken Burns direction; pass the scene order. */
  sceneOrder: number;
  /** A person is choosing (the picker, the admin page). False for automatic placement, which may not pass a review class. */
  human?: boolean;
}

export interface AttachResult {
  mediaType: "video" | "image";
  imageUrl: string;
  videoUrl: string;
  seconds: number;
  title: string;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) {
        const tail = String(stderr ?? "").trim().split("\n").slice(-6).join("\n");
        reject(new Error(`${cmd} failed: ${err.message}${tail ? `\n${tail}` : ""}`));
      } else resolve({ stderr: String(stderr ?? "") });
    });
  });
}

export const clampSeconds = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(n * 10) / 10));
};

export const clampOffset = (v: unknown, duration: number | null): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Never start past the end; leave at least MIN_SECONDS of material.
  const max = duration && duration > MIN_SECONDS ? duration - MIN_SECONDS : n;
  return Math.min(n, max);
};

/** Cover-fit to the canvas, then pin fps and pixel format for the pipeline. */
const fit = (W: number, H: number) =>
  `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;

async function kenBurns(
  still: string,
  out: string,
  W: number,
  H: number,
  seconds: number,
  pullOut: boolean,
): Promise<void> {
  const frames = Math.round(seconds * FPS);
  // The image is pre-scaled to twice the canvas so zoompan samples a large
  // source and the move stays smooth; at 1x it visibly steps.
  const z = pullOut
    ? `max(${(1 + KEN_BURNS_ZOOM).toFixed(3)}-${KEN_BURNS_ZOOM}*on/${frames},1)`
    : `min(1+${KEN_BURNS_ZOOM}*on/${frames},${(1 + KEN_BURNS_ZOOM).toFixed(3)})`;
  const filter =
    `[0:v]${fit(W * 2, H * 2)},` +
    `zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},` +
    `format=yuv420p[v]`;
  await run(
    "ffmpeg",
    [
      "-y",
      "-i", still,
      // A silent track, so the clip has the same streams as a Veo clip and
      // the assemble concat never has to substitute one.
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-filter_complex", filter,
      "-map", "[v]", "-map", "1:a",
      "-frames:v", String(frames),
      "-shortest",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "64k",
      "-movflags", "+faststart",
      out,
    ],
    180_000,
  );
}

async function cutSegment(
  url: string,
  out: string,
  W: number,
  H: number,
  offset: number,
  seconds: number,
): Promise<void> {
  await run(
    "ffmpeg",
    [
      "-y",
      "-user_agent", USER_AGENT,
      "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
      // Input seeking: ffmpeg jumps through the container's index with range
      // requests instead of decoding from the start — the difference between
      // eight seconds of a reel and the whole reel.
      "-ss", offset.toFixed(3),
      "-i", url,
      "-t", seconds.toFixed(3),
      "-map", "0:v:0",
      // Optional: a silent reel still cuts; the assemble step substitutes
      // silence for a clip with no audio stream.
      "-map", "0:a:0?",
      "-vf", `${fit(W, H)},fps=${FPS},format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-ac", "1", "-b:a", "96k",
      "-movflags", "+faststart",
      out,
    ],
    300_000,
  );
}

async function download(url: string): Promise<{ buf: Buffer; contentType: string | null }> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`the archive answered HTTP ${res.status} for the file`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_STILL_BYTES) throw new Error(`the still is ${Math.round(len / 1e6)} MB — too large to use`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("the archive returned an empty file");
  if (buf.length > MAX_STILL_BYTES) throw new Error("the still is too large to use");
  return { buf, contentType: res.headers.get("content-type") };
}

/**
 * The rights gate, through the central validator. `restricted` never passes,
 * whoever is asking. `manual_review` and `editorial_only` pass only for a
 * HUMAN act — the producer's own "Use" in the picker or the admin page —
 * which the caller says with `human: true`; the automatic paths (a suggestion
 * run placing footage on its own) may not.
 */
function refuse(stock: StockMedia, human: boolean): string | null {
  if (stock.status === "rejected") return "This asset was rejected earlier.";
  const rights = validateRights(stock);
  if (rights.status === "restricted")
    return `Its licence forbids this use — ${rights.reason ?? stock.licenseOriginal ?? "restricted"}.`;
  if (!usableAutomatically(rights) && !human && !renderable(rights, stock.status)) {
    return `Its rights need a person's decision first (${rights.status.replace("_", " ")}${rights.reason ? ` — ${rights.reason}` : ""}).`;
  }
  return null;
}

export async function attachArchiveAsset(input: AttachInput): Promise<AttachResult> {
  const stock = await getStockMedia(input.stockId);
  if (!stock) throw new Error("That archive asset is not in the library any more.");
  const why = refuse(stock, input.human !== false);
  if (why) throw new Error(why);

  // What the picture will BE once this lands, decided here because the library
  // row is in hand and because the record of a scene's origin has to change in
  // the same breath as its media.
  //
  // Two answers are combined. The media-only classifier says what the asset
  // IS (archival footage, an archival photo) and can never say actual
  // footage. The provenance engine, given the scene's own request, says
  // whether the asset's metadata matches THIS event, place and date — and
  // may say actual footage past the threshold, or illustrative when the
  // scene named an event this asset is not proven to show. A library row a
  // person already classified (verified_at) keeps their word.
  const classified = classifyVisualOrigin({
    visualSource: stock.mediaType === "video" ? "stock_video" : "stock_image",
    stock: {
      provider: stock.provider,
      creator: stock.creator,
      credit: stock.credit,
      sourceUrl: stock.sourceUrl,
      rightsStatus: stock.rightsStatus,
      license: stock.licenseOriginal,
    },
  });
  let visualOrigin: string = classified.origin;
  let confidence = classified.confidence;
  if (stock.verifiedAt && stock.provenance && stock.provenance !== "unknown") {
    visualOrigin = stock.provenance;
    confidence = stock.provenanceConfidence ?? 100;
  } else {
    const scene = await getSceneForFootage(input.sceneId).catch(() => null);
    if (scene) {
      const request = buildFootageRequest({ id: scene.id, narration: scene.narration, visual: scene.visual });
      const assessed = assessProvenance(request, stock);
      if (assessed.provenance !== "unknown") {
        visualOrigin = assessed.provenance;
        confidence = assessed.confidence;
      }
    }
  }
  // A person's "Use" of a manual-review asset is the review (§18): the row
  // is marked approved so the next scene that wants it does not ask again.
  const rights = validateRights(stock);
  if (!usableAutomatically(rights) && stock.status === "candidate") {
    await setStockStatus(stock.id, "approved").catch(() => {});
  }

  const W = input.portrait ? 720 : 1280;
  const H = input.portrait ? 1280 : 720;
  const seconds = clampSeconds(input.seconds);
  const offset = stock.mediaType === "video" ? clampOffset(input.offsetSeconds, stock.durationSeconds) : 0;

  const work = await mkdtemp(path.join(os.tmpdir(), "archive-"));
  try {
    const clip = path.join(work, "clip.mp4");
    let image: { buf: Buffer; url: string; contentType: string | null; ext?: string };

    const src = await resolveMediaUrl(stock);
    if (stock.mediaType === "image") {
      const { buf, contentType } = await download(src);
      const stillExt = (src.split("?")[0].split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "jpg";
      const still = path.join(work, `still.${stillExt}`);
      await writeFile(still, buf);
      await kenBurns(still, clip, W, H, seconds, input.sceneOrder % 2 === 1);
      image = { buf, url: src, contentType };
    } else {
      await cutSegment(src, clip, W, H, offset, seconds);
      const poster = path.join(work, "poster.jpg");
      await run("ffmpeg", ["-y", "-i", clip, "-frames:v", "1", "-q:v", "3", poster], 60_000);
      image = { buf: await readFile(poster), url: stock.sourceUrl, contentType: "image/jpeg", ext: "jpg" };
    }

    const storedImage = await storeMediaBytes(input.sceneId, "image", image.buf, {
      url: image.url,
      contentType: image.contentType,
      ext: image.ext,
    });
    const storedClip = await storeMediaBytes(input.sceneId, "video", await readFile(clip), {
      url: stock.sourceUrl,
      contentType: "video/mp4",
      ext: "mp4",
    });
    const videoUrl = mediaPublicUrl(storedClip.path);
    if (!videoUrl) throw new Error("MEDIA_BASE_URL is not set — the clip has nowhere public to live");

    await attachStockToScene({
      sceneId: input.sceneId,
      stockId: stock.id,
      mediaType: stock.mediaType,
      offsetSeconds: stock.mediaType === "video" ? offset : null,
      image: {
        path: storedImage.path,
        filename: storedImage.filename,
        contentType: image.contentType,
        sizeBytes: storedImage.bytes,
        sourceUrl: image.url,
      },
      video: {
        path: storedClip.path,
        filename: storedClip.filename,
        contentType: "video/mp4",
        sizeBytes: storedClip.bytes,
        sourceUrl: stock.sourceUrl,
      },
      videoUrl,
      visualOrigin,
      provenanceConfidence: confidence,
      // What the asset states about itself, so the watermark's source line
      // can say where and when — only when the provider actually said.
      eventName: stock.eventName ?? null,
      location: stock.location ?? stock.country ?? null,
      filmingDate: stock.filmingDate ?? null,
    });

    return {
      mediaType: stock.mediaType,
      imageUrl: mediaPublicUrl(storedImage.path),
      videoUrl,
      seconds,
      title: stock.title,
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
