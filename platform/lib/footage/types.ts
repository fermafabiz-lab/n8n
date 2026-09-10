/**
 * The Universal Footage Engine — the contracts.
 *
 * Documentary mode asks for footage by WHAT it needs, never by WHERE it comes
 * from: a scene hands the engine a `FootageSearchRequest` (event, place,
 * date, keywords, the kind of shot), and the engine decides which providers
 * to ask, normalizes whatever they answer into one asset shape, validates the
 * rights centrally, scores the match, and returns the best candidates. Every
 * provider is one adapter behind `FootageProvider`; adding one changes the
 * registry and nothing in the scene-matching path.
 *
 * The asset shape is the archive library's own `NormalizedArchiveAsset`
 * (lib/archive/types.ts) — extended, not duplicated — so the same row the
 * picker has always filed in `hov.stock_media` is what the engine ranks.
 */

import type {
  ArchiveMediaType,
  ArchiveProvider,
  FootageFormat,
  FootageProvenance,
  NormalizedFootageAsset,
} from "@/lib/archive/types";

export type {
  ArchiveMediaType as FootageMediaType,
  ArchiveProvider as FootageProviderId,
  FootageFormat,
  FootageOrigin,
  FootageProvenance,
  NormalizedFootageAsset,
} from "@/lib/archive/types";

/** The kind of shot a scene wants. `any` leaves it to the ranker. */
export type PreferredFootageType = "broll" | "stockshots" | "speech" | "interview" | "any";

/**
 * What a scene needs. Built from the scene's own text by `buildFootageRequest`
 * — or by the model in n8n — and never padded: a date, a place or an event
 * that the script does not support is left absent rather than guessed, since
 * every field here becomes a filter and a scoring signal downstream.
 */
export interface FootageSearchRequest {
  sceneId: string;
  narration: string;
  topic?: string;
  event?: string;
  location?: string;
  country?: string;
  /** ISO dates or bare years — whatever the script supports. */
  dateFrom?: string;
  dateTo?: string;
  people?: string[];
  organizations?: string[];
  keywords: string[];
  preferredMediaType: ArchiveMediaType;
  preferredFootageType?: PreferredFootageType;
  /** Only ACTUAL footage of the named event will do; illustrative is refused. */
  requireExactEvent?: boolean;
  /** Free-text queries authored upstream (the model, or the producer). Merged with the generated ones. */
  queries?: string[];
}

/**
 * The spec's six-way answer to "may this be used", over the library's stored
 * verdict. `FootageRightsValidator.validate()` is the only thing that produces
 * one; nothing else re-reads a licence string.
 */
export type UsageClass =
  | "cleared"
  | "attribution_required"
  | "editorial_only"
  | "manual_review"
  | "restricted"
  | "unknown";

export interface RightsResult {
  status: UsageClass;
  license?: string;
  attribution?: string;
  reason?: string;
  originalRightsText?: string;
}

/** Where the bytes can actually be fetched from, resolved at use time. */
export interface ResolvedMedia {
  url: string;
  mimeType: string | null;
  /** True when the URL is a whole file a range request can seek in. */
  seekable: boolean;
  headers?: Record<string, string>;
}

export interface ProviderSearchCapabilities {
  video: boolean;
  image: boolean;
  recentNews: boolean;
  historical: boolean;
  directDownload: boolean;
  /**
   * Answers from the library only (uploads, URL imports). The engine's
   * local-first pass already reads those rows, so the router never asks such
   * a provider and it never appears in a search report as "routed".
   */
  localOnly?: boolean;
}

export interface ProviderSearchOptions {
  limit: number;
  signal?: AbortSignal;
}

/**
 * What KIND of source a provider is — the router's second axis after the
 * subject categories, and the reason "never every provider for every scene"
 * survives a registry of a dozen:
 *
 *   official   a body publishing its own footage of its own events (EU AV,
 *              DVIDS, NASA): asked first on their subjects, never on history
 *   archive    a catalogue of dated historical material (Internet Archive,
 *              Library of Congress, Europeana, Wellcome, Wikimedia): asked on
 *              history and on named events, and as the general fallback
 *   community  photographs people licensed openly (Flickr, Openverse): asked
 *              on recent events and places, after official sources
 *   stock      generic B-roll with a blanket licence (Pexels, Pixabay,
 *              Unsplash): asked only when the scene names NO event — a real
 *              clip of the wrong thing is not "real footage" of anything
 *   library    answers from our own rows (uploads, URL imports): never routed
 */
export type ProviderTier = "official" | "archive" | "community" | "stock" | "library";

/**
 * One source of real footage. Everything the engine needs from an adapter and
 * nothing it does not: the shape is deliberately small so a new archive is an
 * afternoon, not a project.
 */
export interface FootageProvider {
  readonly id: ArchiveProvider;
  readonly displayName: string;
  /** False when a key or a base URL the adapter needs is not in the environment. */
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  /**
   * A caveat on a provider that IS enabled — "anonymous, five requests an
   * hour" — for the admin strip and the picker's chips. Null when there is
   * nothing to say. Distinct from `disabledReason`: a provider with a notice
   * is still routed.
   */
  readonly notice?: string | null;
  /** Router weight, 0–100. Ties between matching providers break on this. */
  readonly priority: number;
  readonly tier: ProviderTier;
  /** The topic strengths the router matches a request against. */
  readonly categories: readonly string[];
  readonly searchCapabilities: ProviderSearchCapabilities;
  /** The structured search. Adapters turn the request's queries into their own syntax. */
  search(request: FootageSearchRequest, opts: ProviderSearchOptions): Promise<NormalizedFootageAsset[]>;
  /** One asset, fresh — current rights and current download URL; null when gone. */
  getAssetDetails?(providerAssetId: string, opts?: { signal?: AbortSignal }): Promise<NormalizedFootageAsset | null>;
  /** Provider-specific rights knowledge layered on the central classifier. */
  checkRights(asset: NormalizedFootageAsset): Promise<RightsResult>;
  /** Where to fetch the bytes from, when that is not simply `downloadUrl`. */
  resolveDownload?(asset: NormalizedFootageAsset): Promise<ResolvedMedia>;
  /** For the URL importer: does this page belong to me, and can I read it properly? */
  matchesUrl?(url: URL): boolean;
  importFromUrl?(url: URL, opts?: { signal?: AbortSignal }): Promise<NormalizedFootageAsset | null>;
}

/** A candidate after ranking — what the picker and the suggestion run receive. */
export interface RankedFootage {
  asset: NormalizedFootageAsset & { id: string | null; status?: string | null };
  /** 0–100, see lib/footage/rank.ts. */
  score: number;
  /** The scorer's own line — which signals carried the score, which penalty hit. */
  reasons: string[];
  rights: RightsResult;
  provenance: FootageProvenance;
  provenanceConfidence: number;
}

export interface ProviderReport {
  provider: ArchiveProvider;
  displayName: string;
  enabled: boolean;
  /** Whether the router asked this provider at all for this request. */
  routed: boolean;
  /** Why it did not answer — disabled, skipped by the router, or the error it threw. */
  reason: string | null;
  count: number;
  ms: number;
}

export type { FootageFormat as FootageShotFormat, FootageProvenance as AssetProvenance };
