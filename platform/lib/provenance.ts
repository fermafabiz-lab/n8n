/**
 * Visual provenance — what a viewer is actually looking at.
 *
 * A film cuts AI pictures, AI reconstructions and real archive material into
 * one continuous montage, and nothing on screen has ever said which is which.
 * That is the gap this file closes: every scene carries a classification, the
 * classification is STORED, and the render prints a small label from it.
 *
 * Three rules run through the whole thing, and each of them exists because the
 * cheap version of this feature would be a lie:
 *
 * 1. **`actual_footage` is never assigned automatically.** It means the media
 *    genuinely depicts the specific event the narration is describing — the
 *    signing, that day, that place. Nothing we can measure proves that: a
 *    ranker's relevance score is a judgement about a search result, and the
 *    archive's own date field is frequently the UPLOAD date (Commons dates a
 *    1969 NASA reel 2015-06-12). So the classifier tops out at
 *    `archival_footage` / `archival_photo`, and only a person can promote a
 *    scene past that — which is what `manuallyVerified` records.
 *
 * 2. **Absence is never invented.** A date or a location is printed only when
 *    somebody stated it. The provider's `date_original` is deliberately NOT a
 *    source for the watermark, for the reason above; it stays visible in the
 *    picker, labelled "dated", where a human can weigh it.
 *
 * 3. **The watermark and the licence credit are two different systems.** The
 *    watermark is transparency and the producer may switch it off; a credit
 *    demanded by CC BY or CC BY-SA is a legal obligation and switching the
 *    watermark off must not remove it. They are separated here (`attributionText`
 *    is independent of any toggle) and again in the renderer.
 *
 * Mirrored — labels and the watermark formatter only, never the classifier —
 * by `remotion/src/provenance.ts`, because the render is a separate package
 * with no shared module. The classifier lives HERE and its result is stored,
 * so the renderer reads a decision instead of making one.
 */

export type VisualOrigin =
  /** Made by the image/video models from a prompt. The pipeline's default. */
  | "ai_generated"
  /** AI, but explicitly depicting a real past event — a reconstruction. */
  | "ai_reconstruction"
  /** Real media OF the narrated event: right event, right place, right date. */
  | "actual_footage"
  /** Real media, but not of this event — used to illustrate it. */
  | "illustrative_footage"
  /** Real moving footage from an archive. */
  | "archival_footage"
  /** A real photograph from an archive. */
  | "archival_photo"
  /** Real material from a stock library or a producer upload. */
  | "real_stock"
  /** Nothing reliable is known about where this picture came from. */
  | "unknown";

export const VISUAL_ORIGINS: readonly VisualOrigin[] = [
  "ai_generated",
  "ai_reconstruction",
  "actual_footage",
  "illustrative_footage",
  "archival_footage",
  "archival_photo",
  "real_stock",
  "unknown",
];

/**
 * Everything the label and its source line can be built from.
 *
 * Most of it is not stored twice: `provider`, `sourceTitle`, `sourceUrl`,
 * `sourceCreator`, `rightsStatus` and `licenseName` all come from the
 * `hov.stock_media` row the scene already links to (db/007). Only the fields
 * that had nowhere to live are new columns on the scene — see db/009.
 */
export interface VisualProvenance {
  visualOrigin: VisualOrigin;
  /**
   * Free string on purpose (§22): "wikimedia", "internet_archive", "reuters",
   * "eu_audiovisual", "producer_upload". A new source must not need a code
   * change to be nameable, so unknown values are title-cased for display
   * rather than rejected.
   */
  provider?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  sourceCreator?: string;
  /** The date of the ORIGINAL, as a person stated it. Never the catalogue's. */
  originalDate?: string;
  originalLocation?: string;
  eventName?: string;
  /**
   * Derived, never stored: `actual_footage` IS the assertion that the media
   * shows this event at this place on this date, so a second field could only
   * ever contradict the first.
   */
  isExactEventMatch?: boolean;
  rightsStatus?: string;
  licenseName?: string;
  /** The licence demands a credit. See `attributionFor()`. */
  attributionRequired?: boolean;
  /**
   * The credit a licence REQUIRES, already composed. Independent of the
   * watermark toggle — see rule 3 above and
   * docs/source-watermark-license-separation.md. Usually absent: the database
   * sends `attributionRequired` and the sentence is built where it is printed.
   */
  attributionText?: string;
  /** 0–100: how sure we are of `visualOrigin`, not of the event match. */
  provenanceConfidence?: number;
  manuallyVerified?: boolean;
}

/**
 * A scene may not be labelled ACTUAL FOOTAGE below this. It is deliberately
 * unreachable by the automatic classifier — see rule 1 — so in practice it
 * says "a person confirmed it", which scores 100.
 */
export const ACTUAL_FOOTAGE_MIN_CONFIDENCE = 90;

/** What the watermark prints. Short, because it sits in a corner. */
export const ORIGIN_LABELS: Record<VisualOrigin, string> = {
  ai_generated: "AI GENERATED",
  ai_reconstruction: "AI RECONSTRUCTION",
  actual_footage: "ACTUAL FOOTAGE",
  illustrative_footage: "ILLUSTRATIVE FOOTAGE",
  archival_footage: "ARCHIVAL FOOTAGE",
  archival_photo: "ARCHIVAL PHOTO",
  real_stock: "REAL FOOTAGE",
  // Never "ACTUAL FOOTAGE", and never nothing: on a documentary, silence
  // about a picture's origin reads as a claim that it is real (§26).
  unknown: "SOURCE UNVERIFIED",
};

/** The one line the producer reads when choosing a type by hand. */
export const ORIGIN_DESCRIPTIONS: Record<VisualOrigin, string> = {
  ai_generated: "Made by the image model from this scene's prompt.",
  ai_reconstruction: "AI, but depicting a real past event — a reconstruction, not a record of it.",
  actual_footage: "Real media of this exact event: right event, right place, right date.",
  illustrative_footage: "Real media, but not of this event — it illustrates what is being said.",
  archival_footage: "Real moving footage from an archive.",
  archival_photo: "A real photograph from an archive.",
  real_stock: "Real material from a stock library or an upload.",
  unknown: "Nothing reliable is known about where this picture came from.",
};

/** Origins that assert the picture is REAL rather than generated. */
export const REAL_ORIGINS: readonly VisualOrigin[] = [
  "actual_footage",
  "illustrative_footage",
  "archival_footage",
  "archival_photo",
  "real_stock",
];

export const AI_ORIGINS: readonly VisualOrigin[] = ["ai_generated", "ai_reconstruction"];

export const isRealOrigin = (o: VisualOrigin): boolean => REAL_ORIGINS.includes(o);
export const isAiOrigin = (o: VisualOrigin): boolean => AI_ORIGINS.includes(o);

/**
 * The warning shown before an AI picture may be relabelled as authentic.
 *
 * Verbatim from the specification, because it is the sentence that has to stop
 * somebody doing the one thing this whole feature exists to prevent.
 */
export const AI_TO_ACTUAL_WARNING =
  "This visual was generated by AI. It cannot be marked as authentic footage " +
  "unless the underlying media source has been replaced.";

/** A stored value, or null when it is not one of ours. */
export function normalizeVisualOrigin(raw: unknown): VisualOrigin | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (VISUAL_ORIGINS as readonly string[]).includes(v) ? (v as VisualOrigin) : null;
}

/** 0–100, or undefined. Refuses rather than clamps a wild value into meaning. */
export function normalizeConfidence(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n < 0 || n > 100) return undefined;
  return Math.round(n);
}

const fold = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Planner language that says the shot is a RECONSTRUCTION of something real.
 *
 * Only strong, unambiguous wording. "Recreation" alone is a park, a hobby and
 * a school subject before it is a historical reconstruction, so it counts only
 * inside a phrase that settles the meaning — a false positive here would print
 * AI RECONSTRUCTION over an invented scene, which is a claim about reality
 * that nobody made.
 */
const RECONSTRUCTION_PATTERNS: RegExp[] = [
  /\bre-?enactment\b/,
  /\bre-?enact(?:ed|ing|s)?\b/,
  /\breconstruction\b/,
  /\breconstruct(?:ed|ing|s)?\b/,
  /\bdramati[sz]ation\b/,
  /\bdocudrama\b/,
  /\b(?:historical|historic|period|archival)[- ]style\s+recreation\b/,
  /\b(?:historical|historic|period)\s+recreation\b/,
  /\brecreation of the\b/,
  /\brecreat(?:e|es|ed|ing)\s+(?:the|a|an)\s+(?:scene|event|moment|day|battle|meeting|signing|speech|landing|march)\b/,
  /\bimagine the event\b/,
  // Romanian — the segmenter writes prompts in English, but a producer
  // editing the shot direction by hand writes in whichever they think in.
  /\breconstituire\b/,
  /\breconstitui(?:t|ta|te|re)\b/,
];

export function detectAiReconstruction(...texts: Array<string | null | undefined>): boolean {
  const hay = fold(texts.filter(Boolean).join(" \n "));
  return RECONSTRUCTION_PATTERNS.some((re) => re.test(hay));
}

/** What the classifier is given. All of it already exists on the scene. */
export interface ClassifyInput {
  /** db/007's column: "ai" | "stock_video" | "stock_image". */
  visualSource: string;
  /** The prompt that made the picture, and the shot direction. */
  imagePrompt?: string | null;
  videoPrompt?: string | null;
  /** Present only for an archive scene. */
  stock?: {
    provider?: string | null;
    creator?: string | null;
    credit?: string | null;
    sourceUrl?: string | null;
    rightsStatus?: string | null;
    license?: string | null;
  } | null;
}

/**
 * Classify a scene's picture, automatically.
 *
 * It can reach six of the eight origins. It can never reach `actual_footage`
 * (rule 1) and never `illustrative_footage`, because both are statements about
 * whether the media matches the narrated EVENT — a question about the world,
 * not about our own records. Those two are a person's to make, through the
 * Footage type control, and arrive here only as a stored override.
 */
export function classifyVisualOrigin(input: ClassifyInput): {
  origin: VisualOrigin;
  confidence: number;
} {
  const src = String(input.visualSource || "ai");

  if (src === "stock_video" || src === "stock_image") {
    const origin: VisualOrigin = src === "stock_video" ? "archival_footage" : "archival_photo";
    const s = input.stock ?? {};
    // How complete the library row is — this is confidence in "it really is a
    // catalogued archive item", which is exactly what the label claims.
    let c = 70;
    if (String(s.creator ?? s.credit ?? "").trim()) c += 10;
    if (String(s.sourceUrl ?? "").trim()) c += 10;
    if (String(s.rightsStatus ?? "").trim() && s.rightsStatus !== "unknown") c += 5;
    if (String(s.license ?? "").trim()) c += 5;
    // Capped BELOW `ACTUAL_FOOTAGE_MIN_CONFIDENCE`, deliberately. A perfectly
    // documented archive item is still only evidence that it is an archive
    // item; nothing automatic may produce a number that reads as authority
    // about the event, or the threshold stops being a threshold.
    return { origin, confidence: Math.min(85, c) };
  }

  if (src === "ai") {
    if (detectAiReconstruction(input.imagePrompt, input.videoPrompt)) {
      // Inferred from wording rather than recorded, so it is short of certain
      // — but the picture is AI either way, which is the part that matters.
      return { origin: "ai_reconstruction", confidence: 85 };
    }
    return { origin: "ai_generated", confidence: 100 };
  }

  // A visual_source nobody taught us. Better to say so than to guess (§26).
  return { origin: "unknown", confidence: 0 };
}

/**
 * May this origin be stored for this scene? A sentence means no.
 *
 * The refusal that matters is the first one: a picture the models generated
 * cannot be relabelled as REAL, whatever flavour of real, because the bytes on
 * screen are still the bytes the model made. No confirmation dialog can make
 * that true, so this refuses outright rather than warning — the door is to
 * replace the media, which is exactly what the warning sentence says and what
 * the archive picker on this very step does.
 *
 * The mirror refusal is milder but still a false statement: calling a real
 * archive asset AI-generated. It is refused too, with the way out named — the
 * scene has to go back to AI first.
 */
export function refuseFootageType(
  next: VisualOrigin,
  current: { visualSource: string },
): string | null {
  const generated = current.visualSource === "ai";
  if (generated && isRealOrigin(next)) {
    return (
      AI_TO_ACTUAL_WARNING +
      " Pick an archive asset for this scene from the panel under the picture, and it will carry its own provenance."
    );
  }
  if (!generated && isAiOrigin(next)) {
    return (
      "This scene's picture is a real archive asset, so it cannot be labelled AI. " +
      'Use "Back to AI" on the Images step first if that is what you want.'
    );
  }
  return null;
}

// In lockstep with remotion/src/provenance.ts — the site's chips and the
// film's watermark must name a source the same way.
const PROVIDER_LABELS: Record<string, string> = {
  wikimedia: "Wikimedia Commons",
  eu_av: "EU Audiovisual Service",
  dvids: "DVIDS",
  nasa: "NASA",
  internet_archive: "Internet Archive",
  europeana: "Europeana",
  loc: "Library of Congress",
  wellcome: "Wellcome Collection",
  flickr: "Flickr",
  openverse: "Openverse",
  pexels: "Pexels",
  pixabay: "Pixabay",
  unsplash: "Unsplash",
  destockd: "Destockd",
  url_import: "URL import",
  user_upload: "Manual upload",
};

/**
 * A provider's display name. Unknown providers are title-cased rather than
 * dropped, so a new archive (or "reuters", or "producer_upload") reads
 * correctly the day it appears, with no code change (§22).
 */
export function providerLabel(provider: string | null | undefined): string | null {
  const raw = String(provider ?? "").trim();
  if (!raw) return null;
  const known = PROVIDER_LABELS[raw.toLowerCase()];
  if (known) return known;
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * A creator string fit to print.
 *
 * Wikimedia Commons answers the author field with the wiki TEMPLATE that
 * renders it, so a real photographer arrives as "Template:Helmut Laux" —
 * measured on the Bundesarchiv photo of Stalin and Ribbentrop, which is a
 * CC BY-SA row and therefore one whose credit we are obliged to print
 * correctly. Stripped here rather than in the adapter because the rows already
 * in the library carry the prefix and a search will not revisit them.
 */
export const cleanCreator = (v: unknown): string => String(v ?? "").trim().replace(/^Template:\s*/i, "");

/** The compact label alone — what §24 asks for. */
export function getSourceLabel(p: VisualProvenance | null | undefined): string {
  const origin = normalizeVisualOrigin(p?.visualOrigin) ?? "unknown";
  return ORIGIN_LABELS[origin];
}

/**
 * The whole watermark: the label, and the optional smaller line under it.
 *
 * The source line is assembled ONLY from things somebody stated — who made it,
 * where it came from, and a place and date a person entered. The archive's own
 * date is not among them, deliberately: it is the upload date often enough
 * that printing it would be publishing a guess as a fact.
 */
export function formatSourceWatermark(p: VisualProvenance | null | undefined): {
  label: string;
  source: string | null;
} {
  const label = getSourceLabel(p);
  if (!p) return { label, source: null };
  const who = cleanCreator(p.sourceCreator) || providerLabel(p.provider);
  const parts = [who, String(p.originalLocation ?? "").trim(), String(p.originalDate ?? "").trim()]
    .filter((v): v is string => Boolean(v));
  return { label, source: parts.length ? `Source: ${parts.join(" · ")}` : null };
}

/**
 * Where the badge sits and how big it is, in FRAME pixels.
 *
 * Mirrored from `remotion/src/provenance.ts`, which owns it and whose
 * `SourceWatermark` consumes it. The site needs it because `WatermarkPreview`
 * draws the same badge at the same pixel sizes inside a real-sized frame and
 * scales the whole frame down — a preview that scaled each number by hand
 * would drift from the film the first time somebody nudged a padding, and the
 * only thing a preview is for is being trusted.
 *
 * The frame is 1280×720 (720×1280 portrait): the render's real size, not
 * 1080p — see remotion/src/Root.tsx. `npm run check:footage` pins this table
 * against the same literal `npm run check:watermark` pins the render's.
 */
export interface WatermarkGeometry {
  frame: { width: number; height: number };
  left: number;
  bottom: number;
  maxWidth: number;
  gap: number;
  label: { fontSize: number; padding: string };
  source: { fontSize: number };
  credit: { fontSize: number };
  /**
   * The mark itself — the chip that opens into the pill. `height` is the
   * chip's side AND the pill's height, so the shape is square when closed and
   * a capsule when open. Mirrored from remotion/src/provenance.ts.
   */
  mark: { height: number; glyph: number; gap: number; padX: number };
}

/** Just the mark's own numbers, so the arithmetic below can be handed them. */
export type WatermarkMark = WatermarkGeometry["mark"];

export const WATERMARK_LAYOUT: { landscape: WatermarkGeometry; portrait: WatermarkGeometry } = {
  landscape: {
    frame: { width: 1280, height: 720 },
    left: 90,
    bottom: 30,
    maxWidth: 700,
    gap: 3,
    label: { fontSize: 16, padding: "5px 12px" },
    source: { fontSize: 13 },
    credit: { fontSize: 12 },
    mark: { height: 30, glyph: 15, gap: 8, padX: 10 },
  },
  portrait: {
    frame: { width: 720, height: 1280 },
    left: 44,
    bottom: 232,
    maxWidth: 560,
    gap: 3,
    label: { fontSize: 17, padding: "5px 11px" },
    source: { fontSize: 14 },
    credit: { fontSize: 13 },
    mark: { height: 32, glyph: 16, gap: 8, padX: 10 },
  },
};

/** The colours and weights, shared by both orientations. Mirrored with the above. */
export const WATERMARK_STYLE = {
  peakOpacity: 0.88,
  labelWeight: 600,
  labelLetterSpacing: "0.14em",
  /** The same value as a number: the pill does arithmetic with it, because
   *  letter-spacing is added after the LAST character too and that trailing
   *  dead air is not ink. Mirrored from remotion/src/provenance.ts. */
  labelLetterSpacingEm: 0.14,
  labelColor: "#FFFFFF",
  labelBackground: "rgba(0,0,0,0.42)",
  labelBorder: "1px solid rgba(255,255,255,0.16)",
  labelRadius: 6,
  labelLineHeight: 1.2,
  sourceLetterSpacing: "0.05em",
  sourceColor: "rgba(255,255,255,0.9)",
  creditLetterSpacing: "0.04em",
  creditColor: "rgba(255,255,255,0.82)",
  lineBackground: "rgba(0,0,0,0.34)",
  lineRadius: 5,
  linePadding: "3px 9px",
  lineLineHeight: 1.25,
  textShadow: "0 2px 8px rgba(0,0,0,0.75)",
  /** The chip's corner as a fraction of its side; the pill's is a capsule. */
  chipRadiusRatio: 0.3,
  markBorderWidth: 1,
  markBorderColor: "rgba(255,255,255,0.55)",
  /** How the chip opens, in seconds. Mirrored — the preview animates the same
   *  way the film does, or it is showing a different overlay. */
  openDelaySeconds: 0.18,
  openSeconds: 0.42,
  /** The fade at each END of a band. Mirrored from remotion's copy, where it
   *  lived inline in SourceWatermark.tsx until this preview learned to
   *  animate and needed the same number. */
  fadeSeconds: 0.2,
} as const;

/**
 * The badge's easing, as a function of 0..1.
 *
 * The render animates on `CURVES.inOutCubic` = `Easing.bezier(0.65, 0, 0.35, 1)`,
 * and this preview cannot import Remotion — so the same curve is solved by
 * hand here. Verified against Remotion's own over 101 samples: largest
 * disagreement 3.9e-16, which is float noise. Mirrored character for
 * character from remotion/src/provenance.ts, and pinned on both sides.
 *
 * Newton-Raphson first because it converges in a few steps on a well-behaved
 * curve, then bisection to finish — the fallback matters at the flat ends,
 * where the derivative approaches zero and Newton stops making progress.
 */
const solveBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const A = (a: number, b: number) => 1 - 3 * b + 3 * a;
  const B = (a: number, b: number) => 3 * b - 6 * a;
  const C = (a: number) => 3 * a;
  const calc = (t: number, a: number, b: number) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t: number, a: number, b: number) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const sl = slope(t, x1, x2);
      if (sl === 0) break;
      t -= (calc(t, x1, x2) - x) / sl;
    }
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24 && (t < 0 || t > 1); i++) t = (lo + hi) / 2;
    for (let i = 0; i < 24; i++) {
      const cx = calc(t, x1, x2);
      if (Math.abs(cx - x) < 1e-7) break;
      if (cx < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return calc(t, y1, y2);
  };
};

export const WATERMARK_EASE = solveBezier(0.65, 0, 0.35, 1);

/** A clamped, eased 0..1 ramp — the shape `eased()` produces in the render. */
const ramp = (input: number, span: number): number =>
  span <= 0 ? (input >= 0 ? 1 : 0) : WATERMARK_EASE(Math.min(1, Math.max(0, input / span)));

/**
 * How long the opening takes on a band of `bandLength` seconds.
 *
 * A band shorter than the animation would otherwise be caught mid-open at its
 * own fade-out, so the opening is COMPRESSED to fit rather than truncated. On
 * any real film this is simply `openSeconds` — the shortest band is one
 * scene, and a scene is eight seconds.
 */
export const markOpenSpan = (bandLength: number): number =>
  Math.min(
    WATERMARK_STYLE.openSeconds,
    Math.max(0.12, bandLength - WATERMARK_STYLE.openDelaySeconds - WATERMARK_STYLE.fadeSeconds),
  );

/**
 * How open the mark is, 0 (chip) to 1 (pill), `t` seconds into its band.
 *
 * It opens once, just after the fade has brought it up, and STAYS open for the
 * rest of the band. A band that does not `expand` never opens at all: that is
 * what "announce each source once" looks like from the second band on.
 */
export const markOpenAt = (t: number, bandLength: number, expand: boolean): number =>
  expand ? ramp(t - WATERMARK_STYLE.openDelaySeconds, markOpenSpan(bandLength)) : 0;

/**
 * How far the label has uncovered, 0..1, from how open the mark is.
 *
 * A sub-range of the opening rather than its own clock: the text appears while
 * the capsule is still widening, clipped by it, so it reads as the mark
 * OPENING rather than as a second element arriving on top.
 */
export const markRevealAt = (open: number): number =>
  Math.min(1, Math.max(0, (open - 0.25) / (0.85 - 0.25)));

/** The whole badge's opacity `t` seconds into a band. Symmetric in and out. */
export const bandOpacityAt = (t: number, bandLength: number): number =>
  Math.min(ramp(t, WATERMARK_STYLE.fadeSeconds), ramp(bandLength - t, WATERMARK_STYLE.fadeSeconds)) *
  WATERMARK_STYLE.peakOpacity;

/** How long one band's animation takes to settle — what a preview that plays
 *  it ONCE has to wait before it can stop the clock. */
export const markSettleSeconds = (bandLength: number): number =>
  WATERMARK_STYLE.openDelaySeconds + markOpenSpan(bandLength) + 0.05;

/**
 * The dead air CSS letter-spacing leaves AFTER the last character.
 *
 * Spacing is added following every character, the final one included, so a
 * laid-out label is one whole letter-space wider than its own ink. Size a
 * capsule to that width with equal padding on both sides and the right comes
 * out a letter-space wider than the left — 1.6px on a 30px pill, which is the
 * 5% that reads as "the text is not centred".
 *
 * The film subtracts it from a measured advance; this preview cancels it with
 * a negative right margin. One function so they cannot disagree about how
 * much it is. Mirrored from remotion/src/provenance.ts.
 */
export const labelTrailingSpace = (fontSize: number): number =>
  fontSize * WATERMARK_STYLE.labelLetterSpacingEm;

/**
 * The open capsule's width, in border-box pixels, from a MEASURED label.
 *
 * The border is INSIDE this number (`box-sizing: border-box`), so the two 1px
 * edges are added explicitly; and the padding is `padX` on both sides, where
 * it used to be `padX * 1.15` on the right — a fudge compensating for the
 * trailing letter-space above, two wrongs that did not quite make a right.
 *
 * This preview draws the pill at its natural width and so does not call this;
 * it is mirrored because the render's animation interpolates to exactly this
 * number, and a preview that disagreed would be showing a different overlay.
 */
export const markPillWidth = (
  mark: WatermarkMark,
  fontSize: number,
  labelAdvance: number,
): number =>
  2 * WATERMARK_STYLE.markBorderWidth +
  mark.padX +
  mark.glyph +
  mark.gap +
  Math.max(0, Math.ceil(labelAdvance - labelTrailingSpace(fontSize))) +
  mark.padX;

/**
 * The closed chip's left padding — what centres the glyph in the square.
 *
 * The borders are inside the box, so they come off the space the glyph has to
 * sit in. Forgetting them is how the chip ended up half a pixel left of
 * centre: visible on nothing, wrong on everything.
 */
export const markChipPadX = (mark: WatermarkMark): number =>
  (mark.height - 2 * WATERMARK_STYLE.markBorderWidth - mark.glyph) / 2;

/**
 * How much bigger or smaller the whole badge is drawn.
 *
 * The badge is deliberately the least decorative element in the render — a
 * claim about truthfulness that draws attention to itself stops being read as
 * one — but "quiet" is a judgement about a particular film on a particular
 * screen, not a constant. A documentary watched on a phone needs it larger
 * than a 16:9 essay does, and the producer is the one looking at it.
 *
 * The ends are chosen rather than arbitrary. Below 0.7 the 15px glyph falls
 * under 11px and the artwork's thin strokes start dropping out at 1080p;
 * above 1.6 the capsule for the longest label ("ILLUSTRATIVE FOOTAGE", 280px
 * at 1x) passes 448px and begins to read as a banner rather than a mark.
 * `step` is the slider's grid and nothing else enforces it — an arbitrary
 * value inside the range is honoured, because refusing one would be refusing
 * a film that was rendered before the grid existed.
 *
 * Mirrored from remotion/src/provenance.ts.
 */
export const WATERMARK_SCALE = {
  min: 0.7,
  max: 1.6,
  step: 0.05,
  default: 1,
} as const;

/**
 * The stored size, or the default — refuse-then-clamp, like every other
 * Editing Options number (`normalize*` in lib/data/derive.ts).
 *
 * REFUSES rather than clamps, exactly as `normalizeSpeed` does: a value
 * outside the range falls back to 1 instead of being pulled to the nearest
 * end. A stored 4 is not "as big as possible", it is a mistake, and a badge
 * silently drawn at the maximum would be a worse answer than the default one.
 *
 * Three copies in three languages — here, remotion/src/provenance.ts and
 * Final Assembly's `Source Watermark` node. They move together or a film is
 * drawn at a size the control never offered.
 */
export const normalizeWatermarkScale = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return WATERMARK_SCALE.default;
  if (n < WATERMARK_SCALE.min || n > WATERMARK_SCALE.max) return WATERMARK_SCALE.default;
  return n;
};

/**
 * The badge's geometry at a given size.
 *
 * Everything that is part of the MARK scales — its height, its glyph, the two
 * paddings, the three font sizes and the gap between the stacked lines. What
 * does NOT scale is where the badge sits: `left`, `bottom` and `frame` are
 * about the composition, not about the mark, and a badge that walked towards
 * the corner as it grew would be two decisions wearing one control.
 * `maxWidth` is left alone for the same reason.
 *
 * Rounded to whole pixels because half a pixel of border is a grey smear
 * rather than a hairline, and because `markChipPadX` centres the glyph inside
 * the border by halving what is left. The border itself stays 1px at every
 * size, deliberately: a hairline is a hairline, and scaling it would make the
 * largest badge look heavy-handed.
 *
 * Mirrored from remotion/src/provenance.ts.
 */
export const scaleWatermark = (g: WatermarkGeometry, scale: unknown): WatermarkGeometry => {
  const k = normalizeWatermarkScale(scale);
  if (k === WATERMARK_SCALE.default) return g;
  const px = (n: number) => Math.max(1, Math.round(n * k));
  return {
    ...g,
    gap: px(g.gap),
    label: { ...g.label, fontSize: px(g.label.fontSize) },
    source: { fontSize: px(g.source.fontSize) },
    credit: { fontSize: px(g.credit.fontSize) },
    mark: {
      height: px(g.mark.height),
      glyph: px(g.mark.glyph),
      gap: px(g.mark.gap),
      padX: px(g.mark.padX),
    },
  };
};

/** The fields of a canvas `TextMetrics` this needs, and nothing else. */
export type LabelMetrics = {
  width: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
  fontBoundingBoxAscent: number;
  fontBoundingBoxDescent: number;
};

/**
 * How far an all-caps label has to be nudged DOWN to sit on the pill's
 * midline. Positive means the ink is riding high, which it always is.
 *
 * `align-items: center` centres the LINE BOX, and a line box is built around
 * the font's own ascent and descent — room for accents above and descenders
 * below that an all-caps label never uses. "ARCHIVAL FOOTAGE" runs from the
 * baseline up to the cap height with nothing hanging beneath it, so a box
 * centred on the font leaves the letters high: measured at 1.5px in a 30px
 * pill, a twentieth of its height, and obvious once seen.
 *
 * How high depends entirely on the typeface — the film's kicker font is a
 * Google font chosen per preset, this preview falls back to whatever
 * monospace the producer has — so it is computed from the REAL ink box rather
 * than from a cap-height ratio, which is also why the preview runs it against
 * its OWN font rather than copying the film's number.
 *
 * Note what does NOT appear here: `labelLineHeight`. The line box's own
 * half-leading is distributed evenly above and below, so it falls out of the
 * subtraction — which is also why changing the line height moves nothing.
 *
 * Returns 0 — the behaviour this badge had before the correction existed —
 * whenever the answer cannot be trusted: a `TextMetrics` without the
 * actual-bounding-box fields, or a canvas that resolved a DIFFERENT face than
 * the DOM laid the label out in. A canvas draws no letter-spacing, so its
 * width must come out exactly one space per character narrower than the
 * span's; anything else means the two are not measuring the same typeface,
 * and an ink box from the wrong font would push the text the wrong way by a
 * font's worth of error. Mirrored from remotion/src/provenance.ts.
 */
export const labelInkDrop = (
  m: LabelMetrics,
  label: string,
  fontSize: number,
  /** The label span's own laid-out width, letter-spacing and all. */
  advance: number,
): number => {
  const all = [
    m.width,
    m.actualBoundingBoxAscent,
    m.actualBoundingBoxDescent,
    m.fontBoundingBoxAscent,
    m.fontBoundingBoxDescent,
  ];
  if (!all.every((n) => typeof n === "number" && Number.isFinite(n))) return 0;
  const bare = advance - label.length * labelTrailingSpace(fontSize);
  if (bare <= 0 || Math.abs(m.width - bare) > Math.max(2, bare * 0.08)) return 0;
  // Both centres measured from the baseline, downward positive.
  return (
    (m.fontBoundingBoxDescent - m.fontBoundingBoxAscent) / 2 -
    (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2
  );
};

/**
 * The credit a licence obliges us to print, or null.
 *
 * Built only when the licence REQUIRES attribution. A courtesy credit is what
 * the source line above is for; this one is the obligation, and it is the
 * reason the renderer draws it whether the watermark is on or off.
 *
 * Mirrored in remotion/src/provenance.ts — the render composes its own copy so
 * that the provider's display name has one owner per package rather than a
 * third copy inside the SQL view.
 */
export function attributionFor(p: VisualProvenance | null | undefined): string | null {
  if (!p) return null;
  const ready = String(p.attributionText ?? "").trim();
  if (ready) return ready;
  if (!p.attributionRequired) return null;
  const parts = [
    cleanCreator(p.sourceCreator),
    providerLabel(p.provider),
    String(p.licenseName ?? "").trim(),
  ].filter((v): v is string => Boolean(v));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The scene bands the watermark is drawn over.
 *
 * An EXACT mirror of `planWatermarkBands` in `remotion/src/provenance.ts` —
 * same signature, same output — so the preview can be compared to the render
 * case for case. Consecutive scenes carrying the same badge merge into one
 * band, which is the whole reason the site cannot just draw one badge per
 * scene and call it a preview: a documentary running six archive shots
 * together shows ONE steady label, and a preview claiming six would be
 * describing a film nobody is going to watch.
 *
 * For a preview the timings do not matter — only the order and the merging —
 * so the caller may pass unit durations (`startSeconds: i, durationSeconds: 1`)
 * and read the band boundaries back as scene indices.
 */
export interface WatermarkBand {
  startSeconds: number;
  endSeconds: number;
  /** Which mark to draw, and what the "open once" rule keys on. */
  origin: VisualOrigin;
  label: string;
  source: string | null;
  credit: string | null;
  /**
   * Whether the badge opens into the full pill or stays the small chip.
   * Always true unless `openOncePerOrigin` was asked for, in which case only
   * the FIRST band of each origin opens.
   */
  expand: boolean;
}

export function planWatermarkBands(
  scenes: readonly { startSeconds: number; durationSeconds: number; provenance?: VisualProvenance | null }[],
  opts: { showLabel: boolean; openOncePerOrigin?: boolean },
): WatermarkBand[] {
  const bands: WatermarkBand[] = [];
  // Which origins have already had their say. Filled as the film runs, so
  // order of first appearance is what decides.
  const opened = new Set<VisualOrigin>();
  for (const s of scenes) {
    const p = s.provenance;
    if (!p) continue;
    const { label, source } = formatSourceWatermark(p);
    const credit = attributionFor(p);
    // With the label switched off only the licence obligation remains, so a
    // scene that owes nothing draws nothing at all.
    if (!opts.showLabel && !credit) continue;
    const origin: VisualOrigin = p.visualOrigin ?? "unknown";
    const band: WatermarkBand = {
      startSeconds: s.startSeconds,
      endSeconds: s.startSeconds + s.durationSeconds,
      origin,
      label: opts.showLabel ? label : "",
      source: opts.showLabel ? source : null,
      credit,
      // Decided AFTER the merge check below, so a band that merges into its
      // predecessor cannot consume an origin's one opening.
      expand: true,
    };
    const prev = bands[bands.length - 1];
    if (
      prev &&
      Math.abs(prev.endSeconds - band.startSeconds) < 1e-6 &&
      prev.origin === band.origin &&
      prev.label === band.label &&
      prev.source === band.source &&
      prev.credit === band.credit
    ) {
      prev.endSeconds = band.endSeconds;
      continue;
    }
    if (opts.openOncePerOrigin) {
      band.expand = !opened.has(origin);
    }
    opened.add(origin);
    bands.push(band);
  }
  return bands;
}

/**
 * A scene, as far as a credit is concerned. Structural on purpose: this file
 * imports nothing, and a credit needs only the archive asset and what is known
 * about it — not the forty other fields a Scene carries.
 */
export interface CreditableScene {
  stock?: {
    provider: string;
    title: string;
    sourceUrl: string;
    creator: string | null;
  } | null;
  provenance?: VisualProvenance | null;
}

/**
 * The footage credits for a film, in two tiers.
 *
 * `required` is the OBLIGATION — a CC BY or CC BY-SA licence naming its author
 * as the price of use — and it is built by `attributionFor` above, so the line
 * a viewer reads in a YouTube description and the line the render draws over
 * the picture come from one rule and cannot drift apart. `courtesy` is
 * everything else real: public domain, CC0, a government reel. It owes nothing
 * legally, and it is listed anyway, because that is what a documentary
 * description carries and what our API applications tell each provider we do.
 *
 * The split exists so a CAP can only ever fall on the courtesy list. Dropping
 * a required credit to fit a character budget is the one failure this can have
 * that nobody would see — the description would still look complete.
 *
 * One line per SOURCE, not per scene: six shots lifted from one reel are one
 * obligation, and six identical lines would read as a bug.
 */
export function footageCredits(
  scenes: readonly CreditableScene[],
  opts: { max?: number } = {},
): { required: string[]; courtesy: string[]; lines: string[] } {
  const seen = new Set<string>();
  const required: string[] = [];
  const courtesy: string[] = [];
  for (const s of scenes) {
    const st = s.stock;
    // `stock` IS the archive asset — a Commons photo, a NASA reel, a URL
    // import, an upload. Its presence is the honest test of "did this frame
    // come from somewhere that can be credited", and it needs nothing from
    // the provenance columns, so a film predating them still credits.
    if (!st) continue;
    const url = String(s.provenance?.sourceUrl ?? st.sourceUrl ?? "").trim();
    const key = url || `${st.provider}|${st.title}`;
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    const owed = attributionFor(s.provenance);
    const who =
      owed ?? [cleanCreator(st.creator), providerLabel(st.provider)].filter(Boolean).join(" · ");
    if (!who && !url) continue;
    const line = `• ${[who, url].filter(Boolean).join(" — ")}`;
    (owed ? required : courtesy).push(line);
  }
  const max = opts.max ?? 20;
  return {
    required,
    courtesy,
    lines: [...required, ...courtesy.slice(0, Math.max(0, max - required.length))],
  };
}
