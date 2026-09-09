/**
 * Real footage for Documentary mode — the neutral shapes.
 *
 * Several sources, one vocabulary. Each provider (Wikimedia Commons, the EU
 * Audiovisual Service, DVIDS, NASA, a pasted URL, a producer's own upload)
 * answers in its own dialect, and an adapter's whole job is to turn that into
 * a `NormalizedArchiveAsset`. Nothing downstream — the engine, the
 * `stock_media` table, the scene picker, the admin page — ever sees a
 * provider payload, so a seventh source is one file under
 * `lib/footage/providers/` and one line in the registry.
 *
 * The rights fields are the reason the shape is this wide. A film is a
 * DERIVATIVE made for a channel that earns money, so "free" is not one bit:
 * an asset has to say whether it may be used commercially, whether it may be
 * modified, and whether it must be credited — and it has to keep the
 * provider's own licence string next to those verdicts, because the verdicts
 * are ours and the string is the evidence.
 *
 * The name says "archive" because that is what the first source was. The
 * type now describes any real footage, and `NormalizedFootageAsset` in
 * `lib/footage/types.ts` is the same type under the name the engine uses.
 */

/** Where a scene's picture comes from. `ai` is today's whole pipeline. */
export type DocumentaryVisualSource = "ai" | "stock_video" | "stock_image";
export const VISUAL_SOURCES: readonly DocumentaryVisualSource[] = [
  "ai",
  "stock_video",
  "stock_image",
];

/**
 * A provider id. The six the registry knows are named so the compiler can
 * catch a typo in the code that routes to them; the `string` tail keeps the
 * type open, because the library holds rows from providers that no longer
 * search (NARA and Smithsonian were declared and never built — see
 * docs/nara-smithsonian-deprecation.md) and a future provider must be
 * storable the day its adapter lands, with no migration.
 */
export type ArchiveProvider =
  | "wikimedia"
  | "eu_av"
  | "dvids"
  | "nasa"
  | "url_import"
  | "user_upload"
  | (string & {});

/** The providers that SEARCH today, in registry order. */
export const ARCHIVE_PROVIDERS: readonly ArchiveProvider[] = [
  "eu_av",
  "dvids",
  "nasa",
  "wikimedia",
  "url_import",
  "user_upload",
];

export type ArchiveMediaType = "video" | "image";

/**
 * The coarse rights class, derived in `rights.ts` from the licence string.
 * `restricted` is NC/ND — real licences that forbid exactly what a film does.
 */
export type RightsStatus =
  | "public_domain"
  | "cc0"
  | "cc_by"
  | "cc_by_sa"
  | "other_free"
  | "restricted"
  | "unknown";

/** `share_alike` = allowed, on condition the film's reuse is licensed alike. */
export type UseStatus = "allowed" | "share_alike" | "forbidden" | "unknown";

export type ReviewStatus = "auto_approved" | "manual_review" | "rejected";

/** What kind of shot it is, when the provider says. */
export type FootageFormat =
  | "broll"
  | "stockshots"
  | "speech"
  | "press_conference"
  | "interview"
  | "news_package"
  | "live_stream"
  | "documentary"
  | "unknown";

/** Where in the world of footage it comes from. */
export type FootageOrigin = "recent_news" | "official_media" | "historical" | "generic" | "user_upload";

/**
 * What a piece of real footage IS, at the asset level — the same vocabulary
 * as the scene's `visual_origin` minus the two AI values, which no real asset
 * can be. Copied onto the scene when the asset is attached, where the
 * producer's Footage type control may then overrule it.
 */
export type FootageProvenance =
  | "actual_footage"
  | "illustrative_footage"
  | "archival_footage"
  | "archival_photo"
  | "real_stock"
  | "unknown";

export interface NormalizedArchiveAsset {
  provider: ArchiveProvider;
  /** The provider's own id (Commons pageid, DVIDS "video:123", NASA nasa_id, a URL hash). */
  providerAssetId: string;
  mediaType: ArchiveMediaType;
  title: string;
  /** Plain text — every provider's HTML is stripped before it lands here. */
  description: string | null;
  /** The page a human reads (and the film credits). */
  sourceUrl: string;
  /** The bytes. May be a 500 MB webm; nothing downloads it whole. */
  downloadUrl: string;
  /** A poster for videos, a scaled copy for images. */
  thumbnailUrl: string | null;
  /** A small playable preview, when the provider offers one apart from the file. */
  previewUrl?: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /**
   * The provider's date string, VERBATIM. It is not the year of the event:
   * Commons gave a 1969 NASA clip `2015-06-12` (the YouTube upload) and a
   * 2013 photo of a museum replica for an 1886 subject. Shown, never trusted.
   */
  dateOriginal: string | null;
  /** Every plausible year the title and description mention, ascending. */
  yearsMentioned: number[];
  creator: string | null;
  credit: string | null;
  /** The licence as the provider states it ("CC BY-SA 4.0", "Public domain"). */
  licenseOriginal: string | null;
  /** The provider's machine code when it has one ("pd", "cc-by-sa-4.0"). */
  licenseCode: string | null;
  licenseUrl: string | null;
  rightsStatus: RightsStatus;
  commercialUse: UseStatus;
  modifications: UseStatus;
  attributionRequired: boolean;
  reviewStatus: ReviewStatus;
  /** Why it is not auto-approved, in one line; null when it is. */
  reviewReason: string | null;
  categories: string[];
  /** Lower-cased title + description + categories + creator, for the library's own search. */
  searchableText: string;
  /** 0..1 from resolution (and length, for video). Not relevance. */
  qualityScore: number;

  // --- The universal engine's enrichments. Every one optional: the Wikimedia
  // --- adapter predates them, and a row filed before they existed reads as
  // --- "unknown" rather than as wrong.

  /** What kind of shot, when the provider says (EU AV and DVIDS do). */
  footageFormat?: FootageFormat;
  origin?: FootageOrigin;
  /** When the material was SHOT, as the provider states it. Distinct from
   *  `dateOriginal`, which is whatever the uploader typed, and from
   *  `publicationDate`. Trusted a notch more, because official media
   *  providers record it deliberately — never treated as proof of an event. */
  filmingDate?: string | null;
  publicationDate?: string | null;
  location?: string | null;
  country?: string | null;
  eventName?: string | null;
  people?: string[];
  organizations?: string[];
  /** The provider's own rights statement, verbatim — the evidence. */
  rightsText?: string | null;
  /** The asset-level answer to "what is this", before any scene asks. */
  provenance?: FootageProvenance;
  provenanceConfidence?: number;
}

/** The engine's name for the same shape. */
export type NormalizedFootageAsset = NormalizedArchiveAsset;

export interface ArchiveSearchOptions {
  mediaType: ArchiveMediaType | "any";
  /** Per provider, per media type. */
  limit: number;
  signal?: AbortSignal;
}

/**
 * The legacy adapter contract, kept so `searchArchives()` and the code that
 * used it keep compiling. A `FootageProvider` (lib/footage/types.ts) is a
 * superset; the registry exposes each provider through both.
 */
export interface ArchiveProviderAdapter {
  readonly provider: ArchiveProvider;
  /** False when the archive needs a key the environment does not hold. */
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  search(query: string, opts: ArchiveSearchOptions): Promise<NormalizedArchiveAsset[]>;
  /**
   * One asset, fresh from the provider — the current rights and the current
   * download URL. Null means it is gone, which is what "check availability"
   * amounts to.
   */
  getAsset(
    providerAssetId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<NormalizedArchiveAsset | null>;
}
