import Link from "next/link";
import SettingsShell from "@/components/SettingsShell";
import { HOOK_VEO_MODEL, VEO_CREDITS, filmCost } from "@/lib/cost";
import { getApiReadings, getFilmUsage, getOpenAiLedger, getOpenAiTopUp, getScriptsWritten } from "@/lib/data";
import { burnFromDaily, combinedDailyDrops, fmtCount, fmtUsd as fmtUsdPlain, type Point } from "@/lib/insights";
import { PRICES, PRICES_READ_AT, PRICES_SOURCE, capSlices, familyLabel, summarize } from "@/lib/openai-usage";
import DailyBars from "../DailyBars";
import Donut from "../Donut";
import ReadNow from "../ReadNow";
import s from "../insights.module.css";

export const dynamic = "force-dynamic";

/**
 * Where the credits go — the second half of the producer's ask of 2026-09-24:
 * "pe ce consumă fiecare și cât consumă", what each service is spent on and
 * how much.
 *
 * Every chart and table carries a title saying what it shows, as
 * "Service — what, per what" (the producer's words of 2026-09-26: "la fiecare
 * grafic să existe un titlu ca să știu la ce mă uit").
 *
 * Two kinds of number, and the page says which is which:
 * - MEASURED, where the provider counts: ElevenLabs reports characters per day
 *   itself; Google Flow's spend is the drop between hourly readings of each
 *   account's credits (hov.api_balance); OpenAI reports dollars per day and
 *   per model — to a key that carries its Usage permission.
 * - ESTIMATED: per film, from what the film holds (lib/cost.ts); and for
 *   OpenAI, per call, from what n8n recorded of every call its executions
 *   made (hov.openai_call, lib/openai-usage.ts) — which step asked, for which
 *   film, with which model, priced at OpenAI's list prices. That is what
 *   answers "what used the credits after the top-up", which OpenAI itself
 *   cannot: it counts per model, never per step.
 */

const RANGES = [7, 14, 30] as const;
const DAY = 86_400_000;
const TOP = 12;
const TZ = "Europe/Bucharest";
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const whenFmt = (iso: string) => `${dayFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))}`;

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.days) ? sp.days[0] : sp.days;
  const now = Date.now();
  const topUp = await getOpenAiTopUp().catch(() => null);
  // "Since the top-up" is offered while the top-up is inside the last month.
  const topUpAt = topUp && now - Date.parse(topUp.okAt) < 30 * DAY ? Date.parse(topUp.outAt) : null;
  const sinceTopUp = raw === "topup" && topUpAt !== null;
  const asked = Number(raw);
  const days = sinceTopUp
    ? Math.max(1, Math.ceil((now - (topUpAt as number)) / DAY))
    : (RANGES as readonly number[]).includes(asked)
      ? asked
      : 30;
  const since = sinceTopUp ? (topUpAt as number) : now - days * DAY;
  const period = sinceTopUp ? `since the top-up on ${dayFmt.format(new Date(topUpAt as number))}` : `in the last ${days} days`;

  const [readings, films, scripts, ledger, ledgerSinceTopUp] = await Promise.all([
    getApiReadings(Math.max(days, 30)).catch(() => null),
    getFilmUsage(days).catch(() => []),
    getScriptsWritten(days).catch(() => ({ scripts: 0, films: 0 })),
    getOpenAiLedger(since).catch(() => null),
    topUpAt !== null && !sinceTopUp ? getOpenAiLedger(topUpAt).catch(() => null) : Promise.resolve(null),
  ]);
  const latest = readings?.latest ?? [];
  const history = readings?.history ?? {};

  // ---- Google Flow ----
  const flowKeys = Object.keys(history).filter((k) => k.startsWith("google-flow|") && k.endsWith("|credits"));
  const flowDaily = combinedDailyDrops(flowKeys.map((k) => history[k]), since);
  const flowMeasured = flowDaily.reduce((sum, p) => sum + p.v, 0);
  const firstReading = Math.min(...flowKeys.map((k) => history[k][0]?.t ?? Infinity));
  const costs = films
    .filter((f) => Date.parse(f.activeAt) >= since)
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

  // ---- OpenAI: what OpenAI measures (needs the Usage permission) ----
  const spend = latest.find((r) => r.provider === "openai" && r.metric === "spend_30d");
  const spendDaily = (Array.isArray(spend?.detail?.daily) ? (spend.detail.daily as Point[]) : []).filter((p) => p.t + DAY > since);
  const spendByItem = Object.entries((spend?.detail?.byItem as Record<string, number> | undefined) ?? {}).sort((a, b) => b[1] - a[1]);
  const spendTotal = spendDaily.reduce((n, p) => n + p.v, 0);
  const maxItem = Math.max(0.0001, ...spendByItem.map(([, v]) => v));

  // ---- OpenAI: what n8n recorded, call by call (hov.openai_call) ----
  const sum = summarize(ledger?.groups ?? []);
  const sumTopUp = sinceTopUp ? sum : ledgerSinceTopUp ? summarize(ledgerSinceTopUp.groups) : null;
  const families = capSlices(sum.families, 6);
  const models = capSlices(sum.models, 6);
  const stepMax = Math.max(0.0001, ...sum.steps.map((x) => x.costUsd));
  const filmMax = Math.max(0.0001, ...sum.byFilm.map((x) => x.costUsd));
  const searchSteps = sum.steps.filter((x) => x.webSearch).map((x) => x.label);

  return (
    <SettingsShell
      title="Where the credits go"
      intro="What each paid service was spent on — measured where the service counts it, estimated from the films and from n8n's own record of every call where it does not."
      back={{ href: "/admin/insights", label: "Developer insights" }}
    >
      <div className={s.bar}>
        <nav className={s.ranges} aria-label="Period">
          {topUpAt !== null && (
            <Link href="/admin/insights/usage?days=topup" aria-current={sinceTopUp ? "true" : undefined}>
              Since the OpenAI top-up
            </Link>
          )}
          {RANGES.map((d) => (
            <Link key={d} href={`/admin/insights/usage?days=${d}`} aria-current={!sinceTopUp && d === days ? "true" : undefined}>
              {d} days
            </Link>
          ))}
        </nav>
        <span>
          Films worked on {period}: <b>{costs.length}</b>
        </span>
      </div>

      {/* ---------------- OpenAI ---------------- */}
      <section className={s.section} aria-labelledby="u-oai">
        <div className={s.sectionHead}>
          <h3 id="u-oai">OpenAI — writing and checking</h3>
          <p>
            Every call n8n made to OpenAI, read from its own record of each run: which step asked, for which film, with
            which model, priced at OpenAI&apos;s list prices.
            {topUp && (
              <>
                {" "}
                Last top-up: between <b>{whenFmt(topUp.outAt)}</b> and <b>{timeFmt.format(new Date(topUp.okAt))}</b> —
                the hourly check read &ldquo;no credits&rdquo;, then &ldquo;ok&rdquo;.
              </>
            )}
          </p>
        </div>

        {!ledger?.ready ? (
          <div className="setupnote" style={{ margin: 0 }}>
            The call-by-call record is not switched on yet (the <code>hov.openai_call</code> table, db/019). Once it is,
            this section fills itself in from n8n within the hour.
          </div>
        ) : (
          <>
            <div className={s.kpis}>
              {sumTopUp && topUpAt !== null && (
                <Kpi
                  label="Since the top-up (estimate)"
                  value={fmtUsd(sumTopUp.costUsd)}
                  sub={`${fmtCount(sumTopUp.calls)} calls since ${dayFmt.format(new Date(topUpAt))}`}
                />
              )}
              {!sinceTopUp && <Kpi label="Spent (estimate)" value={fmtUsd(sum.costUsd)} sub={period} />}
              <Kpi
                label="Calls to OpenAI"
                value={fmtCount(sum.calls)}
                sub={`${fmtCount(sum.measuredCalls)} measured by OpenAI, the rest estimated`}
              />
              <Kpi
                label="Per film"
                value={sum.films ? fmtUsd(sum.byFilm.reduce((n, f) => n + f.costUsd, 0) / sum.films) : "—"}
                sub={`over ${fmtCount(sum.films)} film${sum.films === 1 ? "" : "s"}`}
              />
              <Kpi
                label="Tokens in / out"
                value={`${compact(sum.inputTokens)} / ${compact(sum.outputTokens)}`}
                sub="what was sent / what came back"
              />
            </div>

            {sum.calls === 0 ? (
              <p className={s.foot}>
                No OpenAI calls recorded {period} yet. {ledger.scanned.executions === 0 ? "Nothing has been read from n8n so far — press Update now." : ""}
              </p>
            ) : (
              <>
                <div className={s.pair}>
                  <div className={s.panel}>
                    <p className={s.panelTitle}>OpenAI — dollars by pipeline step (estimate)</p>
                    <Donut slices={families} label={`OpenAI dollars by pipeline step, ${period}`} />
                  </div>
                  <div className={s.panel}>
                    <p className={s.panelTitle}>OpenAI — dollars by model (estimate)</p>
                    <Donut slices={models} label={`OpenAI dollars by model, ${period}`} />
                  </div>
                </div>

                <div className={s.panel}>
                  <p className={s.panelTitle}>OpenAI — dollars per day (estimate)</p>
                  <DailyBars points={sum.days} unit="USD" format="usd" label="OpenAI estimated dollars per day" />
                </div>

                <div className={s.panel}>
                  <p className={s.panelTitle}>OpenAI — every step, most expensive first</p>
                  <table className={s.rank}>
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th className={s.hideSm}>Part of</th>
                        <th className={s.hideSm}>Calls</th>
                        <th className={s.hideSm}>Tokens in / out</th>
                        <th>Spent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sum.steps.slice(0, 40).map((x) => (
                        <tr key={`${x.step}|${x.label}`}>
                          <td className={s.film}>
                            <span className={s.stepName}>
                              {x.label}
                              {x.webSearch && <span className={s.tag}>web search</span>}
                            </span>
                            <span className={s.stepNode}>
                              {x.step} · {x.models.join(", ")}
                            </span>
                          </td>
                          <td className={s.hideSm}>{familyLabel(x.family)}</td>
                          <td className={s.hideSm}>{fmtCount(x.calls)}</td>
                          <td className={s.hideSm}>
                            {compact(x.inputTokens)} / {compact(x.outputTokens)}
                          </td>
                          <td>
                            <span className={s.rankBar}>
                              <span style={{ width: `${Math.max(2, (x.costUsd / stepMax) * 78)}%` }} />
                              <b>{fmtUsd(x.costUsd)}</b>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <FilmTable
                  title="OpenAI — dollars per video (estimate)"
                  rows={sum.byFilm.slice(0, TOP).map((f) => ({
                    id: f.id,
                    name: f.name,
                    cells: [fmtCount(f.calls)],
                    value: f.costUsd,
                    shown: fmtUsd(f.costUsd),
                  }))}
                  heads={["Calls"]}
                  max={filmMax}
                  empty="No call in this period could be tied to a film."
                />
              </>
            )}

            <p className={s.foot}>
              <b>How the estimate is made.</b> A call made straight to OpenAI (the clip judges, scene rewrites, the graphic
              plan) keeps OpenAI&apos;s own token count — measured. A call made through an agent keeps only n8n&apos;s count
              of the prompt and the answer — estimated. Prices: OpenAI&apos;s list, standard tier, read {PRICES_READ_AT} (
              {Object.entries(PRICES)
                .filter(([m]) => ["gpt-5.4", "gpt-4o", "gpt-4o-mini"].includes(m))
                .map(([m, p]) => `${m} $${p.input} in / $${p.output} out per million tokens`)
                .join("; ")}
              ) — <a href={PRICES_SOURCE}>source</a>.{" "}
              <b>Not in these figures:</b> web searches — {searchSteps.length ? searchSteps.join(", ") : "the research steps"}{" "}
              can search the web, and each search costs $0.01 plus every page it reads, billed as input, which n8n never
              sees — so the real bill for those steps is higher than shown. A run is counted when it ends: a film&apos;s media
              pass that is still going appears once it finishes.
              {sum.unpriced.length > 0 && ` Models with no known price (counted as $0): ${sum.unpriced.join(", ")}.`}
            </p>
            <div className={s.ledgerRow}>
              <ReadNow />
              <span>
                {fmtCount(ledger.scanned.executions)} n8n runs read
                {ledger.scanned.lastScan ? `, last at ${whenFmt(ledger.scanned.lastScan)}` : ""} — read again every hour.
              </span>
            </div>
          </>
        )}

        {spend?.status === "ok" ? (
          <>
            <div className={s.kpis}>
              <Kpi label="Spent, measured by OpenAI" value={fmtUsd(spendTotal)} sub={period} />
              <Kpi label="Scripts written" value={fmtCount(scripts.scripts)} sub={`for ${fmtCount(scripts.films)} film${scripts.films === 1 ? "" : "s"}`} />
            </div>
            <div className={s.panel}>
              <p className={s.panelTitle}>OpenAI — dollars per day (measured by OpenAI)</p>
              <DailyBars points={spendDaily} unit="USD" format="usd" label="OpenAI spend per day, measured" />
            </div>
            <div className={s.panel}>
              <p className={s.panelTitle}>OpenAI — measured spend by model and use, last 30 days</p>
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
            <b>OpenAI&apos;s own total is not readable yet.</b> The figures above are n8n&apos;s record. To see OpenAI&apos;s
            measured dollars beside them — searches included — give the key n8n uses the <b>Usage → Read</b> permission
            (platform.openai.com → API keys → the key → Permissions); it appears here at the next hourly check.
            {spend?.note && (
              <>
                {" "}
                OpenAI&apos;s answer today: <code>{spend.note}</code>
              </>
            )}
          </div>
        )}
      </section>

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
          <p className={s.panelTitle}>Google Flow — credits spent per day, all accounts (measured)</p>
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
          title="Google Flow — credits per video (estimate), most first"
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
          <p className={s.panelTitle}>ElevenLabs — characters per day (measured by ElevenLabs)</p>
          {elDaily.length > 0 ? (
            <DailyBars points={elDaily} unit="characters" label="ElevenLabs characters per day" />
          ) : (
            <p className={s.foot}>No usage figures from ElevenLabs yet — they arrive with the next hourly check.</p>
          )}
        </div>
        <FilmTable
          title="ElevenLabs — characters per video, most first"
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
    </SettingsShell>
  );
}

/** Dollars, where most single OpenAI calls cost a fraction of a cent: "<$0.01", never "$0.00". */
function fmtUsd(n: number): string {
  return n > 0 && n < 0.01 ? "<$0.01" : fmtUsdPlain(n);
}

/** 1,234,567 → "1.2M" — token counts are only read for their size. */
function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return fmtCount(n);
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
