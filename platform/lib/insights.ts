import { MONTHLY_CREDITS } from "@/lib/cost";

/**
 * Developer insights — what every paid service behind the factory has left,
 * how fast it is going, and when it will be gone.
 *
 * The producer's words (2026-09-24): "ne tot trezim că rămânem fără credite"
 * — we keep waking up to find we have run out. The OpenAI account had emptied
 * mid-pipeline twice before (2026-08-08, 2026-09-19) and was empty again the
 * morning this was built; every time, the only signal was a film dying while
 * its script was being written.
 *
 * n8n's "API Credits" workflow reads every provider once an hour, and again
 * whenever someone presses "Check now", into `hov.api_balance`
 * (db/015_api_balance.sql, db/port/api-credits/). A reading carries the
 * provider's own verdict — ok / out / error / unavailable — and the numbers.
 * THIS FILE decides what they mean: what counts as low, how fast a balance
 * is falling, and what the alert says. The thresholds live here, not in n8n,
 * so changing one needs no republish and no backfill.
 */

export const PROVIDER_IDS = ["openai", "google-flow", "elevenlabs", "useapi", "capsolver", "google-drive"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const isProviderId = (v: string): v is ProviderId =>
  (PROVIDER_IDS as readonly string[]).includes(v);

export type ReadingStatus = "ok" | "out" | "error" | "unavailable";

/** One row of hov.api_balance, as the site reads it. */
export interface Reading {
  provider: string;
  account: string;
  metric: string;
  value: number | null;
  unit: string | null;
  limit: number | null;
  resetsAt: string | null;
  status: ReadingStatus;
  note: string | null;
  detail: Record<string, unknown> | null;
  takenAt: string;
}

/** A point of history: epoch milliseconds, value. */
export interface Point {
  t: number;
  v: number;
}

export interface ProviderInfo {
  label: string;
  /** What stops when it runs out — the reason the card exists at all. */
  powers: string;
  /** Where to fix it. */
  manage: { label: string; href: string };
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    label: "OpenAI",
    powers:
      "Writes every film: story bible, outline, narration, scenes, hook, Deep Search, and the clip judges. When it is empty, a new film dies while its script is being written.",
    manage: { label: "Add credits", href: "https://platform.openai.com/settings/organization/billing/overview" },
  },
  "google-flow": {
    label: "Google Flow",
    powers: "Makes every still and every video clip (Veo), through useapi. Each account spends its own credits.",
    manage: { label: "Open Flow", href: "https://labs.google/fx/tools/flow" },
  },
  elevenlabs: {
    label: "ElevenLabs",
    powers: "Speaks every narrator line and every scene recording.",
    manage: { label: "Manage plan", href: "https://elevenlabs.io/app/subscription" },
  },
  useapi: {
    label: "useapi.net",
    powers:
      "The door to Google Flow. If its subscription lapses, no image or clip can be made, whatever credits Flow holds.",
    manage: { label: "Subscription", href: "https://useapi.net/docs/subscription" },
  },
  capsolver: {
    label: "CapSolver",
    powers:
      "Solves the captcha Google asks for on every image and every clip (useapi buys each token from it). When it is empty, Flow refuses every picture.",
    manage: { label: "Add funds", href: "https://dashboard.capsolver.com/dashboard/overview" },
  },
  "google-drive": {
    label: "Google Drive",
    powers: "Keeps the voiceovers and the render's files.",
    manage: { label: "Manage storage", href: "https://one.google.com/storage" },
  },
};

/** The one reading each card is ABOUT; the rest feed the usage page. */
export const PRIMARY_METRIC: Record<ProviderId, string> = {
  openai: "access",
  "google-flow": "credits",
  elevenlabs: "characters",
  useapi: "subscription",
  capsolver: "balance",
  "google-drive": "storage",
};

export const seriesKey = (r: Pick<Reading, "provider" | "account" | "metric">): string =>
  `${r.provider}|${r.account}|${r.metric}`;

/**
 * The check runs every hour. Three missed runs is a dead check, not a quiet
 * one — and a page that kept showing its last numbers as if current would be
 * the very silence this page exists to end.
 */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export function isStale(takenAt: string | null | undefined, now = Date.now()): boolean {
  if (!takenAt) return true;
  const t = Date.parse(takenAt);
  return !Number.isFinite(t) || now - t > STALE_AFTER_MS;
}

/**
 * The ceiling a balance counts down from: the provider's own limit, or — for
 * Google Flow, whose API reports credits but no allowance — the Ultra plan's
 * monthly allowance (lib/cost.ts).
 */
export function ceilingOf(r: Reading): number | null {
  if (r.limit !== null && r.limit > 0) return r.limit;
  if (r.provider === "google-flow" && r.metric === "credits") return MONTHLY_CREDITS;
  return null;
}

/** How much of the allowance is left, 0..1, or null when there is no ceiling. */
export function fractionLeft(r: Reading): number | null {
  const c = ceilingOf(r);
  if (c === null || r.value === null) return null;
  return Math.max(0, Math.min(1, r.value / c));
}

const DAY = 86_400_000;

/**
 * What a balance loses per day, from readings of what is LEFT. Only drops
 * count — a rise is a top-up or the monthly refill, not negative spending —
 * and only the last `windowDays`. Less than six hours of history is not a
 * rate, it is noise.
 */
export function burnPerDay(points: Point[], now = Date.now(), windowDays = 7): number | null {
  const since = now - windowDays * DAY;
  const pts = points
    .filter((p) => p.t >= since && p.t <= now && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  const span = pts[pts.length - 1].t - pts[0].t;
  if (span < 6 * 60 * 60 * 1000) return null;
  let spent = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i - 1].v - pts[i].v;
    if (d > 0) spent += d;
  }
  return spent / (span / DAY);
}

/**
 * The same rate from a provider's own daily USAGE series (ElevenLabs counts
 * characters per day itself): the mean of the last `days` COMPLETE days.
 * Today is left out — half a day would read as half the pace.
 */
export function burnFromDaily(daily: Point[], now = Date.now(), days = 7): number | null {
  const complete = daily.filter((p) => Number.isFinite(p.t) && p.t + DAY <= now).sort((a, b) => a.t - b.t);
  const last = complete.slice(-days);
  if (last.length === 0) return null;
  return last.reduce((s, p) => s + (Number.isFinite(p.v) ? p.v : 0), 0) / last.length;
}

export function daysLeft(value: number | null, burn: number | null): number | null {
  if (value === null || burn === null || burn <= 0) return null;
  return value / burn;
}

/**
 * How much a balance went DOWN on each day (UTC), from readings of what is
 * left — the measured half of the usage page. A rise (refill) counts as zero.
 * Each drop is filed under the day of the reading that saw it.
 */
export function dailyDrops(points: Point[]): Point[] {
  const pts = [...points].filter((p) => Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  const byDay = new Map<number, number>();
  for (let i = 1; i < pts.length; i++) {
    const day = Math.floor(pts[i].t / DAY) * DAY;
    const d = pts[i - 1].v - pts[i].v;
    byDay.set(day, (byDay.get(day) ?? 0) + (d > 0 ? d : 0));
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
}

/**
 * Several balances' daily drops added up per day — Google Flow's accounts are
 * one budget to the producer — from `since` on.
 */
export function combinedDailyDrops(series: Point[][], since = 0): Point[] {
  const from = Math.floor(since / DAY) * DAY;
  const byDay = new Map<number, number>();
  for (const points of series) {
    for (const d of dailyDrops(points)) {
      if (d.t < from) continue;
      byDay.set(d.t, (byDay.get(d.t) ?? 0) + d.v);
    }
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
}

export type Level = "ok" | "low" | "critical" | "out" | "error" | "unknown";

/** Below this share of the allowance a balance is low / critical… */
export const LOW_FRACTION = 0.15;
export const CRITICAL_FRACTION = 0.05;
/**
 * …or, for a prepaid dollar balance with no allowance to measure against
 * (CapSolver), below these amounts: $3 is about a thousand solves — a day of
 * films — and $1 is a few hours. Before a week of readings exists this is
 * the only warning a new balance can give.
 */
export const LOW_USD = 3;
export const CRITICAL_USD = 1;
/** …or when, at the recent pace, it is gone in fewer days than this. */
export const LOW_DAYS = 5;
export const CRITICAL_DAYS = 2;

/**
 * The judgement. A refill that lands before the money runs out makes a fast
 * pace harmless, so it does not count towards "soon".
 */
export function levelOf(r: Reading, burn: number | null = null, now = Date.now()): Level {
  if (r.status === "out") return "out";
  if (r.status === "error") return "error";
  if (r.status === "unavailable") return "unknown";
  if (r.unit === "bool") return r.value === 1 ? "ok" : r.value === 0 ? "out" : "unknown";
  if (r.value === null) return "unknown";
  if (r.value <= 0) return "out";
  const frac = fractionLeft(r);
  const days = daysLeft(r.value, burn);
  const refill = r.resetsAt ? Date.parse(r.resetsAt) : NaN;
  const refillsFirst = days !== null && Number.isFinite(refill) && refill < now + days * DAY;
  const soon = (limit: number) => days !== null && days < limit && !refillsFirst;
  const usd = r.unit === "usd" && frac === null ? r.value : null;
  if ((frac !== null && frac < CRITICAL_FRACTION) || (usd !== null && usd < CRITICAL_USD) || soon(CRITICAL_DAYS)) return "critical";
  if ((frac !== null && frac < LOW_FRACTION) || (usd !== null && usd < LOW_USD) || soon(LOW_DAYS)) return "low";
  return "ok";
}

export const LEVEL_LABEL: Record<Level, string> = {
  ok: "OK",
  low: "Low",
  critical: "Nearly out",
  out: "Out",
  error: "Problem",
  unknown: "Unknown",
};

// ---- words and numbers -------------------------------------------------------

export const fmtCount = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Binary units, the way Google itself reports a Drive quota (30 TB, not 33). */
export function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${Number(v.toFixed(digits))} ${units[i]}`;
}

export function fmtDays(d: number): string {
  if (d < 1) return "less than a day";
  if (d < 1.5) return "about a day";
  if (d > 99) return "months";
  return `about ${Math.round(d)} days`;
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

/** The big number on a card, and the line under it. */
export function headlineOf(r: Reading): { value: string; caption: string } {
  const v = r.value;
  switch (r.metric) {
    case "access":
      if (v === 1) return { value: "Credits available", caption: "A paid call went through at the last check." };
      if (v === 0) return { value: "Out of credits", caption: "OpenAI refused a paid call: no credits remaining." };
      return { value: "Unknown", caption: r.note ?? "The last check could not tell." };
    case "subscription":
      if (v === 1) return { value: "Active", caption: "The subscription is paid up." };
      if (v === 0) return { value: "Not active", caption: r.note ?? "The subscription has lapsed." };
      return { value: "Unknown", caption: r.note ?? "The last check could not tell." };
    case "credits":
      if (v === null) return { value: "—", caption: r.note ?? "No figure at the last check." };
      return { value: fmtCount(v), caption: `credits left · the plan gives ${fmtCount(MONTHLY_CREDITS)} a month` };
    case "balance":
      if (v === null) return { value: "—", caption: r.note ?? "No figure at the last check." };
      return { value: fmtUsd(v), caption: "left · about $3 per 1,000 captcha solves" };
    case "characters":
      if (v === null) return { value: "—", caption: r.note ?? "No figure at the last check." };
      return {
        value: fmtCount(v),
        caption: r.limit !== null ? `characters left of ${fmtCount(r.limit)} this month` : "characters left",
      };
    case "storage": {
      const used = typeof r.detail?.usage === "number" ? (r.detail.usage as number) : null;
      if (v === null) {
        return { value: used !== null ? `${fmtBytes(used)} used` : "—", caption: "No storage limit reported." };
      }
      return {
        value: `${fmtBytes(v)} free`,
        caption: used !== null && r.limit !== null ? `${fmtBytes(used)} used of ${fmtBytes(r.limit)}` : "free space",
      };
    }
    default:
      return { value: v === null ? "—" : fmtCount(v), caption: r.unit ?? "" };
  }
}

/** "At about 1,200 a day this lasts about 18 days." — or null when there is no pace yet. */
export function paceLine(r: Reading, burn: number | null, now = Date.now()): string | null {
  if (r.value === null || burn === null) return null;
  if (burn <= 0) return "Nothing spent over the last week.";
  const unit = r.metric === "storage" ? fmtBytes(burn) : r.unit === "usd" ? fmtUsd(burn) : fmtCount(burn);
  const days = daysLeft(r.value, burn);
  if (days === null) return null;
  const refill = r.resetsAt ? Date.parse(r.resetsAt) : NaN;
  if (Number.isFinite(refill) && refill < now + days * DAY) {
    return `About ${unit} a day — it refills before it runs out.`;
  }
  return `About ${unit} a day — at that pace it lasts ${fmtDays(days)}.`;
}

// ---- the alert ---------------------------------------------------------------

export interface Alert {
  level: "out" | "critical";
  provider: ProviderId;
  account: string;
  text: string;
  href: string;
}

function alertText(r: Reading, level: "out" | "critical", burn: number | null): string {
  const who = r.provider === "google-flow" && r.account ? `Google Flow (${r.account})` : PROVIDERS[r.provider as ProviderId].label;
  if (level === "out") {
    switch (r.provider) {
      case "openai":
        return "OpenAI is out of credits — new films cannot be written.";
      case "google-flow":
        return `${who} has no credits left — its images and clips will fail.`;
      case "elevenlabs":
        return "ElevenLabs has no characters left — no line can be recorded.";
      case "useapi":
        return "The useapi.net subscription is not active — no image or clip can be made.";
      case "capsolver":
        return "CapSolver has no balance left — Google Flow refuses every image and clip without a captcha token.";
      case "google-drive":
        return "Google Drive is full — voiceovers cannot be saved.";
    }
  }
  const h = headlineOf(r);
  const days = daysLeft(r.value, burn);
  return `${who} is nearly out: ${h.value} ${h.caption.split(" · ")[0]}${days !== null ? ` — ${fmtDays(days)} at this pace` : ""}.`;
}

/** What the banner shows: only what will stop a film, worst first. */
export function alertsOf(readings: Reading[], burns: Map<string, number | null> = new Map(), now = Date.now()): Alert[] {
  const out: Alert[] = [];
  for (const r of readings) {
    if (!isProviderId(r.provider) || PRIMARY_METRIC[r.provider] !== r.metric) continue;
    const burn = burns.get(seriesKey(r)) ?? null;
    const level = levelOf(r, burn, now);
    if (level !== "out" && level !== "critical") continue;
    out.push({ level, provider: r.provider, account: r.account, text: alertText(r, level, burn), href: PROVIDERS[r.provider].manage.href });
  }
  const rank = (a: Alert) => (a.level === "out" ? 0 : 1) * 10 + PROVIDER_IDS.indexOf(a.provider);
  return out.sort((a, b) => rank(a) - rank(b) || a.account.localeCompare(b.account));
}

/**
 * The pace of every primary series, from its history (or, for ElevenLabs, its
 * own daily usage) — the one place both pages and the banner get it from.
 */
export function burnsOf(
  latest: Reading[],
  history: Record<string, Point[]>,
  now = Date.now(),
): Map<string, number | null> {
  const burns = new Map<string, number | null>();
  const elDaily = latest.find((r) => r.provider === "elevenlabs" && r.metric === "usage_30d");
  for (const r of latest) {
    const key = seriesKey(r);
    if (r.provider === "elevenlabs" && r.metric === "characters" && Array.isArray(elDaily?.detail?.daily)) {
      burns.set(key, burnFromDaily(elDaily.detail.daily as Point[], now));
      continue;
    }
    burns.set(key, burnPerDay(history[key] ?? [], now));
  }
  return burns;
}
