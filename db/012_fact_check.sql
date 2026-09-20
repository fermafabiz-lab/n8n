-- 012 — the fact-check report of 2026-09-18 (docs/lessons-pipeline.md).
--
-- Idempotent; safe to re-run.

set search_path to hov, public;

-- The fact-check report, one row per project.
--
-- Deliberately ONE ROW holding the whole report as jsonb, rather than a row
-- per finding. Two reasons, both learned from the evidence table next door:
--
--  1. Re-running scripting for the same project DUPLICATES its evidence rows
--     (a known gap, docs/lessons-pipeline.md). An upsert on the project id
--     cannot do that — the second run replaces the first, which is also the
--     truth: the report describes the script that exists now, and an older
--     report describes a script nobody can read any more.
--  2. The site reads the whole report at once to draw one panel. A row per
--     finding would be a join and an ordering for something that is never
--     queried by finding.
--
-- The report's shape (all optional, the site tolerates any subset):
--   {
--     "checked": 12,           -- checkable assertions the judge extracted
--     "flagged": 4,            -- how many were not supported by the pack
--     "searched": 3,           -- how many got a targeted source lookup
--     "rewritten": 3,          -- sentences the rewrite actually changed
--     "skipped": "no pack",    -- present only when the check did not run
--     "findings": [ {
--       "quote":    "the sentence as it stood in the draft",
--       "claim":    "the assertion, isolated",
--       "verdict":  "supported" | "unsupported" | "contradicted",
--       "ref":      "E12",     -- the pack claim that settles it, when there is one
--       "reason":   "one line",
--       "source":   "News from Google",
--       "url":      "https://…",   -- primary source, when one was found
--       "action":   "kept" | "rewritten" | "cut",
--       "after":    "the sentence as it now reads"
--     } ]
--   }
--
-- No foreign key to a scene: the check runs BEFORE segmentation, which is the
-- whole point — at that moment no scene and no voice take exists, so a rewrite
-- costs nothing and invalidates nothing. See the note in docs/lessons-pipeline.md
-- about a line and its recording drifting apart.
create table if not exists fact_check (
  project_id  text primary key references project(id) on delete cascade,
  report      jsonb not null default '{}'::jsonb,
  checked_at  timestamptz not null default now()
);

comment on table fact_check is
  'One fact-check report per project, written by Claude Scripting between the narration guard and Combine Chapters. Upserted, so a re-script replaces rather than duplicates.';
comment on column fact_check.report is
  'checked/flagged/searched/rewritten counts plus findings[]; see db/012_fact_check.sql for the shape.';
