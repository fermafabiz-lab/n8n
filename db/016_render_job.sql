-- 016 — one row per final render, written by the engine (2026-09-24)
--
-- Final Assembly is moving out of n8n (docs/plans/engine-final-assembly.md).
-- In n8n a render was an execution: nothing the site could read while it ran
-- (runData is empty for the whole life of a healthy execution), and nothing
-- that survived a restart. This row IS the render: the engine's worker
-- (engine/src/worker.ts) claims it, advances it phase by phase and writes
-- every step down, so a restart resumes where it stopped and the site can
-- show the real phase and progress instead of an elapsed-time estimate.
--
-- The row is also the queue. The plan named graphile-worker; a queue beside
-- this table would hold a second copy of the same state (which job, which
-- phase, how many polls), and the resume logic has to read THIS row anyway.
-- So the worker claims rows here with FOR UPDATE SKIP LOCKED and a lease, and
-- there is exactly one place that says what a render is doing.
--
--   phase        queued → assemble → graphics → store → done
--                or failed (error says why) / stopped (the site said so)
--   trigger      what the site asked for, in the `assemble` webhook body's
--                shape ({aspect?, captions?}); the engine normalises it with
--                the same rule n8n's Normalize Assemble Input used
--   inputs       the snapshot the plan was built from (scene rows, project,
--                script, the music pick). Kept so a resumed job renders what
--                it started with, and so any render can be replayed offline
--   assemble_*   the Railway /assemble job, its request and its poll count
--   graphics_*   the Railway /render job, likewise; graphics_output_url is
--                where Railway left the drawn film before it was stored
--   assembled    the assemble job's final status: {outputUrl, verify}
--   verify       the assemble server's own measurement, for the site
--   progress     0..1 of the CURRENT phase, as Railway reports it
--   final_url    where the finished film landed (the /media store)
--   locked_by / locked_until   the worker's lease; an expired lease on an
--                active row means its worker died, and any worker resumes it
--
-- At most one ACTIVE row per project (the partial unique index): the
-- double-render history in CLAUDE.md ("The site is the ONLY thing that starts
-- a render") is exactly two runs on one confirmation. A second request while
-- one is active is refused by the database, not by a check that can race.
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists render_job (
  id                 bigserial primary key,
  project_id         text not null references project(id) on delete cascade,
  phase              text not null default 'queued'
                     check (phase in ('queued', 'assemble', 'graphics', 'store', 'done', 'failed', 'stopped')),
  trigger            jsonb not null default '{}'::jsonb,
  inputs             jsonb,
  assemble_job_id    text,
  assemble_body      jsonb,
  assemble_polls     integer not null default 0,
  assembled          jsonb,
  graphics_job_id    text,
  render_body        jsonb,
  graphics_polls     integer not null default 0,
  graphics_output_url text,
  progress           real,
  verify             jsonb,
  final_url          text,
  error              text,
  requested_by       text,
  locked_by          text,
  locked_until       timestamptz,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  updated_at         timestamptz not null default now(),
  finished_at        timestamptz
);

create unique index if not exists render_job_one_active
  on render_job (project_id)
  where phase in ('queued', 'assemble', 'graphics', 'store');

create index if not exists render_job_project_idx on render_job (project_id, created_at desc);

-- What the worker scans for: active rows nobody holds.
create index if not exists render_job_claim_idx on render_job (id)
  where phase in ('queued', 'assemble', 'graphics', 'store');

drop trigger if exists render_job_touch on render_job;
create trigger render_job_touch before update on render_job
  for each row execute function touch_updated_at();
