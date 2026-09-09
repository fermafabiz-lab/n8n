-- AI-proposed archive footage, per scene.
--
-- The producer's ask: "when I approve the scenes, an AI should already have
-- looked for real footage for the scenes where it makes sense, and offer me
-- three or four options in a bar — and leave the rest to be generated."
--
-- The model calls live in n8n (workflow `Archive Suggestions`, webhook
-- `archive-suggest`) because that is where the OpenAI key lives; the searching,
-- filing and storing live on the site (/api/archive/suggest). What lands here
-- is only the RESULT: which library assets the model judged relevant to which
-- scene, in what order, and why.
--
-- Two timestamps on the scene, both needed. `archive_suggested_at` says the
-- scene has been LOOKED AT — with or without picks — so the site can tell
-- "nothing relevant was found" from "nobody has looked yet", which read
-- identically otherwise and would send the producer searching by hand for a
-- scene the AI had already cleared. `archive_suggest_claimed_at` is a short
-- lease: every scene approval fires the webhook, so two runs can overlap, and
-- without a claim both would spend the same model calls on the same scenes.
--
--   docker exec -i n8n-postgres-1 psql -U hov -d hov -f - < db/008_archive_suggestions.sql
--
-- Applied 2026-09-07 through an n8n Postgres node (same route as 007).
-- Every statement is re-runnable.

set search_path to hov, public;

create table if not exists scene_archive_suggestion (
  scene_id       text not null references scene (id) on delete cascade,
  stock_media_id text not null references stock_media (id) on delete cascade,
  rank           integer not null,
  relevance      real,
  reason         text,
  query          text,
  created_at     timestamptz not null default now(),
  primary key (scene_id, stock_media_id)
);

comment on table scene_archive_suggestion is
  'Archive assets a model judged relevant to a scene, ranked. Written by '
  '/api/archive/suggest (stage=store); read with the scene. A pick is an '
  'offer, never a decision — using one goes through the same attach path as '
  'a hand-searched asset.';

alter table scene add column if not exists archive_suggested_at timestamptz;
alter table scene add column if not exists archive_suggest_claimed_at timestamptz;

comment on column scene.archive_suggested_at is
  'When the suggestion run last finished LOOKING at this scene, picks or not. '
  'Null = nobody has looked yet.';
comment on column scene.archive_suggest_claimed_at is
  'Ten-minute lease taken by a suggestion run, so overlapping runs (one per '
  'scene approval) do not spend the same model calls twice.';
