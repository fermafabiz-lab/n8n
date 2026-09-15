/**
 * A producer's own upload as a provider.
 *
 * It searches nothing outside the box — every upload is already a library row
 * — so its `search` is the library's full-text search filtered to
 * `provider = 'user_upload'`, and the engine's local-first pass finds the
 * same rows anyway. Existing as a provider matters for the picker's filter,
 * the admin page, and the rights path: an upload's rights are whatever the
 * person who uploaded it declared, and its provenance is `unknown` until a
 * person says otherwise (§25). Nothing about an upload is ever assumed.
 */

import { searchStockLibrary } from "@/lib/data/stock";
import { generateSearchQueries } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

export const userUploadProvider: FootageProvider = {
  id: "user_upload",
  displayName: "Manual upload",
  enabled: true,
  disabledReason: null,
  priority: 60,
  tier: "library",
  categories: ["general"],
  searchCapabilities: { video: true, image: true, recentNews: true, historical: true, directDownload: true, localOnly: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const out: NormalizedFootageAsset[] = [];
    const seen = new Set<string>();
    for (const q of generateSearchQueries(request).slice(0, 3)) {
      const rows = await searchStockLibrary(q, { mediaType: "any", limit: opts.limit, provider: "user_upload" });
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
