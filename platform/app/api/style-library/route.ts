// The script library as the brief's reference picker sees it: active rows
// only, no transcripts (they are tens of kilobytes each and the form only
// needs to name them). Behind the site password like every page.
import { getLibraryScripts } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await getLibraryScripts();
    return Response.json({
      rows: rows
        .filter((r) => r.active)
        .map((r) => ({
          id: r.id,
          title: r.title.trim(),
          tone: r.tone,
          category: r.category,
          pacingWpm: r.pacingWpm,
          durationSeconds: r.durationSeconds,
          /** Under ~20 sentences a row yields no excerpt; the picker says so. */
          thin: r.transcriptChars < 1500,
        })),
    });
  } catch (e) {
    return Response.json({ rows: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
