import Link from "next/link";
import { getSeriesCandidates, getSeriesList, getSheetMediaUrls } from "@/lib/data";
import SeriesStarter from "@/components/SeriesStarter";
import { initials } from "@/lib/series";
import s from "@/components/SeriesCast.module.css";

export const dynamic = "force-dynamic";

/**
 * The shows. A series is a film's cast, places, look and voice, frozen so the
 * next episode starts from them instead of from nothing — see lib/series.ts.
 */
export default async function SeriesIndex({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const sp = await searchParams;
  const [list, candidates] = await Promise.all([getSeriesList(), getSeriesCandidates()]);
  // One lookup for every face on the page.
  const flowIds = list.flatMap((x) => Object.values(x.refs.castSheets).map((c) => c.id));
  const faces = await getSheetMediaUrls(flowIds);

  return (
    <main className="page">
      {/* The header card, same as /series/[id] and the workspace — see the
          comment there for what wrapping a whole page in `.pj-shell` did. */}
      <div className="room">
        <div className="wk-shell">
          <div className="arc wk-arc" aria-hidden />
          <div className="wk-head">
            <div className="wk-id">
              <div className="eyebrow" style={{ marginBottom: 16 }}>
                <span>Series</span>
              </div>
              <h1 style={{ margin: 0 }}>The shows.</h1>
              <p className={s.hint} style={{ maxWidth: 640, margin: "12px 0 0" }}>
                A show keeps its characters, its places, its look and its voice from one film to the
                next. Start one from a film you like; every episode after that begins with the same
                cast.
              </p>
            </div>
          </div>
        </div>

        {list.length > 0 && (
          <div className={s.seriesgrid} style={{ marginTop: 40, marginBottom: 40 }}>
            {list.map((x) => {
              const cast = x.bible.characters.slice(0, 5);
              return (
                <Link key={x.id} href={`/series/${x.id}`} className={s.seriescard}>
                  <div className={s.faces}>
                    {cast.map((c) => {
                      const url = faces[x.refs.castSheets[c.name]?.id ?? ""] ?? null;
                      return (
                        <span key={c.name} className={s.face} title={c.name}>
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt={c.name} loading="lazy" />
                          ) : (
                            initials(c.name)
                          )}
                        </span>
                      );
                    })}
                  </div>
                  <h2 className={s.name} style={{ fontSize: 22 }}>{x.name}</h2>
                  <p className={s.desc}>{x.premise || x.bible.logline || "No premise written yet."}</p>
                  <div className="specs" style={{ marginTop: 12 }}>
                    <span>{x.episodeCount ?? 0} episode{(x.episodeCount ?? 0) === 1 ? "" : "s"}</span>
                    <span>{x.bible.characters.length} characters</span>
                    {x.tone && <span>{x.tone}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <section className="fsec" style={{ marginTop: list.length ? 0 : 44 }}>
          <header>
            <h2>Start a series</h2>
          </header>
          <SeriesStarter candidates={candidates} preselect={sp.from ?? ""} />
        </section>
      </div>
    </main>
  );
}
