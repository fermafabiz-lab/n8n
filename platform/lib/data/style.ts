/**
 * The two reads `/api/style-refs` needs — Postgres only. On the frozen
 * Airtable backend the route answers no rows and Scripting falls back to the
 * genre voice, the same degradation `Prepare Style Block` always had.
 */
import { atQuery as query } from "./postgres";
import { normalizeStyleRefs, type StyleRow } from "@/lib/style-refs";

export async function getLibraryRowsForStyle(): Promise<StyleRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, title, tone, category, active, raw_transcript, style_card,
            pacing_wpm, hook_wpm, created_at
       from hov.script_library
      where active`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? "").trim(),
    tone: (r.tone as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    active: r.active === true,
    transcript: (r.raw_transcript as string | null) ?? null,
    styleCard: (r.style_card as string | null) ?? null,
    pacingWpm: r.pacing_wpm == null ? null : Number(r.pacing_wpm),
    hookWpm: r.hook_wpm == null ? null : Number(r.hook_wpm),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at ? String(r.created_at) : null,
  }));
}

export async function getProjectStyleInput(
  projectId: string,
): Promise<{ styleRefs: string[]; tone: string; look: string | null } | null> {
  const rows = await query<{ tone: string | null; style: string | null; editing_options: unknown }>(
    `select tone, style, editing_options from hov.project where id = $1`,
    [projectId],
  );
  const r = rows[0];
  if (!r) return null;
  const opts = (r.editing_options && typeof r.editing_options === "object" ? r.editing_options : {}) as {
    styleRefs?: unknown;
  };
  return {
    styleRefs: normalizeStyleRefs(opts.styleRefs),
    tone: r.tone ?? "",
    look: r.style ?? null,
  };
}
