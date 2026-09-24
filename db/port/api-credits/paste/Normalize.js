// Every provider's answer, reduced to one row per thing that can run out
// (db/015_api_balance.sql says what each column means).
//
// Each probe before this one runs with `neverError` + `fullResponse`, so every
// answer arrives as {statusCode, headers, body}: a refusal is data to record,
// not an exception that stops the run and leaves the page with nothing. A
// probe that failed outright (DNS, timeout) arrives as {error} and is recorded
// the same way.
//
// Only named fields are copied. The useapi account record carries Google
// session cookies and an access token (redacted by useapi, but still), and
// none of that belongs in a table the site reads.
//
// "Low" is NOT decided here. A reading carries the provider's own verdict —
// ok / out / error / unavailable — and the numbers; the site owns the
// judgement (platform/lib/insights.ts), so a threshold changes without a
// republish and without a backfill.

const read = (name) => {
  try {
    const j = $(name).first().json;
    return j && typeof j === 'object' ? j : null;
  } catch (e) {
    return null;
  }
};
const clip = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 300);
const message = (res) => {
  if (!res) return 'The probe did not run.';
  if (res.error) return clip(res.error.message || res.error);
  const b = res.body;
  if (b && typeof b === 'object') {
    const e = b.error;
    if (typeof e === 'string') return clip(e);
    if (e && typeof e === 'object') return clip(e.message || e.type || JSON.stringify(e));
    if (b.detail) return clip(typeof b.detail === 'string' ? b.detail : b.detail.message || JSON.stringify(b.detail));
  }
  if (typeof b === 'string' && b.trim()) return clip(b);
  return 'HTTP ' + res.statusCode;
};
const ok = (res) => Boolean(res && res.statusCode === 200 && res.body && typeof res.body === 'object');
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const readings = [];
const add = (r) =>
  readings.push(
    Object.assign(
      { account: '', value: null, unit: null, limit: null, resets_at: null, status: 'ok', note: null, detail: null },
      r,
    ),
  );

// ---- OpenAI ------------------------------------------------------------------
// The balance itself cannot be read with an API key: /dashboard/billing/
// credit_grants answers 403 "must be made with a session key (that is, it can
// only be made from the browser)". What CAN be asked is the question that
// matters: will a billable call go through? A one-token completion costs a
// fraction of a cent, and an empty account answers 429 with
// `credit_balance_exhausted` — the error every film has died of when this ran
// dry (2026-08-08, 2026-09-19, and the morning this was built).
const ping = read('OpenAI Ping');
if (!ping) {
  add({ provider: 'openai', metric: 'access', status: 'error', note: 'The probe did not run.' });
} else if (ping.statusCode === 200) {
  add({ provider: 'openai', metric: 'access', value: 1, unit: 'bool' });
} else {
  const e = (ping.body && typeof ping.body === 'object' && ping.body.error) || {};
  const code = String((e && (e.code || e.type)) || '');
  const out =
    /insufficient_quota|credit_balance_exhausted|billing_hard_limit/.test(code) ||
    /no credits|exceeded your current quota/i.test(String((e && e.message) || ''));
  add({
    provider: 'openai',
    metric: 'access',
    value: out ? 0 : null,
    unit: 'bool',
    status: out ? 'out' : 'error',
    note: message(ping),
    detail: { httpStatus: ping.statusCode === undefined ? null : ping.statusCode, code: code || null },
  });
}

// What it spent, per day and per model. Readable only when the key carries the
// `api.usage.read` scope; without it OpenAI answers 403 "Missing scopes", which
// is recorded as `unavailable` so the page can say which permission to grant.
const costs = read('OpenAI Costs');
if (ok(costs) && Array.isArray(costs.body.data)) {
  const daily = [];
  const byItem = {};
  let total = 0;
  for (const bucket of costs.body.data) {
    let day = 0;
    for (const r of bucket.results || []) {
      const v = num(r && r.amount && r.amount.value) || 0;
      day += v;
      const k = (r && r.line_item) || 'other';
      byItem[k] = (byItem[k] || 0) + v;
    }
    total += day;
    daily.push({ t: (num(bucket.start_time) || 0) * 1000, v: Math.round(day * 10000) / 10000 });
  }
  for (const k of Object.keys(byItem)) byItem[k] = Math.round(byItem[k] * 10000) / 10000;
  add({
    provider: 'openai',
    metric: 'spend_30d',
    value: Math.round(total * 100) / 100,
    unit: 'usd',
    detail: { daily, byItem },
  });
} else {
  add({
    provider: 'openai',
    metric: 'spend_30d',
    status: 'unavailable',
    note: message(costs),
    detail: { httpStatus: costs && costs.statusCode !== undefined ? costs.statusCode : null },
  });
}

// ---- ElevenLabs --------------------------------------------------------------
// Characters left this billing month, and the moment they come back.
const sub = read('ElevenLabs Subscription');
if (ok(sub)) {
  const b = sub.body;
  const used = num(b.character_count) || 0;
  const limit = num(b.character_limit);
  const reset = num(b.next_character_count_reset_unix);
  const lapsed = Boolean(b.status && b.status !== 'active');
  add({
    provider: 'elevenlabs',
    metric: 'characters',
    value: limit === null ? null : Math.max(0, limit - used),
    unit: 'characters',
    limit,
    resets_at: reset ? new Date(reset * 1000).toISOString() : null,
    status: lapsed ? 'error' : limit !== null && used >= limit ? 'out' : 'ok',
    note: lapsed ? 'Subscription status: ' + b.status : null,
    detail: {
      tier: b.tier || null,
      used,
      subscription: b.status || null,
      nextInvoiceCents: b.next_invoice ? num(b.next_invoice.amount_due_cents) : null,
    },
  });
} else {
  add({ provider: 'elevenlabs', metric: 'characters', status: 'error', note: message(sub) });
}

// Characters per day over the last 30, as ElevenLabs itself counted them.
const stats = read('ElevenLabs Usage');
if (ok(stats) && Array.isArray(stats.body.time)) {
  const usage = stats.body.usage || {};
  const series = usage.All || Object.values(usage)[0] || [];
  const daily = stats.body.time.map((t, i) => ({ t: num(t), v: num(series[i]) || 0 }));
  add({
    provider: 'elevenlabs',
    metric: 'usage_30d',
    value: daily.reduce((s, d) => s + d.v, 0),
    unit: 'characters',
    detail: { daily },
  });
}

// ---- Google Drive ------------------------------------------------------------
// Voiceovers and render intermediates are stored here.
const drive = read('Drive About');
if (ok(drive) && drive.body.storageQuota) {
  const q = drive.body.storageQuota;
  const limit = num(q.limit); // absent on an unlimited plan
  const usage = num(q.usage) || 0;
  add({
    provider: 'google-drive',
    account: (drive.body.user && drive.body.user.emailAddress) || '',
    metric: 'storage',
    value: limit === null ? null : Math.max(0, limit - usage),
    unit: 'bytes',
    limit,
    status: limit !== null && usage >= limit ? 'out' : 'ok',
    detail: { usage },
  });
} else {
  add({ provider: 'google-drive', metric: 'storage', status: 'error', note: message(drive) });
}

// ---- useapi — the door to Google Flow ----------------------------------------
// Its own subscription: when it lapses, every image and every clip stops.
const me = read('useapi Account');
if (ok(me)) {
  const b = me.body;
  const flow = (b.accounts && b.accounts['Google Flow API']) || null;
  add({
    provider: 'useapi',
    account: b.email || '',
    metric: 'subscription',
    value: b.subscriptionIsActive ? 1 : 0,
    unit: 'bool',
    status: b.subscriptionIsActive ? 'ok' : 'out',
    note: b.subscriptionIsActive ? null : 'The useapi.net subscription is not active.',
    detail: {
      sub: b.sub || null,
      accountsActive: flow ? num(flow.active) : null,
      accountsTotal: flow ? num(flow.total) : null,
      updated: b.updated || null,
    },
  });
} else {
  add({ provider: 'useapi', metric: 'subscription', status: 'error', note: message(me) });
}

// ---- Google Flow — credits per account -----------------------------------------
// Each account has its own allowance. The list says whether an account is
// healthy — a signed-out account is SILENT everywhere else (CLAUDE.md) — and
// each account's own record carries its credits.
const list = read('Flow Accounts');
const health = ok(list) ? list.body : {};
let emails = [];
let answers = [];
try {
  emails = $('Flow Emails').all().map((i) => i.json.email);
} catch (e) {
  emails = [];
}
try {
  answers = $('Flow Account').all().map((i) => i.json);
} catch (e) {
  answers = [];
}
if (!ok(list)) add({ provider: 'google-flow', metric: 'credits', status: 'error', note: message(list) });
emails.forEach((email, i) => {
  if (!email) return;
  const res = answers[i] || null;
  const h = health[email] || {};
  const state = String(h.health || h.error || (res && res.body && res.body.health) || 'unknown');
  if (!ok(res)) {
    add({ provider: 'google-flow', account: email, metric: 'credits', status: 'error', note: message(res), detail: { health: state } });
    return;
  }
  const c = res.body.credits || {};
  const credits = num(c.credits);
  const healthy = state === 'OK';
  add({
    provider: 'google-flow',
    account: email,
    metric: 'credits',
    value: credits,
    unit: 'credits',
    status: !healthy ? 'error' : credits !== null && credits <= 0 ? 'out' : 'ok',
    note: healthy ? null : clip(state),
    detail: {
      health: state,
      tier: c.userPaygateTier || null,
      sku: c.sku || null,
      serviceTier: c.serviceTier || null,
      subscriptionCredits: num(c.subscriptionCredits),
      nextRefresh: (h.nextRefresh && h.nextRefresh.scheduledFor) || null,
      sessionExpires: (h.sessionData && h.sessionData.expires) || null,
    },
  });
});

// ---- the write ---------------------------------------------------------------
let source = 'schedule';
try {
  if ($('Credits Webhook').isExecuted) source = 'webhook';
} catch (e) {
  source = 'schedule';
}

// ONE literal the database decodes — the repo's write mechanism (base64, never
// a value spliced into SQL text; docs/lessons-n8n.md). `source` is one of two
// constants above, never input.
const b64 = Buffer.from(JSON.stringify(readings), 'utf8').toString('base64');
const sql = [
  'insert into hov.api_balance (provider, account, metric, value, unit, "limit", resets_at, status, note, detail, source)',
  "select r.provider, coalesce(r.account, ''), r.metric, r.value, r.unit, r.\"limit\", r.resets_at, coalesce(r.status, 'ok'), r.note, r.detail, '" +
    source +
    "'",
  "  from jsonb_to_recordset(convert_from(decode('" + b64 + "', 'base64'), 'UTF8')::jsonb)",
  '    as r(provider text, account text, metric text, value numeric, unit text, "limit" numeric, resets_at timestamptz, status text, note text, detail jsonb);',
  "delete from hov.api_balance where taken_at < now() - interval '180 days';",
].join('\n');

return [{ json: { takenAt: new Date().toISOString(), source, readings, sql } }];
