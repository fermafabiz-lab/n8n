/**
 * Archive footage for Documentary mode — the neutral shapes.
 *
 * Three archives, one vocabulary. Each provider (Wikimedia Commons today; NARA
 * and Smithsonian once their keys exist) answers in its own dialect, and an
 * adapter's whole job is to turn that into a `NormalizedArchiveAsset`.
 * Nothing downstream — the search route, the `stock_media` table, the scene
 * picker — ever sees a provider payload, so a fourth archive is one file.
 *
 * The rights fields are the reason the shape is this wide. A film is a
 * DERIVATIVE made for a channel that earns money, so "free" is not one bit:
 * an asset has to say whether it may be used commercially, whether it may be
 * modified, and whether it must be credited — and it has to keep the
 * provider's own licence string next to those verdicts, because the verdicts
 * are ours and the string is the evidence.
 */

/** Where a scene's picture comes from. `ai` is today's whole pipeline. */
export type DocumentaryVisualSource = "ai" | "stock_video" | "stock_image";
export const VISUAL_SOURCES: readonly DocumentaryVisualSource[] = [
  "ai",
  "stock_video",
  "stock_image",
];

export type ArchiveProvider = "wikimedia" | "nara" | "smithsonian";
export const ARCHIVE_PROVIDERS: readonly ArchiveProvider[] = [
  "wikimedia",
  "nara",
  "smithsonian",
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

export interface NormalizedArchiveAsset {
  provider: ArchiveProvider;
  /** The provider's own id (Commons pageid, NARA naId, Smithsonian id). */
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
}

export interface ArchiveSearchOptions {
  mediaType: ArchiveMediaType | "any";
  /** Per provider, per media type. */
  limit: number;
  signal?: AbortSignal;
}

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
