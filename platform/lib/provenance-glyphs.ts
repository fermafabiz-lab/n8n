/**
 * The eight provenance glyphs, as path data.
 *
 * From the designer's asset pack (`svg/glyph-white/<type>.svg`), inlined
 * rather than loaded through `staticFile()` for two reasons: the render server
 * and the site both draw this badge and neither should depend on the other's
 * static directory, and a glyph that is code can take its colour from the
 * element around it instead of shipping an on-dark and an on-light copy.
 *
 * MIRRORED from `remotion/src/provenanceGlyphs.ts`, exactly like the labels and
 * the layout next door — the site's watermark preview draws the same mark the
 * film does, or it is not a preview. `npm run check:footage` here and
 * `npm run check:watermark` there pin that every origin has one.
 *
 * `archival_footage` and `archival_photo` share a glyph BY DESIGN (the pack's
 * README says so); their labels are what tell them apart.
 */
import type { VisualOrigin } from "./provenance";

export type GlyphPath = {
  d: string;
  /** Filled with the current colour rather than stroked. */
  filled?: boolean;
};

/** Every glyph is drawn in a 24×24 box, stroked at 1.8 unless filled. */
export const GLYPH_VIEWBOX = 24;
export const GLYPH_STROKE = 1.8;

const FILM: GlyphPath[] = [
  {d: 'M3 4h18a2.4 2.4 0 0 1 2.4 2.4v11.2A2.4 2.4 0 0 1 21 20H3a2.4 2.4 0 0 1-2.4-2.4V6.4A2.4 2.4 0 0 1 3 4Z'},
  {d: 'M7.6 4v16M16.4 4v16M3 12h18M3 8h4.6M3 16h4.6M16.4 8H21M16.4 16H21'},
];

export const ORIGIN_GLYPHS: Record<VisualOrigin, GlyphPath[]> = {
  ai_generated: [
    {
      d: 'M12 2.4C12.5 7.6 16.4 11.5 21.6 12C16.4 12.5 12.5 16.4 12 21.6C11.5 16.4 7.6 12.5 2.4 12C7.6 11.5 11.5 7.6 12 2.4Z',
      filled: true,
    },
  ],
  ai_reconstruction: [
    {d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'},
    {d: 'M3 3v5h5'},
    {
      d: 'M12 7.7C12.22 10.03 13.97 11.78 16.3 12C13.97 12.22 12.22 13.97 12 16.3C11.78 13.97 10.03 12.22 7.7 12C10.03 11.78 11.78 10.03 12 7.7Z',
      filled: true,
    },
  ],
  actual_footage: [
    {d: 'M2.2 12C4.6 7.8 8.1 5.7 12 5.7s7.4 2.1 9.8 6.3c-2.4 4.2-5.9 6.3-9.8 6.3S4.6 16.2 2.2 12Z'},
    {d: 'M12 9.3a2.7 2.7 0 1 1 0 5.4a2.7 2.7 0 0 1 0-5.4Z', filled: true},
  ],
  illustrative_footage: [
    {d: 'M8.6 6.4a5.6 5.6 0 1 1 0 11.2a5.6 5.6 0 0 1 0-11.2Z'},
    {d: 'M15.4 6.4a5.6 5.6 0 1 1 0 11.2a5.6 5.6 0 0 1 0-11.2Z'},
    {d: 'M12 7.55A5.6 5.6 0 0 1 12 16.45A5.6 5.6 0 0 1 12 7.55Z', filled: true},
  ],
  archival_footage: FILM,
  archival_photo: FILM,
  real_stock: [
    {d: 'M3 4h18a2.4 2.4 0 0 1 2.4 2.4v11.2A2.4 2.4 0 0 1 21 20H3a2.4 2.4 0 0 1-2.4-2.4V6.4A2.4 2.4 0 0 1 3 4Z'},
    {d: 'M8.6 7.7a1.7 1.7 0 1 1 0 3.4a1.7 1.7 0 0 1 0-3.4Z'},
    {d: 'M21 15.4l-3.7-3.7a2 2 0 0 0-2.83 0L7.4 19.9'},
  ],
  unknown: [
    {d: 'M8.9 9.1a3.2 3.2 0 0 1 6.2 1.07c0 2.13-3.1 2.66-3.1 4.26'},
    {d: 'M12 16.65a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 0 1 0-2.5Z', filled: true},
  ],
};

/**
 * Which origins wear a DASHED border, from the artwork.
 *
 * The three that are a claim ABOUT the picture rather than a claim to be the
 * picture: both AI origins and the unverified one. A dashed edge reads as
 * provisional, which is the whole message.
 */
export const DASHED_ORIGINS: ReadonlySet<VisualOrigin> = new Set<VisualOrigin>([
  'ai_generated',
  'ai_reconstruction',
  'unknown',
]);
