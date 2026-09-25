// Final Assembly as code. Each module is one n8n Code node of workflow
// `BY22Vlhh20Xdkr5Z` (live version 309157bd), ported with the same logic and
// pinned to it by engine/check.mjs. The two compositions below are the
// requests the worker sends; everything between them is I/O (Postgres, the
// Drive listings, polling Railway), which is phase 2.

import { attachMotifCards } from './attachMotifCards.ts';
import { buildProps } from './buildProps.ts';
import { buildTimeline } from './buildTimeline.ts';
import { captionColour } from './captionColour.ts';
import { graphicStyles } from './graphicStyles.ts';
import { prepareClips } from './prepareClips.ts';
import { sourceWatermark } from './sourceWatermark.ts';
import type { AtRow, MusicPick, PollStatus, Triggers } from './types.ts';

export { attachMotifCards, buildProps, buildTimeline, captionColour, graphicStyles, prepareClips, sourceWatermark };
export { chapterTitlesOf } from './buildProps.ts';
export { editingOptions } from './editingOptions.ts';
export { judgeAssemblePoll, judgeGraphicsPoll, ASSEMBLE_MAX_POLLS, GRAPHICS_MAX_POLLS } from './guards.ts';
export { matchToneFolder, pickMusicTrack } from './music.ts';
export { normalizeInput, resolveTrigger } from './normalizeInput.ts';
export { normalizeSpeed, playbackSpeed, SPEED_BY_PACE } from './speed.ts';
export type * from './types.ts';

export interface FilmInput {
  triggers: Triggers;
  /** hov.at_scene rows: approved scenes of the project (Fetch Approved Scenes). */
  sceneRows: AtRow[];
  /** hov.at_project row (Fetch Project Info). */
  project: AtRow;
}

/** The `/assemble` request: Prepare Clips → Build Timeline. */
export function planAssemble(input: FilmInput & { music?: MusicPick | null }) {
  const clips = prepareClips(input.sceneRows);
  const timeline = buildTimeline({ clips, triggers: input.triggers, projectFields: input.project.fields, music: input.music });
  return { clips, timeline };
}

/**
 * The `/render` request: Build Remotion Props → Caption Colour → Attach Motif
 * Cards → Source Watermark, then `resolution` from the timeline, exactly as
 * Submit Graphics' jsonBody adds it. It takes the clips and timeline the
 * assemble phase used rather than recomputing them, as n8n reads them back
 * from those nodes. `speed` (D2) is NOT added here: this is the
 * n8n-identical body, and the worker adds speed on top of it.
 */
export function planRender(input: FilmInput & {
  assembly: ReturnType<typeof planAssemble>;
  script: AtRow | null;
  assembled: PollStatus;
}) {
  const { clips, timeline } = input.assembly;
  const fields = input.project.fields;
  let body = buildProps({ clips, triggers: input.triggers, projectFields: fields, script: input.script, assembled: input.assembled }).body;
  body = captionColour(body, fields);
  // Same position as in n8n, where it is the tail of Caption Colour.
  body = graphicStyles(body, fields, input.sceneRows, clips);
  body = attachMotifCards(body, fields, input.sceneRows, clips);
  const wm = sourceWatermark(body, fields, input.sceneRows, clips);
  return { body: Object.assign({}, wm.body, { resolution: (timeline.resolution || '720p') }), log: [wm.log] };
}
