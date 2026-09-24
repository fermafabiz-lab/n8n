// The render worker against a real Postgres engine and a fake Railway.
//
//   cd engine && npm test
//
// PGlite (Postgres in WebAssembly) with every db/NNN_*.sql applied — the
// repo's own migrations, db/016 included — served over the wire protocol so
// the worker's unmodified `pg` Pool talks to it exactly as to the box. A
// small HTTP server plays the Railway render server (/assemble, /render, the
// two status routes, /output) and n8n's two music webhooks, and records
// every request. No network, no n8n, no ffmpeg.
//
// Each scenario is a real run of drive()/runWorker() over a real row:
// the happy path end to end, a Railway restart mid-job (404 → resubmit), an
// error, a Stop from the site, a worker that dies mid-render and is resumed
// by another, flaky polls, the one-active-render rule, and the edge inputs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import * as E from '../src/assembly/index.ts';
import { enqueue, loadInputs, pool } from '../src/db.ts';
import { n8nMusic } from '../src/musicSource.ts';
import { railway } from '../src/railway.ts';
import { drive, runWorker } from '../src/worker.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(here, '..', '..', 'db');

// --- Postgres -----------------------------------------------------------------
const pglite = await PGlite.create();
for (const f of fs.readdirSync(DB_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
  await pglite.exec(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
}
const PG_PORT = 55400 + Math.floor(Math.random() * 90);
const pgServer = new PGLiteSocketServer({ db: pglite, port: PG_PORT, host: '127.0.0.1' });
await pgServer.start();
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
const db = pool(DATABASE_URL, 1);

// --- Fake Railway + n8n ---------------------------------------------------------
// `script` decides what each job's status polls answer, in order; the last
// entry repeats. 'lost' answers 404 (the container was replaced), 'flaky'
// answers 502, 'error' answers status error.
const fake = {
  requests: [],
  jobs: new Map(),
  plan: { assemble: [], render: [] }, // one script per submit, consumed in order
  tracks: [],
  shared: [],
  n: 0,
};
function reset() {
  fake.requests = []; fake.jobs.clear(); fake.plan = { assemble: [], render: [] }; fake.shared = [];
  fake.tracks = [
    { id: 'loose-1', name: 'loose.mp3', group: 'Muzica' },
    { id: 'epic-a', name: 'a.mp3', group: 'Epic' },
    { id: 'epic-b', name: 'b.mp3', group: 'Epic' },
    { id: 'def-1', name: 'd.mp3', group: 'Default' },
  ];
}
const read = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const server = http.createServer(async (req, res) => {
  const body = req.method === 'POST' ? JSON.parse((await read(req)) || '{}') : undefined;
  const url = new URL(req.url, 'http://x');
  fake.requests.push({ method: req.method, path: url.pathname, body, key: req.headers['x-api-key'] });
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  let m;
  if (req.method === 'POST' && (m = /^\/(assemble|render)$/.exec(url.pathname))) {
    const kind = m[1];
    const id = `${kind}-${++fake.n}`;
    fake.jobs.set(id, { kind, body, script: [...(fake.plan[kind].shift() || ['done'])], polls: 0 });
    return json(200, { jobId: id });
  }
  if ((m = /^\/(assemble|render)\/([^/]+)\/status$/.exec(url.pathname))) {
    const job = fake.jobs.get(m[2]);
    if (!job) return json(404, { error: 'job not found' });
    const step = job.script.length > 1 ? job.script.shift() : job.script[0];
    job.polls++;
    if (step === 'lost') return json(404, { error: 'job not found' });
    if (step === 'flaky') return json(502, { error: 'bad gateway' });
    if (step === 'error') return json(200, { status: 'error', error: 'boom', progress: 0.3 });
    if (step === 'running') return json(200, { status: job.kind === 'render' ? 'rendering' : 'assembling', progress: 0.5, outputFile: null, error: null });
    const out = `${m[2]}.mp4`;
    const done = { status: 'done', progress: 1, outputFile: out, error: null, outputUrl: `${BASE}/output/${out}` };
    if (job.kind === 'assemble') done.verify = { videoSeconds: 20, sceneStartsSeconds: [0, 8, 14], voiceDurationsSeconds: [5, 4, 5] };
    else { done.speed = job.body.speed; done.speedError = null; done.engine = 'hyperframes'; }
    return json(200, done);
  }
  if (req.method === 'GET' && (m = /^\/output\/(.+)$/.exec(url.pathname))) {
    res.writeHead(200, { 'content-type': 'video/mp4' });
    return res.end(Buffer.from(`FAKE FILM ${m[1]} `.repeat(4000)));
  }
  if (url.pathname === '/webhook/list-music') return json(200, { tracks: fake.tracks });
  if (url.pathname === '/webhook/share-music') { fake.shared.push(body.id); return json(200, { url: 'x' }); }
  json(404, { error: 'no route' });
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const MEDIA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hov-media-'));
const config = {
  databaseUrl: DATABASE_URL, renderUrl: BASE, renderApiKey: 'test-key', n8nWebhookBase: `${BASE}/webhook`,
  mediaRoot: MEDIA_ROOT, mediaBaseUrl: 'https://media.example', pollMs: 5, leaseSeconds: 30, concurrency: 2,
  workerId: 'w1', maxPollNetworkErrors: 5, pgPoolMax: 1,
};
const logs = [];
const deps = (over = {}) => ({
  db, config: { ...config, ...over }, render: railway(BASE, 'test-key'), music: n8nMusic(`${BASE}/webhook`),
  random: () => 0.99, log: (msg, extra) => logs.push({ msg, ...extra }),
});

// --- Fixtures -------------------------------------------------------------------
let seq = 0;
async function film({ editing = {}, scenes = 3, script = true, tone = 'Epic', pace = 'Normal', approved = true } = {}) {
  const id = `recTest${++seq}${'x'.repeat(6)}`;
  await db.query(`insert into hov.project (id, name, tone, pace, editing_options) values ($1, $2, $3, $4, $5)`,
    [id, `Film ${seq}`, tone, pace, JSON.stringify(editing)]);
  const orders = [1, 101, 102, 103, 201].slice(0, scenes);
  for (const [i, o] of orders.entries()) {
    await db.query(
      `insert into hov.scene (project_id, narration, voiceover_url, scene_final_url, scene_order, duration_seconds, scene_approved)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, `[NARRATOR] Line ${i}.`, `https://cdn.example/${id}/v${i}.mp3`, `https://cdn.example/${id}/c${i}.mp4`, o, o < 100 ? 3 : 8, approved]);
  }
  if (script) await db.query(`insert into hov.script (project_id, content) values ($1, $2)`, [id, '[CHAPTER 1: The Start]\ntext\n[CHAPTER 2: The End]\ntext']);
  return id;
}
const job = async (projectId) => (await db.query(`select * from hov.render_job where project_id = $1 order by id desc limit 1`, [projectId])).rows[0];
async function claimOne(workerId = 'w1') {
  const { claim } = await import('../src/db.ts');
  return claim(db, workerId, config.leaseSeconds);
}
const submits = (kind) => fake.requests.filter((r) => r.method === 'POST' && r.path === '/' + kind);

let passed = 0;
async function scenario(name, fn) {
  reset();
  logs.length = 0;
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); console.log('       logs:', JSON.stringify(logs.slice(-6))); process.exitCode = 1; }
}

// --- Scenarios ------------------------------------------------------------------
console.log('render worker');

await scenario('happy path: queued → assemble → graphics → store → done', async () => {
  const pid = await film({ editing: { music: true, speed: 1.25, category: 'story', hookPlan: { style: 'cliffhanger', beats: ['a'] } } });
  fake.plan.assemble.push(['running', 'running', 'done']);
  fake.plan.render.push(['running', 'done']);
  assert.ok(await enqueue(db, pid, { aspect: '9:16', captions: 'no' }, 'test'));
  const outcome = await drive(await claimOne(), deps());
  assert.equal(outcome, 'done');
  const row = await job(pid);
  assert.equal(row.phase, 'done');
  assert.equal(row.assemble_polls, 3);
  assert.equal(row.graphics_polls, 2);
  assert.ok(row.finished_at);

  // The requests are exactly what the pinned modules build from the same rows.
  const inputs = await loadInputs(db, pid);
  const triggers = { normalize: E.normalizeInput({ Project_ID: pid, aspect: '9:16', captions: 'no' }) };
  const music = { id: 'epic-b', name: 'b.mp3', matched: 'subfolder', url: 'https://n8n-production-55dd.up.railway.app/media?id=epic-b' };
  const assembly = E.planAssemble({ triggers, ...inputs, music });
  assert.deepEqual(submits('assemble')[0].body, JSON.parse(JSON.stringify(assembly.timeline.body)));
  assert.equal(submits('assemble')[0].body.aspect, '9:16');
  assert.equal(submits('assemble')[0].body.musicUrl, music.url, 'Epic subfolder, random 0.99 → the second track');
  assert.deepEqual(fake.shared, ['epic-b'], 'the picked track was shared, as Share Music Track did');
  // Checked before this test makes a status call of its own, without the key.
  assert.ok(fake.requests.filter((r) => r.path !== '/webhook/list-music' && r.path !== '/webhook/share-music' && !r.path.startsWith('/output')).every((r) => r.key === 'test-key'), 'x-api-key on every Railway call');
  const assembled = { lost: false, ...(await (await fetch(`${BASE}/assemble/${row.assemble_job_id}/status`)).json()) };
  const render = E.planRender({ triggers, ...inputs, assembly, assembled });
  assert.deepEqual(submits('render')[0].body, JSON.parse(JSON.stringify({ ...render.body, speed: 1.25 })), 'render body = planRender + speed');
  assert.equal(submits('render')[0].body.showCaptions, false, 'captions: no reached the props');
  assert.deepEqual(submits('render')[0].body.chapterTitles, { 1: 'The Start', 2: 'The End' });

  // Stored in /media, content-addressed, and the project points at it.
  const bytes = fs.readFileSync(path.join(MEDIA_ROOT, row.final_url.replace('https://media.example/', '')));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  assert.equal(row.final_url, `https://media.example/${pid}/final/${hash}.mp4`);
  assert.equal(fs.readdirSync(path.join(MEDIA_ROOT, '.incoming')).length, 0, 'no partial file left behind');
  const p = (await db.query(`select status, final_video_url from hov.project where id = $1`, [pid])).rows[0];
  assert.deepEqual(p, { status: 'Finalizat', final_video_url: row.final_url });
});

await scenario('one active render per project, enforced by the database', async () => {
  const pid = await film();
  assert.ok(await enqueue(db, pid));
  assert.equal(await enqueue(db, pid), null, 'second request refused');
  assert.equal(await drive(await claimOne(), deps()), 'done');
  assert.ok(await enqueue(db, pid), 'a finished render frees the project');
  await db.query(`update hov.render_job set phase = 'stopped' where project_id = $1 and phase = 'queued'`, [pid]);
});

await scenario('music off: no listing, no share, no musicUrl', async () => {
  const pid = await film({ editing: { music: false } });
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'done');
  assert.equal(fake.requests.filter((r) => r.path.startsWith('/webhook/')).length, 0);
  assert.equal(submits('assemble')[0].body.musicUrl, undefined);
  assert.equal(submits('assemble')[0].body.stingers, false);
});

await scenario('pinned track: shared, never listed', async () => {
  const pid = await film({ editing: { music: true, musicTrack: { id: 'pin-777', name: 'Mine' } } });
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'done');
  assert.equal(fake.requests.filter((r) => r.path === '/webhook/list-music').length, 0);
  assert.deepEqual(fake.shared, ['pin-777']);
  assert.match(submits('assemble')[0].body.musicUrl, /id=pin-777$/);
});

await scenario('Railway restarted mid-assemble (404): the same request is resubmitted', async () => {
  const pid = await film();
  fake.plan.assemble.push(['running', 'lost']);
  fake.plan.assemble.push(['running', 'done']);
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'done');
  const a = submits('assemble');
  assert.equal(a.length, 2);
  assert.deepEqual(a[1].body, a[0].body);
  assert.equal((await job(pid)).assemble_polls, 4, 'polls keep counting across the resubmit, as $runIndex did');
});

await scenario('Railway restarted mid-graphics: resubmitted too', async () => {
  const pid = await film();
  fake.plan.render.push(['lost']);
  fake.plan.render.push(['done']);
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'done');
  assert.equal(submits('render').length, 2);
  assert.deepEqual(submits('render')[1].body, submits('render')[0].body);
});

await scenario('assemble error: failed, with the guard\'s message, project untouched', async () => {
  const pid = await film();
  fake.plan.assemble.push(['running', 'error']);
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'failed');
  const row = await job(pid);
  assert.equal(row.phase, 'failed');
  assert.equal(row.error, 'assemble failed: boom');
  assert.equal((await db.query(`select status from hov.project where id = $1`, [pid])).rows[0].status, 'Planificat');
  assert.ok(await enqueue(db, pid), 'a failed render frees the project for a retry');
  await db.query(`update hov.render_job set phase = 'stopped' where project_id = $1 and phase = 'queued'`, [pid]);
});

await scenario('graphics error: failed with the Remotion message', async () => {
  const pid = await film();
  fake.plan.render.push(['error']);
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'failed');
  assert.equal((await job(pid)).error, 'Remotion render failed: boom');
});

await scenario('Stop from the site reaches a running job within one poll', async () => {
  const pid = await film();
  fake.plan.render.push(['running']);
  await enqueue(db, pid);
  const run = drive(await claimOne(), deps());
  for (let i = 0; i < 200 && (await job(pid)).phase !== 'graphics'; i++) await new Promise((r) => setTimeout(r, 5));
  await db.query(`update hov.render_job set phase = 'stopped', finished_at = now() where project_id = $1 and phase in ('queued','assemble','graphics','store')`, [pid]);
  assert.equal(await run, 'dropped');
  assert.equal((await job(pid)).phase, 'stopped');
  assert.equal((await db.query(`select status from hov.project where id = $1`, [pid])).rows[0].status, 'Planificat');
});

await scenario('a worker dies mid-graphics; another resumes the SAME Railway job', async () => {
  const pid = await film();
  fake.plan.render.push(['running', 'running', 'running', 'running', 'running', 'running', 'done']);
  await enqueue(db, pid);
  const dying = new AbortController();
  const first = drive(await claimOne('w1'), deps({ workerId: 'w1' }), dying.signal);
  for (let i = 0; i < 200 && (await job(pid)).graphics_polls < 2; i++) await new Promise((r) => setTimeout(r, 5));
  dying.abort(); // the container is killed: no release, the lease simply runs out
  assert.equal(await first, 'dropped');
  const held = await job(pid);
  assert.equal(held.phase, 'graphics');
  assert.equal(await claimOne('w2'), null, 'a live lease is respected');
  await db.query(`update hov.render_job set locked_until = now() - interval '1 second' where id = $1`, [held.id]);
  const resumed = await claimOne('w2');
  assert.equal(resumed.id, held.id);
  assert.equal(await drive(resumed, deps({ workerId: 'w2' })), 'done');
  assert.equal(submits('render').length, 1, 'no second render: it polled the job already running');
  assert.equal(submits('assemble').length, 1);
  const row = await job(pid);
  assert.equal(row.phase, 'done');
  assert.equal(row.graphics_polls, 7);
});

await scenario('the old worker cannot write once another holds the row', async () => {
  const pid = await film();
  await enqueue(db, pid);
  const stale = await claimOne('w1');
  await db.query(`update hov.render_job set locked_until = now() - interval '1 second' where id = $1`, [stale.id]);
  const fresh = await claimOne('w2');
  assert.equal(fresh.id, stale.id);
  assert.equal(await drive(stale, deps({ workerId: 'w1' })), 'dropped');
  assert.equal(await drive(fresh, deps({ workerId: 'w2' })), 'done');
});

await scenario('flaky polls (502) are weather; too many in a row are fatal', async () => {
  const pid = await film();
  fake.plan.assemble.push(['flaky', 'flaky', 'flaky', 'done']);
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'done');
  const pid2 = await film();
  fake.plan.assemble.push(['flaky']);
  await enqueue(db, pid2);
  assert.equal(await drive(await claimOne(), deps({ maxPollNetworkErrors: 3 })), 'failed');
  assert.match((await job(pid2)).error, /unreachable 3 times in a row/);
});

await scenario('no approved clip: failed with Prepare Clips\' own message', async () => {
  const pid = await film({ approved: false });
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'failed');
  assert.equal((await job(pid)).error, 'No scenes with a final muxed clip (Scene Final URL) found for this project.');
  assert.equal(submits('assemble').length, 0);
});

await scenario('no script row: renders anyway, with no chapter titles (n8n stopped silently here)', async () => {
  const pid = await film({ script: false });
  await enqueue(db, pid);
  assert.equal(await drive(await claimOne(), deps()), 'done');
  assert.deepEqual(submits('render')[0].body.chapterTitles, {});
});

await scenario('speed: Pace Slow with no override → 0.9; nothing → 1', async () => {
  const slow = await film({ pace: 'Slow' });
  await enqueue(db, slow);
  await drive(await claimOne(), deps());
  const plain = await film({ pace: null });
  await enqueue(db, plain);
  await drive(await claimOne(), deps());
  assert.deepEqual(submits('render').map((r) => r.body.speed), [0.9, 1]);
});

await scenario('runWorker: drains the queue two at a time, then shuts down cleanly', async () => {
  const ids = [await film(), await film(), await film()];
  for (const id of ids) await enqueue(db, id);
  const stop = new AbortController();
  const loop = runWorker(deps(), stop.signal);
  for (let i = 0; i < 400; i++) {
    const r = await db.query(`select count(*)::int as n from hov.render_job where project_id = any($1) and phase = 'done'`, [ids]);
    if (r.rows[0].n === 3) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  stop.abort();
  await loop;
  const r = await db.query(`select phase from hov.render_job where project_id = any($1)`, [ids]);
  assert.deepEqual(r.rows.map((x) => x.phase), ['done', 'done', 'done']);
});

// --- Done -----------------------------------------------------------------------
await db.end();
await pgServer.stop();
await pglite.close();
server.close();
fs.rmSync(MEDIA_ROOT, { recursive: true, force: true });
console.log(`\n${process.exitCode ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed} scenarios`);
