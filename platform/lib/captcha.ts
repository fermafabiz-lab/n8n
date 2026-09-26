/**
 * The captcha, in numbers: what CapSolver has left, how many solves the
 * films need, and how many of them Google actually accepts.
 *
 * The producer's ask (2026-09-26): "add the captcha program (CapSolver) to see
 * how much we have left, and if you can add some analytics it would be great".
 *
 * Every image and every clip Google Flow makes needs a reCAPTCHA Enterprise
 * token. useapi.net buys it from a solving service — CapSolver, since 2Captcha
 * was removed on 2026-09-26 for being accepted 0 times in 45 — with the
 * producer's key, one paid solve per ATTEMPT. Google then accepts the token or
 * refuses it as "unusual activity", and a refused one is paid for and retried
 * (up to `captchaRetry`, 5). So the bill is set less by the price of a solve
 * than by how many solves each picture needs, which is what this measures.
 *
 * Two sources, both read by the site (lib/captcha-sync.ts):
 * - CapSolver's own balance — `POST api.capsolver.com/getBalance` with the key
 *   (GitHub Secret CAPSOLVER_API_KEY), stored as a reading like every other
 *   paid service's (hov.api_balance, provider 'capsolver', metric 'balance').
 * - useapi's record of every attempt — `GET …/accounts/captcha-stats?date=`,
 *   kept three months, summed per day into hov.captcha_day (db/020).
 *
 * Pure: `sumDay` turns one day's records into the row, `summarizeDays` turns
 * rows into what the Analytics page shows. `scripts/check-captcha.mjs` pins
 * both against a real day and against useapi's own summaries of two more.
 */

/**
 * What a solve costs, as useapi's own table puts it ("Cost per 1K": CapSolver
 * ~$3.00, 2Captcha ~$2.99, AntiCaptcha ~$2.00 — read 2026-09-26). An ESTIMATE:
 * once CapSolver's balance is being read, its drops are the measured figure.
 */
export const COST_PER_SOLVE: Record<string, number> = {
  CapSolver: 0.003,
  "2Captcha": 0.00299,
  AntiCaptcha: 0.002,
  SolveCaptcha: 0.0008,
  EzCaptcha: 0.0025,
};

/** One attempt, as captcha-stats lists it. */
export interface CaptchaRecord {
  timestamp?: string;
  jobId?: string;
  provider?: string;
  route?: string;
  pageAction?: string;
  statusCode?: number;
  reason?: string;
  captchaDurationMs?: number;
  attemptNumber?: number;
}

/**
 * What happened to an attempt, in the producer's terms:
 * - `accepted`    the request went through (200).
 * - `refused`     Google scored the token as a bot (403 UNUSUAL_ACTIVITY) —
 *                 paid for, then retried.
 * - `traffic`     429 UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC — Google's other bot
 *                 verdict, paid for and retried the same way.
 * - `throttled`   Google limiting the ACCOUNT (the other 429s: throttled,
 *                 high traffic, quota) — the token was fine.
 * - `other`       the token was fine and the request failed after it: a
 *                 refused prompt (400), a model the account lacks (403
 *                 MODEL_ACCESS_DENIED), a timeout (524).
 * - `unavailable` 503: Google Flow was down, which says nothing about the token.
 */
export const OUTCOMES = [
  { id: "accepted", label: "Went through", note: "Google took the token and made the picture" },
  { id: "refused", label: "Refused as unusual activity", note: "a bot verdict on the token (403) — paid, then retried" },
  { id: "traffic", label: "Refused as too much traffic", note: "the other bot verdict (429) — paid, then retried" },
  { id: "throttled", label: "Account throttled", note: "Google limiting the account, not the token" },
  { id: "other", label: "Token fine, request refused", note: "a refused prompt, a model the account lacks, a timeout" },
  { id: "unavailable", label: "Flow unavailable", note: "Google Flow was down (503) — says nothing about the token" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["id"];

/**
 * Whether Google TOOK the token — useapi's own rule for its success rate,
 * worked out from its summaries (execution 17775) rather than assumed: only
 * the two bot verdicts fail a token, a 503 is left out of the sample, and
 * everything else happened after Google had accepted it. So "tokens accepted"
 * is not "requests that went through": on 2026-09-04, 85 refused prompts put
 * the first at 88% and the second at 59%.
 */
export const tokenFailed = (o: Outcome) => o === "refused" || o === "traffic";
export const tokenJudged = (o: Outcome) => o !== "unavailable";
/** A tally's share of tokens Google took, 0..1 — null when none was judged. */
export const tokenRateOf = (t: Pick<Tally, "passed" | "judged">) => (t.judged > 0 ? t.passed / t.judged : null);

export function outcomeOf(r: CaptchaRecord): Outcome {
  const code = Number(r.statusCode);
  const reason = String(r.reason ?? "");
  if (code === 200) return "accepted";
  if (reason === "PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC") return "traffic";
  if (reason.startsWith("PUBLIC_ERROR_UNUSUAL_ACTIVITY") || (code === 403 && !reason)) return "refused";
  if (code === 429) return "throttled";
  if (code === 503) return "unavailable";
  return "other";
}

/** The Flow account a request ran on, from useapi's job id (`…-email:<address>-bot:google-flow`). */
export function accountOf(jobId: string | undefined): string {
  const m = String(jobId ?? "").match(/email:(.+?)-bot:/);
  return m ? m[1] : "unknown";
}

/** Images or videos, from the route (`post-images`, `post-videos`, …). */
export function kindOf(r: CaptchaRecord): string {
  const route = String(r.route ?? r.pageAction ?? "").toLowerCase();
  if (route.includes("image")) return "images";
  if (route.includes("video")) return "videos";
  return "other";
}

export interface Tally {
  attempts: number;
  /** Requests that went through (200). */
  accepted: number;
  /** Tokens Google took (`tokenFailed` is false) — useapi's successes. */
  passed: number;
  /** Tokens that got a verdict (`tokenJudged`) — useapi's sample size. */
  judged: number;
  /** Summed solve time, ms — divide by attempts for the average. */
  ms: number;
}

/** One day, summed — the shape of a hov.captcha_day row. */
export interface CaptchaDay {
  day: string; // YYYY-MM-DD
  attempts: number;
  accepted: number;
  jobs: number;
  solveMs: number;
  byProvider: Record<string, Tally>;
  byAccount: Record<string, Tally>;
  byKind: Record<string, Tally>;
  outcomes: Record<Outcome, number>;
}

const blank = (): Tally => ({ attempts: 0, accepted: 0, passed: 0, judged: 0, ms: 0 });
const blankOutcomes = (): Record<Outcome, number> =>
  Object.fromEntries(OUTCOMES.map((o) => [o.id, 0])) as Record<Outcome, number>;

export function sumDay(day: string, records: CaptchaRecord[]): CaptchaDay {
  const out: CaptchaDay = {
    day,
    attempts: 0,
    accepted: 0,
    jobs: 0,
    solveMs: 0,
    byProvider: {},
    byAccount: {},
    byKind: {},
    outcomes: blankOutcomes(),
  };
  const jobs = new Set<string>();
  for (const r of records) {
    const outcome = outcomeOf(r);
    const ok = outcome === "accepted" ? 1 : 0;
    const judged = tokenJudged(outcome) ? 1 : 0;
    const passed = judged && !tokenFailed(outcome) ? 1 : 0;
    const ms = Math.max(0, Number(r.captchaDurationMs) || 0);
    out.attempts++;
    out.accepted += ok;
    out.solveMs += ms;
    out.outcomes[outcome]++;
    if (r.jobId) jobs.add(r.jobId);
    for (const [bucket, key] of [
      [out.byProvider, String(r.provider || "unknown")],
      [out.byAccount, accountOf(r.jobId)],
      [out.byKind, kindOf(r)],
    ] as Array<[Record<string, Tally>, string]>) {
      const t = (bucket[key] ??= blank());
      t.attempts++;
      t.accepted += ok;
      t.passed += passed;
      t.judged += judged;
      t.ms += ms;
    }
  }
  out.jobs = jobs.size;
  return out;
}

/** What the solves of a tally cost at the table's price per provider. */
export function costOfProviders(byProvider: Record<string, Tally>): number {
  return Object.entries(byProvider).reduce((n, [p, t]) => n + t.attempts * (COST_PER_SOLVE[p] ?? COST_PER_SOLVE.CapSolver), 0);
}

// ---- what the page shows ---------------------------------------------------------

export interface CaptchaSummary {
  days: number;
  attempts: number;
  accepted: number;
  passed: number;
  judged: number;
  jobs: number;
  /** Tokens Google took ÷ tokens judged, 0..1 — useapi's success rate; null with none. */
  tokenRate: number | null;
  /** Requests that went through ÷ requests, 0..1 — null with no requests. */
  throughRate: number | null;
  /** Solves a request needed on average. */
  perJob: number | null;
  avgSolveMs: number | null;
  estCost: number;
  /** Estimated dollars per request that went through. */
  costPerAccepted: number | null;
  outcomes: Array<{ id: Outcome; label: string; note: string; value: number; calls: number }>;
  providers: Array<{ id: string } & Tally & { cost: number }>;
  accounts: Array<{ id: string } & Tally>;
  kinds: Array<{ id: string } & Tally>;
  /** `rate` is the day's token rate. */
  perDay: Array<{ t: number; attempts: number; accepted: number; rate: number | null; cost: number }>;
}

const merge = (into: Record<string, Tally>, from: Record<string, Tally> | null | undefined) => {
  for (const [k, t] of Object.entries(from ?? {})) {
    const m = (into[k] ??= blank());
    m.attempts += Number(t.attempts) || 0;
    m.accepted += Number(t.accepted) || 0;
    m.passed += Number(t.passed) || 0;
    m.judged += Number(t.judged) || 0;
    m.ms += Number(t.ms) || 0;
  }
};

/** A day's token verdicts, from its outcome counts (the row keeps no separate total). */
function verdicts(d: CaptchaDay): { passed: number; judged: number } {
  let passed = 0;
  let judged = 0;
  for (const o of OUTCOMES) {
    const n = Number(d.outcomes?.[o.id]) || 0;
    if (!tokenJudged(o.id)) continue;
    judged += n;
    if (!tokenFailed(o.id)) passed += n;
  }
  return { passed, judged };
}

export function summarizeDays(days: CaptchaDay[]): CaptchaSummary {
  const byProvider: Record<string, Tally> = {};
  const byAccount: Record<string, Tally> = {};
  const byKind: Record<string, Tally> = {};
  const outcomes = blankOutcomes();
  let attempts = 0;
  let accepted = 0;
  let passed = 0;
  let judged = 0;
  let jobs = 0;
  let solveMs = 0;
  const perDay: CaptchaSummary["perDay"] = [];
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    attempts += d.attempts;
    accepted += d.accepted;
    jobs += d.jobs;
    solveMs += d.solveMs;
    merge(byProvider, d.byProvider);
    merge(byAccount, d.byAccount);
    merge(byKind, d.byKind);
    for (const o of OUTCOMES) outcomes[o.id] += Number(d.outcomes?.[o.id]) || 0;
    const v = verdicts(d);
    passed += v.passed;
    judged += v.judged;
    perDay.push({
      t: Date.parse(`${d.day}T00:00:00Z`),
      attempts: d.attempts,
      accepted: d.accepted,
      rate: v.judged > 0 ? v.passed / v.judged : null,
      cost: costOfProviders(d.byProvider ?? {}),
    });
  }
  const estCost = costOfProviders(byProvider);
  const rows = (b: Record<string, Tally>) =>
    Object.entries(b)
      .map(([id, t]) => ({ id, ...t }))
      .sort((x, y) => y.attempts - x.attempts);
  return {
    days: days.length,
    attempts,
    accepted,
    passed,
    judged,
    jobs,
    tokenRate: judged > 0 ? passed / judged : null,
    throughRate: jobs > 0 ? accepted / jobs : null,
    perJob: jobs > 0 ? attempts / jobs : null,
    avgSolveMs: attempts > 0 ? solveMs / attempts : null,
    estCost,
    costPerAccepted: accepted > 0 ? estCost / accepted : null,
    outcomes: OUTCOMES.map((o) => ({ id: o.id, label: o.label, note: o.note, value: outcomes[o.id], calls: outcomes[o.id] })),
    providers: rows(byProvider).map((p) => ({ ...p, cost: p.attempts * (COST_PER_SOLVE[p.id] ?? COST_PER_SOLVE.CapSolver) })),
    accounts: rows(byAccount),
    kinds: rows(byKind),
    perDay,
  };
}

/** The UTC days from `since` to `now`, oldest first, as YYYY-MM-DD. */
export function daysBetween(since: number, now = Date.now()): string[] {
  const out: string[] = [];
  const DAY = 86_400_000;
  for (let t = Math.floor(since / DAY) * DAY; t <= now; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * A day is COMPLETE once it has ended and useapi's latency (5-15 minutes) has
 * passed: from then on its numbers cannot change and it is never read again.
 */
export function isDayComplete(day: string, now = Date.now()): boolean {
  return now >= Date.parse(`${day}T00:00:00Z`) + 86_400_000 + 20 * 60_000;
}
