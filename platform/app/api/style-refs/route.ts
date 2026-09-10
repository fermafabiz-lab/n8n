/**
 * The style rows Claude Scripting writes a film against.
 *
 *   GET /api/style-refs?project=rec…            (n8n: x-hov-key; browser: cookie)
 *   GET /api/style-refs?tone=Educativ&look=…    (no project yet — the brief's preview)
 *
 * Answers `{ records: [{ id, createdTime, fields: {…} }] }` in the same
 * Airtable shape the `/api/at` shim speaks, so `Fetch Style Card` in Claude
 * Scripting changed only its URL and `Prepare Style Block` reads
 * `records[].fields['Style Card'|'Raw Transcript'|'Pacing WPM'|'Hook WPM']`
 * exactly as before. Two things are different from the raw table:
 *
 *   - WHICH rows: the producer's pinned references first (Editing
 *     Options.styleRefs), then tone-family matches, then category matches —
 *     `pickStyleRefs` in lib/style-refs.ts, checked by `npm run check:style-refs`.
 *   - WHAT they carry: `Raw Transcript` is CLEANED prose. Every transcript in
 *     the library is an SRT file, and the writer used to be shown its cue
 *     numbers and timecodes as "the rhythm of this genre".
 */
import { NextRequest } from "next/server";
import { getLibraryRowsForStyle, getProjectStyleInput } from "@/lib/data/style";
import { cleanTranscript, pickStyleRefs } from "@/lib/style-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function keyed(req: NextRequest): boolean {
  const key = process.env.MEDIA_INGEST_KEY;
  if (!key) return false;
  return req.headers.get("x-hov-key") === key || req.headers.get("authorization") === `Bearer ${key}`;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  // The middleware lets a keyed request through and redirects a cookie-less
  // browser to /login, so reaching here means one of the two held. A keyed
  // call is still checked again: the door is not the lock.
  const cookieOk = !process.env.SITE_PASSWORD || req.cookies.get("vf_auth")?.value === process.env.SITE_PASSWORD;
  if (!cookieOk && !keyed(req)) return Response.json({ error: "unauthorised" }, { status: 401 });

  const projectId = (p.get("project") ?? "").trim();
  let pinned: string[] = [];
  let tone = (p.get("tone") ?? "").trim();
  let look: string | null = (p.get("look") ?? "").trim() || null;
  if (projectId) {
    try {
      const pi = await getProjectStyleInput(projectId);
      if (pi) {
        pinned = pi.styleRefs;
        tone = tone || pi.tone;
        look = look ?? pi.look;
      }
    } catch (e) {
      console.warn("style-refs: project unreadable", e instanceof Error ? e.message : e);
    }
  }
  try {
    const rows = await getLibraryRowsForStyle();
    const picked = pickStyleRefs(rows, { pinned, tone, look });
    return Response.json({
      records: picked.map((r) => ({
        id: r.id,
        createdTime: r.createdAt ?? new Date(0).toISOString(),
        fields: {
          Title: r.title,
          Tone: r.tone ?? "",
          Category: r.category ?? "",
          Active: true,
          "Style Card": r.styleCard ?? "",
          "Raw Transcript": cleanTranscript(r.transcript),
          ...(r.pacingWpm ? { "Pacing WPM": r.pacingWpm } : {}),
          ...(r.hookWpm ? { "Hook WPM": r.hookWpm } : {}),
          /** Why this row is here — the scripting log prints it. */
          Reason: pinned.includes(r.id) ? "pinned by producer" : "matched on tone/category",
        },
      })),
      tone,
      pinned,
    });
  } catch (e) {
    // An empty answer degrades Scripting to the genre voice alone, which is
    // what `Prepare Style Block` already does for a missing table.
    return Response.json({ records: [], error: e instanceof Error ? e.message : String(e) });
  }
}
