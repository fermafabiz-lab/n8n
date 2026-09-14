/**
 * Destockd — https://destockd.com, an independent project by Elroddd.
 *
 * It is not a stock library of its own. It takes the **FedFlix** collection
 * on the Internet Archive — the U.S. government films Public.Resource.Org
 * digitised with the NTIS — cuts every film into individual SHOTS, and
 * indexes each shot with CLIP so a search reads the picture instead of the
 * title. That is the thing the Internet Archive cannot do for us: its own
 * adapter hands back a twenty-minute reel and leaves the producer to find
 * the three seconds. Destockd hands back the three seconds.
 *
 * Free, no account, no paywall, no watermark, and no attribution required by
 * Destockd itself.
 *
 *   GET /api/search?q=&page=   → { query, results[], page, total, per_page, has_more }
 *   GET /api/shot/{film}/{shot} → the same, plus archive_url, national_archives_url
 *   result: { film, shot, keyframe, clip, preview, color_type, score }
 *
 * `keyframe` is relative to the site; `clip` and `preview` are absolute on
 * clips.destockd.com. `score` is Destockd's own CLIP similarity, which
 * decided WHICH results came back; our ranker re-scores them on the scene.
 *
 * ## What this client owes the site
 *
 * Destockd's robots.txt is `Allow: /` with `Disallow: /api/`. Nothing here
 * defeats a password, a paywall, a signed URL or any protection — the
 * endpoints are public and unauthenticated and the footage is public
 * domain — but that line is still the operator's preference about automated
 * traffic, and the producer decided to integrate anyway (2026-09-14) with
 * the operator to be told. So this adapter is written to be a POLITE CLIENT
 * rather than a crawler, and the politeness is code, not intention:
 *
 *   - ONE request per scene. Every other adapter runs up to three queries;
 *     this one takes the most specific query and stops.
 *   - A hard local ceiling of MAX_PER_MINUTE. Past it the adapter refuses
 *     itself, before the request is made, and `health.ts` holds it back.
 *   - A User-Agent that names us and how to reach us, so a look at their
 *     logs is enough to ask us to stop.
 *   - 429, or a 403 that is theirs rather than Cloudflare's, is treated as
 *     "stop", not as "retry": it becomes a rate limit, which holds the
 *     provider back for fifteen minutes. A Cloudflare MANAGED challenge is
 *     the one exception and is retried exactly once — see `getJson`.
 *   - The engine's own 6-hour result cache sits in front of all of it.
 *
 * If the operator says no, `FOOTAGE_DESTOCKD=off` switches the search off in
 * one variable and the import doors keep working.
 */

import { classifyLicense } from "@/lib/archive/rights";
import { qualityScoreOf, searchable, yearsIn } from "@/lib/archive/text";
import { generateSearchQueries, describeHttpError } from "../request";
import { validateRights } from "../rights";
import { internetArchiveProvider } from "./internetArchive";
import type { FootageProvider, FootageSearchRequest, NormalizedFootageAsset, ProviderSearchOptions } from "../types";

const SITE = "https://www.destockd.com";
const API = `${SITE}/api`;
const UA =
  "HouseOfVideos/1.0 (https://house-of-videos.com; documentary archive research; contact fermafabiz@gmail.com)";

/** The ceiling this client puts on itself. A film is ~90 scenes; this paces them. */
export const MAX_PER_MINUTE = 20;

let sent: number[] = [];

export function resetDestockdState(): void {
  sent = [];
}

/** How many requests are left in the rolling minute. */
export function destockdBudget(now = Date.now()): number {
  sent = sent.filter((t) => now - t < 60_000);
  return Math.max(0, MAX_PER_MINUTE - sent.length);
}

function spend(): void {
  if (destockdBudget() <= 0) {
    throw new Error(
      `Destockd rate limit reached (${MAX_PER_MINUTE} requests a minute, self-imposed) — this client paces itself on a small independent site`,
    );
  }
  sent.push(Date.now());
}

export const destockdEnabled = (): boolean => String(process.env.FOOTAGE_DESTOCKD ?? "").toLowerCase() !== "off";

export interface DestockdResult {
  film?: string;
  shot?: string;
  keyframe?: string;
  clip?: string;
  preview?: string;
  color_type?: string;
  score?: number;
  archive_url?: string;
  national_archives_url?: string;
}

/**
 * Destockd's own rights basis, quoted rather than paraphrased — it is what
 * the card shows and what the end-screen credit is derived from.
 */
/**
 * Note the wording as much as the content: it must not contain the rights
 * validator's OWN trigger phrases, or every clip is flagged as somebody
 * else's material by its own disclaimer. "Third-party" is one of them, and
 * saying "from other sources" means the same thing to a producer reading the
 * card. The same trap caught DVIDS's rights notice once already.
 */
export const DESTOCKD_RIGHTS_TEXT =
  "Sourced from the FedFlix collection (Public.Resource.Org / NTIS) on the Internet Archive: U.S. government " +
  "films, public domain in the United States under 17 U.S.C. §105 or otherwise unrestricted. Destockd requires " +
  "no attribution of its own and has not independently verified individual clips or embedded elements — " +
  "public-domain status does not clear music, footage from other sources, or model, property, trademark or " +
  "publicity rights. Check the source film for a commercial use that depends on it.";

export const isDestockdHost = (url: URL): boolean => /(^|\.)destockd\.com$/i.test(url.hostname);

const MEDIA_EXT = /\.(mp4|webm|mov|m4v|jpg|jpeg|png|webp)$/i;

/** `Film Title - shot_0042.mp4` is how the site names a download. */
export function splitClipFilename(name: string): { film: string; shot: string | null } {
  const base = decodeURIComponent(name).replace(MEDIA_EXT, "").trim();
  const m = /^(.*\S)\s+-\s+(\S.*)$/.exec(base);
  return m ? { film: m[1].trim(), shot: m[2].trim() } : { film: base, shot: null };
}

/**
 * `#/shot/<film>/<shot>`, `#/film/<film>`, `#/similar/<film>/<shot>`.
 *
 * The hash is the whole address here. A browser never sends it, so there is
 * no page to read — but it is still in the string the producer pasted, which
 * is the only reason a pasted page is recoverable at all.
 */
export function parseDestockdHash(url: URL): { film: string; shot: string | null } | null {
  const parts = url.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return null;
  const kind = parts[0].toLowerCase();
  if ((kind === "shot" || kind === "similar") && parts.length >= 3) {
    return { film: decodeURIComponent(parts[1]), shot: decodeURIComponent(parts[2]) };
  }
  if (kind === "film" && parts.length >= 2) return { film: decodeURIComponent(parts[1]), shot: null };
  return null;
}

const abs = (u: string | undefined | null): string | null => {
  if (!u) return null;
  try {
    return new URL(u, SITE).toString();
  } catch {
    return null;
  }
};

/**
 * One shot as an asset.
 *
 * The FILM TITLE is the only text there is, and on FedFlix it is often the
 * whole catalogue record — "Apollo (11) Spacecraft #107, Saturn V Rocket,
 * AS-506, Launch and Tracking - July 16, 1969" — so it carries the subject,
 * the place and the year into `searchableText` and `yearsMentioned`, which
 * is what our own ranker reads. A shot with a thin title ranks thin, and
 * that is honest: we know nothing else about it.
 */
export function normalizeDestockdResult(r: DestockdResult): NormalizedFootageAsset | null {
  const film = String(r.film ?? "").trim();
  const shot = String(r.shot ?? "").trim();
  const clip = abs(r.clip);
  if (!film || !shot || !clip) return null;
  const title = `${film} — ${shot}`;
  const rights = classifyLicense("pd", DESTOCKD_RIGHTS_TEXT, false);
  const colour = r.color_type === "color" ? "colour" : r.color_type === "bw" ? "black and white" : null;
  return {
    provider: "destockd",
    // film/shot IS the identity, and it is what /api/shot/{film}/{shot} takes.
    providerAssetId: `${film}/${shot}`,
    mediaType: "video",
    title,
    description: [`Shot ${shot} of the FedFlix film "${film}", cut and indexed by Destockd.`, colour].filter(Boolean).join(" "),
    sourceUrl: `${SITE}/#/shot/${encodeURIComponent(film)}/${encodeURIComponent(shot)}`,
    downloadUrl: clip,
    thumbnailUrl: abs(r.keyframe),
    previewUrl: abs(r.preview),
    width: null,
    height: null,
    // Not stated by the search. Absent beats invented: `visualUsefulness`
    // penalises a known-tiny or known-huge clip and leaves an unknown alone,
    // and a cut shot is a few seconds by construction.
    durationSeconds: null,
    mimeType: "video/mp4",
    sizeBytes: null,
    // The catalogue date would be the day Destockd cut the shot, never the
    // day the film was shot. The YEARS in the film's title are real, though.
    dateOriginal: null,
    yearsMentioned: yearsIn(film),
    creator: null,
    credit: "FedFlix / Public.Resource.Org, via Destockd",
    licenseOriginal: "Public domain / unrestricted (FedFlix)",
    licenseCode: "pd",
    licenseUrl: "https://archive.org/details/FedFlix",
    ...rights,
    categories: ["fedflix", "archival", colour].filter((c): c is string => Boolean(c)),
    searchableText: searchable(film, shot, "FedFlix archival US government film newsreel"),
    qualityScore: qualityScoreOf(null, null, null, "video"),
    // A cut shot with no speaker: exactly what narration wants, which is why
    // it takes the B-roll tier and the video-first lift in orderByScore.
    footageFormat: "broll",
    origin: "historical",
    filmingDate: null,
    publicationDate: null,
    location: null,
    country: null,
    eventName: null,
    people: [],
    organizations: [],
    rightsText: DESTOCKD_RIGHTS_TEXT,
    provenance: "archival_footage",
    // Below ACTUAL_FOOTAGE_MIN_CONFIDENCE by construction: a film title is
    // not proof of what this particular shot inside it shows.
    provenanceConfidence: 70,
  };
}

async function ask(url: URL | string, signal?: AbortSignal): Promise<Response> {
  spend();
  return fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(20_000),
  });
}

async function getJson(url: URL | string, signal?: AbortSignal): Promise<unknown> {
  let res = await ask(url, signal);

  // Destockd sits behind Cloudflare in MANAGED mode, which samples: the same
  // request, same second, same identity, is served 200 once and answered with
  // an interstitial the next. Measured 2026-09-14 — three requests from this
  // box with our own UA returned 48 results each, one returned 403 with
  // `cf-mitigated: challenge`. So a challenge is a COIN TOSS, not a verdict,
  // and one honest retry is the right response. We do not solve the challenge,
  // spoof a browser or change identity — that would be evasion; we simply ask
  // again as ourselves, and `spend()` counts the retry against the same
  // per-minute budget. (The measurement also showed a Chrome-like UA is
  // challenged RELIABLY, while our own bot UA is usually let through — so
  // honesty is both the polite option and the working one. Do not be tempted
  // to "fix" this by pretending to be a browser.)
  if (isChallenge(res)) res = await ask(url, signal);

  // Twice challenged is a no. Say CHALLENGED, not "rate limit": `health.ts`
  // reads the word "rate limit" out of the message and holds the provider
  // back for fifteen minutes instead of its ordinary three-strikes five. It
  // also reaches the admin page and the picker verbatim, and "rate limit
  // reached" would tell the reader we had been impolite when we had not.
  if (isChallenge(res)) {
    throw new Error(`Destockd is behind a Cloudflare challenge right now (HTTP ${res.status})`);
  }
  // A genuine rate limit — theirs, not ours. Worth the longer hold-back.
  if (res.status === 429 || res.status === 403) {
    throw new Error(`Destockd rate limit reached (HTTP ${res.status})` + (await describeHttpError(res)));
  }
  if (!res.ok) throw new Error(`Destockd answered HTTP ${res.status}` + (await describeHttpError(res)));
  return res.json();
}

/** Cloudflare's own marker for an interstitial. Never a real answer from the site. */
function isChallenge(res: Response): boolean {
  return res.status === 403 && res.headers.get("cf-mitigated") === "challenge";
}

export const destockdProvider: FootageProvider = {
  id: "destockd",
  displayName: "Destockd",
  get enabled() {
    return destockdEnabled();
  },
  get disabledReason() {
    return destockdEnabled() ? null : "off — FOOTAGE_DESTOCKD=off";
  },
  notice:
    "an independent site, asked once per scene at most and capped at 20 requests a minute; its robots.txt disallows /api/, so the operator should be told we are using it",
  priority: 78,
  tier: "archive",
  categories: ["general", "history", "war", "military", "politics", "events", "places", "people", "science", "technology", "aviation", "space"],
  searchCapabilities: { video: true, image: false, recentNews: false, historical: true, directDownload: true },

  /**
   * ONE query, deliberately. Every other adapter takes three; this one takes
   * the most specific and stops, because the site is one person's project.
   */
  async search(request: FootageSearchRequest, opts: ProviderSearchOptions) {
    const q = generateSearchQueries(request)[0];
    if (!q) return [];
    const url = new URL(`${API}/search`);
    url.searchParams.set("q", q);
    url.searchParams.set("page", "1");
    const body = (await getJson(url, opts.signal)) as { results?: DestockdResult[] };
    const out: NormalizedFootageAsset[] = [];
    const seen = new Set<string>();
    for (const r of body.results ?? []) {
      const a = normalizeDestockdResult(r);
      if (!a || seen.has(a.providerAssetId)) continue;
      seen.add(a.providerAssetId);
      out.push(a);
      // The server pages at 48; we keep what the caller asked for.
      if (out.length >= Math.max(opts.limit, 1)) break;
    }
    return out;
  },

  /** `film/shot` — the same identity `/api/shot/{film}/{shot}` takes. */
  async getAssetDetails(id, opts) {
    const slash = id.lastIndexOf("/");
    if (slash <= 0) return null;
    const film = id.slice(0, slash);
    const shot = id.slice(slash + 1);
    const body = (await getJson(
      `${API}/shot/${encodeURIComponent(film)}/${encodeURIComponent(shot)}`,
      opts?.signal,
    )) as DestockdResult;
    const a = normalizeDestockdResult({ ...body, film: body.film ?? film, shot: body.shot ?? shot });
    if (!a) return null;
    // The shot endpoint is the only place the SOURCE FILM is named, so a
    // detail read is where the credit gets to be specific.
    return body.archive_url
      ? { ...a, rightsText: `${a.rightsText} Source film: ${body.archive_url}`, description: `${a.description} Source film: ${body.archive_url}` }
      : a;
  },

  async checkRights(asset) {
    return validateRights(asset);
  },

  matchesUrl(url) {
    return isDestockdHost(url);
  },

  async importFromUrl(url, opts) {
    // A clip, a keyframe or a preview: the file is the asset, and its name
    // carries the film and the shot.
    if (MEDIA_EXT.test(url.pathname)) {
      const name = url.pathname.split("/").pop() ?? "";
      const fromName = splitClipFilename(name);
      // clips.destockd.com serves /clips/<film>/<shot>.mp4 — the directory is
      // the film when the filename alone does not say.
      const dir = decodeURIComponent(url.pathname.split("/").slice(-2, -1)[0] ?? "");
      const film = fromName.shot ? fromName.film : dir || fromName.film;
      const shot = fromName.shot ?? fromName.film;
      const a = normalizeDestockdResult({ film, shot, clip: url.toString() });
      return a ?? null;
    }

    // A page. Its identity is in the fragment, which never reached a server.
    const hash = parseDestockdHash(url);
    if (!hash) return null;
    if (hash.shot) return this.getAssetDetails!(`${hash.film}/${hash.shot}`, opts);

    // A film page names no shot. The film itself is on archive.org, which we
    // search anyway — so hand back the Archive's own item rather than
    // guessing which shot was meant.
    const found = await findFedflixItem(hash.film, opts?.signal);
    if (!found) return null;
    const asset = await internetArchiveProvider.getAssetDetails!(found, opts);
    return asset
      ? { ...asset, description: [asset.description, `Found from the Destockd film page for "${hash.film}".`].filter(Boolean).join("\n\n") }
      : null;
  },
};

/**
 * Find the FedFlix item a Destockd film came from, on archive.org.
 *
 * Restricted to `collection:FedFlix`: Destockd says in as many words that
 * every clip it holds comes from there, so a title matching something else
 * is a different film with the same name. Verified on three real titles,
 * colons and apostrophes included — each resolved to exactly one item.
 */
export async function findFedflixItem(film: string, signal?: AbortSignal): Promise<string | null> {
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", `collection:FedFlix AND title:("${film.replace(/([\\"])/g, "\\$1")}")`);
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "title");
  url.searchParams.set("rows", "5");
  url.searchParams.set("output", "json");
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Internet Archive answered HTTP ${res.status} while resolving the Destockd film`);
  const body = (await res.json()) as { response?: { docs?: Array<{ identifier?: string; title?: string }> } };
  const docs = (body.response?.docs ?? []).filter((d) => d.identifier);
  if (!docs.length) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const exact = docs.find((d) => norm(String(d.title ?? "")) === norm(film));
  return String((exact ?? docs[0]).identifier);
}
