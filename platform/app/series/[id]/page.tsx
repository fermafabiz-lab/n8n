import Link from "next/link";
import { notFound } from "next/navigation";
import { getSeries, getSeriesEpisodes, getSheetMediaUrls } from "@/lib/data";
import { getCategory } from "@/lib/categories";
import SeriesCharacter from "@/components/SeriesCharacter";
import SeriesNotes from "@/components/SeriesNotes";
import { initials } from "@/lib/series";
import s from "@/components/SeriesCast.module.css";

export const dynamic = "force-dynamic";

/**
 * One show: the cast with their reference sheets, the places with their
 * plates, the objects, the look, the rules — and the episodes made so far.
 * "New episode" opens the brief pre-filled from all of it.
 *
 * A face shows when we kept the sheet's bytes (db/012 sheet_media, written by
 * Media Generation right after the sheet is made). A film made before that
 * existed has names and descriptions but initials for faces — the sheets are
 * still reused by the pipeline through their Flow ids; we just never copied
 * the picture.
 */
export default async function SeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const series = await getSeries(id);
  if (!series) notFound();
  const episodes = await getSeriesEpisodes(id);
  const flowIds = [
    ...Object.values(series.refs.castSheets).map((c) => c.id),
    ...Object.values(series.refs.locationPlates).map((p) => p.id),
    ...Object.values(series.refs.objectRefs),
  ];
  const media = await getSheetMediaUrls(flowIds);
  const cat = getCategory(series.category);
  const style = series.settings.categoryOptions.visual_style;

  return (
    <main className="page">
      <div className="pj-shell">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          <Link href="/series">Series</Link>
          <span style={{ color: "var(--dim)" }}>/</span>
          <span>{series.name}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>{series.name}</h1>
            <div className="specs" style={{ marginTop: 10 }}>
              <span>{cat.label}</span>
              {style && <span>{style}</span>}
              {series.tone && <span>{series.tone}</span>}
              <span>{series.language}</span>
              <span>{series.aspect}</span>
              <span>{episodes.length} episode{episodes.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <Link href={`/new?series=${series.id}`} className="pj-cta">
            New episode →
          </Link>
        </div>

        <section className="fsec">
          <header>
            <h2>The cast</h2>
            <span className="no">{series.bible.characters.length}</span>
          </header>
          {series.bible.characters.length === 0 ? (
            <p className={s.hint}>The film this show came from had no characters in its Story Bible.</p>
          ) : (
            <div className={s.grid}>
              {series.bible.characters.map((c) => {
                const sheet = series.refs.castSheets[c.name] ?? null;
                return (
                  <SeriesCharacter
                    key={c.name}
                    seriesId={series.id}
                    character={c}
                    portraitUrl={sheet ? (media[sheet.id] ?? null) : null}
                    sheetKind={sheet?.kind ?? null}
                  />
                );
              })}
            </div>
          )}
          {Object.keys(series.refs.castSheets).length > 0 &&
            Object.values(series.refs.castSheets).every((c) => !media[c.id]) && (
              <p className={s.hint} style={{ marginTop: 14 }}>
                The sheets exist and the pipeline reuses them, but their pictures were made before the
                site started keeping a copy — faces will appear for sheets drawn from now on.
              </p>
            )}
        </section>

        {series.bible.locations.length > 0 && (
          <section className="fsec">
            <header>
              <h2>The places</h2>
              <span className="no">{series.bible.locations.length}</span>
            </header>
            <div className={s.plates}>
              {series.bible.locations.map((l) => {
                const plate = series.refs.locationPlates[l.name] ?? null;
                const url = plate ? (media[plate.id] ?? null) : null;
                return (
                  <article key={l.name} className={s.plate}>
                    <div className={s.portrait}>
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={`${l.name} — set plate`} loading="lazy" />
                      ) : (
                        <span className={s.initials}>{initials(l.name)}</span>
                      )}
                      {plate && <span className={s.kind}>plate</span>}
                    </div>
                    <div className={s.body}>
                      <h3 className={s.name}>{l.name}</h3>
                      <p className={s.desc}>{l.description}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {series.bible.objects.length > 0 && (
          <section className="fsec">
            <header>
              <h2>The objects</h2>
              <span className="no">{series.bible.objects.length}</span>
            </header>
            <div className={s.plates}>
              {series.bible.objects.map((o) => {
                const flowId = series.refs.objectRefs[o.name] ?? "";
                const url = flowId ? (media[flowId] ?? null) : null;
                return (
                  <article key={o.name} className={s.plate}>
                    <div className={s.portrait}>
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={`${o.name} — object sheet`} loading="lazy" />
                      ) : (
                        <span className={s.initials}>{initials(o.name)}</span>
                      )}
                      {flowId && <span className={s.kind}>sheet</span>}
                    </div>
                    <div className={s.body}>
                      <h3 className={s.name}>{o.name}</h3>
                      <p className={s.desc}>{o.description}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {(Object.keys(series.bible.visualStyle).length > 0 || series.bible.continuityRules.length > 0) && (
          <section className="fsec">
            <header>
              <h2>The look and the rules</h2>
            </header>
            <div className="card">
              {Object.entries(series.bible.visualStyle).map(([k, v]) => (
                <div key={k} className="kv">
                  <span>{k.replace(/_/g, " ")}</span>
                  <span style={{ textAlign: "right", maxWidth: "70%" }}>{v}</span>
                </div>
              ))}
              {series.bible.continuityRules.length > 0 && (
                <ul style={{ margin: "14px 0 0", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
                  {series.bible.continuityRules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        <section className="fsec">
          <header>
            <h2>The show in words</h2>
          </header>
          <SeriesNotes
            seriesId={series.id}
            name={series.name}
            premise={series.premise}
            previously={series.previously}
            channelName={series.channelName}
          />
        </section>

        <section className="fsec">
          <header>
            <h2>Episodes</h2>
            <span className="no">{episodes.length}</span>
          </header>
          {episodes.length === 0 ? (
            <p className={s.hint}>No episode yet.</p>
          ) : (
            <div className={s.episodes}>
              {episodes.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className={s.episode}>
                  <span className={s.thumb}>
                    {p.coverUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.coverUrl} alt="" loading="lazy" />
                    )}
                  </span>
                  <span>
                    <span className={s.no}>Episode {p.episodeNo ?? "?"}</span>
                    <p className={s.title}>{p.name}</p>
                  </span>
                  <span className={`wk-state ${p.statusKind}`}>
                    <span className="wk-dot" />
                    {p.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <div style={{ marginTop: 18 }}>
            <Link href={`/new?series=${series.id}`} className="pj-cta">
              New episode →
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
