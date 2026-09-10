/**
 * The same footage from two doors is one asset.
 *
 * Three identities, checked in order of cost: the provider's own id (free),
 * the canonical source URL (free — the same Commons page reached through the
 * URL importer and through a search is one page), and a content hash when
 * one is already known (an upload, or a file the site has stored). Nothing
 * here downloads anything to find out: a hash we do not have is not an
 * identity we can compare, and the spec is explicit that deduplication is
 * not worth a fetch.
 */

import type { NormalizedFootageAsset } from "./types";

/** Strip the parts of a URL that vary without the document varying. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // Tracking and pagination noise. Commons appends utm_source to every
    // file URL; every other provider has its own version of the same.
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|source$|_ga)/i.test(k)) u.searchParams.delete(k);
    }
    u.searchParams.sort();
    let host = u.host.toLowerCase().replace(/^www\./, "");
    // Commons pages come in three spellings of one address.
    if (host === "commons.m.wikimedia.org") host = "commons.wikimedia.org";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const q = u.searchParams.toString();
    return `${u.protocol}//${host}${path}${q ? `?${q}` : ""}`;
  } catch {
    return raw.trim();
  }
}

export function identityKeys(a: NormalizedFootageAsset & { contentHash?: string | null }): string[] {
  const keys = [`${a.provider}:${a.providerAssetId}`];
  if (a.sourceUrl) keys.push(`url:${canonicalUrl(a.sourceUrl)}`);
  if (a.downloadUrl) keys.push(`file:${canonicalUrl(a.downloadUrl)}`);
  if (a.contentHash) keys.push(`sha:${a.contentHash}`);
  return keys;
}

/**
 * Keep the first of each identity, in input order — which the engine makes
 * the higher-priority provider's answer, so the better-catalogued copy wins.
 */
export function dedupeAssets<T extends NormalizedFootageAsset & { contentHash?: string | null }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of items) {
    const keys = identityKeys(a);
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(a);
  }
  return out;
}
