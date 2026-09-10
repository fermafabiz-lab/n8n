/**
 * Openverse — `api.openverse.org`, the WordPress/Creative Commons catalogue
 * of openly licensed images across hundreds of sources (Flickr, museums,
 * Wikimedia, science agencies…). Images only; every result carries its
 * licence as a code and a URL, which is why it is worth a seat.
 *
 * KEYED, and off without `OPENVERSE_CLIENT_ID` + `OPENVERSE_CLIENT_SECRET`
 * (free, api.openverse.org/v1/auth_tokens/register/). Measured 2026-09-10
 * from the box: an anonymous request from the Hetzner IP is answered with
 * Cloudflare's "Just a moment…" challenge (HTTP 403), not JSON — so the
 * anonymous tier the documentation describes is not reachable from here, and
 * only the OAuth2 client-credentials path is worth trying. The token is
 * cached in memory until it expires.
 *
 * Documented shape (docs.openverse.org):
 *   GET /v1/images/?q=…&license=cc0,pdm,by,by-sa&page_size=…&mature=false
 *     → { result_count, page_count, results: [{ id, title, foreign_landing_url,
 *         url, creator, creator_url, license ("by"), license_version ("2.0"),
 *         license_url, provider, source, category, filesize, filetype,
 *         tags: [{ name }], attribution, height, width, thumbnail, detail_url }] }
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, stripHtml, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries } from "../request";
import { validateRights } from "../rights";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const API = "https://api.openverse.org/v1";
const UA = "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research)";
const clientId = () => (process.env.OPENVERSE_CLIENT_ID ?? "").trim();
const clientSecret = () => (process.env.OPENVERSE_CLIENT_SECRET ?? "").trim();

export interface OpenverseResult {
  id?: string;
  title?: string;
  foreign_landing_url?: string;
  url?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  provider?: string;
  source?: string;
  category?: string;
  filetype?: string;
  filesize?: number;
  tags?: Array<{ name?: string }>;
  attribution?: string;
  height?: number;
  width?: number;
  thumbnail?: string;
  detail_url?: string;
}

/** Openverse's short codes as the classifier reads them. */
export function openverseLicenseCode(license: string | undefined): string | null {
  const l = (license ?? "").toLowerCase();
  if (!l) return null;
  if (l === "cc0") return "cc0";
  if (l === "pdm") return "public domain mark";
  return `cc-${l}`;
}

export function normalizeOpenverseResult(r: OpenverseResult): NormalizedFootageAsset | null {
  const id = String(r.id ?? "").trim();
  const title = stripHtml(r.title) ?? "";
  if (!id || !r.url) return null;
  const code = openverseLicenseCode(r.license);
  const rights = classifyLicense(code, `${code ?? ""} ${r.license_version ?? ""} ${r.license_url ?? ""}`.trim(), null);
  const tags = (r.tags ?? []).map((t) => String(t.name ?? "")).filter(Boolean).slice(0, 20);
  const years = yearsIn(title, tags.join(" "));
  const latest = years.length ? years[years.length - 1] : null;
  const source = r.source ?? r.provider ?? "openverse";
  return {
    provider: "openverse",
    providerAssetId: id,
    mediaType: "image",
    title: title || `Openverse image ${id.slice(0, 8)}`,
    description: null,
    sourceUrl: r.foreign_landing_url ?? r.detail_url ?? r.url,
    downloadUrl: r.url,
    thumbnailUrl: r.thumbnail ?? r.url,
    previewUrl: null,
    width: r.width ?? null,
    height: r.height ?? null,
    durationSeconds: null,
    mimeType: r.filetype ? `image/${r.filetype.toLowerCase()}` : null,
    sizeBytes: r.filesize ?? null,
    dateOriginal: null,
    yearsMentioned: years,
    creator: stripHtml(r.creator),
    credit: stripHtml(r.attribution) ?? stripHtml(r.creator) ?? source,
    licenseOriginal: r.license ? `${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim() : null,
    licenseCode: code,
    licenseUrl: r.license_url ?? null,
    ...rights,
    categories: tags,
    searchableText: searchable(title, tags, r.creator, source),
    qualityScore: qualityScoreOf(r.width ?? null, r.height ?? null, null, "image"),
    footageFormat: "unknown",
    origin: latest !== null && latest < 1995 ? "historical" : "generic",
    filmingDate: null,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [source],
    rightsText: [r.license_url, r.attribution].filter(Boolean).join(" · ") || null,
    provenance: "archival_photo",
    provenanceConfidence: 60,
  };
}

let token: { value: string; until: number } | null = null;

async function bearer(signal?: AbortSignal): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  const body = new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), grant_type: "client_credentials" });
  const res = await fetch(`${API}/auth_tokens/token/`, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Openverse token request answered HTTP ${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Openverse token request answered without a token");
  token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 60) * 1000 };
  return token.value;
}

async function searchOne(q: string, limit: number, signal?: AbortSignal): Promise<NormalizedFootageAsset[]> {
  const url = new URL(`${API}/images/`);
  url.searchParams.set("q", q);
  url.searchParams.set("license", "cc0,pdm,by,by-sa");
  url.searchParams.set("page_size", String(Math.min(Math.max(limit, 1), 50)));
  url.searchParams.set("mature", "false");
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Authorization: `Bearer ${await bearer(signal)}` }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("Openverse rate limit reached");
  if (!res.ok) throw new Error(`Openverse answered HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/json/.test(ct)) throw new Error("Openverse answered with something other than JSON (a Cloudflare challenge, most likely)");
  const body = (await res.json()) as { results?: OpenverseResult[] };
  return (body.results ?? []).map(normalizeOpenverseResult).filter((a): a is NormalizedFootageAsset => a !== null);
}

export const openverseProvider: FootageProvider = {
  id: "openverse",
  displayName: "Openverse",
  get enabled() {
    return Boolean(clientId() && clientSecret());
  },
  get disabledReason() {
    return clientId() && clientSecret() ? null : "needs OPENVERSE_CLIENT_ID + OPENVERSE_CLIENT_SECRET (free) — anonymous requests from the box are challenged by Cloudflare";
  },
  priority: 65,
  tier: "community",
  categories: ["events", "places", "people", "politics", "history", "science"],
  searchCapabilities: { video: false, image: true, recentNews: true, historical: true, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const queries = generateSearchQueries(request).slice(0, 3);
    const seen = new Set<string>();
    const out: NormalizedFootageAsset[] = [];
    for (const q of queries) {
      for (const h of await searchOne(q, opts.limit, opts.signal)) {
        if (seen.has(h.providerAssetId)) continue;
        seen.add(h.providerAssetId);
        out.push(h);
      }
    }
    return out;
  },

  async getAssetDetails(id, opts) {
    const res = await fetch(`${API}/images/${encodeURIComponent(id)}/`, { headers: { "User-Agent": UA, Accept: "application/json", Authorization: `Bearer ${await bearer(opts?.signal)}` }, signal: opts?.signal ?? AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Openverse answered HTTP ${res.status}`);
    return normalizeOpenverseResult((await res.json()) as OpenverseResult);
  },

  async checkRights(asset) {
    return validateRights(asset);
  },
};
