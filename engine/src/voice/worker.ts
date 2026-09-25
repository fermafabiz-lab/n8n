// One voice take for one scene, as a media_job — what `scene-voice-regen`
// (Claude Scripting's `VR *` tail) did, minus its two failure modes:
// - a death anywhere no longer strands `Regenerează Voce` (a failure writes
//   the reason and releases the flag, like Mark Scene Regen Failed does for
//   text), and
// - the take lands in /media, not Drive, so review plays it from the box
//   (Drive answered 593-1383 ms a seek; CLAUDE.md, scene-lag).
import { setTimeout as sleepFor } from 'node:timers/promises';
import type pg from 'pg';
import type { Config } from '../config.ts';
import { type MediaJob, finishMedia, heartbeat, loadSceneContext, writeScene } from '../media/db.ts';
import { NetworkError, type RenderServer } from '../railway.ts';
import { storeBytes } from '../store.ts';
import type { Speaker } from './elevenlabs.ts';
import { MULTI_MAX_POLLS, applyPin, multiBody, noSpeech, pickVoice, speakText, voiceSettings } from './voice.ts';

export interface VoiceDeps {
  db: pg.Pool;
  config: Config;
  speaker: Speaker;
  render: RenderServer;
  fetchImpl?: typeof fetch;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  /** Between two polls of a multi-voice job; 10 s in n8n (AB/VR Wait Multi). */
  multiPollMs?: number;
}

class Dropped extends Error {}

export async function driveVoice(job: MediaJob, deps: VoiceDeps): Promise<'done' | 'failed' | 'dropped'> {
  const { db, config } = deps;
  const log = (msg: string, extra: Record<string, unknown> = {}) =>
    (deps.log || ((m, e) => console.log(JSON.stringify({ at: new Date().toISOString(), msg: m, ...e }))))(msg, { mediaJob: job.id, scene: job.scene_id, kind: 'voice', ...extra });
  const alive = async () => { if (!(await heartbeat(db, job, config.workerId, config.leaseSeconds))) throw new Dropped('stopped or taken over'); };
  try {
    const { scene, project, allScenes } = await loadSceneContext(db, job.scene_id);
    if (!scene || !project) throw new Error('scene or project not found');
    const pf = project.fields || {};
    if (noSpeech(scene, pf)) throw new Error(pf['Editing Options'] && /"category"\s*:\s*"cinematic"/.test(String(pf['Editing Options'])) ? 'a Cinematic film has no narration to speak' : 'this scene has no narration to speak');
    const pick = applyPin(pickVoice({ projectVoice: pf['Voice ID'], projectFields: pf, scene, allScenes }), job.request?.voice_id);

    let audio: Buffer;
    if (pick.multi) {
      const id = await deps.render.submitTtsMulti(multiBody(pick, pf));
      let polls = 0, outputUrl: string | undefined;
      for (;;) {
        await sleepFor(deps.multiPollMs ?? 10_000);
        await alive();
        let st;
        try { st = await deps.render.status('tts-multi', id); } catch (e) { if (e instanceof NetworkError) continue; throw e; }
        const s = String(st.status || '').toLowerCase();
        if (s === 'error') throw new Error('multi-voice TTS failed: ' + (st.error || 'unknown'));
        if (++polls > MULTI_MAX_POLLS) throw new Error(`multi-voice TTS timed out after ${polls} polls. Last status: ${s}`);
        if (s === 'done') { outputUrl = st.outputUrl; break; }
      }
      const res = await (deps.fetchImpl || fetch)(String(outputUrl), { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`downloading the multi-voice take answered ${res.status}`);
      audio = Buffer.from(await res.arrayBuffer());
    } else {
      audio = await deps.speaker.speak(pick.voice_id, speakText(scene), voiceSettings(pf));
    }
    await alive();

    const stored = await storeBytes({ buf: audio, dir: `voices/${job.scene_id}`, ext: 'mp3', mediaRoot: config.mediaRoot, mediaBaseUrl: config.mediaBaseUrl });
    if (!stored.url) throw new Error('MEDIA_BASE_URL is not set: the take was stored but has no public URL');
    // The same fields VR Write Voice writes.
    await writeScene(db, job.scene_id, {
      'Voiceover URL': stored.url,
      'Status Producție Scenă': 'Așteaptă Aprobare Voce',
      'Aprobare Voce': false,
      'Regenerează Voce': false,
      'Observații Scenă': '',
    });
    await finishMedia(db, job, config.workerId, 'done', { result: { url: stored.url, bytes: stored.bytes, voice_id: pick.voice_id, multi: pick.multi, pinned: job.request?.voice_id ? true : false } });
    log('voice done', { url: stored.url, bytes: stored.bytes, voice: pick.voice_id, multi: pick.multi });
    return 'done';
  } catch (e) {
    if (e instanceof Dropped) { log('voice dropped', { reason: e.message }); return 'dropped'; }
    const message = (e as Error).message || String(e);
    log('voice failed', { error: message });
    // Release the flag and say why, so the badge ends and the producer can
    // read it — the stranded-flag trap, closed at the source.
    await writeScene(db, job.scene_id, { 'Regenerează Voce': false, 'Observații Scenă': `Voice regeneration failed: ${message}`.slice(0, 1000) }).catch(() => {});
    await finishMedia(db, job, config.workerId, 'failed', { error: message.slice(0, 4000) }).catch(() => {});
    return 'failed';
  }
}
