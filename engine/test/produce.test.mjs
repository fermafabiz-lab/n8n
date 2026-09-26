// Whole production runs, end to end, against a real Postgres engine (PGlite,
// every db/NNN_*.sql) and one fake server playing Google Flow through useapi
// (images, assets, videos, jobs), the render server's /inspect, OpenAI and the
// site's /api/media/ingest. The media worker runs beside the production
// worker, as in the container, and a fake PRODUCER approves what appears.
// Waits are shrunk; the order, the counters and the gates are n8n's.
//
//   cd engine && npm run test:produce      (part of npm run check)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { clipServices } from '../src/clip/services.ts';
import { pool } from '../src/db.ts';
import { flowImages } from '../src/image/flow.ts';
import { siteIngest } from '../src/media/ingest.ts';
import { runMediaWorker } from '../src/media/loop.ts';
import * as D from '../src/produce/db.ts';
import { produceServices } from '../src/produce/services.ts';
import { driveProduction } from '../src/produce/worker.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(here, '..', '..', 'db');
const pglite = await PGlite.create();
for (const f of fs.readdirSync(DB_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) await pglite.exec(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
const PG_PORT = 56000 + Math.floor(Math.random() * 90);
const pgServer = new PGLiteSocketServer({ db: pglite, port: PG_PORT, host: '127.0.0.1' });
await pgServer.start();
const db = pool(`postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`, 1);
const MEDIA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hov-produce-'));

// --- The fake world ---------------------------------------------------------------------------------
const hex = (s) => Buffer.from(s).toString('hex');
const unhex = (id) => { const m = /-email:([0-9a-f]+)-/.exec(id || ''); return m ? Buffer.from(m[1], 'hex').toString() : ''; };
const A0 = 'fermafabiz@gmail.com', A1 = 'houseofvideos01@gmail.com', A2 = 'houseofvideos02@gmail.com';
const fake = {};
const reset = () => Object.assign(fake, { requests: [], images: [], uploads: [], submits: [], jobs: new Map(), imageScript: [], jobScripts: [], judgeScript: [], consistencyScript: [] });
// Flow ids are unique for ever (hov.sheet_media.flow_id is): the counter is never reset.
fake.n = 0;
reset();
const read = (req) => new Promise((ok) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => ok(Buffer.concat(b))); });
let BASE = '';
const server = http.createServer(async (req, res) => {
  const raw = await read(req);
  const url = new URL(req.url, 'http://x');
  let body;
  try { body = raw.length && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw.toString()) : undefined; } catch {}
  fake.requests.push({ method: req.method, path: url.pathname, body });
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  let m;
  if (url.pathname.startsWith('/dl/') || url.pathname.startsWith('/m/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from('png:' + url.pathname)); }
  if (url.pathname === '/v1/google-flow/images') {
    fake.images.push(body);
    const step = fake.imageScript.length ? fake.imageScript.shift() : 'ok';
    if (step === 'refuse') return json(400, { error: 'PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED' });
    if (step === 'throttle') return json(403, { error: 'captcha_quality: PUBLIC_ERROR_UNUSUAL_ACTIVITY' });
    const n = ++fake.n;
    return json(200, { media: [{ image: { generatedImage: { mediaGenerationId: `u-email:${hex(body.email)}-image:${n}`, fifeUrl: `${BASE}/dl/img${n}.png` } } }] });
  }
  if ((m = /^\/v1\/google-flow\/assets\/(.+)$/.exec(url.pathname))) {
    if (req.method === 'GET') return json(200, { url: `${BASE}/dl/asset-${fake.n}.png` });
    const email = decodeURIComponent(m[1]);
    fake.uploads.push({ email, bytes: raw.length });
    return json(200, { mediaGenerationId: `u-email:${hex(email)}-image:copy${++fake.n}` });
  }
  if (url.pathname === '/v1/google-flow/videos') {
    fake.submits.push(body);
    const id = `j${++fake.n}v-u2923-email:${body.email}-bot:google-flow`;
    fake.jobs.set(id, [...(fake.jobScripts.shift() || ['running', 'done'])]);
    return json(200, { jobid: id });
  }
  if ((m = /^\/v1\/google-flow\/jobs\/(.+)$/.exec(url.pathname))) {
    const s = fake.jobs.get(decodeURIComponent(m[1]));
    const step = s.length > 1 ? s.shift() : s[0];
    if (step === 'running') return json(200, { status: 'processing' });
    if (step === 'failed') return json(200, { status: 'failed', error: 'internal error' });
    if (step === 'audio') return json(200, { status: 'failed', error: 'PUBLIC_ERROR_AUDIO_FILTERED', reason: 'AUDIO_GENERATION_FILTERED' });
    return json(200, { status: 'completed', response: { media: [{ video: { generatedVideo: { fifeUrl: `https://flow-content.google/video/${fake.n}.mp4`, mediaGenerationId: `CAMS-video:${fake.n}` } } }] } });
  }
  if (url.pathname === '/inspect') return json(200, { url: `${BASE}/dl/sheet.jpg` });
  if (url.pathname === '/v1/chat/completions') {
    const sys = String(((body.messages || [])[0] || {}).content || '');
    if (body.model === 'gpt-4o-mini') return json(200, { choices: [{ message: { content: 'A calm quay at dusk, seen from behind.' } }] });
    if (/continuity supervisor/.test(sys)) {
      const v = fake.consistencyScript.length ? fake.consistencyScript.shift() : { identity: 0.9, wardrobe: 0.9, place: 0.9, sheet_leak: false, problems: [] };
      return json(200, { choices: [{ message: { content: JSON.stringify(v) } }] });
    }
    const v = fake.judgeScript.length ? fake.judgeScript.shift() : { direction: 1, permanence: 1, untouched: 1, coherent: 1, morph: false, loop: false, problems: [] };
    return json(200, { choices: [{ message: { content: JSON.stringify(v) } }] });
  }
  if (url.pathname === '/api/media/ingest') {
    if (body.field === 'sheets') {
      for (const it of body.items) await db.query(`insert into hov.sheet_media (project_id, kind, name, flow_id, path) values ($1, $2, $3, $4, $5) on conflict (flow_id) do nothing`, [body.projectId, it.kind, it.name, it.flowId, `${body.projectId}/sheets/${it.flowId.slice(-8)}.png`]);
      return json(200, { ok: true });
    }
    const p = `${body.sceneId}/${body.field}/${++fake.n}.${body.field === 'video' ? 'mp4' : 'png'}`;
    if (body.field === 'image') { await db.query(`delete from hov.attachment where scene_id = $1 and field = 'image'`, [body.sceneId]); await db.query(`insert into hov.attachment (scene_id, field, path) values ($1, 'image', $2)`, [body.sceneId, p]); }
    if (Object.keys(body.fields || {}).length) await db.query(`select * from hov.at_write('scene', $1, $2::jsonb)`, [body.sceneId, JSON.stringify(body.fields)]);
    return json(200, { ok: true, media: { url: `${BASE}/m/${p}` } });
  }
  json(404, {});
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
BASE = `http://127.0.0.1:${server.address().port}`;
await db.query(`select set_config('hov.media_base_url', $1, false)`, [`${BASE}/m`]);

const config = {
  databaseUrl: '', renderUrl: BASE, renderApiKey: 'rk', n8nWebhookBase: '', mediaRoot: MEDIA_ROOT, mediaBaseUrl: `${BASE}/m`, pollMs: 2, leaseSeconds: 30,
  concurrency: 1, workerId: 'w1', maxPollNetworkErrors: 3, pgPoolMax: 1, elevenLabsKey: '', voiceConcurrency: 3,
  useapiToken: 'tok', siteUrl: BASE, mediaIngestKey: 'ik', imageConcurrency: 1, openaiKey: 'ok', clipConcurrency: 1, productionConcurrency: 1,
};
const logs = [];
const log = (msg, extra) => logs.push({ msg, ...extra });
const speaker = { async speak(voice, text) { fake.requests.push({ path: 'elevenlabs', body: { voice, text } }); return Buffer.from('mp3:' + text); } };
const clip = clipServices({ useapiToken: 'tok', renderUrl: BASE, renderApiKey: 'rk', openaiKey: 'ok', useapiBase: BASE, openaiBase: BASE });
const ingest = siteIngest(BASE, 'ik');
const services = produceServices({ useapiToken: 'tok', openaiKey: 'ok', siteUrl: BASE, ingestKey: 'ik', useapiBase: BASE, openaiBase: BASE });
const tiny = { sheet: 1, pace: 1, betweenImages: 1, gate: 3, voicePoll: 3, firstPoll: 1, poll: 1, pool: 5, cooldown: 1, vpImage: 3, imgCooldownUnit: 0 };
const deps = (extra = {}) => ({ db, config, services, clip, ingest, log, waits: tiny, ...extra });

// --- A film, and a producer who approves what appears -------------------------------------------------------
let seq = 0;
const bible = {
  characters: [{ name: 'Livia', role: 'protagonist', visual_description: 'a woman in her forties, grey stola' }],
  objects: [],
  locations: [{ name: 'Ostia Harbour', visual_description: 'a busy quay' }],
};
async function film({ editing = {}, scenes = 3 } = {}) {
  const pid = `recProd${String(++seq).padStart(3, '0')}xxxxxxxx`.slice(0, 17);
  await db.query(`insert into hov.project (id, name, editing_options, story_bible, aspect, status) values ($1, 'Production test', $2, $3, '16:9', 'Producție')`, [pid, JSON.stringify(editing), JSON.stringify(bible)]);
  const ids = [];
  const plan = [
    [1, 'Livia watches the ships come in.', 'Dawn over Ostia harbour, Livia on the quay', ['char:Livia', 'loc:Ostia Harbour']],
    [101, 'The grain is weighed.', 'Livia at the scale on the quay', ['char:Livia', 'loc:Ostia Harbour']],
    [102, '', 'Empty quay at dusk, ropes and crates', ['loc:Ostia Harbour']],
    [103, 'Night falls on the river port.', 'The river port at night, lamps lit', ['char:Livia']],
    [104, 'The ships sail at dawn.', 'Ships leaving the harbour mouth at dawn', ['loc:Ostia Harbour']],
    [105, 'Rome eats.', 'A bakery counter in Rome, loaves stacked', []],
  ].slice(0, scenes);
  for (const [order, narration, prompt, tags] of plan) {
    const r = await db.query(`insert into hov.scene (project_id, scene_order, narration, image_prompt, motion_prompt, tags, scene_approved, production_status) values ($1, $2, $3, $4, 'Slow push-in along the quay', $5, true, 'Aprobat') returning id`, [pid, order, narration, prompt, tags]);
    ids.push(r.rows[0].id);
  }
  return { pid, ids };
}
function producer(pid, { hold = () => false } = {}) {
  let stop = false;
  const run = (async () => {
    while (!stop) {
      const rows = (await db.query(`select s.id, s.narration, s.voiceover_url, s.voice_approved, s.image_approved, s.regen_image, s.regen_voice, s.regen_video, s.scene_final_url, s.video_approved,
                                           exists(select 1 from hov.attachment a where a.scene_id = s.id and a.field = 'image') as has_image
                                      from hov.scene s where s.project_id = $1`, [pid])).rows;
      for (const s of rows) {
        if (hold(s)) continue;
        if (!s.voice_approved && !s.regen_voice && (s.voiceover_url || !String(s.narration || '').trim())) await db.query(`update hov.scene set voice_approved = true where id = $1`, [s.id]);
        if (s.has_image && !s.image_approved && !s.regen_image) await db.query(`update hov.scene set image_approved = true where id = $1`, [s.id]);
        if (s.scene_final_url && !s.video_approved && !s.regen_video) await db.query(`update hov.scene set video_approved = true where id = $1`, [s.id]);
      }
      const p = (await db.query(`select status from hov.project where id = $1`, [pid])).rows[0];
      if (p.status === 'Setări Finale') await db.query(`update hov.project set status = 'Asamblare' where id = $1`, [pid]);
      await new Promise((ok) => setTimeout(ok, 3));
    }
  })();
  return async () => { stop = true; await run; };
}
async function produce(pid, trigger = { Aspect_Ratio: '16:9' }, opts = {}) {
  await D.enqueueProduction(db, pid, trigger, 'test');
  const job = await D.claimProduction(db, 'w1', 30);
  const stopMedia = new AbortController();
  const media = runMediaWorker({ db, config, render: {}, speaker, flow: flowImages('tok', fetch, BASE), ingest, clip, waits: { firstPollMs: 1, pollMs: 1, cooldownMs: 1 }, log }, stopMedia.signal);
  const stopProducer = producer(pid, opts);
  try { return { outcome: await driveProduction(job, deps(opts.deps)), job }; }
  finally { await stopProducer(); stopMedia.abort(); await media; }
}
const scenesOf = async (pid) => (await db.query(`select id, scene_order, production_status, voiceover_url, image_media_id, scene_final_url, note, motion_prompt from hov.scene where project_id = $1 order by scene_order`, [pid])).rows;
const jobOf = async (pid) => (await db.query(`select phase, stage, pass, error, state from hov.production_job where project_id = $1 order by id desc limit 1`, [pid])).rows[0];

let passed = 0;
async function scenario(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  reset(); logs.length = 0;
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { process.exitCode = 1; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ') + '\n       logs: ' + JSON.stringify(logs.filter((l) => /repli|sheets|plates|image|pass/.test(l.msg)).slice(0, 14)).slice(0, 3000)); }
}

console.log('production runs');

await scenario('one account, serial: setup, voices, images in order, both gates, clips, Finalizat, the settings gate', async () => {
  const { pid, ids } = await film();
  const { outcome } = await produce(pid);
  assert.equal(outcome, 'done');
  const j = await jobOf(pid);
  assert.equal(j.phase, 'done');
  assert.equal(j.stage, 'done');
  // Setup: Livia qualifies for a turnaround (3 of 3 scenes is past the lead bar), the harbour for a plate.
  const sheet = fake.images.find((b) => /Character reference sheet/.test(b.prompt));
  assert.ok(sheet, 'a turnaround was drawn');
  assert.equal(sheet.captchaRetry, 5);
  assert.ok(fake.images.find((b) => /Establishing reference plate/.test(b.prompt)), 'a plate was drawn');
  const eo = (await db.query(`select editing_options from hov.project where id = $1`, [pid])).rows[0].editing_options;
  assert.ok(eo.castRefs.Livia && eo.castSheets.Livia.kind === 'turnaround' && eo.locationRefs['Ostia Harbour']);
  assert.equal((await db.query(`select count(*)::int as n from hov.sheet_media where project_id = $1`, [pid])).rows[0].n, 2, 'our own copies were kept');
  // Voices: the two scenes that speak, never the silent one.
  const spoken = fake.requests.filter((r) => r.path === 'elevenlabs').map((r) => r.body.text).sort();
  assert.deepEqual(spoken, ['Livia watches the ships come in.', 'The grain is weighed.']);
  // Images: in pass order, each carrying the references the batch attaches.
  const frames = fake.images.filter((b) => !/reference (sheet|plate)/i.test(b.prompt));
  assert.equal(frames.length, 3);
  assert.ok(frames.every((b) => b.captchaRetry === 5 && b.email === A0));
  assert.ok(Object.values(frames[0]).includes(eo.castRefs.Livia), 'the first frame carries the cast sheet');
  // Clips: the hook on Fast, the rest free on the manager.
  assert.equal(fake.submits.length, 3);
  assert.equal(fake.submits[0].model, 'veo-3.1-fast');
  assert.deepEqual(fake.submits.slice(1).map((s) => s.model), ['veo-3.1-lite-low-priority', 'veo-3.1-lite-low-priority']);
  assert.ok(fake.submits.every((s) => s.captchaRetry === 5 && s.email === A0 && /^One continuous take/.test(s.prompt)));
  const rows = await scenesOf(pid);
  assert.ok(rows.every((s) => s.production_status === 'Finalizat' && /\/m\/.+\/video\//.test(s.scene_final_url)));
  assert.equal(rows[2].voiceover_url, null, 'the silent scene has no take');
  assert.equal((await db.query(`select status from hov.project where id = $1`, [pid])).rows[0].status, 'Asamblare');
  void ids;
});

await scenario('three accounts and the pool: references copied, clips on the account that owns each still', async () => {
  const { pid } = await film({ editing: { flowAccounts: 3, videoPool: true }, scenes: 6 });
  const { outcome } = await produce(pid);
  assert.equal(outcome, 'done');
  // Replication: every stored sheet (turnaround + plate) onto the two other accounts.
  assert.deepEqual(fake.uploads.map((u) => u.email).sort(), [A1, A1, A2, A2]);
  const eo = (await db.query(`select editing_options from hov.project where id = $1`, [pid])).rows[0].editing_options;
  assert.equal(Object.keys(eo.flowRefs[A1]).length, 2);
  assert.equal(Object.keys(eo.flowRefs[A2]).length, 2);
  // Images split over the three accounts, and every reference is the account's own copy.
  const frames = fake.images.filter((b) => !/reference (sheet|plate)/i.test(b.prompt));
  assert.deepEqual([...new Set(frames.map((b) => b.email))].sort(), [A0, A1, A2]);
  for (const b of frames) for (const [k, v] of Object.entries(b)) if (k.startsWith('reference_')) assert.equal(unhex(v), b.email, `${k} of a frame on ${b.email} is ${unhex(v)}'s`);
  // Clips: each on its still's owner, the invited accounts on the paid lite model.
  const rows = await scenesOf(pid);
  const ownerOf = Object.fromEntries(rows.map((r) => [r.image_media_id, unhex(r.image_media_id)]));
  for (const s of fake.submits) {
    assert.equal(s.email, ownerOf[s.startImage] || unhex(s.startImage));
    if (s.email !== A0 && s.model !== 'veo-3.1-fast') assert.equal(s.model, 'veo-3.1-lite');
  }
  assert.ok(rows.every((s) => s.production_status === 'Finalizat'));
  assert.ok(logs.some((l) => l.msg === 'pool done'));
});

await scenario('the video filter refuses a clip: the still is steered and regenerated, the clip resubmitted and kept', async () => {
  const { pid, ids } = await film({ scenes: 2 });
  fake.jobScripts = [['done'], ['running', 'audio'], ['done']];
  const { outcome } = await produce(pid);
  assert.equal(outcome, 'done');
  const s = (await scenesOf(pid)).find((r) => r.id === ids[1]);
  assert.match(s.note || '', /^AUTO-REWRITE-VIDEO \(attempt 1\): .*AUDIO/);
  // The ladder regenerated the still (a media job the batch queued), with the steer as its adjustment.
  const regen = (await db.query(`select kind, phase, requested_by from hov.media_job where scene_id = $1 and kind = 'image'`, [ids[1]])).rows;
  assert.equal(regen.length, 1);
  assert.equal(regen[0].phase, 'done');
  assert.match(regen[0].requested_by, /^production:/);
  assert.equal(fake.submits.length, 3);
  assert.notEqual(fake.submits[2].startImage, fake.submits[1].startImage, 'the resubmit starts from the NEW still');
  assert.notEqual(fake.submits[2].seed, fake.submits[1].seed, 'and at a fresh seed');
  assert.equal(s.production_status, 'Finalizat');
});

await scenario('an image refused twice is rewritten twice; a drifted frame is re-rolled in strict mode', async () => {
  const { pid, ids } = await film({ scenes: 2 });
  // Sheets and plates take the first two answers; then scene 1 is refused twice and passes; scene 2 drifts once.
  fake.imageScript = ['ok', 'ok', 'refuse', 'refuse', 'ok', 'ok', 'ok'];
  // Scene 1's frame after two rewrites carries no references, so the judge is skipped for it (Judge Prep).
  fake.consistencyScript = [{ identity: 0.2, wardrobe: 0.9, place: 0.9, problems: ['a different face'] }];
  const { outcome } = await produce(pid);
  assert.equal(outcome, 'done');
  const rows = await scenesOf(pid);
  assert.equal((await db.query(`select image_prompt from hov.scene where id = $1`, [ids[0]])).rows[0].image_prompt, 'A calm quay at dusk, seen from behind.');
  assert.ok(logs.filter((l) => l.msg === 'image prompt rewritten').length === 2);
  assert.ok(logs.some((l) => l.msg === 'image re-roll' && l.scene === ids[1]));
  const last = fake.images.filter((b) => !/reference (sheet|plate)/i.test(b.prompt)).at(-1);
  assert.match(last.prompt, /STRICT/i, 'the re-roll is drawn in strict mode');
  assert.ok(rows.every((s) => s.production_status === 'Finalizat'));
});

await scenario('a throttled account cools down and the frame is retried', async () => {
  const { pid } = await film({ scenes: 1 });
  // One scene: Livia is in one scene only, so no sheet — the plate is the only setup image.
  fake.imageScript = ['ok', 'throttle', 'ok'];
  const { outcome } = await produce(pid);
  assert.equal(outcome, 'done');
  assert.ok(logs.some((l) => l.msg === 'image cooldown'));
});

await scenario('the gates hold until the producer approves, and dispatch a flagged regeneration nobody is doing', async () => {
  const { pid, ids } = await film({ scenes: 2 });
  let released = false;
  const hold = (s) => !released && s.id === ids[1];
  setTimeout(async () => { await db.query(`update hov.scene set regen_image = true where id = $1`, [ids[1]]); released = true; }, 150);
  const { outcome } = await produce(pid, { Aspect_Ratio: '16:9' }, { hold });
  assert.equal(outcome, 'done');
  const regen = (await db.query(`select phase, requested_by from hov.media_job where scene_id = $1 and kind = 'image'`, [ids[1]])).rows;
  assert.equal(regen.length, 1, 'the asset gate queued the flagged image');
  assert.match(regen[0].requested_by, /^production:/);
});

await scenario('a restart resumes the pool: the clip in flight is polled, never submitted twice', async () => {
  const { pid, ids } = await film({ editing: { videoPool: true }, scenes: 2 });
  fake.jobScripts = [['running', 'running', 'running', 'running', 'running', 'running', 'running', 'running', 'done'], ['done']];
  // Take the run away from its worker the moment the first clip is in flight.
  let taken = false;
  // (A little after the submit, so the job id is on the row: between the two is the one window a crash can still duplicate a clip, as in n8n.)
  const deps1 = { log: (msg, extra) => { log(msg, extra); if (msg === 'clip submitted' && !taken) { taken = true; setTimeout(() => db.query(`update hov.production_job set locked_by = 'someone-else' where project_id = $1`, [pid]), 15); } } };
  const first = await produce(pid, { Aspect_Ratio: '16:9' }, { deps: deps1 });
  assert.equal(first.outcome, 'dropped');
  const mid = await jobOf(pid);
  assert.equal(mid.stage, 'clips');
  assert.equal(mid.state.pool.inflight.length, 1);
  const submitsBefore = fake.submits.length;
  // The lease lapses; the run is claimed again and driven on.
  await db.query(`update hov.production_job set locked_by = null, locked_until = now() - interval '1 second' where project_id = $1`, [pid]);
  const job = await D.claimProduction(db, 'w1', 30);
  const stopMedia = new AbortController();
  const media = runMediaWorker({ db, config, render: {}, speaker, flow: flowImages('tok', fetch, BASE), ingest, clip, log }, stopMedia.signal);
  const stopProducer = producer(pid);
  const outcome = await driveProduction(job, deps());
  await stopProducer(); stopMedia.abort(); await media;
  assert.equal(outcome, 'done');
  assert.equal(fake.submits.length - submitsBefore, 1, 'only the second scene was submitted after the restart');
  assert.ok((await scenesOf(pid)).every((s) => s.production_status === 'Finalizat'));
  void ids;
});

await scenario('a clip flagged at the settings gate sends the run back for one more pass', async () => {
  const { pid, ids } = await film({ scenes: 1 });
  let flagged = false;
  const deps1 = { log: (msg, extra) => { log(msg, extra); } };
  const hold = () => false;
  // As the run reaches the settings gate, the producer asks for a new clip (the site clears the clip and sets the flag).
  const watcher = setInterval(async () => {
    const p = (await db.query(`select status from hov.project where id = $1`, [pid])).rows[0];
    if (!flagged && p.status === 'Setări Finale') { flagged = true; await db.query(`update hov.scene set regen_video = true, video_approved = false where id = $1`, [ids[0]]); }
  }, 1);
  const { outcome } = await produce(pid, { Aspect_Ratio: '16:9' }, { deps: deps1, hold });
  clearInterval(watcher);
  assert.equal(outcome, 'done');
  assert.ok(logs.some((l) => l.msg === 'settings gate: a clip was flagged, another pass') || logs.some((l) => l.msg === 'settings confirmed'));
});

await server.close();
await db.end();
await pgServer.stop();
console.log(`RESULT: ${process.exitCode ? 'FAIL' : 'OK'} ${passed} production scenarios`);
