// The "API Credits" workflow's Code-node bodies (paste/), run against the REAL
// answers every provider gave on 2026-09-24 (fixtures/2026-09-24.json,
// sanitised: cookies and tokens replaced by the redacted markers useapi itself
// prints) — with no n8n and no network.
//
// The failure this exists for is silent: a provider changes a field name, the
// body reads undefined, and the page calmly shows "—" where "OUT OF CREDITS"
// should be. Worse, the useapi account record carries session cookies, and a
// careless copy would land them in a table the site reads.
//
//   node db/port/api-credits/check.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;
const fails = [];
const is = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
    console.log(`OK   ${label} -> ${JSON.stringify(got)}`);
  } else {
    fails.push(label);
    console.log(`FAIL ${label} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
};

const body = (name) => readFileSync(join(here, "paste", `${name}.js`), "utf8");
const fx = JSON.parse(readFileSync(join(here, "fixtures", "2026-09-24.json"), "utf8"));

// n8n's `$('Node')`, from a map of node name → json (or array of json). A node
// absent from the map is one that did not run, as in n8n.
const make$ = (map) => (name) => {
  if (!(name in map)) {
    const unexecuted = () => {
      throw new Error(`Referenced node is unexecuted: ${name}`);
    };
    return { first: unexecuted, all: unexecuted, isExecuted: false };
  }
  const v = map[name];
  const list = Array.isArray(v) ? v : [v];
  return { first: () => ({ json: list[0] }), all: () => list.map((json) => ({ json })), isExecuted: true };
};
const run = (name, map) => new Function("$", "Buffer", body(name))(make$(map), Buffer);

// ---- Flow Emails ---------------------------------------------------------------
const emails = run("Flow Emails", { "Flow Accounts": fx["Flow Accounts"] }).map((i) => i.json.email);
is("one item per Flow account, sorted", emails, ["fermafabiz@gmail.com", "houseofvideos01@gmail.com", "houseofvideos02@gmail.com"]);
is(
  "useapi down: one item with no email, so the run carries on",
  run("Flow Emails", { "Flow Accounts": { statusCode: 401, body: { error: "Unauthorized" } } }).map((i) => i.json.email),
  [null],
);

// ---- Normalize on the real answers -------------------------------------------------
const one = fx["Flow Account"];
const withCredits = (n) => ({ ...one, body: { ...one.body, credits: { ...one.body.credits, credits: n } } });
const base = {
  "Credits Webhook": { body: {} },
  "OpenAI Ping": fx["OpenAI Ping"],
  "OpenAI Costs": fx["OpenAI Costs"],
  "ElevenLabs Subscription": fx["ElevenLabs Subscription"],
  "ElevenLabs Usage": fx["ElevenLabs Usage"],
  "Drive About": fx["Drive About"],
  "useapi Account": fx["useapi Account"],
  "Flow Accounts": fx["Flow Accounts"],
  "Flow Emails": emails.map((email) => ({ email })),
  "Flow Account": [withCredits(23100), withCredits(21950), withCredits(0)],
};
const out = run("Normalize", base)[0].json;
const r = (provider, metric, account = "") =>
  out.readings.find((x) => x.provider === provider && x.metric === metric && (account === null || x.account === account));

is("OpenAI out of credits is read as OUT, not as an error", [r("openai", "access").status, r("openai", "access").value], ["out", 0]);
is("…with OpenAI's own words", /no credits remaining/.test(r("openai", "access").note), true);
is("…and its code", r("openai", "access").detail.code, "credit_balance_exhausted");
is("spend without the usage scope is unavailable, saying which scope", [r("openai", "spend_30d").status, /api\.usage\.read/.test(r("openai", "spend_30d").note)], ["unavailable", true]);

const el = r("elevenlabs", "characters");
is("ElevenLabs: characters LEFT, not used", [el.value, el.limit, el.detail.used], [131000 - 79280, 131000, 79280]);
is("…with the reset moment", el.resets_at, new Date(1790521107 * 1000).toISOString());
is("…tier and ok", [el.detail.tier, el.status], ["creator", "ok"]);
const usage = r("elevenlabs", "usage_30d");
is("ElevenLabs daily usage kept, one point per day", [usage.detail.daily.length, usage.value], [31, fx["ElevenLabs Usage"].body.usage.All.reduce((s, v) => s + v, 0)]);

const drv = r("google-drive", "storage", null);
is("Drive: storage left against the quota", [drv.value, drv.limit, drv.account], [32985348833280 - 10364750054, 32985348833280, "fermafabiz@gmail.com"]);
is("useapi subscription active", [r("useapi", "subscription", null).status, r("useapi", "subscription", null).value], ["ok", 1]);

const flow = out.readings.filter((x) => x.provider === "google-flow");
is("one credits reading per Flow account", flow.map((x) => [x.account, x.value, x.status]), [
  ["fermafabiz@gmail.com", 23100, "ok"],
  ["houseofvideos01@gmail.com", 21950, "ok"],
  ["houseofvideos02@gmail.com", 0, "out"],
]);
is("…with tier and the next session refresh", [flow[1].detail.tier, flow[1].detail.nextRefresh], ["PAYGATE_TIER_TWO", fx["Flow Accounts"].body["houseofvideos01@gmail.com"].nextRefresh.scheduledFor]);

const text = JSON.stringify(out.readings);
is("NO cookie, token or session value reaches a reading", ["redacted", "SID", "access_token", "ya29", "Cookies"].filter((s) => text.includes(s)), []);

// ---- the failures that matter ---------------------------------------------------------
const signedOut = run("Normalize", {
  ...base,
  "Flow Accounts": {
    statusCode: 200,
    body: { ...fx["Flow Accounts"].body, "houseofvideos01@gmail.com": { error: "Google has signed your account out. Reconnect at https://useapi.net/docs/start-here/setup-google-flow" } },
  },
})[0].json.readings.find((x) => x.account === "houseofvideos01@gmail.com");
is("a signed-out Flow account is an error even though its credits read fine", [signedOut.status, /signed your account out/.test(signedOut.note), signedOut.value], ["error", true, 21950]);

const down = run("Normalize", {
  ...base,
  "OpenAI Ping": { error: { message: "getaddrinfo ENOTFOUND api.openai.com" } },
  "ElevenLabs Subscription": { statusCode: 401, body: { detail: { status: "invalid_api_key", message: "Invalid API key" } } },
  "Flow Account": [withCredits(23100), { statusCode: 500, body: "upstream timeout" }, withCredits(5)],
})[0].json.readings;
const f = (p, m, a = "") => down.find((x) => x.provider === p && x.metric === m && x.account === a);
is("a network failure is an error with its reason, not OUT", [f("openai", "access").status, f("openai", "access").note], ["error", "getaddrinfo ENOTFOUND api.openai.com"]);
is("an invalid ElevenLabs key says so", [f("elevenlabs", "characters").status, f("elevenlabs", "characters").note], ["error", "Invalid API key"]);
is("one Flow account failing does not take the others with it", down.filter((x) => x.provider === "google-flow").map((x) => x.status), ["ok", "error", "ok"]);
is("…and says what it answered", f("google-flow", "credits", "houseofvideos01@gmail.com").note, "upstream timeout");

const rateLimited = run("Normalize", { ...base, "OpenAI Ping": { statusCode: 429, body: { error: { message: "Rate limit reached for gpt-4o-mini", type: "requests", code: "rate_limit_exceeded" } } } })[0].json;
is("a rate limit is NOT mistaken for an empty account", rateLimited.readings.find((x) => x.metric === "access").status, "error");

// OpenAI's costs endpoint, in the shape its API reference documents (grant the
// key `api.usage.read` and this is what comes back).
const withSpend = run("Normalize", {
  ...base,
  "OpenAI Costs": {
    statusCode: 200,
    body: {
      object: "page",
      data: [
        { object: "bucket", start_time: 1790035200, end_time: 1790121600, results: [{ object: "organization.costs.result", amount: { value: 1.25, currency: "usd" }, line_item: "gpt-5.4, input" }, { object: "organization.costs.result", amount: { value: 3.5, currency: "usd" }, line_item: "gpt-5.4, output" }] },
        { object: "bucket", start_time: 1790121600, end_time: 1790208000, results: [{ object: "organization.costs.result", amount: { value: 0.75, currency: "usd" }, line_item: "gpt-5.4, input" }] },
      ],
      has_more: false,
    },
  },
})[0].json.readings.find((x) => x.metric === "spend_30d");
is("spend is summed per day and per model", [withSpend.status, withSpend.value, withSpend.detail.daily.map((d) => d.v), withSpend.detail.byItem], ["ok", 5.5, [4.75, 0.75], { "gpt-5.4, input": 2, "gpt-5.4, output": 3.5 }]);

// ---- the write ------------------------------------------------------------------------
const b64 = out.sql.match(/decode\('([A-Za-z0-9+/=]+)', 'base64'\)/)[1];
is("the SQL carries the readings as ONE base64 literal", JSON.parse(Buffer.from(b64, "base64").toString("utf8")).length, out.readings.length);
is("no $<digit> and no {{ in the SQL (n8n would read them)", [/\$\d/.test(out.sql), out.sql.includes("{{")], [false, false]);
const { ["Credits Webhook"]: _hook, ...fromSchedule } = base;
is("the run says where it came from", [out.source, run("Normalize", fromSchedule)[0].json.source], ["webhook", "schedule"]);
is("old readings are pruned by the writer", /delete from hov\.api_balance where taken_at < now\(\) - interval '180 days'/.test(out.sql), true);

// ---- Result ---------------------------------------------------------------------------
const res = (save) => run("Result", { Normalize: out, "Save Snapshot": save })[0].json;
is("Result answers with the readings and saved: true", [res({ success: true }).saved, res({ success: true }).readings.length], [true, out.readings.length]);
is("…and says so when the write failed", [res({ error: { message: 'relation "hov.api_balance" does not exist' } }).saved, res({ error: { message: 'relation "hov.api_balance" does not exist' } }).saveError], [false, 'relation "hov.api_balance" does not exist']);

// ---- the site reads what this writes ----------------------------------------------------
const lib = readFileSync(join(here, "..", "..", "..", "platform", "lib", "insights.ts"), "utf8");
for (const p of ["openai", "elevenlabs", "google-flow", "useapi", "google-drive"]) {
  is(`the site knows provider ${p}`, lib.includes(`"${p}"`), true);
}
const sql = readFileSync(join(here, "..", "..", "015_api_balance.sql"), "utf8");
is("every status the body writes is one the table accepts", ["ok", "out", "error", "unavailable"].every((s) => sql.includes(`'${s}'`)), true);

console.log(`\n${pass}/${pass + fails.length} passed`);
process.exit(fails.length ? 1 : 0);
