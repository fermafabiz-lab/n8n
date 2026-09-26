import { captchaReady, completeCaptchaDays, saveApiReading, saveCaptchaDay } from "@/lib/data/postgres";
import { daysBetween, isDayComplete, sumDay, type CaptchaRecord } from "@/lib/captcha";

/**
 * The site's two captcha readings (lib/captcha.ts says what they mean).
 *
 * Both run on the SITE rather than in n8n because the keys are site secrets,
 * written into platform.env by deploy-platform.yml like every other one:
 * CAPSOLVER_API_KEY (the producer's CapSolver key — useapi holds it too, but
 * shows it masked) and USEAPI_TOKEN (the same useapi token the engine uses).
 *
 * Called hourly by n8n's "API Credits" (its Read OpenAI Ledger node posts to
 * /api/insights/tick), by "Check now" on Developer insights (the balance) and
 * by "Update now" on Analytics (today's captcha). Neither key is ever stored,
 * logged or sent anywhere but its own service.
 */

const DAY = 86_400_000;
// Overridable only so a local run can point them at stand-ins
// (db/port/captcha/browser/drive.mjs); production never sets them.
const CAPSOLVER = (process.env.CAPSOLVER_BASE_URL || "https://api.capsolver.com").replace(/\/+$/, "");
const USEAPI = (process.env.USEAPI_BASE_URL || "https://api.useapi.net").replace(/\/+$/, "");
/** How far back the captcha analytics reach (useapi keeps three months). */
export const CAPTCHA_DAYS_BACK = 31;

type Source = "schedule" | "webhook" | "manual";
const clip = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 300);

export interface CapSolverResult {
  ok: boolean;
  balance: number | null;
  message: string;
}

/** CapSolver's balance, read with the site's key and filed as a reading. */
export async function readCapSolver(source: Source): Promise<CapSolverResult> {
  const key = process.env.CAPSOLVER_API_KEY?.trim();
  if (!key) {
    const note = "The site has no CapSolver key yet: add it as the GitHub Secret CAPSOLVER_API_KEY, then redeploy.";
    await saveApiReading({ provider: "capsolver", metric: "balance", value: null, unit: "usd", status: "unavailable", note, detail: null, source });
    return { ok: false, balance: null, message: note };
  }
  try {
    const res = await fetch(`${CAPSOLVER}/getBalance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: key }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { errorId?: number; errorCode?: string; errorDescription?: string; balance?: number; packages?: unknown[] }
      | null;
    if (!res.ok || !body || body.errorId !== 0 || typeof body.balance !== "number") {
      const note = clip(body?.errorDescription || body?.errorCode || `CapSolver answered HTTP ${res.status}`);
      await saveApiReading({
        provider: "capsolver",
        metric: "balance",
        value: null,
        unit: "usd",
        status: "error",
        note,
        detail: { httpStatus: res.status, errorCode: body?.errorCode ?? null },
        source,
      });
      return { ok: false, balance: null, message: note };
    }
    const balance = Math.round(body.balance * 10_000) / 10_000;
    await saveApiReading({
      provider: "capsolver",
      metric: "balance",
      value: balance,
      unit: "usd",
      status: balance <= 0 ? "out" : "ok",
      note: balance <= 0 ? "CapSolver has no balance left." : null,
      detail: { packages: Array.isArray(body.packages) ? body.packages.length : 0 },
      source,
    });
    return { ok: true, balance, message: `CapSolver: $${balance.toFixed(2)} left.` };
  } catch (e) {
    const note = clip(`CapSolver did not answer: ${e instanceof Error ? e.message : String(e)}`);
    await saveApiReading({ provider: "capsolver", metric: "balance", value: null, unit: "usd", status: "error", note, detail: null, source });
    return { ok: false, balance: null, message: note };
  }
}

export interface CaptchaSyncResult {
  ok: boolean;
  message: string;
  /** Days read in this call. */
  read: number;
  /** False when the time ran out first — the next call carries on. */
  done: boolean;
}

/**
 * Read useapi's captcha record one day at a time into hov.captcha_day: today
 * and every day of the last month not yet read to its end. Newest first, so a
 * short budget always refreshes today before it back-fills.
 */
export async function syncCaptchaDays(opts: { budgetMs?: number; daysBack?: number } = {}): Promise<CaptchaSyncResult> {
  const token = process.env.USEAPI_TOKEN?.trim();
  if (!token) return { ok: false, message: "The site has no useapi token (USEAPI_TOKEN).", read: 0, done: true };
  if (!(await captchaReady())) return { ok: false, message: "The captcha table is not there yet (db/020).", read: 0, done: true };
  const t0 = Date.now();
  const now = Date.now();
  const days = daysBetween(now - ((opts.daysBack ?? CAPTCHA_DAYS_BACK) - 1) * DAY, now).reverse();
  const finished = await completeCaptchaDays(days);
  let read = 0;
  for (const day of days) {
    if (finished.has(day)) continue;
    if (Date.now() - t0 > (opts.budgetMs ?? 30_000)) {
      return { ok: true, message: `Read ${read} day${read === 1 ? "" : "s"} of captcha records; more to read.`, read, done: false };
    }
    let res: Response;
    try {
      res = await fetch(`${USEAPI}/v1/google-flow/accounts/captcha-stats?date=${day}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
    } catch (e) {
      return { ok: false, message: clip(`useapi did not answer: ${e instanceof Error ? e.message : String(e)}`), read, done: false };
    }
    if (!res.ok) return { ok: false, message: `useapi answered HTTP ${res.status} for ${day}.`, read, done: false };
    const body = (await res.json().catch(() => null)) as { data?: CaptchaRecord[]; summary?: Record<string, unknown> } | null;
    const records = Array.isArray(body?.data) ? body.data : [];
    await saveCaptchaDay(sumDay(day, records), body?.summary ?? null, isDayComplete(day, now));
    read++;
  }
  return { ok: true, message: read ? `Read ${read} day${read === 1 ? "" : "s"} of captcha records.` : "Captcha records up to date.", read, done: true };
}
