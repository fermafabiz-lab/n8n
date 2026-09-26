-- 018 — one row per production run of a film, driven by the engine (2026-09-26)
--
-- Media Generation's batch (docs/plans/engine-media-generation.md, phase 6)
-- is moving out of n8n. In n8n a production run was ONE execution holding
-- every gate open for hours: nothing the site could read while it ran, Pause
-- stopped every film's run at once, and a restart of n8n threw the whole run
-- away, clips in flight included. Here the run is a row, like render_job:
--
--   phase     queued → running → done, or failed (error says why) / stopped
--   stage     where the run is: setup → voices → images → asset_gate → clips
--             → video_gate → finalize → settings_gate
--   pass      which pass over the film (More Batches?); n8n allows 12
--   trigger   the orchestrator's inputs: {Voice_ID, Aspect_Ratio, Flow_Email}
--   state     everything the run needs to resume where it stopped: the
--             pass's scenes and accounts, this pass's reference copies, the
--             n-1 image, the clip pool with its jobs IN FLIGHT at Google,
--             every per-scene counter n8n kept in static data
--   locked_by / locked_until   the worker's lease, renewed by a heartbeat
--
-- At most one ACTIVE row per project, enforced by the database.
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists production_job (
  id            bigserial primary key,
  project_id    text not null references project(id) on delete cascade,
  phase         text not null default 'queued'
                check (phase in ('queued', 'running', 'done', 'failed', 'stopped')),
  stage         text not null default 'setup'
                check (stage in ('setup', 'voices', 'images', 'asset_gate', 'clips', 'video_gate', 'finalize', 'settings_gate', 'done')),
  pass          integer not null default 0,
  trigger       jsonb not null default '{}'::jsonb,
  state         jsonb not null default '{}'::jsonb,
  error         text,
  attempts      integer not null default 0,
  requested_by  text,
  locked_by     text,
  locked_until  timestamptz,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create unique index if not exists production_job_one_active
  on production_job (project_id)
  where phase in ('queued', 'running');

create index if not exists production_job_project_idx on production_job (project_id, created_at desc);

create index if not exists production_job_claim_idx on production_job (id)
  where phase in ('queued', 'running');

drop trigger if exists production_job_touch on production_job;
create trigger production_job_touch before update on production_job
  for each row execute function touch_updated_at();
