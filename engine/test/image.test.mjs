// Image regeneration as media_job rows, against a real Postgres engine
// (PGlite, every db/NNN_*.sql) and one fake server playing useapi's Flow
// images endpoint and the site's /api/media/ingest (which, like the real one,
// writes the scene fields it is handed). No network.
//
//   cd engine && npm run test:image      (part of npm run check)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { pool } from '../src/db.ts';
import { flowImages } from '../src/image/flow.ts';
import * as I from '../src/image/request.ts';
import { driveImage } from '../src/image/worker.ts';
import { claimMedia, enqueueMedia, loadSceneContext } from '../src/media/db.ts';
import { siteIngest } from '../src/media/ingest.ts';
import { runMediaWorker } from '../src/media/loop.ts';
import { railway } from '../src/railway.ts';
import { elevenLabs } from '../src/voice/elevenlabs.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(here, '..', '..', 'db');
const pglite = await PGlite.create();
for (const f of fs.readdirSync(DB_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) await pglite.exec(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
const PG_PORT = 55800 + Math.floor(Math.random() * 90);
const pgServer = new PGLiteSocketServer({ db: pglite, port: PG_PORT, host: '127.0.0.1' });
await pgServer.start();
const db = pool(`postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`, 1);

const fake = { requests: [], script: ['ok'] };
const read = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const server = http.createServer(async (req, res) => {
  const raw = req.method === 'POST' ? await read(req) : '';
  const url = new URL(req.url, 'http://x');
  const body = raw ? JSON.parse(raw) : undefined;
  fake.requests.push({ path: url.pathname, body, headers: req.headers });
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (url.pathname === '/v1/google-flow/images') {
    const step = fake.script.length > 1 ? fake.script.shift() : fake.script[0];
    if (step === 'refuse') return json(400, { error: 'PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED' });
    if (step === 'busy') return json(503, { error: 'try later' });
    if (step === 'empty') return json(200, { media: [] });
    return json(200, { media: [{ image: { generatedImage: { fifeUrl: `https://flow.example/${fake.requests.length}.png`, mediaGenerationId: `CAMS-image:${fake.requests.length}` } } }] });
  }
  if (url.pathname === '/api/media/ingest') {
    if (req.headers['x-hov-key'] !== 'ingest-key') return json(401, { ok: false });
    // What the site does with the fields it is handed.
    await db.query(`select * from hov.at_write('scene', $1, $2::jsonb)`, [body.sceneId, JSON.stringify(body.fields)]);
    return json(200, { ok: true, media: { url: `https://site.example/media/${body.sceneId}/image/x.png` } });
  }
  json(404, {});
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;
const config = {
  databaseUrl: '', renderUrl: BASE, renderApiKey: '', n8nWebhookBase: '', mediaRoot: '/tmp', mediaBaseUrl: 'https://x', pollMs: 5, leaseSeconds: 30,
  concurrency: 1, workerId: 'w1', maxPollNetworkErrors: 3, pgPoolMax: 1, elevenLabsKey: '', voiceConcurrency: 1,
  useapiToken: 'tok', siteUrl: BASE, mediaIngestKey: 'ingest-key', imageConcurrency: 2,
};
const logs = [];
const deps = (over = {}) => ({
  db, config: { ...config, ...over }, flow: flowImages(over.useapiToken ?? 'tok', fetch, BASE), ingest: siteIngest(BASE, 'ingest-key'),
  retryMs: 5, log: (msg, extra) => logs.push({ msg, ...extra }),
});

let seq = 0;
async function film(editing = {}, { prompt = 'Wide dawn shot of Ostia harbour with grain ships', note = null, tags = ['char:Livia', 'loc:Ostia Harbour'] } = {}) {
  const pid = `recImage${String(++seq).padStart(3, '0')}xxxxxx`.slice(0, 17);
  const bible = { characters: [{ name: 'Livia', role: 'protagonist' }], locations: [{ name: 'Ostia Harbour' }] };
  await db.query(`insert into hov.project (id, name, editing_options, story_bible) values ($1, 'Image test', $2, $3)`, [pid, JSON.stringify(editing), JSON.stringify(bible)]);
  const a = await db.query(`insert into hov.scene (project_id, image_prompt, scene_order, image_media_id) values ($1, 'A calm sea at noon with birds', 101, 'img-prev') returning id`, [pid]);
  const b = await db.query(`insert into hov.scene (project_id, image_prompt, scene_order, tags, note, regen_image, image_approved) values ($1, $2, 102, $3, $4, true, true) returning id`, [pid, prompt, tags, note]);
  return { pid, prev: a.rows[0].id, id: b.rows[0].id };
}
const sceneRow = async (id) => (await db.query(`select image_media_id, regen_image, image_approved, note from hov.scene where id = $1`, [id])).rows[0];
const jobRow = async (id) => (await db.query(`select phase, result, error from hov.media_job where scene_id = $1 order by id desc limit 1`, [id])).rows[0];
const claim = () => claimMedia(db, 'w1', 30, ['image']);
const flowCalls = () => fake.requests.filter((r) => r.path === '/v1/google-flow/images');

let passed = 0;
async function scenario(name, fn) {
  fake.requests = []; fake.script = ['ok']; logs.length = 0;
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { process.exitCode = 1; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ') + '\n       logs: ' + JSON.stringify(logs.slice(-4))); }
}

console.log('image jobs');

await scenario('the request is IR Build Request\'s with captchaRetry 5, through the ingest door', async () => {
  const f = await film({ castRefs: { Livia: 'cast-li' }, locationRefs: { 'Ostia Harbour': 'loc-ostia' } });
  await enqueueMedia(db, f.id, 'image', {}, 'test');
  assert.equal(await driveImage(await claim(), deps()), 'done');
  const [call] = flowCalls();
  const ctx = await loadSceneContext(db, f.id);
  const want = I.buildRegenRequest({ scene: ctx.scene, siblings: ctx.allScenes, projectFields: ctx.project.fields, captchaRetry: 5 }).requestBody;
  assert.deepEqual(call.body, JSON.parse(JSON.stringify(want)));
  assert.equal(call.body.captchaRetry, 5);
  assert.equal(call.body.reference_1, 'cast-li');
  assert.equal(call.body.reference_2, 'loc-ostia');
  assert.equal(call.body.reference_3, 'img-prev', 'previous frame last');
  assert.equal(call.headers.authorization, 'Bearer tok');
  const ingest = fake.requests.find((r) => r.path === '/api/media/ingest');
  assert.deepEqual(ingest.body, { sceneId: f.id, field: 'image', url: 'https://flow.example/1.png', fields: { 'Image Media ID': 'CAMS-image:1', 'Aprobare Imagine': false, 'Regenerează Imagine': false, 'Observații Scenă': '' } });
  assert.deepEqual(await sceneRow(f.id), { image_media_id: 'CAMS-image:1', regen_image: false, image_approved: false, note: '' });
  const j = await jobRow(f.id);
  assert.equal(j.phase, 'done');
  assert.equal(j.result.url, `https://site.example/media/${f.id}/image/x.png`);
});

await scenario('the reviewer\'s note steers the prompt', async () => {
  const f = await film({}, { note: 'Make the sky stormy.' });
  await enqueueMedia(db, f.id, 'image');
  await driveImage(await claim(), deps());
  assert.match(flowCalls()[0].body.prompt, /ADJUSTMENT REQUEST — the new image MUST follow this: Make the sky stormy\.$/);
});

await scenario('a refusal: IR Mark Rejected\'s words on the scene, flag released, nothing ingested', async () => {
  const f = await film({});
  fake.script = ['refuse'];
  await enqueueMedia(db, f.id, 'image');
  assert.equal(await driveImage(await claim(), deps()), 'failed');
  const s = await sceneRow(f.id);
  assert.equal(s.regen_image, false);
  assert.equal(s.note, I.rejectionNote('PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED'));
  assert.equal(fake.requests.some((r) => r.path === '/api/media/ingest'), false);
  assert.equal(flowCalls().length, 1, 'a refusal is not retried');
});

await scenario('after a refusal the next attempt attaches nothing (the note says REJECTED)', async () => {
  const f = await film({ castRefs: { Livia: 'cast-li' } }, { note: I.rejectionNote('faces') });
  await enqueueMedia(db, f.id, 'image');
  await driveImage(await claim(), deps());
  assert.equal('reference_1' in flowCalls()[0].body, false);
});

await scenario('busy twice, then a picture: retried, not reported as a refusal', async () => {
  const f = await film({});
  fake.script = ['busy', 'busy', 'ok'];
  await enqueueMedia(db, f.id, 'image');
  assert.equal(await driveImage(await claim(), deps()), 'done');
  assert.equal(flowCalls().length, 3);
});

await scenario('busy every time: FAILED (not REJECTED), flag released', async () => {
  const f = await film({});
  fake.script = ['busy'];
  await enqueueMedia(db, f.id, 'image');
  assert.equal(await driveImage(await claim(), deps()), 'failed');
  assert.equal(flowCalls().length, 3);
  const s = await sceneRow(f.id);
  assert.equal(s.regen_image, false);
  assert.match(s.note, /^Image regeneration FAILED: useapi images answered 503/);
});

await scenario('an empty answer releases the flag (in n8n it threw and stranded it)', async () => {
  const f = await film({});
  fake.script = ['empty'];
  await enqueueMedia(db, f.id, 'image');
  assert.equal(await driveImage(await claim(), deps()), 'failed');
  assert.match((await sceneRow(f.id)).note, /^Image regeneration FAILED: No image in Flow response/);
});

await scenario('no image prompt: failed before calling anyone, flag released', async () => {
  const f = await film({}, { prompt: null });
  await enqueueMedia(db, f.id, 'image');
  assert.equal(await driveImage(await claim(), deps()), 'failed');
  assert.equal(flowCalls().length, 0);
  assert.match((await sceneRow(f.id)).note, /has no image prompt/);
});

await scenario('no token on the engine: a clear failure', async () => {
  const f = await film({});
  await enqueueMedia(db, f.id, 'image');
  assert.equal(await driveImage(await claim(), deps({ useapiToken: '' })), 'failed');
  assert.match((await jobRow(f.id)).error, /USEAPI_TOKEN is not set/);
});

await scenario('stopped between retries: let go, the scene untouched', async () => {
  const f = await film({});
  fake.script = ['busy'];
  await enqueueMedia(db, f.id, 'image');
  const run = driveImage(await claim(), deps({}));
  for (let i = 0; i < 200 && flowCalls().length < 1; i++) await new Promise((r) => setTimeout(r, 2));
  await db.query(`update hov.media_job set phase = 'stopped' where scene_id = $1 and phase = 'running'`, [f.id]);
  assert.equal(await run, 'dropped');
  const s = await sceneRow(f.id);
  assert.equal(s.regen_image, true, 'the site cleared it or not; the engine did not touch it');
});

await scenario('one active image job per scene', async () => {
  const f = await film({});
  assert.ok(await enqueueMedia(db, f.id, 'image'));
  assert.equal(await enqueueMedia(db, f.id, 'image'), null);
  assert.ok(await enqueueMedia(db, f.id, 'voice'), 'a voice take is separate work');
  await db.query(`update hov.media_job set phase = 'stopped' where scene_id = $1`, [f.id]);
});

await scenario('the loop runs image and voice work side by side', async () => {
  const a = await film({}), b = await film({});
  await enqueueMedia(db, a.id, 'image');
  await enqueueMedia(db, b.id, 'image');
  const stop = new AbortController();
  const loop = runMediaWorker({ ...deps(), render: railway(BASE, ''), speaker: elevenLabs('', fetch, BASE) }, stop.signal);
  for (let i = 0; i < 400; i++) {
    const r = await db.query(`select count(*)::int n from hov.media_job where scene_id = any($1) and kind = 'image' and phase = 'done'`, [[a.id, b.id]]);
    if (r.rows[0].n === 2) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  stop.abort();
  await loop;
  const r = await db.query(`select phase from hov.media_job where scene_id = any($1) and kind = 'image'`, [[a.id, b.id]]);
  assert.deepEqual(r.rows.map((x) => x.phase), ['done', 'done']);
});

await db.end();
await pgServer.stop();
await pglite.close();
server.close();
console.log(`\n${process.exitCode ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed} image scenarios`);
