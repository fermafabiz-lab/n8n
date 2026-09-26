-- 019 — what OpenAI was asked, call by call (2026-09-26)
--
-- The producer's ask: after the last top-up the OpenAI credits went very fast,
-- "și aș vrea să știu ce a consumat și cât" — what used them, and how much.
--
-- OpenAI cannot answer that for the key n8n holds: its request log needs a
-- browser session, nothing is stored for the chat completions list, and its
-- usage endpoints want a permission the key lacks — and even with it, OpenAI
-- counts per MODEL, never per pipeline step. n8n is the one place that knows
-- which step asked, so the site reads every finished execution once and writes
-- down every OpenAI call in it (lib/openai-usage.ts parses, lib/openai-collect.ts
-- fetches and stores). The usage page reads it back.
--
--   openai_call  one row per call: the node that called, the STEP that asked
--                (the agent a model sub-node served, or the HTTP node itself),
--                the film, the model, the tokens, and the price at the time
--                (USD, list price — lib/openai-usage.ts PRICES).
--                `measured` is true when OpenAI's own usage figures were in the
--                reply (a raw HTTP call), false when they are n8n's estimate
--                (a model sub-node: the prompt as n8n counted it, the answer
--                measured off its text or the agent's output).
--                `web_search`: the model could search the web — the searches
--                and the pages they read are NOT in the numbers.
--   openai_scan  one row per execution already read, so each is read once.
--                `calls` = 0 is an answer too (a run with nothing to count, or
--                one whose data n8n no longer keeps).
--
-- project_id is not a foreign key on purpose: a deleted film keeps its bill.
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists openai_call (
  execution_id      bigint      not null,
  node              text        not null,
  run_index         integer     not null,
  item_index        integer     not null default 0,
  workflow_id       text        not null,
  workflow_name     text        not null default '',
  step              text        not null,
  project_id        text,
  scene_id          text,
  model             text        not null default '',
  at                timestamptz not null,
  input_tokens      integer     not null default 0,
  cached_tokens     integer     not null default 0,
  output_tokens     integer     not null default 0,
  reasoning_tokens  integer     not null default 0,
  web_search        boolean     not null default false,
  web_search_calls  integer     not null default 0,
  measured          boolean     not null,
  cost_usd          numeric(12, 6) not null default 0,
  primary key (execution_id, node, run_index, item_index)
);

comment on table openai_call is
  'One OpenAI call made by an n8n execution: which step asked, for which film, with which '
  'model, how many tokens and what it cost at list price. Read out of n8n executions by the '
  'site (lib/openai-collect.ts). See db/019_openai_usage.sql.';

create index if not exists openai_call_at_idx on openai_call (at desc);
create index if not exists openai_call_project_idx on openai_call (project_id, at desc);

create table if not exists openai_scan (
  execution_id  bigint      primary key,
  workflow_id   text        not null,
  status        text        not null default '',
  started_at    timestamptz,
  scanned_at    timestamptz not null default now(),
  calls         integer     not null default 0,
  note          text        not null default ''
);

comment on table openai_scan is
  'Every n8n execution the OpenAI ledger has read, so each is read once. See db/019_openai_usage.sql.';

create index if not exists openai_scan_started_idx on openai_scan (started_at desc);
