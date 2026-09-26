// Clip regeneration as media_job rows, against a real Postgres engine
// (PGlite, every db/NNN_*.sql) and one fake server playing Veo through useapi
// (videos, jobs, images), the render server's /inspect, OpenAI and the site's
// /api/media/ingest. The waits are shrunk; the ORDER and the counts are n8n's.
//
//   cd engine && npm run test:clip      (part of npm run check)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import * as R from '../src/clip/regen.ts';
import { clipServices } from '../src/clip/services.ts';
import { driveClip } from '../src/clip/worker.ts';
import { pool } from '../src/db.ts';
import { claimMedia, enqueueMedia, loadSceneContext } from '../src/media/db.ts';
import { siteIngest } from '../src/media/ingest.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(here, '..', '..', 'db');
const pglite = await PGlite.create();
for (const f of fs.readdirSync(DB_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) await pglite.exec(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
const PG_PORT = 55900 + Math.floor(Math.random() * 90);
const pgServer = new PGLiteSocketServer({ db: pglite, port: PG_PORT, host: '127.0.0.1' });
await pgServer.start();
const db = pool(`postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`, 1);

// --- The fake world ---------------------------------------------------------------------------
const fake = { requests: [], submits: [], jobs: new Map(), jobScripts: [], submitScript: [], judgeScript: [], sheetOk: true, n: 0 };
const read = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const server = http.createServer(async (req, res) => {
  const raw = req.method === 'POST' ? await read(req) : '';
  const url = new URL(req.url, 'http://x');
  const body = raw ? JSON.parse(raw) : undefined;
  fake.requests.push({ path: url.pathname, body, headers: req.headers });
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  let m;
  if (url.pathname === '/v1/google-flow/videos') {
    fake.submits.push(body);
    const step = fake.submitScript.length ? fake.submitScript.shift() : 'ok';
    if (step === '429') return json(429, { error: 'Too many requests' });
    // Shaped like a real useapi job id: `:` and `@` in it, which must reach the poll unencoded.
    const id = `j09261422${++fake.n}v-u2923-email:fermafabiz@gmail.com-bot:google-flow`;
    fake.jobs.set(id, [...(fake.jobScripts.shift() || ['running', 'done'])]);
    return json(200, { jobid: id });
  }
  if ((m = /^\/v1\/google-flow\/jobs\/(.+)$/.exec(url.pathname))) {
    // As useapi does: an encoded id is refused.
    if (/%40|%3A/i.test(req.url)) return json(400, { error: 'Invalid job ID format', code: 400 });
    const s = fake.jobs.get(m[1]);
    const step = s.length > 1 ? s.shift() : s[0];
    if (step === 'running') return json(200, { status: 'processing' });
    if (step === 'failed') return json(200, { status: 'failed', error: 'internal error' });
    if (step === 'filtered') return json(200, { status: 'failed', error: 'PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED' });
    if (step === 'audio') return json(200, { status: 'failed', error: 'PUBLIC_ERROR_AUDIO_FILTERED', reason: 'AUDIO_GENERATION_FILTERED' });
    return json(200, { status: 'completed', response: { media: [{ video: { generatedVideo: { fifeUrl: `https://flow-content.google/video/${m[1]}.mp4`, mediaGenerationId: `CAMS-video:${m[1]}` } } }] } });
  }
  if (url.pathname === '/v1/google-flow/images') return json(200, { media: [{ image: { generatedImage: { mediaGenerationId: 'CAMS-image:endframe' } } }] });
  if (url.pathname === '/inspect') return fake.sheetOk ? json(200, { url: `${BASE}/sheets/${encodeURIComponent(url.searchParams.get('url'))}.jpg` }) : json(500, {});
  if (url.pathname === '/v1/chat/completions') {
    const v = fake.judgeScript.length ? fake.judgeScript.shift() : { direction: 1, permanence: 1, untouched: 1, coherent: 1, morph: false, loop: false, problems: [] };
    return json(200, { choices: [{ message: { content: JSON.stringify(v) } }] });
  }
  if (url.pathname === '/api/media/ingest') {
    // As attachMedia does: the fields it is handed are written, and none means no write.
    if (Object.keys(body.fields || {}).length) await db.query(`select * from hov.at_write('scene', $1, $2::jsonb)`, [body.sceneId, JSON.stringify(body.fields)]);
    return json(200, { ok: true, media: { url: `https://site.example/media/${body.sceneId}/${body.field}/${fake.n}.mp4` } });
  }
  json(404, {});
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;
const config = {
  databaseUrl: '', renderUrl: BASE, renderApiKey: 'rk', n8nWebhookBase: '', mediaRoot: '/tmp', mediaBaseUrl: 'https://x', pollMs: 5, leaseSeconds: 30,
  concurrency: 1, workerId: 'w1', maxPollNetworkErrors: 3, pgPoolMax: 1, elevenLabsKey: '', voiceConcurrency: 1,
  useapiToken: 'tok', siteUrl: BASE, mediaIngestKey: 'ik', imageConcurrency: 1, openaiKey: 'ok', clipConcurrency: 1,
};
const NOW = Date.parse('2026-09-25T21:00:00.000Z');
const logs = [];
const deps = () => ({
  db, config, clip: clipServices({ useapiToken: 'tok', renderUrl: BASE, renderApiKey: 'rk', openaiKey: 'ok', useapiBase: BASE, openaiBase: BASE }),
  ingest: siteIngest(BASE, 'ik'), waits: { firstPollMs: 2, pollMs: 2, cooldownMs: 2 }, now: () => NOW, log: (msg, extra) => logs.push({ msg, ...extra }),
});

// --- Fixtures -----------------------------------------------------------------------------------------
const IMG = 'CAMS-image:abc-email:' + Buffer.from('fermafabiz@gmail.com').toString('hex') + '-x';
let seq = 0;
async function film({ editing = {}, motion = 'Slow push-in as Livia lifts the grain sack. Negative: morphing', image = IMG, flag = true, note = null } = {}) {
  const pid = `recClip${String(++seq).padStart(3, '0')}xxxxxxx`.slice(0, 17);
  await db.query(`insert into hov.project (id, name, editing_options) values ($1, 'Clip test', $2)`, [pid, JSON.stringify(editing)]);
  const r = await db.query(`insert into hov.scene (project_id, scene_order, motion_prompt, image_media_id, regen_video, video_approved, note, scene_final_url) values ($1, 101, $2, $3, $4, true, $5, 'https://old/clip.mp4') returning id`, [pid, motion, image, flag, note]);
  return r.rows[0].id;
}
const sceneRow = async (id) => (await db.query(`select scene_final_url, video_approved, regen_video, production_status, image_approved, note from hov.scene where id = $1`, [id])).rows[0];
const jobRow = async (id) => (await db.query(`select phase, result, error from hov.media_job where scene_id = $1 order by id desc limit 1`, [id])).rows[0];
const claim = () => claimMedia(db, 'w1', 30, ['clip']);

let passed = 0;
async function scenario(name, fn) {
  Object.assign(fake, { requests: [], submits: [], jobScripts: [], submitScript: [], judgeScript: [], sheetOk: true });
  logs.length = 0;
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { process.exitCode = 1; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ') + '\n       logs: ' + JSON.stringify(logs.slice(-5))); }
}

console.log('clip jobs');

await scenario('a clean take: n8n\'s submit body, polled, judged, stored, the scene written as Write Regen Video did', async () => {
  const id = await film();
  // The expected request is built from the scene as the worker found it: afterwards the flag is cleared.
  const ctx = await loadSceneContext(db, id);
  await enqueueMedia(db, id, 'clip', {}, 'test');
  assert.equal(await driveClip(await claim(), deps()), 'done');
  const b = R.buildVideoRegen(id, { scene: ctx.scene.fields, project: ctx.project.fields, project_id: ctx.project.id });
  const p = R.prepVideoRegen(b, NOW);
  assert.deepEqual(fake.submits[0], JSON.parse(JSON.stringify(R.submitBody({ p }))));
  assert.equal(fake.submits[0].captchaRetry, 5);
  assert.equal(fake.submits[0].model, 'veo-3.1-lite-low-priority');
  assert.match(fake.submits[0].prompt, /^One continuous take, .* Slow push-in as Livia lifts the grain sack\. Keep the world consistent/);
  const judge = fake.requests.find((r) => r.path === '/v1/chat/completions');
  assert.equal(judge.headers.authorization, 'Bearer ok');
  assert.equal(judge.body.model, 'gpt-4o');
  const ingest = fake.requests.find((r) => r.path === '/api/media/ingest');
  assert.equal(ingest.body.field, 'video');
  assert.equal(ingest.body.url, `https://flow-content.google/video/j09261422${fake.n}v-u2923-email:fermafabiz@gmail.com-bot:google-flow.mp4`);
  const s = await sceneRow(id);
  assert.match(s.scene_final_url, /^https:\/\/site\.example\/media\/.+\/video\//);
  assert.deepEqual({ ...s, scene_final_url: undefined }, { scene_final_url: undefined, video_approved: false, regen_video: false, production_status: 'Așteaptă Aprobare Video', image_approved: false, note: null });
  const j = await jobRow(id);
  assert.equal(j.phase, 'done');
  assert.equal(j.result.verdict, 'ok');
});

await scenario('the judge finds a vanishing object: one re-roll, new seed, a positive correction, then kept', async () => {
  const id = await film();
  fake.judgeScript = [{ direction: 1, permanence: 0.2, untouched: 1, coherent: 1, problems: ['the sack vanishes'] }];
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'done');
  assert.equal(fake.submits.length, 2);
  assert.notEqual(fake.submits[1].seed, fake.submits[0].seed);
  assert.match(fake.submits[1].prompt, /CORRECTION — the new take MUST hold to this: Whatever the subject is holding stays in their hands/);
  assert.equal(fake.requests.filter((r) => r.path === '/v1/chat/completions').length, 1, 'the re-roll is not judged again');
});

await scenario('judged wrong twice is still kept after the one re-roll', async () => {
  const id = await film();
  fake.judgeScript = [{ direction: 0 }, { direction: 0 }];
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'done');
  assert.equal(fake.submits.length, 2);
});

await scenario('no contact sheet: the judge is skipped and the take kept', async () => {
  const id = await film();
  fake.sheetOk = false;
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'done');
  assert.equal(fake.requests.filter((r) => r.path === '/v1/chat/completions').length, 0);
  assert.equal((await jobRow(id)).result.verdict, 'unreadable');
});

await scenario('motionJudge: false skips the judge', async () => {
  const id = await film({ editing: { motionJudge: false } });
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'done');
  assert.equal(fake.requests.filter((r) => r.path === '/inspect').length, 0);
});

await scenario('a refused submit (429) cools down and tries again', async () => {
  const id = await film();
  fake.submitScript = ['429', '429', 'ok'];
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'done');
  assert.equal(fake.submits.length, 3);
});

await scenario('a failed job is resubmitted with a fresh poll budget', async () => {
  const id = await film();
  fake.jobScripts = [['running', 'failed'], ['done']];
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'done');
  assert.equal(fake.submits.length, 2);
});

await scenario('five failed jobs: gives up, releases the flag, says why (n8n died with it set)', async () => {
  const id = await film();
  fake.jobScripts = Array.from({ length: 6 }, () => ['failed']);
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'failed');
  assert.equal(fake.submits.length, 5);
  const s = await sceneRow(id);
  assert.equal(s.regen_video, false);
  assert.equal(s.scene_final_url, 'https://old/clip.mp4', 'the old clip stays');
  assert.match(s.note, /^REJECTED — the regeneration failed: Scene .* too many failed video regenerations/);
});

await scenario('the content filter (picture): Mark Regen Filtered\'s writes', async () => {
  const id = await film();
  fake.jobScripts = [['filtered']];
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'failed');
  const s = await sceneRow(id);
  assert.deepEqual({ regen: s.regen_video, video: s.video_approved, image: s.image_approved, status: s.production_status }, { regen: false, video: false, image: false, status: 'Așteaptă Aprobare Imagine' });
  assert.match(s.note, /STILL IMAGE itself is what Google refuses/);
  assert.equal(fake.submits.length, 1, 'a filter refusal is not resubmitted');
});

await scenario('the content filter (sound): the advice that fits', async () => {
  const id = await film();
  fake.jobScripts = [['audio']];
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'failed');
  assert.match((await sceneRow(id)).note, /for its SOUND, not its picture/);
});

await scenario('no Flow image: refused with VRW Refuse\'s words, nothing submitted', async () => {
  const id = await film({ image: null });
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'failed');
  assert.equal(fake.submits.length, 0);
  const s = await sceneRow(id);
  assert.equal(s.regen_video, false);
  assert.match(s.note, /^REJECTED — this scene has no Flow image id/);
});

await scenario('the flag already cleared (cancelled): nothing written, nothing submitted', async () => {
  const id = await film({ flag: false, note: 'keep me' });
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'failed');
  assert.equal(fake.submits.length, 0);
  assert.equal((await sceneRow(id)).note, 'keep me');
});

await scenario('the producer\'s correction reaches the brief, after the legacy tail is stripped', async () => {
  const id = await film({ note: 'She keeps holding the sack.' });
  await enqueueMedia(db, id, 'clip');
  await driveClip(await claim(), deps());
  assert.match(fake.submits[0].prompt, /grain sack\. ADJUSTMENT REQUEST — the new video MUST follow this: She keeps holding the sack\.\. Keep the world/);
});

await scenario('end frame opted in: drawn on the start image\'s account and attached', async () => {
  const id = await film({ editing: { endFrame: true } });
  await enqueueMedia(db, id, 'clip');
  assert.equal(await driveClip(await claim(), deps()), 'done');
  const ef = fake.requests.find((r) => r.path === '/v1/google-flow/images');
  assert.equal(ef.body.email, 'fermafabiz@gmail.com');
  assert.equal(ef.body.captchaRetry, 5);
  assert.equal(fake.submits[0].endImage, 'CAMS-image:endframe');
});

await scenario('stopped while polling: let go, the scene untouched', async () => {
  const id = await film();
  fake.jobScripts = [Array.from({ length: 50 }, () => 'running')];
  await enqueueMedia(db, id, 'clip');
  const run = driveClip(await claim(), { ...deps(), waits: { firstPollMs: 2, pollMs: 10, cooldownMs: 2 } });
  for (let i = 0; i < 300 && !fake.requests.some((r) => r.path.startsWith('/v1/google-flow/jobs/')); i++) await new Promise((r) => setTimeout(r, 2));
  await db.query(`update hov.media_job set phase = 'stopped' where scene_id = $1 and phase = 'running'`, [id]);
  assert.equal(await run, 'dropped');
  const s = await sceneRow(id);
  assert.equal(s.regen_video, true);
  assert.equal(s.scene_final_url, 'https://old/clip.mp4');
});

await db.end();
await pgServer.stop();
await pglite.close();
server.close();
console.log(`\n${process.exitCode ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed} clip scenarios`);
