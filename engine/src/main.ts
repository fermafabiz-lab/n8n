// The engine container's entry point: `node --experimental-strip-types src/main.ts`.
// Runs the render worker until SIGTERM/SIGINT, then finishes the poll in
// hand and gives its leases back (docker compose stop waits for it).
import { loadConfig } from './config.ts';
import { pool } from './db.ts';
import { n8nMusic } from './musicSource.ts';
import { railway } from './railway.ts';
import { runWorker } from './worker.ts';

// /media is shared with the site and n8n through group 2000 (hovmedia): a
// directory this process creates — a project's own folder, the first time
// its film lands — must stay writable by the group, or the site cannot add
// that project's sheets to it later.
process.umask(0o002);

const config = loadConfig();
const db = pool(config.databaseUrl, config.pgPoolMax);

// Fail at boot, loudly, rather than at the first render: no database, or
// db/016 not applied, is a deploy mistake and the container should say so
// by crash-looping where `docker ps` shows it.
try {
  await db.query('select 1 from hov.render_job limit 1');
} catch (e) {
  console.error(JSON.stringify({ at: new Date().toISOString(), msg: 'engine cannot start: hov.render_job is not readable (db/016 applied? DATABASE_URL right?)', error: String(e) }));
  process.exit(1);
}
const stop = new AbortController();
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => stop.abort());

console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'engine worker up', worker: config.workerId, render: config.renderUrl, concurrency: config.concurrency }));
await runWorker({ db, config, render: railway(config.renderUrl, config.renderApiKey), music: n8nMusic(config.n8nWebhookBase) }, stop.signal);
await db.end();
console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'engine worker stopped' }));
