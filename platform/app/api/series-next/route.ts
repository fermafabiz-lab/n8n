// The "✨ Suggest episode N" button on the brief, for a series.
//
// POST { series_id, language? } -> { title, idea }
//
// Same shape and the same manners as expand-brief: the model call lives in
// n8n (webhook `series-next`), because that is where the OpenAI key is, and
// any failure answers with nulls so the button is dead rather than the draft
// lost. n8n loads the show — premise, cast, places, the recap and every
// title already used — from Postgres by id, exactly like `series-recap`
// does; the site sends an id, never a premise, so nothing a browser can
// forge reaches the prompt.
import { SeriesNextBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  const webhook = newProject?.replace(/new-project\/?$/, "series-next");
  if (!webhook?.includes("series-next")) {
    return Response.json({ title: null, idea: null, error: "n8n not configured" }, { status: 200 });
  }
  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {}
  const parsed = SeriesNextBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ title: null, idea: null, error: "no series" }, { status: 200 });
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        series_id: parsed.data.series_id,
        language: String(parsed.data.language ?? "English").slice(0, 40),
      }),
      signal: AbortSignal.timeout(75_000),
      cache: "no-store",
    });
    const out = (await res.json()) as { title?: unknown; idea?: unknown };
    const title = typeof out.title === "string" && out.title.trim() ? out.title.trim() : null;
    const idea = typeof out.idea === "string" && out.idea.trim() ? out.idea.trim() : null;
    // A title is the point of the button; an idea without one is nothing to
    // put on screen, so it answers as a miss and the fields stay untouched.
    return Response.json(title ? { title, idea } : { title: null, idea: null });
  } catch {
    return Response.json({ title: null, idea: null, error: "unreachable" }, { status: 200 });
  }
}
