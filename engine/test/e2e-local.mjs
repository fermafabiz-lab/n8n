// One real render, end to end, on this machine: no Railway, no n8n, no box.
//
//   cd engine && npm run e2e            (needs ffmpeg + remotion/node_modules)
//
// ffmpeg makes three short clips and three voiceovers; a static server serves
// them; PGlite holds a film whose scenes point at them; the REAL render
// server (remotion/server/index.mjs) is started on a free port; and the
// engine's worker is pointed at all of it. It passes when the film lands in a
// temporary media dir, the project reads Finalizat with that URL, and ffprobe
// says the file is a real video of plausible length.
//
// RENDER_ENGINE defaults to hyperframes, which is what production runs.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { enqueue, pool } from '../src/db.ts';
import { n8nMusic } from '../src/musicSource.ts';
import { railway } from '../src/railway.ts';
import { runWorker } from '../src/worker.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hov-e2e-'));
const assets = path.join(tmp, 'assets');
const mediaRoot = path.join(tmp, 'media');
fs.mkdirSync(assets);
const t0 = Date.now();
const say = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// --- Media ----------------------------------------------------------------------
const colours = ['0x7a2e1f', '0x1f4e7a', '0x2e7a3a'];
for (let i = 0; i < 3; i++) {
  execFileSync('ffmpeg', ['-v', 'error', '-y',
    // testsrc2 moves, so a frozen or repeated clip would be visible; the
    // colour overlay tells the three scenes apart. (No drawtext: Homebrew's
    // ffmpeg is built without it.)
    '-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=24:d=5`,
    '-f', 'lavfi', '-i', `sine=frequency=${220 + i * 110}:duration=5`,
    '-vf', `drawbox=x=0:y=0:w=iw:h=ih/4:color=${colours[i]}:t=fill`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(assets, `clip${i}.mp4`)]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${440 + i * 60}:duration=2.5`,
    '-c:a', 'libmp3lame', path.join(assets, `voice${i}.mp3`)]);
}
say('media generated');
const files = http.createServer((req, res) => {
  const f = path.join(assets, path.basename(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.mp4') ? 'video/mp4' : 'audio/mpeg', 'content-length': fs.statSync(f).size });
  fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => files.listen(0, '127.0.0.1', ok));
const FILES = `http://127.0.0.1:${files.address().port}`;

// --- Postgres -----------------------------------------------------------------
const pglite = await PGlite.create();
for (const f of fs.readdirSync(path.join(repo, 'db')).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
  await pglite.exec(fs.readFileSync(path.join(repo, 'db', f), 'utf8'));
}
const pgPort = 55500 + Math.floor(Math.random() * 90);
const pgServer = new PGLiteSocketServer({ db: pglite, port: pgPort, host: '127.0.0.1' });
await pgServer.start();
const db = pool(`postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`, 1);
const pid = 'recE2ELocalFilm1';
await db.query(`insert into hov.project (id, name, tone, pace, editing_options) values ($1, 'Local end to end', 'Epic', 'Normal', $2)`,
  [pid, JSON.stringify({ category: 'story', music: false, speed: 1.1 })]);
const lines = ['The first scene sets the table.', 'The second one turns it over.', 'And the third one ends it.'];
for (let i = 0; i < 3; i++) {
  await db.query(`insert into hov.scene (project_id, narration, voiceover_url, scene_final_url, scene_order, duration_seconds, scene_approved)
                  values ($1, $2, $3, $4, $5, 5, true)`, [pid, lines[i], `${FILES}/voice${i}.mp3`, `${FILES}/clip${i}.mp4`, 101 + i]);
}
await db.query(`insert into hov.script (project_id, content) values ($1, '[CHAPTER 1: Everything]\ntext')`, [pid]);
say('database ready');

// --- Render server ---------------------------------------------------------------
// It writes into remotion/server/output/; whatever this run adds there is
// removed at the end, so the repo is left as it was found.
const OUTPUT_DIR = path.join(repo, 'remotion', 'server', 'output');
const outputBefore = new Set(fs.existsSync(OUTPUT_DIR) ? fs.readdirSync(OUTPUT_DIR) : []);
const hadOutputDir = fs.existsSync(OUTPUT_DIR);
const renderPort = 3900 + Math.floor(Math.random() * 90);
const engine = process.env.RENDER_ENGINE || 'hyperframes';
const server = spawn(process.execPath, [path.join(repo, 'remotion', 'server', 'index.mjs')], {
  cwd: path.join(repo, 'remotion'),
  env: { ...process.env, PORT: String(renderPort), RENDER_ENGINE: engine, RENDER_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));
const RENDER = `http://127.0.0.1:${renderPort}`;
for (let i = 0; ; i++) {
  try { if ((await fetch(`${RENDER}/health`)).ok) break; } catch {}
  if (i > 100) throw new Error('render server did not come up:\n' + serverLog.join(''));
  await new Promise((r) => setTimeout(r, 200));
}
say(`render server up (${engine})`);

// --- The worker -------------------------------------------------------------------
const config = {
  databaseUrl: '', renderUrl: RENDER, renderApiKey: '', n8nWebhookBase: 'http://unused.invalid',
  mediaRoot, mediaBaseUrl: 'http://media.local', pollMs: 1000, leaseSeconds: 60, concurrency: 1,
  workerId: 'e2e', maxPollNetworkErrors: 10, pgPoolMax: 1,
};
const stop = new AbortController();
const loop = runWorker({
  db, config, render: railway(RENDER, ''), music: n8nMusic(config.n8nWebhookBase),
  log: (msg, extra) => say(`${msg} ${JSON.stringify(extra)}`),
}, stop.signal);
assert.ok(await enqueue(db, pid, {}, 'e2e'));

let row;
let exit = 0;
try {
  const deadline = Date.now() + 20 * 60_000;
  for (;;) {
    row = (await db.query(`select * from hov.render_job where project_id = $1`, [pid])).rows[0];
    if (['done', 'failed', 'stopped'].includes(row.phase)) break;
    if (Date.now() > deadline) throw new Error('timed out at phase ' + row.phase);
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(row.phase, 'done', `render ${row.phase}: ${row.error}\n--- render server ---\n${serverLog.join('').slice(-4000)}`);
  const project = (await db.query(`select status, final_video_url from hov.project where id = $1`, [pid])).rows[0];
  assert.deepEqual(project, { status: 'Finalizat', final_video_url: row.final_url });
  const file = path.join(mediaRoot, row.final_url.replace('http://media.local/', ''));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]));
  const seconds = Number(probe.format.duration);
  const video = probe.streams.find((s) => s.codec_type === 'video');
  say(`stored ${row.final_url}: ${seconds.toFixed(2)} s, ${video.width}x${video.height}, ${fs.statSync(file).size} bytes`);
  say(`assemble verify: ${JSON.stringify(row.verify)}`);
  assert.ok(video && probe.streams.some((s) => s.codec_type === 'audio'), 'video and audio streams');
  assert.ok(seconds > 5 && seconds < 40, `plausible length (${seconds})`);
  console.log(`\nRESULT: OK — a real ${engine} render, stored and marked Finalizat, in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} catch (e) {
  console.log('\nRESULT: FAIL ' + (e.message || e));
  exit = 1;
} finally {
  stop.abort();
  await loop;
  server.kill('SIGTERM');
  if (fs.existsSync(OUTPUT_DIR)) {
    for (const f of fs.readdirSync(OUTPUT_DIR)) if (!outputBefore.has(f)) fs.rmSync(path.join(OUTPUT_DIR, f), { force: true });
    if (!hadOutputDir && !fs.readdirSync(OUTPUT_DIR).length) fs.rmdirSync(OUTPUT_DIR);
  }
  await db.end();
  await pgServer.stop();
  await pglite.close();
  files.close();
  if (!exit && !process.env.KEEP) fs.rmSync(tmp, { recursive: true, force: true });
  else if (!exit) console.log('kept: ' + tmp);
  else console.log('kept for inspection: ' + tmp);
  process.exit(exit);
}
