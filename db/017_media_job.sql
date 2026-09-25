-- 017 — one row per piece of per-scene media work, done by the engine (2026-09-25)
--
-- Media Generation is moving out of n8n (docs/plans/engine-media-generation.md).
-- In n8n every regeneration is a webhook into a long execution that clears a
-- flag on the scene when it finishes — so any death in between strands the
-- flag with nobody left to clear it (CLAUDE.md, "The same trap exists once per
-- in-flight flag"). Here the work IS a row: the site queues it, the engine
-- claims it (FOR UPDATE SKIP LOCKED + a lease, exactly like render_job), and
-- the row says what happened — done, failed with the reason, or stopped.
--
--   kind       voice (2026-09-25); image and clip follow
--   phase      queued → running → done, or failed / stopped
--   request    what was asked beyond the scene itself, e.g. {"voice_id": …}
--              — the audio panel's per-scene voice pin
--   result     what was made: {url, voice_id, multi, bytes, …}
--
-- At most one ACTIVE row per scene and kind: a second click while a take is
-- being synthesized is refused by the database, not by a check that can race.
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

create table if not exists media_job (
  id            bigserial primary key,
  project_id    text not null references project(id) on delete cascade,
  scene_id      text not null references scene(id) on delete cascade,
  kind          text not null check (kind in ('voice', 'image', 'clip')),
  phase         text not null default 'queued'
                check (phase in ('queued', 'running', 'done', 'failed', 'stopped')),
  request       jsonb not null default '{}'::jsonb,
  result        jsonb,
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

create unique index if not exists media_job_one_active
  on media_job (scene_id, kind)
  where phase in ('queued', 'running');

create index if not exists media_job_scene_idx on media_job (scene_id, kind, created_at desc);

create index if not exists media_job_claim_idx on media_job (id)
  where phase in ('queued', 'running');

drop trigger if exists media_job_touch on media_job;
create trigger media_job_touch before update on media_job
  for each row execute function touch_updated_at();
