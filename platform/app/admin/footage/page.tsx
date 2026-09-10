import { Suspense } from "react";
import FootageAdmin from "@/components/FootageAdmin";
import { listStockMedia, stockProviders, type StockFilter } from "@/lib/data/stock";
import { allProviders } from "@/lib/footage/registry";
import { heldBack, providerStats } from "@/lib/footage/health";

// The library changes with every search and every verification; never a
// cached copy of what someone just changed.
export const dynamic = "force-dynamic";

// The registry's own ids; anything else in the library is a retired provider
// and gets its own chip from the counts.
const FIXED = new Set<string>(allProviders().map((p) => p.id));

export default async function FootagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const usable = process.env.DATA_BACKEND === "postgres";
  const filter: StockFilter = {
    provider: one("provider") ?? "all",
    mediaType: (one("type") as StockFilter["mediaType"]) ?? "any",
    reviewStatus: (one("rights") as StockFilter["reviewStatus"]) ?? "any",
    status: (one("status") as StockFilter["status"]) ?? "any",
    provenance: (one("provenance") as StockFilter["provenance"]) ?? "any",
    origin: (one("origin") as StockFilter["origin"]) ?? "any",
    event: one("event") || undefined,
    country: one("country") || undefined,
    year: Number(one("year")) || undefined,
    q: one("q") || undefined,
    limit: 60,
    offset: Number(one("offset")) || 0,
  };

  const [list, providers, stats] = usable
    ? await Promise.all([listStockMedia(filter).catch(() => ({ rows: [], total: 0 })), stockProviders(), providerStats()])
    : [{ rows: [], total: 0 }, [], []];
  const byId = new Map(stats.map((s) => [s.provider, s]));
  const health = allProviders().map((p) => {
    const s = byId.get(p.id);
    return {
      id: p.id,
      displayName: p.displayName,
      enabled: p.enabled,
      disabledReason: p.disabledReason,
      heldBack: heldBack(p.id),
      searches: s?.searches ?? 0,
      results: s?.resultsReturned ?? 0,
      selected: s?.assetsSelected ?? 0,
      avgScore: s?.averageRelevanceScore ?? null,
      avgMs: s?.averageResponseMs ?? null,
      lastError: s?.healthy === false ? s.lastError : null,
    };
  });

  return (
    <main className="page admin">
      <div className="sechead">
        <h2>Footage library</h2>
        <p>
          Every real asset the searches have seen, the URLs that were imported and the files that were
          uploaded — one library, whatever the source. Verify what a person has checked, reject what
          should never be offered, set what a picture actually shows. A search from any scene reads this
          first.
        </p>
        {!usable && <p className="backendnote">The library needs the Postgres backend.</p>}
      </div>
      <section className="adminsec">
        <Suspense fallback={null}>
          <FootageAdmin
            rows={list.rows}
            total={list.total}
            extraProviders={providers.filter((p) => !FIXED.has(p.provider))}
            health={health}
          />
        </Suspense>
      </section>
    </main>
  );
}
