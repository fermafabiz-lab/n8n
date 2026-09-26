-- 020 — the captcha, day by day (2026-09-26)
--
-- The producer's ask: "add the captcha program (CapSolver) to see how much we
-- have left, and if you can add some analytics it would be great".
--
-- Every image and every clip Google Flow makes needs a reCAPTCHA Enterprise
-- token, which useapi.net buys from CapSolver with the producer's key — one
-- paid solve per ATTEMPT, whether Google then accepts the token or not. On the
-- evening of 2026-09-26 Google accepted about a third of CapSolver's tokens
-- and none of 2Captcha's, and a refused token is paid for and then retried.
-- So what the captcha costs is decided less by the price of a solve than by
-- how many solves a clip needs.
--
-- useapi keeps every attempt for three months and answers them one day at a
-- time (GET /v1/google-flow/accounts/captcha-stats?date=YYYY-MM-DD). The site
-- reads each day, sums it here, and reads the sums back for the Analytics
-- page (platform/lib/captcha.ts sums, platform/lib/captcha-sync.ts fetches).
-- The CapSolver BALANCE is not here: it is a reading like any other paid
-- service's, in hov.api_balance (provider 'capsolver', metric 'balance').
--
--   day         the UTC day useapi filed the attempts under
--   attempts    captcha solves tried that day (each one billed by its provider)
--   accepted    of those, how many Google accepted (the request then got 200)
--   by_provider { "CapSolver": {attempts, accepted, ms}, ... }   ms = summed solve time
--   by_account  { "fermafabiz@gmail.com": {attempts, accepted, ms}, ... }
--   by_kind     { "images": {...}, "videos": {...} }
--   outcomes    { "accepted": n, "refused": n, "traffic": n, "throttled": n, "other": n }
--   jobs        requests (a request retries up to captchaRetry times)
--   summary     useapi's own summary object for the day, verbatim
--   complete    the day had ended (plus useapi's 15-minute latency) when it was
--               read, so it is never read again
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists captcha_day (
  day          date        primary key,
  attempts     integer     not null default 0,
  accepted     integer     not null default 0,
  jobs         integer     not null default 0,
  solve_ms     bigint      not null default 0,
  by_provider  jsonb       not null default '{}'::jsonb,
  by_account   jsonb       not null default '{}'::jsonb,
  by_kind      jsonb       not null default '{}'::jsonb,
  outcomes     jsonb       not null default '{}'::jsonb,
  summary      jsonb,
  complete     boolean     not null default false,
  fetched_at   timestamptz not null default now()
);

comment on table captcha_day is
  'One day of captcha solves as useapi.net recorded them, summed by provider, Flow account and '
  'kind (images/videos), for the Analytics page. See db/020_captcha_day.sql.';
