/**
 * The archives, behind one call.
 *
 * `searchArchives` fans a query out to every enabled provider, normalizes,
 * and reports per provider — including the ones that could not answer, so a
 * screen can say "Smithsonian: no key" instead of quietly showing fewer
 * results. A provider that throws costs its own results and nothing else.
 *
 * NARA and Smithsonian are declared here as DISABLED adapters rather than
 * left out: the picker lists all three so the gap is visible, and the day
 * their keys exist the only change is the adapter file. Both need a key we
 * do not hold (NARA: catalog.archives.gov, `x-api-key`; Smithsonian:
 * api.data.gov, `api_key`), and neither can be tested from here without one —
 * so they are not pretended into existence.
 */

import { wikimedia } from "./wikimedia";
import type {
  ArchiveMediaType,
  ArchiveProvider,
  ArchiveProviderAdapter,
  NormalizedArchiveAsset,
} from "./types";

export * from "./types";
export { classifyLicense, autoApprovedClasses } from "./rights";

const notBuilt = (
  provider: ArchiveProvider,
  reason: string,
): ArchiveProviderAdapter => ({
  provider,
  enabled: false,
  disabledReason: reason,
  async search() {
    throw new Error(`${provider}: ${reason}`);
  },
  async getAsset() {
    throw new Error(`${provider}: ${reason}`);
  },
});

const ADAPTERS: readonly ArchiveProviderAdapter[] = [
  wikimedia,
  notBuilt("nara", "not built yet — needs NARA_API_KEY from catalog.archives.gov"),
  notBuilt("smithsonian", "not built yet — needs SMITHSONIAN_API_KEY from api.data.gov"),
];

export function archiveAdapters(): readonly ArchiveProviderAdapter[] {
  return ADAPTERS;
}

export function adapterFor(provider: string): ArchiveProviderAdapter | null {
  return ADAPTERS.find((a) => a.provider === provider) ?? null;
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

export async function searchArchives(
  query: string,
  opts: {
    mediaType: ArchiveMediaType | "any";
    limit: number;
    providers?: ArchiveProvider[];
    signal?: AbortSignal;
  },
): Promise<ArchiveSearchResult> {
  const wanted = ADAPTERS.filter((a) => !opts.providers || opts.providers.includes(a.provider));
  const settled = await Promise.allSettled(
    wanted.map((a) =>
      a.enabled
        ? a.search(query, { mediaType: opts.mediaType, limit: opts.limit, signal: opts.signal })
        : Promise.reject(new Error(a.disabledReason ?? "disabled")),
    ),
  );
  const results: NormalizedArchiveAsset[] = [];
  const providers: ProviderReport[] = [];
  settled.forEach((s, i) => {
    const a = wanted[i];
    if (s.status === "fulfilled") {
      results.push(...s.value);
      providers.push({ provider: a.provider, enabled: a.enabled, reason: null, count: s.value.length });
    } else {
      providers.push({
        provider: a.provider,
        enabled: a.enabled,
        reason: s.reason instanceof Error ? s.reason.message : String(s.reason),
        count: 0,
      });
    }
  });
  return { results, providers };
}
