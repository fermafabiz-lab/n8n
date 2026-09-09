/**
 * The Universal Footage Engine.
 *
 *   request → library first → good enough? → return
 *                            → router → providers (parallel, isolated,
 *                              timed out) → normalize → rights → dedupe →
 *                              provenance → rank → file the good ones →
 *                              return best
 *
 * Three properties the rest of the system leans on:
 *
 * - **The library is asked first, always.** Every provider answer is filed
 *   as metadata the moment it arrives, so a scene that asks what a sibling
 *   scene asked last week is answered from the box without a single external
 *   call — and so a provider outage costs new material only, never what has
 *   already been seen.
 * - **A provider failure is that provider's problem.** Each is called under
 *   its own timeout inside `Promise.allSettled`; a throw, a rate limit or a
 *   changed response shape becomes a line in the report and a mark against
 *   the provider's health, and the other providers' answers go through.
 *   Documentary generation never waits on, or fails with, one archive.
 * - **Rights are a filter, not a score.** A restricted asset is removed
 *   before ranking; manual-review and editorial-only assets are ranked and
 *   returned, flagged, for a person to decide — and the automatic paths
 *   (the suggestion run) never place one without that decision.
 */

import type { ArchiveProvider } from "@/lib/archive/types";
import { recentlyUsedProviderAssetKeys, saveStockCandidates, searchStockLibrary } from "@/lib/data/stock";
import { readSearchCache, writeSearchCache } from "@/lib/data/stock";
import { dedupeAssets } from "./dedupe";
import { heldBack, recordFailure, recordSearch } from "./health";
import { matchSignals } from "./match";
import { assessProvenance } from "./provenance";
import { orderByScore, rankOne } from "./rank";
import { routeProviders, searchableProviders } from "./registry";
import { generateSearchQueries } from "./request";
import { usableWithReview, validateRights } from "./rights";
import type { FootageSearchRequest, NormalizedFootageAsset, ProviderReport, RankedFootage } from "./types";

export interface EngineOptions {
  /** Ask only these providers (the picker's filter). Undefined = the router decides. */
  providers?: ArchiveProvider[];
  /** Per provider, per query. */
  limit?: number;
  /** How many to return. */
  top?: number;
  /** Skip the providers entirely — the library only. */
  localOnly?: boolean;
  /** Skip the library's short-circuit and always ask the providers too. */
  forceProviders?: boolean;
  signal?: AbortSignal;
  /** Per-provider timeout. */
  providerTimeoutMs?: number;
}

export interface EngineResult {
  candidates: RankedFootage[];
  providers: ProviderReport[];
  /** Where the answer came from. */
  source: "library" | "providers" | "both" | "cache";
  queries: string[];
  ms: number;
}

/** A library answer this good is not worth an external call. */
const GOOD_ENOUGH_SCORE = 62;
const GOOD_ENOUGH_COUNT = 3;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Score, classify and flag one asset for one request. */
export function judge(
  r: FootageSearchRequest,
  a: NormalizedFootageAsset & { id: string | null; status?: string | null },
  reused: boolean,
): RankedFootage {
  const signals = matchSignals(r, a);
  const rights = validateRights(a);
  const rank = rankOne(r, a, { reused, signals });
  const prov = assessProvenance(r, a, signals);
  return {
    asset: a,
    score: rank.score,
    reasons: rank.reasons,
    rights,
    provenance: prov.provenance,
    provenanceConfidence: prov.confidence,
  };
}

async function fromLibrary(r: FootageSearchRequest, queries: string[], opts: EngineOptions): Promise<RankedFootage[]> {
  const seen = new Map<string, NormalizedFootageAsset & { id: string; status: string }>();
  for (const q of queries) {
    const rows = await searchStockLibrary(q, {
      mediaType: "any",
      limit: opts.limit ?? 12,
      providers: opts.providers,
    }).catch(() => []);
    for (const row of rows) if (!seen.has(row.id)) seen.set(row.id, row);
  }
  const reused = await recentlyUsedProviderAssetKeys().catch(() => new Set<string>());
  return [...seen.values()]
    .map((a) => judge(r, a, reused.has(`${a.provider}:${a.providerAssetId}`)))
    .filter((c) => usableWithReview(c.rights));
}

/**
 * Search. The whole engine, behind one call.
 */
export async function searchFootage(r: FootageSearchRequest, opts: EngineOptions = {}): Promise<EngineResult> {
  const started = Date.now();
  const queries = generateSearchQueries(r);
  const top = opts.top ?? 12;
  const reports: ProviderReport[] = [];

  // 1. The library. Cheap, complete for anything seen before, and the only
  //    thing that answers when the internet does not.
  const local = await fromLibrary(r, queries, opts);
  const localOrdered = orderByScore(local, r);
  const goodEnough =
    localOrdered.length >= GOOD_ENOUGH_COUNT && localOrdered[0].score >= GOOD_ENOUGH_SCORE && !opts.forceProviders;
  if (opts.localOnly || goodEnough) {
    return { candidates: localOrdered.slice(0, top), providers: reports, source: "library", queries, ms: Date.now() - started };
  }

  // 1b. The cache: the same request in the last few hours already asked the
  //     providers, and their answers are library rows now.
  const cached = await readSearchCache(r).catch(() => null);
  if (cached && !opts.forceProviders && !opts.providers) {
    const rows = cached.filter((row) => row);
    const reused = await recentlyUsedProviderAssetKeys().catch(() => new Set<string>());
    const judged = rows.map((a) => judge(r, a, reused.has(`${a.provider}:${a.providerAssetId}`))).filter((c) => usableWithReview(c.rights));
    const merged = dedupeRanked([...judged, ...localOrdered]);
    return { candidates: orderByScore(merged, r).slice(0, top), providers: reports, source: "cache", queries, ms: Date.now() - started };
  }

  // 2. The router.
  const routed = routeProviders(r, { only: opts.providers, max: opts.providers ? 6 : 4 });
  const routedIds = new Set(routed.map((x) => x.provider.id));
  for (const p of searchableProviders()) {
    if (!routedIds.has(p.id)) reports.push({ provider: p.id, displayName: p.displayName, enabled: p.enabled, routed: false, reason: "not routed for this subject", count: 0, ms: 0 });
  }

  // 3. The providers, each on its own.
  const timeout = opts.providerTimeoutMs ?? 20_000;
  const settled = await Promise.allSettled(
    routed.map(async ({ provider }) => {
      const hold = heldBack(provider.id);
      if (hold) throw new Error(hold);
      const t0 = Date.now();
      const hits = await withTimeout(provider.search(r, { limit: opts.limit ?? 12, signal: opts.signal }), timeout, provider.displayName);
      return { hits, ms: Date.now() - t0 };
    }),
  );

  const fresh: NormalizedFootageAsset[] = [];
  await Promise.all(
    settled.map(async (s, i) => {
      const p = routed[i].provider;
      if (s.status === "fulfilled") {
        reports.push({ provider: p.id, displayName: p.displayName, enabled: p.enabled, routed: true, reason: null, count: s.value.hits.length, ms: s.value.ms });
        fresh.push(...s.value.hits);
        await recordSearch(p.id, { ok: true, results: s.value.hits.length, ms: s.value.ms });
      } else {
        const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
        reports.push({ provider: p.id, displayName: p.displayName, enabled: p.enabled, routed: true, reason: msg, count: 0, ms: 0 });
        await recordSearch(p.id, { ok: false, results: 0, ms: 0, error: msg, rateLimited: /rate limit|429/i.test(msg) });
      }
    }),
  );

  // 4. Rights first — restricted is out before anything is scored — then
  //    dedupe in provider-priority order so the better-catalogued copy wins.
  const allowed: NormalizedFootageAsset[] = [];
  for (const a of fresh) {
    const rights = validateRights(a);
    if (!usableWithReview(rights)) {
      await recordFailure(a.provider, "rights");
      continue;
    }
    allowed.push({ ...a, provenance: assessProvenance(null, a).provenance, provenanceConfidence: assessProvenance(null, a).confidence });
  }
  const unique = dedupeAssets(allowed);

  // 5. File what came back — metadata only; bytes move when a scene uses one.
  let filed = new Map<string, { id: string; status: string }>();
  if (unique.length) {
    try {
      filed = await saveStockCandidates(unique, queries[0] ?? r.narration.slice(0, 80));
    } catch (e) {
      console.warn(`footage engine: could not file ${unique.length} results — ${(e as Error).message}`);
    }
  }
  const reused = await recentlyUsedProviderAssetKeys().catch(() => new Set<string>());
  const judged = unique.map((a) => {
    const row = filed.get(`${a.provider}:${a.providerAssetId}`);
    return judge(r, { ...a, id: row?.id ?? null, status: row?.status ?? null }, reused.has(`${a.provider}:${a.providerAssetId}`));
  });

  // 6. Merge with the library's own answer, rank, remember.
  const merged = dedupeRanked([...judged, ...localOrdered]);
  const ordered = orderByScore(merged, r);
  await writeSearchCache(r, ordered.map((c) => c.asset.id).filter((id): id is string => Boolean(id))).catch(() => {});
  return {
    candidates: ordered.slice(0, top),
    providers: reports,
    source: local.length ? "both" : "providers",
    queries,
    ms: Date.now() - started,
  };
}

function dedupeRanked(items: RankedFootage[]): RankedFootage[] {
  const seen = new Set<string>();
  const out: RankedFootage[] = [];
  for (const c of items) {
    const k = c.asset.id ?? `${c.asset.provider}:${c.asset.providerAssetId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * The fallback ladder (§32), as a statement about a result rather than as
 * more searching: given what came back, what should the scene do?
 *
 *   real video → real image → AI reconstruction.
 *
 * A relevant AI picture beats an unrelated real clip — so "use footage"
 * needs a candidate above the floor, not merely a candidate.
 */
export function fallbackPlan(result: EngineResult, floor = 45): { use: "video" | "image" | "ai"; candidate: RankedFootage | null } {
  const ok = result.candidates.filter((c) => c.score >= floor && c.rights.status !== "restricted");
  const video = ok.find((c) => c.asset.mediaType === "video");
  if (video) return { use: "video", candidate: video };
  const image = ok.find((c) => c.asset.mediaType === "image");
  if (image) return { use: "image", candidate: image };
  return { use: "ai", candidate: null };
}

export const UniversalFootageEngine = { search: searchFootage, judge, fallbackPlan };
