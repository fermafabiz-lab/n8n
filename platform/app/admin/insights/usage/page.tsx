import Link from "next/link";
import SettingsShell from "@/components/SettingsShell";
import { HOOK_VEO_MODEL, VEO_CREDITS, filmCost } from "@/lib/cost";
import { getApiReadings, getFilmUsage, getScriptsWritten } from "@/lib/data";
import { burnFromDaily, combinedDailyDrops, fmtCount, fmtUsd, type Point } from "@/lib/insights";
import DailyBars from "../DailyBars";
import s from "../insights.module.css";

export const dynamic = "force-dynamic";

/**
 * Where the credits go — the second half of the producer's ask of 2026-09-24:
 * "pe ce consumă fiecare și cât consumă", what each service is spent on and
 * how much.
 *
 * Two kinds of number, and the page says which is which:
 * - MEASURED, where the provider counts: ElevenLabs reports characters per day
 *   itself; Google Flow's spend is the drop between hourly readings of each
 *   account's credits (hov.api_balance, so it starts on the day the check was
 *   switched on); OpenAI reports dollars per day and per model — to a key
 *   that carries its Usage permission.
 * - ESTIMATED, per film, from what the film holds (lib/cost.ts, the same
 *   rule as the project page's cost panel): clips and stills including every
 *   re-roll still on file, and the narration that was voiced.
 */

const RANGES = [7, 14, 30] as const;
const DAY = 86_400_000;
const TOP = 12;
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", day: "numeric", month: "short" });

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const asked = Number(Array.isArray(sp.days) ? sp.days[0] : sp.days);
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 30;
  const now = Date.now();
  const since = now - days * DAY;

  const [readings, films, scripts] = await Promise.all([
    getApiReadings(Math.max(days, 30)).catch(() => null),
    getFilmUsage(days).catch(() => []),
    getScriptsWritten(days).catch(() => ({ scripts: 0, films: 0 })),
  ]);
  const latest = readings?.latest ?? [];
  const history = readings?.history ?? {};

  // ---- Google Flow ----
  const flowKeys = Object.keys(history).filter((k) => k.startsWith("google-flow|") && k.endsWith("|credits"));
  const flowDaily = combinedDailyDrops(flowKeys.map((k) => history[k]), since);
  const flowMeasured = flowDaily.reduce((sum, p) => sum + p.v, 0);
  const firstReading = Math.min(...flowKeys.map((k) => history[k][0]?.t ?? Infinity));
  const costs = films
    .map((f) => ({ f, c: filmCost(f.scenes, { videoModel: f.videoModel, lengthSeconds: f.lengthSeconds }) }))
    .filter(({ c }) => c.clips + c.images + c.characters > 0);
  const byCredits = [...costs].sort((a, b) => b.c.credits - a.c.credits || b.c.clips - a.c.clips).slice(0, TOP);
  const clips = costs.reduce((n, x) => n + x.c.clips, 0);
  const retries = costs.reduce((n, x) => n + x.c.clipRetries, 0);
  const stills = costs.reduce((n, x) => n + x.c.images, 0);
  const estCredits = costs.reduce((n, x) => n + x.c.credits, 0);
  const maxCredits = Math.max(1, ...byCredits.map((x) => x.c.credits));

  // ---- ElevenLabs ----
  const elUsage = latest.find((r) => r.provider === "elevenlabs" && r.metric === "usage_30d");
  const elAll = (Array.isArray(elUsage?.detail?.daily) ? (elUsage.detail.daily as Point[]) : []).filter((p) => Number.isFinite(p.t));
  const elDaily = elAll.filter((p) => p.t + DAY > since);
  const elTotal = elDaily.reduce((n, p) => n + p.v, 0);
  const elPace = burnFromDaily(elAll, now);
  const elLeft = latest.find((r) => r.provider === "elevenlabs" && r.metric === "characters");
  const byChars = [...costs].sort((a, b) => b.c.characters - a.c.characters).filter((x) => x.c.characters > 0).slice(0, TOP);
  const maxChars = Math.max(1, ...byChars.map((x) => x.c.characters));

  // ---- OpenAI ----
  const spend = latest.find((r) => r.provider === "openai" && r.metric === "spend_30d");
  const spendDaily = (Array.isArray(spend?.detail?.daily) ? (spend.detail.daily as Point[]) : []).filter((p) => p.t + DAY > since);
  const spendByItem = Object.entries((spend?.detail?.byItem as Record<string, number> | undefined) ?? {}).sort((a, b) => b[1] - a[1]);
  const spendTotal = spendDaily.reduce((n, p) => n + p.v, 0);
  const maxItem = Math.max(0.0001, ...spendByItem.map(([, v]) => v));

  return (
    <SettingsShell
      title="Where the credits go"
      intro="What each paid service was spent on — measured where the service counts it, estimated from the films where it does not."
      back={{ href: "/admin/insights", label: "Developer insights" }}
    >
      <div className={s.bar}>
        <nav className={s.ranges} aria-label="Period">
          {RANGES.map((d) => (
            <Link key={d} href={`/admin/insights/usage?days=${d}`} aria-current={d === days ? "true" : undefined}>
              {d} days
            </Link>
          ))}
        </nav>
        <span>
          Films worked on in the last {days} days: <b>{costs.length}</b>
        </span>
      </div>

      {/* ---------------- Google Flow ---------------- */}
      <section className={s.section} aria-labelledby="u-flow">
        <div className={s.sectionHead}>
          <h3 id="u-flow">Google Flow — stills and clips</h3>
          <p>Credits are spent by the clips; the free model costs none, the hook is made on the best one.</p>
        </div>
        <div className={s.kpis}>
          <Kpi
            label="Credits spent (measured)"
            value={flowKeys.length ? fmtCount(flowMeasured) : "—"}
            sub={Number.isFinite(firstReading) ? `since ${dayFmt.format(new Date(Math.max(firstReading, since)))}, all accounts` : "no readings yet"}
          />
          <Kpi label="Clips made" value={fmtCount(clips)} sub={clips ? `${Math.round((retries / clips) * 100)}% were re-rolls` : "in these films"} />
          <Kpi label="Stills made" value={fmtCount(stills)} sub="including re-rolls" />
          <Kpi label="Credits, by the films (estimate)" value={fmtCount(estCredits)} sub="at each film's chosen model" />
        </div>
        <div className={s.panel}>
          <p className={s.panelTitle}>Credits spent per day, all accounts (measured)</p>
          {flowDaily.length > 0 ? (
            <DailyBars points={flowDaily} unit="credits" label="Google Flow credits spent per day" />
          ) : (
            <p className={s.foot}>
              Measured from the hourly readings, which began{" "}
              {Number.isFinite(firstReading) ? `on ${dayFmt.format(new Date(firstReading))}` : "with the first check"} — the
              chart fills in day by day.
            </p>
          )}
        </div>
        <FilmTable
          title="What the credits went on — films, most first"
          rows={byCredits.map(({ f, c }) => ({
            id: f.id,
            name: f.name,
            cells: [`${fmtCount(c.clips)}${c.clipRetries ? ` (${fmtCount(c.clipRetries)} re-rolls)` : ""}`, fmtCount(c.images)],
            value: c.credits,
            shown: `${fmtCount(c.credits)} cr`,
          }))}
          heads={["Clips", "Stills"]}
          max={maxCredits}
          empty="No clips were made for the films worked on in this period."
        />
        <p className={s.foot}>
          The estimate prices each film&apos;s clips at the model its brief chose ({Object.entries(VEO_CREDITS)
            .map(([m, c]) => `${m} ${c}`)
            .join(", ")}) and its hook at {HOOK_VEO_MODEL}. Accounts invited to the Ultra plan pay 5 credits for the
          clips the manager makes free, so the measured figure above is the one to trust; the table says where they
          went.
        </p>
      </section>

      {/* ---------------- ElevenLabs ---------------- */}
      <section className={s.section} aria-labelledby="u-el">
        <div className={s.sectionHead}>
          <h3 id="u-el">ElevenLabs — voices</h3>
          <p>Characters are spent on every narrator line and every re-recording.</p>
        </div>
        <div className={s.kpis}>
          <Kpi label="Characters used" value={elUsage ? fmtCount(elTotal) : "—"} sub="ElevenLabs' own count" />
          <Kpi label="Per day" value={elPace !== null ? fmtCount(elPace) : "—"} sub="average of the last 7 days" />
          <Kpi
            label="Left this month"
            value={elLeft?.value != null ? fmtCount(elLeft.value) : "—"}
            sub={elLeft?.limit != null ? `of ${fmtCount(elLeft.limit)}` : ""}
          />
        </div>
        <div className={s.panel}>
          <p className={s.panelTitle}>Characters per day (measured by ElevenLabs)</p>
          {elDaily.length > 0 ? (
            <DailyBars points={elDaily} unit="characters" label="ElevenLabs characters per day" />
          ) : (
            <p className={s.foot}>No usage figures from ElevenLabs yet — they arrive with the next hourly check.</p>
          )}
        </div>
        <FilmTable
          title="What the characters went on — films, most first"
          rows={byChars.map(({ f, c }) => ({ id: f.id, name: f.name, cells: [], value: c.characters, shown: fmtCount(c.characters) }))}
          heads={[]}
          max={maxChars}
          empty="No narration was voiced for the films worked on in this period."
        />
        <p className={s.foot}>
          Per film, the narration on file that has a recording. A line recorded three times was paid three times and
          counts once here, so these are floors; ElevenLabs&apos; own count above is the total.
        </p>
      </section>

      {/* ---------------- OpenAI ---------------- */}
      <section className={s.section} aria-labelledby="u-oai">
        <div className={s.sectionHead}>
          <h3 id="u-oai">OpenAI — writing</h3>
          <p>Dollars are spent writing each film: bible, outline, narration, scenes, hook, Deep Search, rewrites.</p>
        </div>
        <div className={s.kpis}>
          {spend?.status === "ok" && <Kpi label="Spent" value={fmtUsd(spendTotal)} sub={`last ${days} days`} />}
          <Kpi label="Scripts written" value={fmtCount(scripts.scripts)} sub={`for ${fmtCount(scripts.films)} film${scripts.films === 1 ? "" : "s"}`} />
          {spend?.status === "ok" && scripts.films > 0 && (
            <Kpi label="Per film written" value={fmtUsd(spendTotal / scripts.films)} sub="spend ÷ films scripted" />
          )}
        </div>
        {spend?.status === "ok" ? (
          <>
            <div className={s.panel}>
              <p className={s.panelTitle}>Dollars per day (measured by OpenAI)</p>
              <DailyBars points={spendDaily} unit="USD" format="usd" label="OpenAI spend per day" />
            </div>
            <div className={s.panel}>
              <p className={s.panelTitle}>By model, last 30 days</p>
              <table className={s.rank}>
                <thead>
                  <tr>
                    <th>Model and use</th>
                    <th>Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {spendByItem.map(([item, v]) => (
                    <tr key={item}>
                      <td className={s.film}>{item}</td>
                      <td>
                        <span className={s.rankBar}>
                          <span style={{ width: `${Math.max(2, (v / maxItem) * 78)}%` }} />
                          <b>{fmtUsd(v)}</b>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="setupnote" style={{ margin: 0 }}>
            <b>OpenAI does not tell an ordinary API key what it spent.</b> To see dollars per day and per model here,
            give the key the <b>Usage → Read</b> permission (platform.openai.com → API keys → the key n8n uses →
            Permissions), and this section fills itself in at the next hourly check.
            {spend?.note && (
              <>
                {" "}
                OpenAI&apos;s answer today: <code>{spend.note}</code>
              </>
            )}
          </div>
        )}
      </section>
    </SettingsShell>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel}>{label}</span>
      <span className={s.kpiValue}>{value}</span>
      {sub ? <span className={s.kpiSub}>{sub}</span> : null}
    </div>
  );
}

function FilmTable({
  title,
  rows,
  heads,
  max,
  empty,
}: {
  title: string;
  rows: Array<{ id: string; name: string; cells: string[]; value: number; shown: string }>;
  heads: string[];
  max: number;
  empty: string;
}) {
  return (
    <div className={s.panel}>
      <p className={s.panelTitle}>{title}</p>
      {rows.length === 0 ? (
        <p className={s.foot}>{empty}</p>
      ) : (
        <table className={s.rank}>
          <thead>
            <tr>
              <th>Film</th>
              {heads.map((h) => (
                <th key={h} className={s.hideSm}>
                  {h}
                </th>
              ))}
              <th>Spent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={s.film}>
                  <Link href={`/projects/${r.id}`} title={r.name}>
                    {r.name}
                  </Link>
                </td>
                {r.cells.map((c, i) => (
                  <td key={i} className={s.hideSm}>
                    {c}
                  </td>
                ))}
                <td>
                  <span className={s.rankBar}>
                    <span style={{ width: `${Math.max(2, (r.value / max) * 78)}%` }} />
                    <b>{r.shown}</b>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
