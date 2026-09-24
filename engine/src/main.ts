// The engine container's entry point: `node --experimental-strip-types src/main.ts`.
// Runs the render worker until SIGTERM/SIGINT, then finishes the poll in
// hand and gives its leases back (docker compose stop waits for it).
import { loadConfig } from './config.ts';
import { pool } from './db.ts';
import { n8nMusic } from './musicSource.ts';
import { railway } from './railway.ts';
import { runWorker } from './worker.ts';

const config = loadConfig();
const db = pool(config.databaseUrl, config.pgPoolMax);
const stop = new AbortController();
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => stop.abort());

console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'engine worker up', worker: config.workerId, render: config.renderUrl, concurrency: config.concurrency }));
await runWorker({ db, config, render: railway(config.renderUrl, config.renderApiKey), music: n8nMusic(config.n8nWebhookBase) }, stop.signal);
await db.end();
console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'engine worker stopped' }));
