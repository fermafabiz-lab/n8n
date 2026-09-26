/**
 * The site's hourly work for Developer insights and Analytics — for n8n,
 * which has no browser session.
 *
 *     POST http://web:3000/api/insights/tick   {"budgetMs": 120000}
 *     with the `HOV Media Ingest` credential (header x-hov-key)
 *
 * n8n's "API Credits" workflow reads most balances itself and then knocks
 * here, every hour, for the three things only the SITE can do — it holds the
 * keys (platform.env, from GitHub Secrets):
 *   1. CapSolver's balance (CAPSOLVER_API_KEY) → hov.api_balance
 *   2. useapi's captcha record, day by day (USEAPI_TOKEN) → hov.captcha_day
 *   3. the OpenAI ledger from finished n8n executions (N8N_API_KEY) → hov.openai_call
 * One budget for the three, in that order: the balance takes a second, today's
 * captcha a few, and the ledger gets what is left (a long backlog is finished
 * by the next hour — nothing read is ever read twice).
 *
 * Exempted from the password gate in middleware.ts only when the key is right
 * (the door); checked again here (the lock).
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
  const budgetMs = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 270_000) : 60_000;
  const t0 = Date.now();
  const left = () => Math.max(5_000, budgetMs - (Date.now() - t0));

  const { readCapSolver, syncCaptchaDays } = await import("@/lib/captcha-sync");
  const { collectOpenAiUsage } = await import("@/lib/openai-collect");
  const capsolver = await readCapSolver("schedule").catch((e) => ({ ok: false, balance: null, message: String(e) }));
  const captcha = await syncCaptchaDays({ budgetMs: Math.min(60_000, left() / 2) }).catch((e) => ({
    ok: false,
    message: String(e),
    read: 0,
    done: false,
  }));
  const ledger = await collectOpenAiUsage({ budgetMs: left() }).catch((e) => ({ ok: false, message: String(e) }));
  return reply(200, { ok: true, capsolver, captcha, ledger, ms: Date.now() - t0 });
}
