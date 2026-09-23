/**
 * A film's "last worked on" moment, as SQL — the one owner of the expression
 * the library's order reads (getProjects) and that the migration's own check
 * (db/port/activity-order/check-trigger.mjs) runs against a real engine.
 *
 * `p` must be the alias of hov.project in the enclosing query.
 *
 * The project row's part is `activity_at`, kept by the db/014 trigger so that
 * the Publishing panel does not count; NULL on rows nothing has changed since
 * 014 ran, which reads as updated_at — the history they have. The children's
 * part is their plain updated_at: publishing and playlists never write
 * scenes, chapters or scripts, so everything that does is work. `greatest()`
 * skips NULLs, so a film with no scenes yet is simply its own row.
 *
 * THIS REQUIRES db/014 ON THE DATABASE. getProjects has no fallback for a
 * missing column — apply the migration before the site code that reads it,
 * or the library page fails to load.
 */
export const PROJECT_ACTIVITY_SQL = `greatest(
      coalesce(p.activity_at, p.updated_at, p.created_at),
      (select max(s.updated_at) from hov.scene s where s.project_id = p.id),
      (select max(c.updated_at) from hov.chapter c where c.project_id = p.id),
      (select max(x.updated_at) from hov.script x where x.project_id = p.id)
    )`;
