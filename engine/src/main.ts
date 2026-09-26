// The engine container's entry point: `node --experimental-strip-types src/main.ts`.
// Runs the render worker until SIGTERM/SIGINT, then finishes the poll in
// hand and gives its leases back (docker compose stop waits for it).
import { loadConfig } from './config.ts';
import { pool } from './db.ts';
import { n8nMusic } from './musicSource.ts';
import { railway } from './railway.ts';
import { runWorker } from './worker.ts';
import { runMediaWorker } from './media/loop.ts';
import { elevenLabs } from './voice/elevenlabs.ts';
import { flowImages } from './image/flow.ts';
import { siteIngest } from './media/ingest.ts';
import { clipServices } from './clip/services.ts';
import { produceServices } from './produce/services.ts';
import { runProductionWorker } from './produce/worker.ts';

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
  await db.query('select 1 from hov.media_job limit 1');
} catch (e) {
  console.error(JSON.stringify({ at: new Date().toISOString(), msg: 'engine cannot start: hov.render_job / hov.media_job not readable (db/016 and db/017 applied? DATABASE_URL right?)', error: String(e) }));
  process.exit(1);
}
// db/018 is optional at boot: without it the engine does everything else and
// leaves production to n8n, so an engine deploy can never wait on a migration.
let production = true;
try { await db.query('select 1 from hov.production_job limit 1'); }
catch (e) { production = false; console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'production loop off: hov.production_job not readable (db/018 not applied?)', error: String(e) })); }
const stop = new AbortController();
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => stop.abort());

console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'engine worker up', worker: config.workerId, render: config.renderUrl, concurrency: config.concurrency }));
const render = railway(config.renderUrl, config.renderApiKey);
// Renders and per-scene media work share the process, the database pool and
// the lease rules; each loop stops on the same signal.
const ingest = siteIngest(config.siteUrl, config.mediaIngestKey);
const clip = clipServices({ useapiToken: config.useapiToken, renderUrl: config.renderUrl, renderApiKey: config.renderApiKey, openaiKey: config.openaiKey });
await Promise.all([
  runWorker({ db, config, render, music: n8nMusic(config.n8nWebhookBase) }, stop.signal),
  runMediaWorker({ db, config, render, speaker: elevenLabs(config.elevenLabsKey), flow: flowImages(config.useapiToken), ingest, clip }, stop.signal),
  production
    ? runProductionWorker({ db, config, clip, ingest, services: produceServices({ useapiToken: config.useapiToken, openaiKey: config.openaiKey, siteUrl: config.siteUrl, ingestKey: config.mediaIngestKey }) }, stop.signal)
    : Promise.resolve(),
]);
await db.end();
console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'engine worker stopped' }));
