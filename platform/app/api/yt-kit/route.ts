// The YouTube description, assembled from what the pipeline already knows.
//
// GET /api/yt-kit?project=rec…  ->  { description, measured, chapters, sources }
//
// Nothing here is invented by a model. The hook paragraph is the film's own
// opening narration; the chapter list is the script's own [CHAPTER n: title]
// markers with timestamps summed from the real takes; the sources are the
// Evidence rows the script was written against — the one part of the research
// pack a viewer ever gets to see, and exactly what a documentary description
// is expected to carry.
//
// Timestamps are ≈ by construction. A scene's screen time is its take plus
// 0.35s, minus the breath trim the assembler cuts from the take's ends — we
// approximate that trim at 0.1s net (trim ~0.45s, add 0.35s) rather than
// re-running silencedetect over every take, and the whole timeline is divided
// by the film's playback speed. Off by a second or two over minutes, which is
// what YouTube chapters tolerate; the response says whether the takes were
// actually measured so the UI can label the list honestly.
import {
  getProject,
  getProjectEvidence,
  getProjectScriptInfo,
  getScenes,
} from "@/lib/data";
import { mp3DurationSeconds } from "@/lib/mp3";
import { chapterOf } from "@/lib/chapters";
import { driveId } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TAKES = 200;
/** One take, not one film — a 25MB "mp3" is not narration. */
const MAX_TAKE_BYTES = 25 * 1024 * 1024;

const bad = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** m:ss / h:mm:ss — YouTube's own timestamp shapes. */
function stamp(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** First ~N chars of the opening narration, cut at a sentence end. */
function hookParagraph(text: string, cap = 260): string {
  const clean = text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= cap) return clean;
  const head = clean.slice(0, cap);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return cut > 60 ? head.slice(0, cut + 1) : head.trimEnd() + "…";
}

/**
 * Fetch one take straight from where it lives and measure its frames.
 * Drive links go through the uc?export=download form audio-bundle already
 * uses — NOT through our own /api/media proxy, which sits behind the site
 * password and would bounce a cookie-less server-side fetch to /login.
 */
async function takeSeconds(voiceUrl: string): Promise<number> {
  const id = driveId(voiceUrl);
  const url = id ? `https://drive.google.com/uc?export=download&id=${id}` : voiceUrl;
  const res = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`take ${res.status}`);
  if ((res.headers.get("content-type") ?? "").includes("html")) {
    throw new Error("drive returned a page, not audio");
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_TAKE_BYTES) throw new Error("take too large");
  return mp3DurationSeconds(bytes);
}

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const projectId = reqUrl.searchParams.get("project") ?? "";
  if (!/^rec[A-Za-z0-9]{5,}$/.test(projectId)) return bad(400, "bad project id");

  const project = await getProject(projectId);
  if (!project) return bad(404, "project not found");
  const scenes = await getScenes(projectId);
  if (scenes.length === 0) return bad(409, "no scenes yet");
  if (scenes.length > MAX_TAKES) return bad(413, "too many scenes");

  const ro = /rom/i.test(project.language ?? "");
  const speed =
    Number.isFinite(project.editing.speed) && project.editing.speed > 0
      ? project.editing.speed
      : 1;

  // --- durations -----------------------------------------------------------
  // Measured from the takes' own mp3 frames where they exist; estimated from
  // word count where one is missing (a failed fetch must shift the later
  // chapters, not zero them). A silent film has no takes at all — then there
  // is nothing to sum and the chapter list ships without timestamps.
  const hasVoices = scenes.some((s) => s.voiceUrl);
  let measured = hasVoices;
  const durations = await Promise.all(
    scenes.map((s) => {
      const estimate =
        ((s.narration ?? "").trim().split(/\s+/).filter(Boolean).length || 8) / 2.6;
      if (!s.voiceUrl) {
        if (hasVoices) measured = false;
        return Promise.resolve(estimate);
      }
      return takeSeconds(s.voiceUrl).then(
        (d) => (d > 0.5 ? d : estimate),
        () => {
          measured = false;
          return estimate;
        },
      );
    }),
  );

  // --- chapters ------------------------------------------------------------
  const titles = new Map<number, string>();
  try {
    const script = await getProjectScriptInfo(projectId);
    for (const m of (script?.content ?? "").matchAll(/\[CHAPTER\s+(\d+)\s*:\s*([^\]]+)\]/gi)) {
      titles.set(Number(m[1]), m[2].trim());
    }
  } catch {
    // No script reachable — chapters fall back to numbered names.
  }

  /** "Why does a car company need to keep…" — a scene's own opening words,
   *  sized for a timestamp label. Used when the film is too short to have
   *  real chapters. */
  const sceneLabel = (s: (typeof scenes)[number], i: number): string => {
    const clean = (s.narration ?? "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return `${ro ? "Scena" : "Scene"} ${i + 1}`;
    if (clean.length <= 48) return clean.replace(/[.!?]+$/, "");
    const head = clean.slice(0, 48);
    return head.slice(0, head.lastIndexOf(" ")).replace(/[,;:.!?]+$/, "") + "…";
  };

  // Two granularities, picked by what the film actually has. Chapter count
  // is ceil(length/120), so every film under ~4 minutes is hook + one
  // chapter — and a two-line list under a nine-scene film reads as the
  // feature not working (it was reported as exactly that). Under 3 real
  // chapters the list is per SCENE, labelled by each scene's own opening
  // words; at 3+ the chapter titles win, because a 90-scene film listed
  // per scene is noise nobody scrolls.
  const distinctChapters = new Set(scenes.map((s) => chapterOf(s.order ?? 0))).size;
  const perScene = distinctChapters < 3;

  const chapterLines: string[] = [];
  if (hasVoices) {
    let t = 0;
    let lastChapter: number | null = null;
    scenes.forEach((s, i) => {
      const ch = chapterOf(s.order ?? 0);
      if (perScene) {
        // YouTube requires the first entry to sit at exactly 0:00. Entries
        // shorter than 10s keep their line — the bar may decline to segment,
        // but a timestamp in a description is a clickable jump link always.
        chapterLines.push(`${i === 0 ? "0:00" : stamp(t / speed)} ${sceneLabel(s, i)}`);
      } else if (ch !== lastChapter) {
        const name =
          ch === 0
            ? "Intro"
            : (titles.get(ch) ?? (ro ? `Capitolul ${ch}` : `Chapter ${ch}`));
        chapterLines.push(`${chapterLines.length === 0 ? "0:00" : stamp(t / speed)} ${name}`);
        lastChapter = ch;
      }
      t += Math.max(1, durations[i] - 0.45) + 0.35;
    });
  }

  // --- sources -------------------------------------------------------------
  const evidence = await getProjectEvidence(projectId).catch(() => []);
  const seen = new Set<string>();
  const sourceLines: string[] = [];
  for (const e of evidence) {
    if (!e.url) continue;
    const key = `${e.source ?? ""}|${e.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sourceLines.push(`• ${e.source ? `${e.source} — ` : ""}${e.url}`);
    if (sourceLines.length >= 12) break;
  }

  // --- assembly ------------------------------------------------------------
  const parts: string[] = [];
  const opening = scenes.find((s) => (s.narration ?? "").trim());
  if (opening?.narration) parts.push(hookParagraph(opening.narration));
  // YouTube only builds chapters from a list of 3+; fewer is still useful to
  // a reader, so the block ships from 2 up and simply won't segment the bar.
  if (chapterLines.length >= 2) {
    parts.push(`${ro ? "Capitole" : "Chapters"}:\n${chapterLines.join("\n")}`);
  }
  if (sourceLines.length > 0) {
    parts.push(`${ro ? "Surse" : "Sources"}:\n${sourceLines.join("\n")}`);
  }

  return new Response(
    JSON.stringify({
      description: parts.join("\n\n"),
      measured,
      chapters: chapterLines.length,
      sources: sourceLines.length,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
