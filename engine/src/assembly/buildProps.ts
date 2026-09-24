import { editingOptions } from './editingOptions.ts';
import { resolveTrigger } from './normalizeInput.ts';
import type { AtRow, Clip, Fields, PollStatus, Triggers } from './types.ts';

export interface PropsInput {
  clips: Clip[];
  triggers: Triggers;
  projectFields: Fields | undefined;
  /** The newest hov.at_script row for the project, or null when there is none. */
  script: AtRow | null | undefined;
  /** The assemble job's final status: `{outputUrl, verify}`. */
  assembled: PollStatus;
}

/** Chapter titles from the script's `[CHAPTER n: title]` markers. */
export function chapterTitlesOf(script: AtRow | null | undefined): Record<string, string> {
  const chapterTitles: Record<string, string> = {};
  try {
    const sc = ((script as AtRow).fields || {})['Script Content'] || '';
    const re = /\[CHAPTER\s+(\d+)\s*:\s*([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sc))) chapterTitles[m[1]] = m[2].trim();
  } catch (e) {}
  return chapterTitles;
}

/**
 * Build Remotion Props: the graphics pass (hook, chapter markers, captions,
 * grade, end screen) over the assembled montage. Scene timings and real
 * narration lengths come from the assemble step's own ffprobe verification,
 * so captions pace with the actual voice.
 */
export function buildProps({ clips, triggers, projectFields, script, assembled }: PropsInput) {
  const status = assembled;
  if (!status.outputUrl) throw new Error('assemble outputUrl missing');
  const v = status.verify || {};
  const starts = v.sceneStartsSeconds || [];
  const voices = v.voiceDurationsSeconds || [];
  const total = v.videoSeconds || 0;
  const scenes = clips.map((c, i) => {
    const start = starts[i] ?? (i * 8);
    const end = (i + 1 < starts.length) ? starts[i + 1] : total;
    return {
      narratorText: c.narratorText || '',
      startSeconds: start,
      durationSeconds: Math.max(0.5, end - start),
      chapter: c.chapter || 0,
      speechSeconds: voices[i] || undefined,
    } as Record<string, unknown>;
  });
  const pf = projectFields || {};

  // Aspect + captions: trigger input -> webhook body -> project fields -> defaults.
  const trig = resolveTrigger(triggers, true);
  const aspectRatio = (trig.Aspect === '9:16' || pf['Format'] === '9:16') ? '9:16' : '16:9';

  // Per-overlay toggles from the site form. Missing field/old projects = everything on.
  const opts = editingOptions(pf);

  // How hard the montage re-frames across a cut. Sent explicitly and 0 by
  // default: left to Remotion it derived 1 from most tones, which read as a
  // zoom bug on every two-hander (reported three times; it was this setting).
  const montageIntensity = [0, 1, 2].includes(opts.montageIntensity) ? opts.montageIntensity : 0;

  // A cinematic film's Script Scenă is an unspoken shot note. Captions, the
  // chapter card's fallback title and derived figure cards all read that
  // field as speech; one flag tells the render, and all three obey it.
  const narrationIsSpoken = opts.category !== 'cinematic';
  const showCaptions = !(trig.No_Captions === 'yes' || pf['Fără Subtitrări'] === true) && narrationIsSpoken;

  return {
    body: {
      finalVideoUrl: status.outputUrl,
      projectTitle: pf['Nume Proiect'] || 'Video Factory',
      scenes,
      tone: pf['Tonalitate'] || 'Dark',
      channelName: 'Video Factory',
      aspectRatio,
      showCaptions,
      narrationIsSpoken,
      montageIntensity,
      // The cold open Scripting planned; a film without one opens on its footage.
      hookPlan: (opts.hookPlan && typeof opts.hookPlan === 'object') ? opts.hookPlan : undefined,
      showChapterCards: opts.chapterCards !== false,
      // Off means no cards of ANY kind, derived figure cards included
      // (2026-09-12: the switch used to silence only the motif half).
      showTextCards: opts.drawnCards !== false,
      showEndScreen: opts.endScreen !== false,
      chapterTitles: chapterTitlesOf(script),
    } as Record<string, any>,
  };
}

export type RenderBody = ReturnType<typeof buildProps>['body'];
