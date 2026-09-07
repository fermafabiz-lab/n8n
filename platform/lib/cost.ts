import type { Scene } from "./data";

/**
 * What a film has actually consumed.
 *
 * Nothing in the platform tracked this. The producer could not answer "what
 * did that film cost" for their own channel, let alone for a client paying
 * for an ad — and the plan is three films a day, where the answer stops being
 * curiosity and starts being the business.
 *
 * **In units the pipeline really meters, not in money.** Veo credits and
 * ElevenLabs characters are counted by the providers and capped by the plan;
 * a price per unit is a commercial fact this repo does not know, and inventing
 * one would produce a confident number that is wrong. Credits are the figure
 * that actually constrains the operation anyway: the allowance is 25,050 a
 * month and the target volume is 7,200 clips.
 *
 * Every number here is an ESTIMATE with a stated basis, because the pipeline
 * does not record per-scene model choices or synthesis counts. The breakdown
 * is exposed so it can be audited rather than believed.
 */

/**
 * Credits per 8-second clip, measured on the account itself
 * (`GET /accounts/{email}` returns `creditCost` per model) rather than quoted.
 * The default model is free at any volume, which is the whole reason the Ultra
 * plan exists — see "The credit strategy" in CLAUDE.md.
 */
export const VEO_CREDITS: Record<string, number> = {
  "veo-3.1-lite-low-priority": 0,
  "veo-3.1-lite": 5,
  "veo-3.1-fast": 10,
  "veo-3.1-quality": 100,
};
export const DEFAULT_VEO_MODEL = "veo-3.1-lite-low-priority";
/** The hook is the one clip that decides whether the film is watched. */
export const HOOK_VEO_MODEL = "veo-3.1-quality";
/** Monthly allowance on the Ultra plan. Credits do not roll over. */
export const MONTHLY_CREDITS = 25050;

export type FilmCost = {
  /** Clips generated, including every re-roll still on file. */
  clips: number;
  /** Re-rolls alone — the part a tighter first pass would remove. */
  clipRetries: number;
  credits: number;
  /** Which model the body of the film was priced at. */
  model: string;
  /** Characters sent to ElevenLabs, counted from the narration on file. */
  characters: number;
  /** Images generated, including re-rolls. */
  images: number;
  imageRetries: number;
  /** Minutes of Remotion render, by the site's own estimate. */
  renderMinutes: number;
};

/**
 * The hook is scene order 1 (or chapter 0 in the `chapter*100 + scene`
 * encoding). Priced separately because it is deliberately generated on the
 * expensive model — one clip per film, and the only one that is.
 */
const isHook = (s: Scene): boolean => {
  const order = typeof s.order === "number" ? s.order : Number(s.order);
  return Number.isFinite(order) && (order === 1 || order < 100);
};

export function filmCost(
  scenes: Scene[],
  opts: { videoModel?: string | null; lengthSeconds?: number | null } = {},
): FilmCost {
  const model =
    opts.videoModel && opts.videoModel in VEO_CREDITS
      ? opts.videoModel
      : DEFAULT_VEO_MODEL;

  let clips = 0;
  let clipRetries = 0;
  let images = 0;
  let imageRetries = 0;
  let characters = 0;
  let credits = 0;

  for (const s of scenes) {
    // Every regeneration files the outgoing asset as a draft, so the draft
    // count IS the number of extra generations paid for. This is the same
    // signal `Prep Video Regen` uses as its take counter.
    const videoDrafts = (s.versions ?? []).filter((v) => v.kind === "video").length;
    const imageDrafts = (s.versions ?? []).filter((v) => v.kind === "image").length;

    if (s.videoUrl) {
      const made = 1 + videoDrafts;
      clips += made;
      clipRetries += videoDrafts;
      credits += made * (VEO_CREDITS[isHook(s) ? HOOK_VEO_MODEL : model] ?? 0);
    }
    if (s.imageUrl) {
      images += 1 + imageDrafts;
      imageRetries += imageDrafts;
    }
    // Only the narration ON FILE. A line re-recorded three times was billed
    // three times, and takes are not versioned, so that is not recoverable —
    // the figure is a floor and the panel says so.
    if (s.voiceUrl && s.narration) characters += s.narration.length;
  }

  // The site's own render estimate, the one AssemblyStatus judges "slow"
  // against: 120s of fixed cost plus 12s per second of film.
  const length = opts.lengthSeconds ?? 0;
  const renderMinutes = length > 0 ? Math.round((120 + 12 * length) / 60) : 0;

  return {
    clips,
    clipRetries,
    credits,
    model,
    characters,
    images,
    imageRetries,
    renderMinutes,
  };
}
