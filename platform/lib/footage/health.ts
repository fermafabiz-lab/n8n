/**
 * Provider performance and health — the statistics that say which source is
 * worth asking for what, and the state that keeps one dead provider from
 * taking a film down with it.
 *
 * Counted in memory per process and flushed to `hov.footage_provider_status`
 * (db/010) after every search, so the admin page reads the same numbers the
 * engine acts on. A provider that has failed three times in a row is held
 * back for a cooling-off period rather than asked again on the next scene;
 * a rate-limit answer holds it back for longer. Nothing here ever throws —
 * a health-table hiccup is not a reason to lose a search.
 */

import { atQuery, isConfigured } from "@/lib/data/postgres";
import type { ArchiveProvider } from "@/lib/archive/types";

export interface ProviderStats {
  provider: ArchiveProvider;
  enabled: boolean;
  healthy: boolean;
  lastSuccess: string | null;
  lastFailure: string | null;
  lastError: string | null;
  failureCount: number;
  rateLimitedUntil: string | null;
  searches: number;
  resultsReturned: number;
  assetsSelected: number;
  averageRelevanceScore: number | null;
  rightsFailures: number;
  downloadFailures: number;
  averageResponseMs: number | null;
}

interface Mem {
  failures: number;
  lastFailureAt: number;
  rateLimitedUntil: number;
}

const mem = new Map<string, Mem>();
const COOL_OFF_MS = 5 * 60_000;
const RATE_LIMIT_MS = 15 * 60_000;
const MAX_CONSECUTIVE = 3;

const usable = () => isConfigured && process.env.DATA_BACKEND === "postgres";

/** Should the router skip this provider right now? */
export function heldBack(provider: ArchiveProvider): string | null {
  const m = mem.get(provider);
  if (!m) return null;
  const now = Date.now();
  if (m.rateLimitedUntil > now) return `rate-limited until ${new Date(m.rateLimitedUntil).toISOString()}`;
  if (m.failures >= MAX_CONSECUTIVE && now - m.lastFailureAt < COOL_OFF_MS) {
    return `held back after ${m.failures} consecutive failures`;
  }
  return null;
}

export async function recordSearch(
  provider: ArchiveProvider,
  o: { ok: boolean; results: number; ms: number; error?: string | null; rateLimited?: boolean },
): Promise<void> {
  const m = mem.get(provider) ?? { failures: 0, lastFailureAt: 0, rateLimitedUntil: 0 };
  if (o.ok) {
    m.failures = 0;
  } else {
    m.failures += 1;
    m.lastFailureAt = Date.now();
    if (o.rateLimited || /rate limit|429/i.test(o.error ?? "")) m.rateLimitedUntil = Date.now() + RATE_LIMIT_MS;
  }
  mem.set(provider, m);
  if (!usable()) return;
  try {
    await atQuery(
      `insert into hov.footage_provider_status as s
         (provider, healthy, last_success, last_failure, last_error, failure_count, rate_limited_until,
          searches, results_returned, response_ms_sum, response_n)
       values ($1, $2, case when $2 then now() end, case when not $2 then now() end, $3, $4,
               $5::timestamptz, 1, $6, $7, 1)
       on conflict (provider) do update set
         healthy = excluded.healthy,
         last_success = coalesce(excluded.last_success, s.last_success),
         last_failure = coalesce(excluded.last_failure, s.last_failure),
         last_error = case when excluded.healthy then s.last_error else excluded.last_error end,
         failure_count = $4,
         rate_limited_until = excluded.rate_limited_until,
         searches = s.searches + 1,
         results_returned = s.results_returned + excluded.results_returned,
         response_ms_sum = s.response_ms_sum + excluded.response_ms_sum,
         response_n = s.response_n + 1,
         updated_at = now()`,
      [
        provider,
        o.ok,
        o.ok ? null : String(o.error ?? "").slice(0, 400),
        m.failures,
        m.rateLimitedUntil > Date.now() ? new Date(m.rateLimitedUntil).toISOString() : null,
        o.results,
        Math.max(0, Math.round(o.ms)),
      ],
    );
  } catch {
    /* the health table is bookkeeping, never a reason to fail a search */
  }
}

export async function recordSelection(provider: ArchiveProvider, relevance: number | null): Promise<void> {
  if (!usable()) return;
  try {
    await atQuery(
      `insert into hov.footage_provider_status as s (provider, assets_selected, relevance_sum, relevance_n)
       values ($1, 1, $2, $3)
       on conflict (provider) do update set
         assets_selected = s.assets_selected + 1,
         relevance_sum = s.relevance_sum + excluded.relevance_sum,
         relevance_n = s.relevance_n + excluded.relevance_n,
         updated_at = now()`,
      [provider, relevance ?? 0, relevance === null ? 0 : 1],
    );
  } catch {
    /* see above */
  }
}

export async function recordFailure(provider: ArchiveProvider, kind: "rights" | "download"): Promise<void> {
  if (!usable()) return;
  const col = kind === "rights" ? "rights_failures" : "download_failures";
  try {
    await atQuery(
      `insert into hov.footage_provider_status as s (provider, ${col}) values ($1, 1)
       on conflict (provider) do update set ${col} = s.${col} + 1, updated_at = now()`,
      [provider],
    );
  } catch {
    /* see above */
  }
}

export async function providerStats(): Promise<ProviderStats[]> {
  if (!usable()) return [];
  try {
    const rows = await atQuery<{
      provider: string;
      healthy: boolean;
      last_success: Date | null;
      last_failure: Date | null;
      last_error: string | null;
      failure_count: number;
      rate_limited_until: Date | null;
      searches: number;
      results_returned: number;
      assets_selected: number;
      relevance_sum: number;
      relevance_n: number;
      rights_failures: number;
      download_failures: number;
      response_ms_sum: number;
      response_n: number;
    }>(`select * from hov.footage_provider_status order by provider`);
    return rows.map((r) => ({
      provider: r.provider,
      enabled: true,
      healthy: r.healthy,
      lastSuccess: r.last_success ? r.last_success.toISOString() : null,
      lastFailure: r.last_failure ? r.last_failure.toISOString() : null,
      lastError: r.last_error,
      failureCount: Number(r.failure_count),
      rateLimitedUntil: r.rate_limited_until ? r.rate_limited_until.toISOString() : null,
      searches: Number(r.searches),
      resultsReturned: Number(r.results_returned),
      assetsSelected: Number(r.assets_selected),
      averageRelevanceScore: Number(r.relevance_n) ? Math.round(Number(r.relevance_sum) / Number(r.relevance_n)) : null,
      rightsFailures: Number(r.rights_failures),
      downloadFailures: Number(r.download_failures),
      averageResponseMs: Number(r.response_n) ? Math.round(Number(r.response_ms_sum) / Number(r.response_n)) : null,
    }));
  } catch {
    return [];
  }
}
