import { backfillSeriesSettings, getSeries, getSeriesEpisodes, nextEpisodeNo } from "@/lib/data";
import { seriesPrefill, type SeriesPrefill } from "@/lib/series";
import NewVideoForm from "./NewVideoForm";

export const dynamic = "force-dynamic";

/**
 * The brief. A plain visit is the empty form; `?series=<id>` opens it as the
 * next episode of that show — the WHOLE brief is pre-answered from the
 * series row (category, length, look, tone, language, voice, overlays,
 * levels, video tier), and the producer changes whatever this episode needs
 * to be different. Only the title and the idea are blank, and even those
 * have a button that proposes one from the show. The form itself is a client component (NewVideoForm.tsx); this
 * wrapper is the only server code, so the prefill is read once, here.
 */
export default async function NewVideo({
  searchParams,
}: {
  searchParams: Promise<{ series?: string }>;
}) {
  const sp = await searchParams;
  const id = String(sp.series ?? "").trim();
  let series: SeriesPrefill | null = null;
  if (/^rec[A-Za-z0-9]{14}$/.test(id)) {
    // A show frozen before the whole brief was carried learns the rest from
    // its first film, here, once — otherwise episode 2 of an older series
    // still opens on the form's defaults and the producer re-answers every
    // setting by hand, which is the complaint this whole page exists to
    // answer. A show that already has everything is not touched.
    const s = await getSeries(id)
      .then((row) => (row ? backfillSeriesSettings(row) : null))
      .catch(() => null);
    if (s) {
      // The titles already used travel with the prefill for one reason: the
      // "suggest the next episode" button must not propose one of them back.
      const [episodeNo, episodes] = await Promise.all([
        nextEpisodeNo(s.id),
        getSeriesEpisodes(s.id).catch(() => []),
      ]);
      series = seriesPrefill(s, episodeNo, episodes.map((e) => e.name).filter(Boolean));
    }
  }
  return <NewVideoForm series={series} />;
}
