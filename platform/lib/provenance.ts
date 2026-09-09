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
   * Free string on purpose (§22): "wikimedia", "nara", "reuters",
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

const PROVIDER_LABELS: Record<string, string> = {
  wikimedia: "Wikimedia Commons",
  eu_av: "EU Audiovisual Service",
  dvids: "DVIDS",
  nasa: "NASA",
  url_import: "URL import",
  user_upload: "Manual upload",
  // Retired providers (docs/nara-smithsonian-deprecation.md): no search
  // reaches them, but rows they filed still print their real names.
  nara: "US National Archives",
  smithsonian: "Smithsonian",
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
