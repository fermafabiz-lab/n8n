/**
 * Openverse — `api.openverse.org`, the WordPress/Creative Commons catalogue
 * of openly licensed images across hundreds of sources (Flickr, museums,
 * Wikimedia, science agencies…). Images only; every result carries its
 * licence as a code and a URL, which is why it is worth a seat.
 *
 * TWO MODES, never off. With `OPENVERSE_CLIENT_ID` + `OPENVERSE_CLIENT_SECRET`
 * (free, api.openverse.org/v1/auth_tokens/register/) every request carries an
 * OAuth2 client-credentials token — the API's standard tier, 10,000 requests
 * a day and 100 a minute. Without them the adapter runs ANONYMOUSLY, exactly
 * as the official client does: no header, and the API's anonymous throttle
 * applies — 5 requests an hour, 100 a day, at most 20 results a page (the
 * `anon_burst` / `anon_sustained` rates the API declares; its own 429 is the
 * authority, these numbers only keep us from asking for one). So anonymous
 * mode spends ONE request per search, on the most specific query, and keeps a
 * sliding window of its own: the fifth request in an hour is the last this
 * process sends until the window frees, reported as a rate limit so the
 * health module holds the provider back for a quarter hour instead of burning
 * the budget on refusals.
 *
 * Measured 2026-09-10 from the box: an anonymous request from the Hetzner IP
 * was answered with Cloudflare's "Just a moment…" challenge (HTTP 403), not
 * JSON. That is a fact about the address, not a reason to switch the mode
 * off — the health strip says so when it happens, the router gives the slot
 * to the next provider, and the credentials are the thing to add either way.
 * Whether the authenticated path passes the challenge from that address is
 * unverified.
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

/** The anonymous throttle as the API declares it. */
export const OPENVERSE_ANON_PER_HOUR = 5;
export const OPENVERSE_ANON_PER_DAY = 100;
export const OPENVERSE_ANON_PAGE_MAX = 20;
const AUTH_PAGE_MAX = 50;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export type OpenverseMode = "authenticated" | "anonymous";

/** Authenticated when both halves of the client are in the environment, anonymous otherwise. */
export const openverseMode = (): OpenverseMode => (clientId() && clientSecret() ? "authenticated" : "anonymous");

export const OPENVERSE_ANONYMOUS_NOTICE =
  `anonymous — ${OPENVERSE_ANON_PER_HOUR} requests an hour, ${OPENVERSE_ANON_PER_DAY} a day, ${OPENVERSE_ANON_PAGE_MAX} results a page; ` +
  "add OPENVERSE_CLIENT_ID + OPENVERSE_CLIENT_SECRET (free) for 10,000 a day";

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
/** Timestamps of the anonymous requests this process has sent, oldest first. */
let anonymousSent: number[] = [];

/** For tests: forget the cached token and the anonymous window. */
export function resetOpenverseState(): void {
  token = null;
  anonymousSent = [];
}

/** How many anonymous requests are left in the current hour and day. */
export function openverseAnonymousBudget(now = Date.now()): { hour: number; day: number } {
  anonymousSent = anonymousSent.filter((t) => now - t < DAY_MS);
  const hour = anonymousSent.filter((t) => now - t < HOUR_MS).length;
  return { hour: Math.max(0, OPENVERSE_ANON_PER_HOUR - hour), day: Math.max(0, OPENVERSE_ANON_PER_DAY - anonymousSent.length) };
}

function spendAnonymous(): void {
  const left = openverseAnonymousBudget();
  if (left.hour <= 0 || left.day <= 0) {
    throw new Error(
      `Openverse anonymous rate limit reached (${OPENVERSE_ANON_PER_HOUR} requests an hour, ${OPENVERSE_ANON_PER_DAY} a day without credentials) — ` +
        "add OPENVERSE_CLIENT_ID + OPENVERSE_CLIENT_SECRET for the full quota",
    );
  }
  anonymousSent.push(Date.now());
}

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

/** The headers for one request: a bearer when there is a client, the anonymous budget spent otherwise. */
async function requestHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
  const h: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
  if (openverseMode() === "authenticated") h.Authorization = `Bearer ${await bearer(signal)}`;
  else spendAnonymous();
  return h;
}

async function searchOne(q: string, limit: number, signal?: AbortSignal): Promise<NormalizedFootageAsset[]> {
  const url = new URL(`${API}/images/`);
  url.searchParams.set("q", q);
  url.searchParams.set("license", "cc0,pdm,by,by-sa");
  const pageMax = openverseMode() === "anonymous" ? OPENVERSE_ANON_PAGE_MAX : AUTH_PAGE_MAX;
  url.searchParams.set("page_size", String(Math.min(Math.max(limit, 1), pageMax)));
  url.searchParams.set("mature", "false");
  const res = await fetch(url, { headers: await requestHeaders(signal), signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error(`Openverse rate limit reached (${openverseMode()} mode)`);
  if (!res.ok) throw new Error(`Openverse answered HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/json/.test(ct)) throw new Error("Openverse answered with something other than JSON (a Cloudflare challenge, most likely)");
  const body = (await res.json()) as { results?: OpenverseResult[] };
  return (body.results ?? []).map(normalizeOpenverseResult).filter((a): a is NormalizedFootageAsset => a !== null);
}

export const openverseProvider: FootageProvider = {
  id: "openverse",
  displayName: "Openverse",
  // Never off: the official client answers anonymous requests, so do we.
  enabled: true,
  disabledReason: null,
  get notice() {
    return openverseMode() === "anonymous" ? OPENVERSE_ANONYMOUS_NOTICE : null;
  },
  priority: 65,
  tier: "community",
  categories: ["events", "places", "people", "politics", "history", "science"],
  searchCapabilities: { video: false, image: true, recentNews: true, historical: true, directDownload: true },

  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    // Anonymous: one request, the most specific query — five an hour is the
    // whole allowance, and three queries per scene would spend it on one scene.
    const queries = generateSearchQueries(request).slice(0, openverseMode() === "anonymous" ? 1 : 3);
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
    const res = await fetch(`${API}/images/${encodeURIComponent(id)}/`, { headers: await requestHeaders(opts?.signal), signal: opts?.signal ?? AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Openverse answered HTTP ${res.status}`);
    return normalizeOpenverseResult((await res.json()) as OpenverseResult);
  },

  async checkRights(asset) {
    return validateRights(asset);
  },
};
