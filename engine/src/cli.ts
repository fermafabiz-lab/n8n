// Operator commands, for local runs and for the box before the site learns
// to queue renders itself (phase 4):
//
//   node --experimental-strip-types src/cli.ts enqueue <projectId> [aspect] [captions]
//   node --experimental-strip-types src/cli.ts status  <projectId>
//   node --experimental-strip-types src/cli.ts stop    <projectId>
//
// Needs DATABASE_URL only.
import pg from 'pg';
import { enqueue } from './db.ts';

const [cmd, projectId, aspect, captions] = process.argv.slice(2);
if (!cmd || !projectId) {
  console.error('usage: cli.ts enqueue|status|stop <projectId> [aspect] [captions]');
  process.exit(2);
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  if (cmd === 'enqueue') {
    const trigger: Record<string, string> = {};
    if (aspect) trigger.aspect = aspect;
    if (captions) trigger.captions = captions;
    const id = await enqueue(db, projectId, trigger, 'cli');
    console.log(id ? `queued render_job ${id}` : 'refused: this project already has an active render');
  } else if (cmd === 'status') {
    const r = await db.query(
      `select id, phase, progress, assemble_polls, graphics_polls, final_url, error, created_at, updated_at
       from hov.render_job where project_id = $1 order by id desc limit 5`, [projectId]);
    console.table(r.rows);
  } else if (cmd === 'stop') {
    const r = await db.query(
      `update hov.render_job set phase = 'stopped', finished_at = now()
       where project_id = $1 and phase in ('queued', 'assemble', 'graphics', 'store') returning id`, [projectId]);
    console.log(r.rowCount ? `stopped render_job ${r.rows[0].id}` : 'nothing active');
  } else {
    console.error(`unknown command ${cmd}`);
    process.exitCode = 2;
  }
} finally {
  await db.end();
}
