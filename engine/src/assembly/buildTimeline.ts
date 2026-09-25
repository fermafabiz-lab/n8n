import { editingOptions } from './editingOptions.ts';
import { resolveTrigger } from './normalizeInput.ts';
import type { Clip, Fields, MusicPick, Triggers } from './types.ts';

// Level defaults, and the refuse-then-default rule they share. The same rule
// lives in platform/lib/data/derive.ts and in the orchestrator's 'Normalize
// Webhook Input'; change one, change all of them.
//
// SFX_LEVEL was 0.25 and judged too subtle on a real SFX-only render
// (Warhammer, 2026-08-10); 0.35 lifts the effects without touching the
// ducking. MUSIC_LEVEL is the gain assemble.mjs hard-coded for the bed before
// the brief grew a slider, so absence is today's sound.
export const SFX_LEVEL = 0.35;
export const MUSIC_LEVEL = 0.22;

const level = (value: unknown, fallback: number) => {
  const n = Number(value);
  return (Number.isFinite(n) && n >= 0.05 && n <= 1) ? Math.round(n * 100) / 100 : fallback;
};

export interface TimelineInput {
  clips: Clip[];
  triggers: Triggers;
  projectFields: Fields | undefined;
  /** Pick Music Track's result; read only when the film has music on. */
  music?: MusicPick | null;
}

/**
 * Build Timeline: the `/assemble` request (Railway's ffmpeg montage), plus
 * the bookkeeping fields n8n's item carried beside it. The server measures
 * each clip itself and silence-pads every voiceover to its scene's length.
 */
export function buildTimeline({ clips, triggers, projectFields, music }: TimelineInput) {
  if (!clips.length) throw new Error('No clips to assemble.');
  const sceneChapters = clips.map(c => c.chapter || 0);

  // Aspect: trigger input -> webhook body -> project field -> 16:9.
  const trig = resolveTrigger(triggers);
  const pf = projectFields || {};
  const aspect = (trig.Aspect === '9:16' || pf['Format'] === '9:16') ? '9:16' : '16:9';

  const opts = editingOptions(pf);

  // Two independent switches, both sent explicitly — the server's implicit
  // defaults must never decide this. sfx: the clips' own Veo ambience, ON by
  // default (silent footage under a voice sounds dead). music: the Muzica bed
  // AND the synthesized accents at the cuts, one opt-IN switch.
  const sfxOn = opts.sfx !== false;
  const sfxLevel = level(opts.sfxLevel, SFX_LEVEL);
  const musicOn = opts.music === true;
  let musicUrl: string | undefined;
  if (musicOn) musicUrl = (music && music.url) || undefined;
  const musicLevel = level(opts.musicLevel, MUSIC_LEVEL);

  // 720p unless the project says otherwise, and only /upscale-film does. The
  // montage and the graphics drawn over it must agree on the canvas, and the
  // graphics poll ceiling doubles at 1080p.
  const resolution = opts.resolution === '1080p' ? '1080p' : '720p';

  // The breath between one scene's narration and the next cut. Kids story
  // asks for real pauses (0.8s relaxed, 1.2s read-along); /assemble clamps.
  const sceneGap = (() => {
    if (opts.category !== 'kids') return 0.35;
    return String((opts.categoryOptions || {}).narration_pace || '') === 'very_slow' ? 1.2 : 0.8;
  })();

  // THE HOOK (2026-09-11). With a hookPlan, chapter-0 scenes are teaser
  // shots: held for the planned seconds, cut on the last word, and given
  // 0.45s of air after a spoken beat (more than a scene's 0.35: a teaser
  // line has to land on its own). A film with no plan times as it always did.
  const hookPlan = (opts.hookPlan && typeof opts.hookPlan === 'object') ? opts.hookPlan : null;
  const scenes = clips.map(c => {
    const s: Record<string, unknown> = {
      videoUrl: c.url,
      audioUrl: (c.voiceUrl && c.voiceUrl.startsWith('http')) ? c.voiceUrl : undefined,
    };
    if (hookPlan && (c.chapter || 0) === 0) {
      const planned = Number(c.seconds);
      s.holdSeconds = (Number.isFinite(planned) && planned > 0) ? Math.min(20, Math.max(1.5, planned)) : 3;
      s.minSeconds = 1.6;
      s.gapSeconds = 0.45;
    }
    return s;
  });

  // THE CLOSING HOLD (2026-09-16). The last VOICED scene holds 1.5s after its
  // narration on a Story, 2s on a Kids story; documentary and cinematic keep
  // the classic cut. An absent category is a Story, the site's default.
  const closingCategory = (opts.category === undefined || opts.category === '') ? 'story' : String(opts.category);
  const closingHold = closingCategory === 'kids' ? 2 : closingCategory === 'story' ? 1.5 : null;
  if (closingHold !== null) {
    for (let i = scenes.length - 1; i >= 0; i--) {
      if (scenes[i].audioUrl) { scenes[i].gapSeconds = closingHold; break; }
    }
  }
  const hookRiser = !!hookPlan && ['cliffhanger', 'action'].includes(String(hookPlan.style || ''));

  return {
    body: {
      scenes,
      sceneChapters,
      hookRiser,
      musicUrl,
      musicVolume: musicOn ? musicLevel : undefined,
      aspect,
      resolution,
      nativeAudio: sfxOn ? sfxLevel : false,
      stingers: musicOn,
      sceneGap,
    },
    resolution,
    sceneCount: scenes.length,
    tone: pf.Tonalitate || 'default',
    aspect,
    musicUrl: musicUrl || null,
    sfx: sfxOn,
    sfxLevel: sfxOn ? sfxLevel : 0,
    music: musicOn,
    musicLevel: musicOn ? musicLevel : 0,
  };
}

export type Timeline = ReturnType<typeof buildTimeline>;
