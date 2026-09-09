/**
 * The archives, behind one call — now a thin door onto the Universal Footage
 * Engine (lib/footage), kept so the code written against it keeps working.
 *
 * `searchArchives(query, …)` is the free-text search the picker and the
 * suggestion run used from the first day of Documentary mode. It now builds
 * a minimal `FootageSearchRequest` from the query and lets the engine route
 * it; the answer is the same `NormalizedArchiveAsset[]` plus a per-provider
 * report, so a screen can still say "DVIDS: no key" instead of quietly
 * showing fewer results.
 *
 * NARA and Smithsonian are gone from here. They were declared as disabled
 * placeholders for two months and never built; the registry does not list
 * them, no search reaches them, and the rows the library may hold under
 * their names stay readable. See docs/nara-smithsonian-deprecation.md.
 */

import { providerById, searchableProviders } from "@/lib/footage/registry";
import { searchFootage } from "@/lib/footage/engine";
import type { FootageSearchRequest } from "@/lib/footage/types";
import type {
  ArchiveMediaType,
  ArchiveProvider,
  ArchiveProviderAdapter,
  NormalizedArchiveAsset,
} from "./types";

export * from "./types";
export { classifyLicense, autoApprovedClasses } from "./rights";

/** The legacy adapter view of a registry provider. */
function asAdapter(id: string): ArchiveProviderAdapter | null {
  const p = providerById(id);
  if (!p) return null;
  return {
    provider: p.id,
    enabled: p.enabled,
    disabledReason: p.disabledReason,
    async search(query, opts) {
      const r = await searchFootage(requestFromQuery(query, opts.mediaType), {
        providers: [p.id],
        limit: opts.limit,
        top: opts.limit * 2,
        forceProviders: true,
        signal: opts.signal,
      });
      return r.candidates.map((c) => c.asset);
    },
    async getAsset(providerAssetId, opts) {
      return p.getAssetDetails ? p.getAssetDetails(providerAssetId, opts) : null;
    },
  };
}

export function archiveAdapters(): readonly ArchiveProviderAdapter[] {
  return searchableProviders()
    .map((p) => asAdapter(p.id))
    .filter((a): a is ArchiveProviderAdapter => a !== null);
}

export function adapterFor(provider: string): ArchiveProviderAdapter | null {
  return asAdapter(provider);
}

export interface ProviderReport {
  provider: ArchiveProvider;
  enabled: boolean;
  /** Why it did not answer — disabled, or the error it threw. */
  reason: string | null;
  count: number;
}

export interface ArchiveSearchResult {
  results: NormalizedArchiveAsset[];
  providers: ProviderReport[];
}

/** A free-text query as a request: the words are the keywords, nothing is invented. */
export function requestFromQuery(query: string, mediaType: ArchiveMediaType | "any"): FootageSearchRequest {
  const q = query.trim().replace(/\s+/g, " ");
  return {
    sceneId: "adhoc",
    narration: q,
    keywords: q.split(" ").filter((w) => w.length >= 3).slice(0, 12),
    preferredMediaType: mediaType === "image" ? "image" : "video",
    preferredFootageType: "any",
    queries: [q],
  };
}

export async function searchArchives(
  query: string,
  opts: {
    mediaType: ArchiveMediaType | "any";
    limit: number;
    providers?: ArchiveProvider[];
    signal?: AbortSignal;
  },
): Promise<ArchiveSearchResult> {
  const r = await searchFootage(requestFromQuery(query, opts.mediaType), {
    providers: opts.providers,
    limit: opts.limit,
    top: Math.max(opts.limit * 2, 24),
    forceProviders: true,
    signal: opts.signal,
  });
  const results = r.candidates
    .map((c) => c.asset)
    .filter((a) => opts.mediaType === "any" || a.mediaType === opts.mediaType);
  return {
    results,
    providers: r.providers
      .filter((p) => p.routed)
      .map((p) => ({ provider: p.provider, enabled: p.enabled, reason: p.reason, count: p.count })),
  };
}
