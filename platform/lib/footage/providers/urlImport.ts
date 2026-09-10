/**
 * Pasted URLs as a provider.
 *
 * Like uploads, it searches nothing outside the box: what a producer has
 * imported is a library row under `provider = 'url_import'`, found by the
 * local-first pass and by this provider's filtered search. The import itself
 * — fetching a page, reading its OpenGraph, JSON-LD and video tags, or
 * handing it to the provider that owns the domain — is `lib/footage/urlImport.ts`.
 */

import { searchStockLibrary } from "@/lib/data/stock";
import { generateSearchQueries } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

export const urlImportProvider: FootageProvider = {
  id: "url_import",
  displayName: "URL import",
  enabled: true,
  disabledReason: null,
  priority: 65,
  tier: "library",
  categories: ["general"],
  searchCapabilities: { video: true, image: true, recentNews: true, historical: true, directDownload: false, localOnly: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const out: NormalizedFootageAsset[] = [];
    const seen = new Set<string>();
    for (const q of generateSearchQueries(request).slice(0, 3)) {
      const rows = await searchStockLibrary(q, { mediaType: "any", limit: opts.limit, provider: "url_import" });
      for (const r of rows) {
        if (seen.has(r.providerAssetId)) continue;
        seen.add(r.providerAssetId);
        out.push(r);
      }
    }
    return out;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },
};
