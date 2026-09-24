// Developer insights (lib/insights.ts): the judgement over the hourly readings
// n8n writes into hov.api_balance — what is low, how fast a balance falls,
// when it is gone, and what the strip on every page says — pinned against
// fixtures, plus the joints that carry it to the screen.
//
// The n8n half (the node bodies that WRITE the readings) is
// db/port/api-credits/check.mjs (`npm run check:api-credits-node`).
//
//   node --experimental-strip-types --no-warnings --import ./scripts/footage-loader.mjs scripts/check-insights.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  alertsOf,
  burnFromDaily,
  burnPerDay,
  burnsOf,
  ceilingOf,
  combinedDailyDrops,
  dailyDrops,
  daysLeft,
  fmtBytes,
  fmtDays,
  fractionLeft,
  headlineOf,
  isStale,
  levelOf,
  paceLine,
  PRIMARY_METRIC,
  PROVIDER_IDS,
  seriesKey,
} from "@/lib/insights";
import { filmCost, MONTHLY_CREDITS } from "@/lib/cost";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const reading = (over) => ({
  provider: "elevenlabs",
  account: "",
  metric: "characters",
  value: 51720,
  unit: "characters",
  limit: 131000,
  resetsAt: null,
  status: "ok",
  note: null,
  detail: null,
  takenAt: new Date(NOW - 10 * 60_000).toISOString(),
  ...over,
});

// ------------------------------------------------------------------ the pace
const hourly = (from, n, start, perHour) => Array.from({ length: n }, (_, i) => ({ t: from + i * H, v: start - i * perHour }));
is("burn: a steady fall of 100 an hour is 2,400 a day", Math.round(burnPerDay(hourly(NOW - 24 * H, 25, 20000, 100), NOW)), 2400);
is("…a refill in the middle is not negative spending", Math.round(burnPerDay([
  { t: NOW - 24 * H, v: 1000 },
  { t: NOW - 12 * H, v: 400 },
  { t: NOW - 11 * H, v: 25050 },
  { t: NOW, v: 24450 },
], NOW)), 1200);
is("…less than six hours of history is not a rate", burnPerDay(hourly(NOW - 5 * H, 6, 1000, 10), NOW), null);
is("…and readings older than the week do not count", Math.round(burnPerDay([{ t: NOW - 30 * D, v: 90000 }, ...hourly(NOW - 24 * H, 25, 20000, 50)], NOW)), 1200);
is("daily usage: the mean of the last 7 COMPLETE days, today left out", burnFromDaily([
  ...Array.from({ length: 10 }, (_, i) => ({ t: Date.UTC(2026, 8, 14 + i), v: i < 3 ? 99999 : 700 })),
  { t: Date.UTC(2026, 8, 24), v: 5 },
], NOW), 700);
is("days left", [daysLeft(1000, 250), daysLeft(1000, 0), daysLeft(null, 3)], [4, null, null]);
is("drops are filed by day, rises count as zero", dailyDrops([
  { t: Date.UTC(2026, 8, 22, 10), v: 1000 },
  { t: Date.UTC(2026, 8, 22, 20), v: 900 },
  { t: Date.UTC(2026, 8, 23, 1), v: 25000 },
  { t: Date.UTC(2026, 8, 23, 9), v: 24800 },
]), [{ t: Date.UTC(2026, 8, 22), v: 100 }, { t: Date.UTC(2026, 8, 23), v: 200 }]);
is("the Flow accounts are one budget per day", combinedDailyDrops([
  [{ t: Date.UTC(2026, 8, 23, 1), v: 100 }, { t: Date.UTC(2026, 8, 23, 2), v: 90 }],
  [{ t: Date.UTC(2026, 8, 23, 1), v: 50 }, { t: Date.UTC(2026, 8, 23, 5), v: 20 }],
]), [{ t: Date.UTC(2026, 8, 23), v: 40 }]);

// ------------------------------------------------------------------ the judgement
is("OpenAI out is OUT", levelOf(reading({ provider: "openai", metric: "access", value: 0, unit: "bool", status: "out" }), null, NOW), "out");
is("OpenAI with credits is OK", levelOf(reading({ provider: "openai", metric: "access", value: 1, unit: "bool", limit: null }), null, NOW), "ok");
is("a probe error is a Problem, never OK", levelOf(reading({ status: "error", value: null }), null, NOW), "error");
is("spend without the scope is Unknown", levelOf(reading({ metric: "spend_30d", status: "unavailable", value: null }), null, NOW), "unknown");
is("39% left, no pace: OK", levelOf(reading(), null, NOW), "ok");
is("12% left: Low", levelOf(reading({ value: 15720 }), null, NOW), "low");
is("4% left: Nearly out", levelOf(reading({ value: 5240 }), null, NOW), "critical");
is("zero left: Out", levelOf(reading({ value: 0 }), null, NOW), "out");
is("plenty left but gone in 4 days at this pace: Low", levelOf(reading({ value: 40000 }), 10000, NOW), "low");
is("…gone in 1.5 days: Nearly out", levelOf(reading({ value: 15000, limit: 30000 }), 10000, NOW), "critical");
is("…unless it refills first", levelOf(reading({ value: 15000, limit: 30000, resetsAt: new Date(NOW + 1 * D).toISOString() }), 10000, NOW), "ok");
is("Flow credits are judged against the monthly allowance", [ceilingOf(reading({ provider: "google-flow", metric: "credits", limit: null, value: 2000 })), levelOf(reading({ provider: "google-flow", metric: "credits", limit: null, value: 2000, unit: "credits" }), null, NOW)], [MONTHLY_CREDITS, "low"]);
is("a signed-out Flow account is a Problem even with credits", levelOf(reading({ provider: "google-flow", metric: "credits", limit: null, value: 21950, status: "error" }), null, NOW), "error");
is("fraction left", [fractionLeft(reading()), fractionLeft(reading({ limit: null }))].map((f) => (f === null ? null : Math.round(f * 100))), [39, null]);

// ------------------------------------------------------------------ words
is("bytes as Google counts them", [fmtBytes(32985348833280), fmtBytes(10364750054), fmtBytes(512)], ["30 TB", "9.7 GB", "512 B"]);
is("days", [fmtDays(0.4), fmtDays(1.2), fmtDays(6.6), fmtDays(400)], ["less than a day", "about a day", "about 7 days", "months"]);
is("OpenAI out, in words", headlineOf(reading({ provider: "openai", metric: "access", value: 0, unit: "bool" })).value, "Out of credits");
is("ElevenLabs, in words", headlineOf(reading()), { value: "51,720", caption: "characters left of 131,000 this month" });
is("Drive, in words", headlineOf(reading({ provider: "google-drive", metric: "storage", unit: "bytes", value: 32974984083226, limit: 32985348833280, detail: { usage: 10364750054 } })).value, "30 TB free");
is("pace, in words", paceLine(reading({ value: 12000 }), 1000, NOW), "About 1,000 a day — at that pace it lasts about 12 days.");
is("…with a refill first", paceLine(reading({ value: 12000, resetsAt: new Date(NOW + 2 * D).toISOString() }), 1000, NOW), "About 1,000 a day — it refills before it runs out.");

// ------------------------------------------------------------------ the strip
const live = [
  reading({ provider: "openai", metric: "access", value: 0, unit: "bool", limit: null, status: "out" }),
  reading({ provider: "openai", metric: "spend_30d", value: null, status: "unavailable" }),
  reading(),
  reading({ provider: "google-flow", account: "b@x", metric: "credits", unit: "credits", limit: null, value: 900 }),
  reading({ provider: "google-flow", account: "a@x", metric: "credits", unit: "credits", limit: null, value: 21950 }),
  reading({ provider: "useapi", metric: "subscription", value: 1, unit: "bool", limit: null }),
];
const alerts = alertsOf(live, new Map(), NOW);
is("the strip carries only what will stop a film, worst first", alerts.map((a) => [a.level, a.provider, a.account]), [
  ["out", "openai", ""],
  ["critical", "google-flow", "b@x"],
]);
is("…in words the producer can act on", alerts[0].text, "OpenAI is out of credits — new films cannot be written.");
is("…naming the account", /^Google Flow \(b@x\) is nearly out: 900 credits left/.test(alerts[1].text), true);
is("…with where to fix it", alerts[0].href.startsWith("https://platform.openai.com/"), true);
is("a secondary metric never raises the strip", alertsOf([reading({ metric: "usage_30d", value: 0 })], new Map(), NOW).length, 0);
is("stale after three hours", [isStale(new Date(NOW - 2 * H).toISOString(), NOW), isStale(new Date(NOW - 4 * H).toISOString(), NOW), isStale(null, NOW)], [false, true, true]);
const burns = burnsOf(
  [reading(), reading({ metric: "usage_30d", value: 7000, detail: { daily: Array.from({ length: 8 }, (_, i) => ({ t: Date.UTC(2026, 8, 16 + i), v: 1000 })) } })],
  {},
  NOW,
);
is("ElevenLabs' pace comes from its own daily count", burns.get(seriesKey(reading())), 1000);
is("every provider has a primary metric", PROVIDER_IDS.every((p) => typeof PRIMARY_METRIC[p] === "string"), true);

// ------------------------------------------------------------------ one pricing rule
const scenes = [
  { order: 1, videoUrl: "v", imageUrl: "i", voiceUrl: "a", narration: "x".repeat(40), versions: [{ kind: "video" }, { kind: "image" }] },
  { order: 102, videoUrl: "v", imageUrl: "i", voiceUrl: "a", narration: "y".repeat(60), versions: [] },
];
const counted = [
  { order: 1, videoUrl: "v", imageUrl: "i", voiceUrl: "a", narrationLength: 40, videoDrafts: 1, imageDrafts: 1 },
  { order: 102, videoUrl: "v", imageUrl: "i", voiceUrl: "a", narrationLength: 60, videoDrafts: 0, imageDrafts: 0 },
];
is("filmCost from SQL counts equals filmCost from scenes", filmCost(counted, { videoModel: "veo-3.1-fast" }), filmCost(scenes, { videoModel: "veo-3.1-fast" }));
is("…and prices the hook on the best model", filmCost(counted, { videoModel: "veo-3.1-fast" }).credits, 2 * 100 + 10);

// ------------------------------------------------------------------ the joints
const read = (...p) => readFileSync(join(root, ...p), "utf8");
const hub = read("app", "admin", "page.tsx");
const layout = read("app", "layout.tsx");
const route = read("app", "api", "insights", "alert", "route.ts");
const actions = read("app", "actions.ts");
const data = read("lib", "data.ts");
const pg = read("lib", "data", "postgres.ts");
const page = read("app", "admin", "insights", "page.tsx");
const usage = read("app", "admin", "insights", "usage", "page.tsx");
const wf = readFileSync(join(root, "..", "db", "port", "api-credits", "api-credits.workflow.js"), "utf8");

is("Settings has the Developer insights card", /href: "\/admin\/insights",\s+label: "Developer insights"/.test(hub), true);
is("…red when anything is out or nearly out", /alertsOf\(d\.latest, burnsOf\(d\.latest, d\.history\)\)\.length/.test(hub), true);
is("every page carries the strip", /<CreditsAlert \/>/.test(layout), true);
is("the strip's route judges with the same rule", /alertsOf\(data\.latest, burnsOf\(data\.latest, data\.history, now\), now\)/.test(route), true);
is("Check now calls the webhook n8n registers", /replace\(\/new-project\\\/\?\$\/, "api-credits"\)/.test(actions) && /path: 'api-credits'/.test(wf), true);
is("…with the key n8n checks", /"x-hov-key": key/.test(actions) && /authentication: 'headerAuth'/.test(wf) && /HOV Media Ingest/.test(wf), true);
is("the committed workflow never holds the real token", /Bearer __USEAPI_TOKEN__/.test(wf) && !/user:\d+-/.test(wf), true);
is("the readers wait for db/015", /if \(!\(await tableReady\("hov\.api_balance"\)\)\) return \{ ready: false/.test(pg), true);
is("demo mode shows no made-up balance", /return \{ ready: false, latest: \[\], history: \{\} \};/.test(data), true);
is("the page says when the hourly check has stopped", /the hourly check has stopped reporting/.test(page), true);
is("the page links to where the credits go", /href="\/admin\/insights\/usage"/.test(page), true);
is("usage prices films with the one rule", /filmCost\(f\.scenes, \{ videoModel: f\.videoModel, lengthSeconds: f\.lengthSeconds \}\)/.test(usage), true);

// Keep this LAST (see check-watermark.mjs).
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
