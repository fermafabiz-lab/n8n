import type { PollStatus } from './types.ts';

// Both guards poll every 5 s ('Wait Render' / 'Wait Graphics' sleep BEFORE
// each check). Move the interval and these ceilings move with it, or the
// real ceiling silently shrinks.
//
// Assemble: 720 polls = 60 minutes, sized for the 12-minute brief (142
// downloads, 71 breath trims and an eight-minute encode), not the shortest.
export const ASSEMBLE_MAX_POLLS = 720;
// Graphics: 2160 polls = 3 hours at 720p; doubled at 1080p, which costs 2.09x
// per frame. A render slower than the guard allows fails at the cap and reads
// as a hang. (Measured under Remotion; Hyperframes is far faster, and the
// ceiling was deliberately left alone when it arrived.)
export const GRAPHICS_MAX_POLLS = 2160;

export type PollVerdict = PollStatus & { lost: boolean };

/** The HTTP-level error a failed poll carries: n8n puts it on `error`, as an object or a bare string. */
function httpError(j: PollStatus): string {
  if (j.error && typeof j.error === 'object') {
    const e = j.error as { message?: unknown; description?: unknown };
    return String(e.message || e.description || '');
  }
  return (typeof j.error === 'string' && !j.status) ? j.error : '';
}

/**
 * Render Guard. `polls` is n8n's $runIndex: how many checks came before this
 * one. A 404 means a Railway deploy replaced the container and wiped the
 * in-memory job map. The work died with it, so the answer is `lost` and the
 * caller resubmits.
 */
export function judgeAssemblePoll(j: PollStatus, polls: number): PollVerdict {
  const MAX_POLLS = ASSEMBLE_MAX_POLLS;
  if (/not.*found|404/i.test(httpError(j))) {
    if (polls > MAX_POLLS) throw new Error('assemble job lost repeatedly (' + polls + ' polls) — giving up.');
    return { lost: true, status: 'lost' };
  }
  const s = (j.status || '').toLowerCase();
  if (s === 'error') throw new Error('assemble failed: ' + (j.error || 'unknown'));
  if (polls > MAX_POLLS) throw new Error('assemble timed out after ' + polls + ' polls. Last status: ' + s);
  return Object.assign({ lost: false }, j);
}

/** Graphics Guard: the same shape for the `/render` pass, with the 1080p ceiling. */
export function judgeGraphicsPoll(j: PollStatus, polls: number, resolution?: string): PollVerdict {
  const MAX_POLLS = resolution === '1080p' ? GRAPHICS_MAX_POLLS * 2 : GRAPHICS_MAX_POLLS;
  if (/not.*found|404/i.test(httpError(j))) {
    if (polls > MAX_POLLS) throw new Error('graphics job lost repeatedly (' + polls + ' polls) — giving up.');
    return { lost: true, status: 'lost' };
  }
  const s = (j.status || '').toLowerCase();
  if (s === 'error') throw new Error('Remotion render failed: ' + (j.error || 'unknown'));
  if (polls > MAX_POLLS) throw new Error('Remotion render timed out after ' + polls + ' polls. Last status: ' + s + ' progress: ' + (j.progress || 0));
  return Object.assign({ lost: false }, j);
}
