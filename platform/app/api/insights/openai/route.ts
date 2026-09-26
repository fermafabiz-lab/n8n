/**
 * Fill the OpenAI ledger (db/019) — for n8n, which has no browser session.
 *
 *     POST http://web:3000/api/insights/openai   {"budgetMs": 240000}
 *     with the `HOV Media Ingest` credential (header x-hov-key)
 *
 * The "API Credits" workflow calls it every hour after reading the balances,
 * so the usage page is never more than an hour behind what n8n has finished.
 * It reads executions through the n8n public API, which only this site holds
 * the key to — the reason the work happens here and not in n8n.
 *
 * Exempted from the password gate in middleware.ts only when the key is
 * right (the door); checked again here (the lock). Reads n8n and writes two
 * ledger tables, nothing else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function POST(req: Request) {
  const key = process.env.MEDIA_INGEST_KEY;
  if (!key) return reply(500, { ok: false, message: "MEDIA_INGEST_KEY is not set" });
  if (req.headers.get("x-hov-key") !== key) return reply(401, { ok: false, message: "bad key" });

  const body = (await req.json().catch(() => null)) as { budgetMs?: unknown } | null;
  const asked = Number(body?.budgetMs);
  // Four and a half minutes at most: a first read of a month of runs is long,
  // and whatever is left is picked up by the next call.
  const budgetMs = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 270_000) : 60_000;

  const { collectOpenAiUsage } = await import("@/lib/openai-collect");
  const r = await collectOpenAiUsage({ budgetMs });
  return reply(r.ok ? 200 : 409, { ...r });
}
