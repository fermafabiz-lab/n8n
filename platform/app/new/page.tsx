import { getSeries, getSeriesEpisodes, nextEpisodeNo } from "@/lib/data";
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
    const s = await getSeries(id).catch(() => null);
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
