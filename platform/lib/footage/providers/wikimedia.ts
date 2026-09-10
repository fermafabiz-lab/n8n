/**
 * Wikimedia Commons as a `FootageProvider` — the broad, general one.
 *
 * The adapter itself is `lib/archive/wikimedia.ts`, unchanged: it was written
 * off real responses and has answered every archive search since Documentary
 * mode began. This file gives it the engine's contract — categories for the
 * router, a structured search that runs the request's top queries, an
 * importer for `commons.wikimedia.org/wiki/File:…` pages — and adds the two
 * enrichments Commons can actually supply: a `historical` origin when the
 * asset's own years fall before the newsroom era, and `archival_*` provenance
 * by media type.
 *
 * Every asset's licence is read individually by `classifyLicense`; nothing
 * here assumes Commons is one licence.
 */

import { wikimedia } from "@/lib/archive/wikimedia";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

function enrich(a: NormalizedFootageAsset): NormalizedFootageAsset {
  const latest = a.yearsMentioned.length ? a.yearsMentioned[a.yearsMentioned.length - 1] : null;
  return {
    ...a,
    origin: latest !== null && latest < 1995 ? "historical" : "generic",
    footageFormat: a.mediaType === "video" ? "broll" : "unknown",
    provenance: a.mediaType === "video" ? "archival_footage" : "archival_photo",
    provenanceConfidence: 70,
  };
}

export const wikimediaProvider: FootageProvider = {
  id: "wikimedia",
  displayName: "Wikimedia Commons",
  enabled: wikimedia.enabled,
  disabledReason: wikimedia.disabledReason,
  priority: 75,
  tier: "archive",
  categories: ["general", "history", "places", "people", "events", "politics"],
  searchCapabilities: { video: true, image: true, recentNews: false, historical: true, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      const hits = await wikimedia.search(q, {
        mediaType: request.preferredMediaType === "image" ? "image" : "any",
        limit: opts.limit,
        signal: opts.signal,
      });
      for (const h of hits) {
        if (seen.has(h.providerAssetId)) continue;
        seen.add(h.providerAssetId);
        out.push(enrich(h));
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const a = await wikimedia.getAsset(id, opts);
    return a ? enrich(a) : null;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return /(^|\.)commons\.(m\.)?wikimedia\.org$/i.test(url.hostname) && /\/wiki\/File:/i.test(url.pathname);
  },

  /** A File: page → the same asset a search would have filed. */
  async importFromUrl(url, opts) {
    const title = decodeURIComponent(url.pathname.replace(/^\/wiki\//, ""));
    const api = new URL("https://commons.wikimedia.org/w/api.php");
    for (const [k, v] of Object.entries({
      action: "query",
      format: "json",
      formatversion: "2",
      titles: title,
      prop: "imageinfo|categories",
      iiprop: "url|size|mime|mediatype|extmetadata",
      iiurlwidth: "640",
      cllimit: "20",
    })) {
      api.searchParams.set(k, v);
    }
    const res = await fetch(api, {
      headers: { "User-Agent": "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)" },
      signal: opts?.signal ?? AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Commons answered HTTP ${res.status}` + (await describeHttpError(res)));
    const body = (await res.json()) as { query?: { pages?: Array<{ pageid?: number; missing?: boolean }> } };
    const page = body.query?.pages?.[0];
    if (!page || page.missing || !page.pageid) return null;
    return this.getAssetDetails!(String(page.pageid), opts);
  },
};
