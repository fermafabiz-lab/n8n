import { getSeries, nextEpisodeNo } from "@/lib/data";
import { seriesPrefill, type SeriesPrefill } from "@/lib/series";
import NewVideoForm from "./NewVideoForm";

export const dynamic = "force-dynamic";

/**
 * The brief. A plain visit is the empty form; `?series=<id>` opens it as the
 * next episode of that show — category, look, tone, language, voice and the
 * hidden series link filled in from the series row, the rest left to the
 * producer. The form itself is a client component (NewVideoForm.tsx); this
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
    if (s) series = seriesPrefill(s, await nextEpisodeNo(s.id));
  }
  return <NewVideoForm series={series} />;
}
