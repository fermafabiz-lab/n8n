// Voice takes as media_job rows, against a real Postgres engine (PGlite with
// every db/NNN_*.sql, db/017 included) and one fake server playing both
// ElevenLabs and Railway's /tts-multi. No network.
//
//   cd engine && npm run test:voice      (part of npm run check)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { pool } from '../src/db.ts';
import { claimMedia, enqueueMedia } from '../src/media/db.ts';
import { runMediaWorker } from '../src/media/loop.ts';
import { railway } from '../src/railway.ts';
import { elevenLabs } from '../src/voice/elevenlabs.ts';
import * as V from '../src/voice/voice.ts';
import { driveVoice } from '../src/voice/worker.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(here, '..', '..', 'db');
const pglite = await PGlite.create();
for (const f of fs.readdirSync(DB_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) await pglite.exec(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
const PG_PORT = 55700 + Math.floor(Math.random() * 90);
const pgServer = new PGLiteSocketServer({ db: pglite, port: PG_PORT, host: '127.0.0.1' });
await pgServer.start();
const db = pool(`postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`, 1);

// --- One fake for ElevenLabs and Railway ------------------------------------------
const fake = { requests: [], elStatus: 200, multi: new Map(), multiScript: ['running', 'done'] };
const read = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const server = http.createServer(async (req, res) => {
  const raw = req.method === 'POST' ? await read(req) : '';
  const url = new URL(req.url, 'http://x');
  const body = raw ? JSON.parse(raw) : undefined;
  fake.requests.push({ method: req.method, path: url.pathname, query: url.search, body, headers: req.headers });
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  let m;
  if ((m = /^\/v1\/text-to-speech\/(.+)$/.exec(url.pathname))) {
    if (fake.elStatus !== 200) return json(fake.elStatus, { detail: { status: 'quota_exceeded', message: 'You have 0 credits' } });
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    return res.end(Buffer.from(`MP3 ${m[1]} ${body.text}`));
  }
  if (req.method === 'POST' && url.pathname === '/tts-multi') {
    const id = `multi-${fake.multi.size + 1}`;
    fake.multi.set(id, [...fake.multiScript]);
    return json(200, { jobId: id });
  }
  if ((m = /^\/tts-multi\/(.+)\/status$/.exec(url.pathname))) {
    const s = fake.multi.get(m[1]);
    const step = s.length > 1 ? s.shift() : s[0];
    if (step === 'error') return json(200, { status: 'error', error: 'segment 2 failed' });
    return json(200, step === 'done' ? { status: 'done', outputUrl: `${BASE}/output/${m[1]}.mp3` } : { status: 'running' });
  }
  if (url.pathname.startsWith('/output/')) { res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end(Buffer.from('MULTI MP3')); }
  json(404, {});
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;
const MEDIA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hov-voice-'));
const config = {
  databaseUrl: '', renderUrl: BASE, renderApiKey: 'k', n8nWebhookBase: '', mediaRoot: MEDIA_ROOT, mediaBaseUrl: 'https://media.example',
  pollMs: 5, leaseSeconds: 30, concurrency: 1, workerId: 'w1', maxPollNetworkErrors: 3, pgPoolMax: 1, elevenLabsKey: 'el-key', voiceConcurrency: 2,
};
const logs = [];
const deps = (over = {}) => ({
  db, config: { ...config, ...over }, speaker: elevenLabs(over.elevenLabsKey ?? 'el-key', fetch, BASE), render: railway(BASE, 'k'),
  multiPollMs: 5, log: (msg, extra) => logs.push({ msg, ...extra }),
});

// --- Fixtures -------------------------------------------------------------------------
const V1 = 'elevenlabs_AAAAAAAAAAAAAAAAAAAA', V2 = 'elevenlabs_BBBBBBBBBBBBBBBBBBBB', V3 = 'elevenlabs_CCCCCCCCCCCCCCCCCCCC';
let seq = 0;
async function film(editing = {}, lines = ['[NARRATOR] The harbour  opens at dawn.'], voice = V1) {
  const pid = `recVoice${String(++seq).padStart(3, '0')}xxxxxx`.slice(0, 17);
  await db.query(`insert into hov.project (id, name, voice_id, editing_options) values ($1, 'Voice test', $2, $3)`, [pid, voice, JSON.stringify(editing)]);
  const ids = [];
  for (const [i, t] of lines.entries()) {
    const r = await db.query(`insert into hov.scene (project_id, narration, scene_order, regen_voice, voice_approved, note) values ($1, $2, $3, true, true, 'old note') returning id`, [pid, t, 101 + i]);
    ids.push(r.rows[0].id);
  }
  return { pid, ids };
}
const sceneRow = async (id) => (await db.query(`select voiceover_url, production_status, voice_approved, regen_voice, note from hov.scene where id = $1`, [id])).rows[0];
const jobRow = async (id) => (await db.query(`select phase, result, error from hov.media_job where scene_id = $1 order by id desc limit 1`, [id])).rows[0];
const claim = () => claimMedia(db, 'w1', 30, ['voice']);
const el = () => fake.requests.filter((r) => r.path.startsWith('/v1/text-to-speech/'));

let passed = 0;
async function scenario(name, fn) {
  fake.requests = []; fake.elStatus = 200; fake.multiScript = ['running', 'done']; logs.length = 0;
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { process.exitCode = 1; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ') + '\n       logs: ' + JSON.stringify(logs.slice(-4))); }
}

console.log('voice jobs');

await scenario('one narrator: the ElevenLabs request, the take in /media, the scene written as VR Write Voice did', async () => {
  const { pid, ids } = await film({ voice: { stability: 0.4, similarity: 0.8, style: 0.1 } });
  assert.ok(await enqueueMedia(db, ids[0], 'voice', {}, 'test'));
  assert.equal(await driveVoice(await claim(), deps()), 'done');
  const [r] = el();
  assert.equal(r.path, `/v1/text-to-speech/${V1.replace('elevenlabs_', '')}`);
  assert.equal(r.query, '?output_format=mp3_44100_128');
  assert.equal(r.headers['xi-api-key'], 'el-key');
  assert.deepEqual(r.body, { text: 'The harbour opens at dawn.', model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true } });
  const s = await sceneRow(ids[0]);
  assert.match(s.voiceover_url, new RegExp(`^https://media\\.example/voices/${ids[0]}/[0-9a-f]{32}\\.mp3$`));
  assert.deepEqual({ ...s, voiceover_url: undefined }, { voiceover_url: undefined, production_status: 'Așteaptă Aprobare Voce', voice_approved: false, regen_voice: false, note: '' });
  assert.ok(fs.existsSync(path.join(MEDIA_ROOT, s.voiceover_url.replace('https://media.example/', ''))));
  const j = await jobRow(ids[0]);
  assert.equal(j.phase, 'done');
  assert.equal(j.result.voice_id, V1);
  void pid;
});

await scenario('no voice settings on the film: none are sent', async () => {
  const { ids } = await film({});
  await enqueueMedia(db, ids[0], 'voice');
  await driveVoice(await claim(), deps());
  assert.equal('voice_settings' in el()[0].body, false);
});

await scenario('chapters mode: chapter 1 reads with cast[0]', async () => {
  const { ids } = await film({ multiVoiceMode: 'chapters', cast: [V2, V3] });
  await enqueueMedia(db, ids[0], 'voice');
  await driveVoice(await claim(), deps());
  assert.equal(el()[0].path, `/v1/text-to-speech/${V2.replace('elevenlabs_', '')}`);
});

await scenario('the audio panel pin beats the mode rule (n8n ignored it)', async () => {
  const { ids } = await film({ multiVoiceMode: 'chapters', cast: [V2] });
  await enqueueMedia(db, ids[0], 'voice', { voice_id: V3 });
  await driveVoice(await claim(), deps());
  assert.equal(el()[0].path, `/v1/text-to-speech/${V3.replace('elevenlabs_', '')}`);
  assert.equal((await jobRow(ids[0])).result.pinned, true);
});

await scenario('characters mode: /tts-multi with the picker\'s segments, polled, downloaded, stored', async () => {
  const lines = ['[NARRATOR] Dawn. [CHARACTER: Maria] Where is he? [CHARACTER: Ion] Here.'];
  const editing = { multiVoiceMode: 'characters', cast: [V2, V3], voice: { stability: 0.5, similarity: 0.5, style: 0 } };
  const { ids } = await film(editing, lines);
  await enqueueMedia(db, ids[0], 'voice');
  assert.equal(await driveVoice(await claim(), deps()), 'done');
  const submit = fake.requests.find((r) => r.path === '/tts-multi');
  const scene = { id: ids[0], fields: { 'Script Scenă': lines[0], 'Ordine Scenă': 101 } };
  const pick = V.pickVoice({ projectVoice: V1, projectFields: { 'Editing Options': JSON.stringify(editing) }, scene, allScenes: [scene] });
  assert.equal(pick.multi, true);
  assert.deepEqual(submit.body, V.multiBody(pick, { 'Editing Options': JSON.stringify(editing) }));
  assert.equal(submit.headers['x-api-key'], 'k');
  assert.equal(el().length, 0, 'no single-voice call');
  assert.equal((await jobRow(ids[0])).result.multi, true);
});

await scenario('multi-voice error: failed with the server\'s reason, flag released', async () => {
  const { ids } = await film({ multiVoiceMode: 'characters', cast: [V2] }, ['[CHARACTER: Ana] Hello.']);
  fake.multiScript = ['running', 'error'];
  await enqueueMedia(db, ids[0], 'voice');
  assert.equal(await driveVoice(await claim(), deps()), 'failed');
  assert.equal((await jobRow(ids[0])).error, 'multi-voice TTS failed: segment 2 failed');
  const s = await sceneRow(ids[0]);
  assert.equal(s.regen_voice, false);
  assert.equal(s.note, 'Voice regeneration failed: multi-voice TTS failed: segment 2 failed');
});

await scenario('ElevenLabs refuses (quota): failed, reason on the scene, the old take untouched', async () => {
  const { ids } = await film({});
  await db.query(`update hov.scene set voiceover_url = 'https://drive.google.com/uc?export=download&id=OLD' where id = $1`, [ids[0]]);
  fake.elStatus = 401;
  await enqueueMedia(db, ids[0], 'voice');
  assert.equal(await driveVoice(await claim(), deps()), 'failed');
  const s = await sceneRow(ids[0]);
  assert.equal(s.voiceover_url, 'https://drive.google.com/uc?export=download&id=OLD');
  assert.equal(s.regen_voice, false);
  assert.match(s.note, /^Voice regeneration failed: ElevenLabs answered 401: .*0 credits/);
});

await scenario('a Cinematic film has nothing to speak: failed without calling anyone', async () => {
  const { ids } = await film({ category: 'cinematic' });
  await enqueueMedia(db, ids[0], 'voice');
  assert.equal(await driveVoice(await claim(), deps()), 'failed');
  assert.equal(fake.requests.length, 0);
  assert.match((await sceneRow(ids[0])).note, /Cinematic film has no narration/);
});

await scenario('no key on the engine: a clear failure, not a hang', async () => {
  const { ids } = await film({});
  await enqueueMedia(db, ids[0], 'voice');
  assert.equal(await driveVoice(await claim(), deps({ elevenLabsKey: '' })), 'failed');
  assert.match((await jobRow(ids[0])).error, /ELEVENLABS_API_KEY is not set/);
});

await scenario('one active take per scene, by the database', async () => {
  const { ids } = await film({});
  assert.ok(await enqueueMedia(db, ids[0], 'voice'));
  assert.equal(await enqueueMedia(db, ids[0], 'voice'), null);
  await driveVoice(await claim(), deps());
  assert.ok(await enqueueMedia(db, ids[0], 'voice'), 'a finished take frees the scene');
  await db.query(`update hov.media_job set phase = 'stopped' where scene_id = $1 and phase = 'queued'`, [ids[0]]);
});

await scenario('stopped while the multi-voice job runs: the worker lets go, writes nothing', async () => {
  const { ids } = await film({ multiVoiceMode: 'characters', cast: [V2] }, ['[CHARACTER: Ana] Hello.']);
  fake.multiScript = ['running', 'running', 'running', 'running', 'running', 'running', 'running', 'running', 'done'];
  await enqueueMedia(db, ids[0], 'voice');
  const run = driveVoice(await claim(), deps());
  for (let i = 0; i < 200 && !fake.requests.some((r) => r.path.endsWith('/status')); i++) await new Promise((r) => setTimeout(r, 5));
  await db.query(`update hov.media_job set phase = 'stopped', finished_at = now() where scene_id = $1 and phase = 'running'`, [ids[0]]);
  assert.equal(await run, 'dropped');
  const s = await sceneRow(ids[0]);
  assert.equal(s.voiceover_url, null);
  assert.equal(s.note, 'old note');
});

await scenario('the loop drains voice jobs two at a time and stops cleanly', async () => {
  const f1 = await film({}, ['One.', 'Two.', 'Three.']);
  for (const id of f1.ids) await enqueueMedia(db, id, 'voice');
  const stop = new AbortController();
  const loop = runMediaWorker(deps(), stop.signal);
  for (let i = 0; i < 400; i++) {
    const r = await db.query(`select count(*)::int n from hov.media_job where scene_id = any($1) and phase = 'done'`, [f1.ids]);
    if (r.rows[0].n === 3) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  stop.abort();
  await loop;
  const r = await db.query(`select phase from hov.media_job where scene_id = any($1)`, [f1.ids]);
  assert.deepEqual(r.rows.map((x) => x.phase), ['done', 'done', 'done']);
});

await db.end();
await pgServer.stop();
await pglite.close();
server.close();
fs.rmSync(MEDIA_ROOT, { recursive: true, force: true });
console.log(`\n${process.exitCode ? 'RESULT: FAIL' : 'RESULT: OK'} ${passed} voice scenarios`);
