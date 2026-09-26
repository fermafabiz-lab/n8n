// The captcha on Developer insights and Analytics (lib/captcha.ts): what a
// solve's outcome is, which account and kind it was for, what a day sums to,
// and what the page shows — pinned against a REAL day of useapi's record
// (db/port/captcha/fixtures/, 159 attempts on 2026-09-26), whose own summary
// is the answer key, and against useapi's summaries of two days that carry
// what that one does not (refused prompts, 503s, timeouts). Plus the
// CapSolver card's judgement and the joints.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/footage-loader.mjs scripts/check-captcha.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountOf,
  costOfProviders,
  daysBetween,
  isDayComplete,
  kindOf,
  outcomeOf,
  sumDay,
  summarizeDays,
  tokenRateOf,
} from "@/lib/captcha";
import { alertsOf, headlineOf, levelOf, paceLine, PRIMARY_METRIC, PROVIDER_IDS, PROVIDERS } from "@/lib/insights";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const results = [];
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const near = (name, got, want, eps = 1e-9) => {
  const ok = Math.abs(got - want) <= eps;
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${got}, want ${want}`}`);
};

const fx = JSON.parse(readFileSync(join(root, "../db/port/captcha/fixtures/captcha-stats-2026-09-26.json"), "utf8"));
const summaries = JSON.parse(readFileSync(join(root, "../db/port/captcha/fixtures/useapi-summaries.json"), "utf8"));
const pct2 = (n, d) => Math.round((n / d) * 10000) / 100;

// ---- one attempt ----
is("200 is accepted", outcomeOf({ statusCode: 200, reason: "" }), "accepted");
is("403 unusual activity is a refused token", outcomeOf({ statusCode: 403, reason: "PUBLIC_ERROR_UNUSUAL_ACTIVITY" }), "refused");
is("429 too much traffic is its own outcome", outcomeOf({ statusCode: 429, reason: "PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC" }), "traffic");
is("429 throttled is the ACCOUNT, not the token", outcomeOf({ statusCode: 429, reason: "PUBLIC_ERROR_USER_REQUESTS_THROTTLED" }), "throttled");
is("a quota 429 is throttled too", outcomeOf({ statusCode: 429, reason: "PUBLIC_ERROR_PER_MODEL_DAILY_QUOTA_REACHED" }), "throttled");
is("high traffic is the account too", outcomeOf({ statusCode: 429, reason: "PUBLIC_ERROR_HIGH_TRAFFIC" }), "throttled");
is("a refused prompt came after the token", outcomeOf({ statusCode: 400, reason: "" }), "other");
is("a model the account lacks came after the token", outcomeOf({ statusCode: 403, reason: "PUBLIC_ERROR_MODEL_ACCESS_DENIED" }), "other");
is("a timeout came after the token", outcomeOf({ statusCode: 524, reason: "" }), "other");
is("a 503 says nothing about the token", outcomeOf({ statusCode: 503, reason: "" }), "unavailable");
is("the account is read off the job id", accountOf("j0926181252593316958v-u2923-email:fermafabiz@gmail.com-bot:google-flow"), "fermafabiz@gmail.com");
is("an address with a hyphen survives", accountOf("j1-u2-email:house-of-videos.01@gmail.com-bot:google-flow"), "house-of-videos.01@gmail.com");
is("no email, unknown", accountOf("20260203103000123-user:123-bot:google-flow"), "unknown");
is("images and videos by route", [kindOf({ route: "post-images" }), kindOf({ route: "post-videos" }), kindOf({ route: "post-voices" })], ["images", "videos", "other"]);

// ---- a real day, against useapi's own summary ----
const day = sumDay("2026-09-26", fx.data);
is("every attempt counted", day.attempts, fx.total);
is("per provider, the sample sizes useapi reports", Object.fromEntries(Object.entries(day.byProvider).map(([k, t]) => [k, t.attempts])), fx.summary.sample_size_by_provider);
is(
  "per provider, useapi's success rate to two decimals",
  Object.fromEntries(Object.entries(day.byProvider).map(([k, t]) => [k, pct2(t.passed, t.judged)])),
  fx.summary.success_rate_by_provider,
);
is("per provider, useapi's sample", Object.fromEntries(Object.entries(day.byProvider).map(([k, t]) => [k, t.judged])), fx.summary.sample_size_by_provider);
is("per tier rate agrees too (all one tier)", pct2(summarizeDays([day]).passed, summarizeDays([day]).judged), fx.summary.success_rate_by_tier.PAYGATE_TIER_TWO);
near("average solve time is useapi's to the millisecond", Math.round(day.solveMs / day.attempts), fx.summary.avg_captcha_ms, 1);
is("outcomes add up", Object.values(day.outcomes).reduce((a, b) => a + b, 0), day.attempts);
is("outcomes of that evening", day.outcomes, { accepted: 37, refused: 98, traffic: 24, throttled: 0, other: 0, unavailable: 0 });
is("three accounts", Object.keys(day.byAccount).sort(), ["fermafabiz@gmail.com", "houseofvideos01@gmail.com", "houseofvideos02@gmail.com"]);
is("images and videos", Object.fromEntries(Object.entries(day.byKind).map(([k, t]) => [k, t.attempts])), { videos: 114, images: 45 });
is("requests (jobs)", day.jobs, 58);
near("cost at useapi's table: 108 CapSolver + 51 2Captcha", costOfProviders(day.byProvider), 108 * 0.003 + 51 * 0.00299, 1e-9);

// ---- two more days, rebuilt from useapi's own summaries ----
// Both ran one attempt per request (avg_attempt 1), so the per-request status
// mix IS the attempt mix: rebuild the attempts from it, check the rebuild
// against the mix it came from, then hold the sums to useapi's success rate
// and sample. The 2026-09-26 day above has only 200/403/429s; these carry the
// cases that decided the rule — 400s and a HIGH_TRAFFIC 429 counted as
// successes, 503s left out, 524s counted, a record with no tier.
const REASONED = new Set([429]);
const rebuild = (date, requests, extra = []) => {
  const records = [];
  for (const [kind, mix] of Object.entries(requests)) {
    for (const [key, n] of Object.entries(mix)) {
      const [code, reason = code === "403" ? "PUBLIC_ERROR_UNUSUAL_ACTIVITY" : ""] = key.split(":");
      for (let i = 0; i < n; i++) {
        records.push({ jobId: `j${date}${kind}${key}${i}-email:fermafabiz@gmail.com-bot:google-flow`, provider: "CapSolver", route: `post-${kind}`, statusCode: Number(code), reason });
      }
    }
  }
  return [...records, ...extra];
};
const mixOf = (records, kind) => {
  const of = records.filter((r) => r.route === `post-${kind}`);
  const by = {};
  for (const r of of) {
    const key = REASONED.has(r.statusCode) ? `${r.statusCode}:${r.reason}` : String(r.statusCode);
    by[key] = (by[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(by).map(([k, n]) => [k, pct2(n, of.length)]));
};
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
for (const [date, requests, extra] of [
  [
    "2026-09-04",
    {
      images: { 200: 117, 400: 85, 403: 10, "429:PUBLIC_ERROR_HIGH_TRAFFIC": 1, "429:PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC": 5 },
      videos: { 200: 60, 403: 19, "429:PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC": 1 },
    },
    [],
  ],
  [
    "2026-09-17",
    {
      images: { 200: 198, 403: 1, 503: 1, 524: 2, "429:PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC": 9 },
      videos: { 200: 93, 403: 9, 503: 4, "429:PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC": 11 },
    },
    // the "(empty)" tier: one accepted request on neither route
    [{ jobId: "j0917-no-tier", provider: "CapSolver", route: "", statusCode: 200, reason: "" }],
  ],
]) {
  const u = summaries[date];
  const records = rebuild(date, requests, extra);
  is(`${date}: the rebuild is useapi's image mix`, sorted(mixOf(records, "images")), sorted(u.by_status_code_images));
  is(`${date}: …and its video mix`, sorted(mixOf(records, "videos")), sorted(u.by_status_code_videos));
  const d = sumDay(date, records);
  const t = d.byProvider.CapSolver;
  is(`${date}: useapi's sample`, t.judged, u.sample_size_by_provider.CapSolver);
  is(`${date}: useapi's success rate`, pct2(t.passed, t.judged), u.success_rate_by_provider.CapSolver);
  is(`${date}: the page's token rate is the same number`, pct2(summarizeDays([d]).passed, summarizeDays([d]).judged), u.success_rate_by_provider.CapSolver);
}
const d0904 = sumDay("2026-09-04", rebuild("2026-09-04", { images: { 200: 117, 400: 85 } }));
is("tokens accepted is not requests through", [Math.round(tokenRateOf(d0904.byProvider.CapSolver) * 100), Math.round(summarizeDays([d0904]).throughRate * 100)], [100, 58]);

// ---- the page's numbers ----
const empty = sumDay("2026-09-25", []);
const sum = summarizeDays([day, empty]);
is("two days, one empty", [sum.days, sum.attempts, sum.accepted], [2, 159, 37]);
near("tokens accepted", sum.tokenRate, 37 / 159);
near("requests that went through", sum.throughRate, 37 / 58);
near("solves per request", sum.perJob, 159 / 58);
near("cost per request that went through", sum.costPerAccepted, (108 * 0.003 + 51 * 0.00299) / 37);
is("per day, oldest first, the empty day has no rate", sum.perDay.map((d) => [new Date(d.t).toISOString().slice(0, 10), d.attempts, d.rate === null]), [
  ["2026-09-25", 0, true],
  ["2026-09-26", 159, false],
]);
is("providers most used first", sum.providers.map((p) => p.id), ["CapSolver", "2Captcha"]);
is("outcome slices in a fixed order", sum.outcomes.map((o) => o.id), ["accepted", "refused", "traffic", "throttled", "other", "unavailable"]);
is("an empty month is zeroes, not errors", [summarizeDays([]).attempts, summarizeDays([]).tokenRate, summarizeDays([]).perJob], [0, null, null]);
is("a tally with nothing judged has no rate", tokenRateOf({ passed: 0, judged: 0 }), null);

// ---- days ----
is("the days of a range, UTC", daysBetween(Date.parse("2026-09-24T23:00:00Z"), Date.parse("2026-09-26T01:00:00Z")), ["2026-09-24", "2026-09-25", "2026-09-26"]);
is("today is never complete", isDayComplete("2026-09-26", Date.parse("2026-09-26T23:59:00Z")), false);
is("yesterday is complete once useapi's latency has passed", [
  isDayComplete("2026-09-25", Date.parse("2026-09-26T00:10:00Z")),
  isDayComplete("2026-09-25", Date.parse("2026-09-26T00:25:00Z")),
], [false, true]);

// ---- the CapSolver card ----
const reading = (value, status = "ok", note = null) => ({
  provider: "capsolver",
  account: "",
  metric: "balance",
  value,
  unit: "usd",
  limit: null,
  resetsAt: null,
  status,
  note,
  detail: null,
  takenAt: new Date().toISOString(),
});
is("CapSolver is a card", PROVIDER_IDS.includes("capsolver") && PRIMARY_METRIC.capsolver === "balance" && Boolean(PROVIDERS.capsolver.manage.href), true);
is("dollars on the card", headlineOf(reading(12.3456)).value, "$12.35");
is("a healthy balance", levelOf(reading(20)), "ok");
is("under $3 is low", levelOf(reading(2.5)), "low");
is("under $1 is nearly out", levelOf(reading(0.6)), "critical");
is("zero is out", levelOf(reading(0)), "out");
is("no key yet is unknown, never an alarm", [levelOf(reading(null, "unavailable", "no key")), alertsOf([reading(null, "unavailable", "no key")]).length], ["unknown", 0]);
is("the pace is in dollars", paceLine(reading(20), 4), "About $4.00 a day — at that pace it lasts about 5 days.");
is("out raises the strip, naming what stops", alertsOf([reading(0)])[0]?.text.startsWith("CapSolver has no balance left"), true);

// ---- the joints ----
const read = (p) => readFileSync(join(root, p), "utf8");
const insights = read("app/admin/insights/page.tsx");
const analytics = read("app/admin/insights/usage/page.tsx");
is("the button says Analytics", /<Link href="\/admin\/insights\/usage" className="btn">\s*Analytics\s*<\/Link>/.test(insights), true);
is("the page is called Analytics", /title="Analytics"/.test(analytics), true);
is("nothing on screen says Where the credits go", /Where the credits go</.test(insights + analytics) || /title="Where the credits go"/.test(analytics), false);
const titles = [...analytics.matchAll(/panelTitle\}>([^<{]+)</g)].map((m) => m[1].trim());
is("the captcha charts are titled", ["Captcha — what happened to each solve", "Captcha — solves per day", "Captcha — share of tokens Google accepted, per day", "Captcha — by provider", "Captcha — by Google Flow account"].every((t) => titles.includes(t)), true);
const sync = read("lib/captcha-sync.ts");
is("the key goes only to CapSolver", /body: JSON\.stringify\(\{ clientKey: key \}\)/.test(sync) && !/note[^\n]*key\b[^\n]*\$\{key\}/.test(sync), true);
is("a day summed under the old rule is not complete", /where complete and outcomes \? 'unavailable'/.test(read("lib/data/postgres.ts")), true);
is("the tick route is behind the key", /\/api\/insights\/tick/.test(read("middleware.ts")) && /x-hov-key/.test(read("app/api/insights/tick/route.ts")), true);
const deploy = read("../.github/workflows/deploy-platform.yml");
is("the deploy carries both secrets into platform.env", ["USEAPI_TOKEN=${USEAPI_TOKEN}", "CAPSOLVER_API_KEY=${CAPSOLVER_API_KEY}"].every((l) => deploy.includes(l)) && /envs:.*USEAPI_TOKEN,CAPSOLVER_API_KEY/.test(deploy), true);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
