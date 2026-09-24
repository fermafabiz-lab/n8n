-- 015 — what every paid service has left, reading after reading (2026-09-24)
--
-- The producer's ask: a "Developer insights" page that shows how many credits
-- are left on every API the pipeline uses, "because we keep waking up to find
-- we have run out" — and a page that shows what each one is spent on.
--
-- The OpenAI account ran dry mid-pipeline twice (2026-08-08 and 2026-09-19,
-- CLAUDE.md) and was dry AGAIN the morning this was built; each time the only
-- signal was a film dying in scripting. A balance read once tells you where you
-- are. A balance read every hour tells you how fast it is going and when it
-- will be gone, which is the question "waking up to zero" is really asking. So
-- this is a history, not a current-value table: one row per thing that can run
-- out, per reading.
--
-- Written by n8n's "API Credits" workflow (db/port/api-credits/): hourly on a
-- schedule, and on demand when someone presses Refresh on the page (the
-- `api-credits` webhook). Read by the site (lib/insights.ts,
-- /admin/insights). Nothing else writes it.
--
--   provider   openai | elevenlabs | google-flow | useapi | google-drive
--   account    which account of that provider ('' when there is only one) —
--              the three Google Flow accounts each have their own credits
--   metric     what was measured: 'credits', 'characters', 'storage',
--              'access' (OpenAI: can a billable call be made at all),
--              'subscription', 'usage_30d', 'spend_30d'
--   value      how much is LEFT (or used, for the *_30d metrics), in `unit`
--   limit      the ceiling `value` counts down from, when the provider says
--   resets_at  when the allowance refills, when the provider says
--   status     ok | out | error | unavailable — the provider's own verdict or
--              the probe's. "Low" is NOT stored: it is a judgement about a
--              number, and the site owns it (lib/insights.ts), so changing a
--              threshold never needs a backfill.
--   detail     whatever else is worth showing (tier, the daily series behind
--              a *_30d figure). Never secrets: the useapi account record
--              carries session cookies, and only named fields are copied.
--
-- Rows older than 180 days are deleted by the writer itself.
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists api_balance (
  id         bigserial primary key,
  taken_at   timestamptz not null default now(),
  provider   text not null,
  account    text not null default '',
  metric     text not null,
  value      numeric,
  unit       text,
  "limit"    numeric,
  resets_at  timestamptz,
  status     text not null default 'ok'
             check (status in ('ok', 'out', 'error', 'unavailable')),
  note       text,
  detail     jsonb,
  source     text not null default 'schedule'
             check (source in ('schedule', 'webhook', 'manual'))
);

comment on table api_balance is
  'One reading of one thing that can run out (credits, characters, storage) on one paid '
  'service, written hourly by the n8n "API Credits" workflow and on Refresh. A history, '
  'so the site can say how fast it is going and when it will be gone. See db/015_api_balance.sql.';

-- The site asks for the newest reading of every series, and for each series'
-- history over the last month.
create index if not exists api_balance_series_idx
  on api_balance (provider, account, metric, taken_at desc);
create index if not exists api_balance_taken_idx
  on api_balance (taken_at desc);
