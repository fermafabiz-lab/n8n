// Voice synthesis: which voice reads a scene, and what exactly is sent.
//
// One function where n8n has two copies: Media Generation's `AB Pick Voice`
// (the film's production pass) and Claude Scripting's `VR Pick Voice` (the
// `scene-voice-regen` webhook). Their logic is identical; they differ only in
// where they read the project's default voice (the batch trigger's
// `Voice_ID` vs the project row's `Voice ID`, the same stored value) and the
// film's scenes. engine/check.mjs holds this to BOTH bodies.
import type { AtRow, Fields } from '../assembly/types.ts';

/** Bella: every film made before a narrator could be picked reads with her. */
export const DEFAULT_VOICE = 'elevenlabs_hpp4J3VqNfWAUOO0d1Us';
export const MODEL = 'eleven_multilingual_v2';
export const OUTPUT_FORMAT = 'mp3_44100_128';
/** The pause /tts-multi leaves between two speakers. */
export const MULTI_GAP_MS = 350;

export interface Segment {
  text: string;
  voice_id: string;
}
export interface VoicePick {
  voice_id: string;
  multi: boolean;
  segments: Segment[];
}

/** Stored voice ids carry the `elevenlabs_` prefix; the `_` is the validity test in five places. */
export const isVoiceId = (v: unknown): v is string => typeof v === 'string' && v.includes('_');

/**
 * The voice (or voices) for one scene.
 * - `chapters`: the chapter's narrator — an explicit pick from the audio
 *   panel, else cast[N-1] (looping); the hook keeps the main narrator unless
 *   it was given a voice of its own.
 * - `characters`: [NARRATOR]/[CHARACTER: Name] tags split the text into
 *   segments, each with its speaker's voice; characters get castAssign, else
 *   their order of first appearance across the film.
 * - anything else: the project narrator.
 */
export function pickVoice(input: {
  /** The project's narrator as stored (`Voice ID`). */
  projectVoice: unknown;
  projectFields: Fields | undefined;
  scene: AtRow;
  /** Every scene of the film, for the characters' order of appearance. */
  allScenes: AtRow[];
}): VoicePick {
  const pv = String(input.projectVoice || '');
  const fallback = pv.includes('_') ? pv : DEFAULT_VOICE;
  let voice = fallback, mode = 'off';
  let cast: string[] = [];
  let assign: Record<string, unknown> = {};
  let chapterVoices: Record<string, unknown> = {};
  try {
    const opts = JSON.parse((input.projectFields || {})['Editing Options'] || '{}') || {};
    mode = String(opts.multiVoiceMode || 'off');
    cast = (Array.isArray(opts.cast) ? opts.cast : []).filter((v: unknown) => typeof v === 'string' && v.includes('_'));
    assign = (opts.castAssign && typeof opts.castAssign === 'object') ? opts.castAssign : {};
    chapterVoices = (opts.chapterVoices && typeof opts.chapterVoices === 'object') ? opts.chapterVoices : {};
  } catch (e) {}
  const f = input.scene.fields || {};
  const text = String(f['Script Scenă'] || '');
  if (mode === 'chapters' && (cast.length || Object.keys(chapterVoices).length)) {
    const o = Number(f['Ordine Scenă']);
    const chapter = Number.isFinite(o) ? Math.floor(o / 100) : 0;
    const picked = chapterVoices[chapter > 0 ? String(chapter) : 'hook'];
    if (typeof picked === 'string' && picked.includes('_')) voice = picked;
    else if (chapter > 0 && cast.length) voice = cast[(chapter - 1) % cast.length];
  }
  let multi = false;
  const segments: Segment[] = [];
  if (mode === 'characters' && cast.length) {
    const all = input.allScenes.slice()
      .sort((a, b) => (Number((a.fields || {})['Ordine Scenă']) || 0) - (Number((b.fields || {})['Ordine Scenă']) || 0));
    const order: string[] = [];
    for (const sc of all) {
      const t = String((sc.fields || {})['Script Scenă'] || '');
      for (const m of t.matchAll(/\[\s*CHARACTER:\s*([^\]]+)\]/gi)) {
        const n = m[1].trim();
        if (n && !order.includes(n)) order.push(n);
      }
    }
    const voiceFor = (name: string) => {
      const a = assign[name];
      if (typeof a === 'string' && a.includes('_')) return a;
      const i = order.indexOf(name);
      return cast[(i >= 0 ? i : 0) % cast.length];
    };
    let cur = fallback;
    for (const tk of text.split(/(\[[^\[\]]{1,60}\])/)) {
      if (/^\[\s*NARRATOR\s*\]$/i.test(tk)) { cur = fallback; continue; }
      const cm = tk.match(/^\[\s*CHARACTER:\s*([^\]]+)\]$/i);
      if (cm) { cur = voiceFor(cm[1].trim()); continue; }
      const t = tk.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const last = segments[segments.length - 1];
      if (last && last.voice_id === cur) last.text += ' ' + t;
      else segments.push({ text: t, voice_id: cur });
    }
    // Only worth the multi pipeline when a second voice actually appears.
    multi = segments.length > 0 && segments.some((s) => s.voice_id !== fallback);
  }
  return { voice_id: voice, multi, segments };
}

/**
 * The audio panel's per-scene pin, which beats every mode rule for this one
 * synthesis. The site has always sent it (`voice_id` on scene-voice-regen)
 * and CLAUDE.md documents it as working, but the live `VR Pick Voice` never
 * read it — so the engine is the first to honour it. A pin makes the take
 * single-voice, whatever the mode.
 */
export function applyPin(pick: VoicePick, pin: unknown): VoicePick {
  return isVoiceId(pin) ? { voice_id: pin, multi: false, segments: [] } : pick;
}

/** What is spoken: speaker tags are routing, not narration (same strip as the captions). */
export function speakText(scene: AtRow): string {
  return String((scene.fields || {})['Script Scenă'] || '').replace(/\[[^\]]{0,60}\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The film's voice settings (Editing Options.voice), or null for ElevenLabs'
 * own defaults. All three sliders must be valid numbers in [0, 1], or none
 * is sent — a half-set tone would be a voice nobody chose.
 */
export function voiceSettings(projectFields: Fields | undefined): { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean } | null {
  try {
    const t = (JSON.parse((projectFields || {})['Editing Options'] || '{}') || {}).voice;
    const u = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null; };
    const s = u(t && t.stability), m = u(t && t.similarity), y = u(t && t.style);
    return (s !== null && m !== null && y !== null) ? { stability: s, similarity_boost: m, style: y, use_speaker_boost: t.speakerBoost !== false } : null;
  } catch (e) {
    return null;
  }
}

/** The /tts-multi request (Railway), for a scene with more than one speaker. */
export function multiBody(pick: VoicePick, projectFields: Fields | undefined) {
  return {
    segments: pick.segments,
    gapMs: MULTI_GAP_MS,
    voiceTone: (() => { try { return (JSON.parse((projectFields || {})['Editing Options'] || '{}') || {}).voice || null; } catch (e) { return null; } })(),
  };
}

/**
 * A scene with nothing to say gets no take: an empty line, or a Cinematic
 * film, whose Script Scenă is an unspoken shot note (AB No Speech?).
 */
export function noSpeech(scene: AtRow, projectFields: Fields | undefined): boolean {
  try { if (String((scene.fields || {})['Script Scenă'] || '').trim() === '') return true; } catch (e) {}
  try { return JSON.parse((projectFields || {})['Editing Options'] || '{}').category === 'cinematic'; } catch (e) { return false; }
}

/** The multi-voice job's poll ceiling (AB/VR Multi Guard): 40 polls, 10 s apart. */
export const MULTI_MAX_POLLS = 40;
