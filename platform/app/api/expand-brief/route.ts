// The "✨ Develop my idea" button on the brief.
//
// POST { tema, brief?, tone?, language? } -> { brief }
//
// The model call lives in n8n (webhook `expand-brief`), because that is where
// the OpenAI key lives — same shape as yt-scene-titles. This route only
// derives the webhook URL the way every other site->n8n call does (swap the
// last path segment of the new-project URL) and forwards. Any failure answers
// with brief: null and the form keeps whatever the producer typed — a dead
// button, never a lost draft.
import { ExpandBriefBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const newProject = process.env.N8N_NEW_PROJECT_WEBHOOK_URL;
  const webhook = newProject?.replace(/new-project\/?$/, "expand-brief");
  if (!webhook?.includes("expand-brief")) {
    return Response.json({ brief: null, error: "n8n not configured" }, { status: 200 });
  }
  // Soft-fail on purpose (see the header comment above): a malformed body
  // still parses to the all-defaults shape rather than a 400, so a bad
  // request behaves exactly like "no topic" below, not like an error page.
  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {}
  const parsed = ExpandBriefBody.safeParse(raw);
  const body = parsed.success ? parsed.data : ExpandBriefBody.parse({});
  const tema = String(body.tema ?? "").trim();
  if (!tema) return Response.json({ brief: null, error: "no topic" }, { status: 200 });
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tema: tema.slice(0, 1200),
        brief: String(body.brief ?? "").slice(0, 2000),
        tone: String(body.tone ?? "").slice(0, 60),
        language: String(body.language ?? "English").slice(0, 40),
      }),
      signal: AbortSignal.timeout(75_000),
      cache: "no-store",
    });
    const out = (await res.json()) as { brief?: unknown };
    const brief = typeof out.brief === "string" && out.brief.trim() ? out.brief.trim() : null;
    return Response.json({ brief });
  } catch {
    return Response.json({ brief: null, error: "unreachable" }, { status: 200 });
  }
}
