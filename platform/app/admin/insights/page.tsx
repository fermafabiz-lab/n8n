import Link from "next/link";
import SettingsShell from "@/components/SettingsShell";
import { MONTHLY_CREDITS } from "@/lib/cost";
import { getApiReadings } from "@/lib/data";
import {
  LEVEL_LABEL,
  PRIMARY_METRIC,
  PROVIDERS,
  PROVIDER_IDS,
  STALE_AFTER_MS,
  alertsOf,
  burnsOf,
  fmtCount,
  fmtUsd,
  fractionLeft,
  headlineOf,
  levelOf,
  paceLine,
  seriesKey,
  type Level,
  type ProviderId,
  type Reading,
} from "@/lib/insights";
import CheckNow from "./CheckNow";
import s from "./insights.module.css";

export const dynamic = "force-dynamic";

/**
 * Developer insights — what every paid service behind the factory has left.
 *
 * Asked for on 2026-09-24 because the team kept finding out a balance was
 * empty from a film that had died of it. n8n's "API Credits" workflow reads
 * every provider once an hour into hov.api_balance (db/015,
 * db/port/api-credits/); this page reads the newest reading of each, and the
 * last month of them for the pace. What the numbers MEAN — low, nearly out,
 * how many days are left — is lib/insights.ts, one owner for this page, the
 * Settings dot and the banner every page carries.
 */

const GLYPH: Record<Level, string> = { ok: "●", low: "▲", critical: "▲", out: "✕", error: "!", unknown: "?" };
const WORST: Level[] = ["out", "critical", "error", "low", "unknown", "ok"];
const worst = (levels: Level[]): Level =>
  levels.length === 0 ? "unknown" : [...levels].sort((a, b) => WORST.indexOf(a) - WORST.indexOf(b))[0];

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Bucharest",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", day: "numeric", month: "short" });

function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

function Pill({ level }: { level: Level }) {
  return (
    <span className={`${s.lv} ${s[`lv_${level}`]}`}>
      <span aria-hidden="true">{GLYPH[level]}</span>
      {LEVEL_LABEL[level]}
    </span>
  );
}

function Meter({ fraction, level, label }: { fraction: number | null; level: Level; label: string }) {
  if (fraction === null) return null;
  const pct = Math.round(fraction * 100);
  const tone = level === "low" || level === "critical" || level === "out" ? s[`meter_${level}`] : "";
  return (
    <div className={`${s.meter} ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function Manage({ id }: { id: ProviderId }) {
  const m = PROVIDERS[id].manage;
  return (
    <a className={s.manage} href={m.href} target="_blank" rel="noopener noreferrer">
      {m.label} ↗
    </a>
  );
}

export default async function InsightsPage() {
  const now = Date.now();
  const data = await getApiReadings(30).catch(() => null);

  const intro =
    "What every paid service behind the factory has left, checked every hour — so an empty account shows up here before a film dies of it.";

  if (!data || !data.ready) {
    return (
      <SettingsShell title="Developer insights" intro={intro}>
        <div className="setupnote errcard">
          <b>{data ? "The readings table is not set up on this database yet." : "The readings could not be loaded."}</b>{" "}
          {data
            ? "Apply db/015_api_balance.sql (db/port/api-credits/README.md), and the hourly check starts filling it."
            : "The database did not answer. Reload in a minute."}
        </div>
      </SettingsShell>
    );
  }

  const { latest, history } = data;
  const burns = burnsOf(latest, history, now);
  const alerts = alertsOf(latest, burns, now);
  const newest = latest.reduce((m, r) => Math.max(m, Date.parse(r.takenAt) || 0), 0);
  const stale = newest === 0 || now - newest > STALE_AFTER_MS;
  const primary = (p: ProviderId) => latest.filter((r) => r.provider === p && r.metric === PRIMARY_METRIC[p]);
  const levelFor = (r: Reading) => levelOf(r, burns.get(seriesKey(r)) ?? null, now);
  const spend = latest.find((r) => r.provider === "openai" && r.metric === "spend_30d");

  return (
    <SettingsShell title="Developer insights" intro={intro}>
      <div className={s.bar}>
        {newest ? (
          <span className={s.checked}>
            Last checked <b>{when.format(new Date(newest))}</b> · {ago(now - newest)}
            {stale && <span className={s.stale}> — the hourly check has stopped reporting</span>}
          </span>
        ) : (
          <span className={s.stale}>No reading yet — press Check now.</span>
        )}
        <CheckNow />
        <span className={s.spacer} />
        <Link href="/admin/insights/usage">Where the credits go →</Link>
      </div>

      {alerts.length > 0 && (
        <section className={s.alerts} aria-label="Needs attention now">
          <ul>
            {alerts.map((a) => (
              <li key={`${a.provider}|${a.account}`}>
                <span>
                  <span aria-hidden="true">{a.level === "out" ? "✕ " : "▲ "}</span>
                  {a.text}
                </span>
                <a href={a.href} target="_blank" rel="noopener noreferrer">
                  {PROVIDERS[a.provider].manage.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={s.grid}>
        {PROVIDER_IDS.map((id) => {
          const rows = primary(id);
          const level = worst(rows.map(levelFor));
          const out = level === "out" || level === "critical";
          return (
            <section key={id} className={`${s.card} ${out ? s.cardOut : ""}`} aria-labelledby={`p-${id}`}>
              <div className={s.head}>
                <h3 className={s.name} id={`p-${id}`}>
                  {PROVIDERS[id].label}
                </h3>
                <Pill level={level} />
              </div>
              <p className={s.powers}>{PROVIDERS[id].powers}</p>

              {rows.length === 0 && <p className={s.note}>No reading yet.</p>}

              {id === "google-flow" && rows.length > 0 ? (
                <FlowAccounts rows={rows} burns={burns} now={now} />
              ) : (
                rows.map((r) => {
                  const h = headlineOf(r);
                  const lv = levelFor(r);
                  const pace = paceLine(r, burns.get(seriesKey(r)) ?? null, now);
                  return (
                    <div key={seriesKey(r)} style={{ display: "grid", gap: 10 }}>
                      <div className={s.figure}>
                        <span className={`${s.value} ${lv === "out" ? s.valueOut : ""}`}>{h.value}</span>
                        <span className={s.caption}>{h.caption}</span>
                      </div>
                      <Meter fraction={fractionLeft(r)} level={lv} label={`${PROVIDERS[id].label}: share left`} />
                      {r.resetsAt && <p className={s.pace}>Refills on {day.format(new Date(r.resetsAt))}.</p>}
                      {pace && <p className={s.pace}>{pace}</p>}
                      {id === "useapi" && typeof r.detail?.accountsActive === "number" && (
                        <p className={s.pace}>
                          {String(r.detail.accountsActive)} of {String(r.detail.accountsTotal ?? r.detail.accountsActive)} Google Flow
                          accounts connected.
                        </p>
                      )}
                      {(r.status === "error" || r.status === "unavailable") && r.note && <p className={s.note}>{r.note}</p>}
                    </div>
                  );
                })
              )}

              {id === "openai" && level === "out" && (
                <p className={s.tip}>
                  Top it up, then switch on <b>auto recharge</b> in OpenAI&apos;s billing settings — it refills the
                  balance by itself before it reaches zero, which is the only way this never happens mid-film.
                </p>
              )}
              {id === "openai" && spend && (
                <p className={s.pace}>
                  {spend.status === "ok" && spend.value !== null ? (
                    <>
                      Spent {fmtUsd(spend.value)} in the last 30 days — <Link href="/admin/insights/usage">by day and model</Link>.
                    </>
                  ) : (
                    <>OpenAI will not say what it spent to this key — see <Link href="/admin/insights/usage">Where the credits go</Link>.</>
                  )}
                </p>
              )}
              <Manage id={id} />
            </section>
          );
        })}
      </div>

      <div className={s.howto}>
        <p>
          <b>How this works.</b> n8n&apos;s <i>API Credits</i> workflow asks every service once an hour and keeps each
          answer for six months, which is what the pace and the &ldquo;lasts about N days&rdquo; lines are measured from.
          A balance is <b>Low</b> under 15% of its allowance or with less than five days left at the last week&apos;s pace,
          and <b>Nearly out</b> under 5% or two days — unless it refills before then. Anything nearly out or out is
          also shown in a strip at the top of every page.
        </p>
        <p>
          <b>OpenAI</b> does not reveal its balance to an API key (only to a logged-in browser), so the check asks the
          question that matters: does a paid call go through? <b>Google Flow</b> reports credits per account but not the
          plan&apos;s allowance, so the bar is measured against {fmtCount(MONTHLY_CREDITS)} a month.
        </p>
      </div>
    </SettingsShell>
  );
}

function FlowAccounts({ rows, burns, now }: { rows: Reading[]; burns: Map<string, number | null>; now: number }) {
  const accounts = rows.filter((r) => r.account);
  const total = accounts.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const failed = rows.filter((r) => !r.account);
  return (
    <>
      <div className={s.figure}>
        <span className={s.value}>{fmtCount(total)}</span>
        <span className={s.caption}>
          credits across {accounts.length} account{accounts.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className={s.accounts}>
        {accounts.map((r) => {
          const lv = levelOf(r, burns.get(seriesKey(r)) ?? null, now);
          const pace = paceLine(r, burns.get(seriesKey(r)) ?? null, now);
          return (
            <li key={r.account} className={s.account}>
              <div className={s.accountTop}>
                <span className={s.email} title={r.account}>
                  {r.account}
                </span>
                <span className={s.accountValue}>{r.value === null ? "—" : fmtCount(r.value)}</span>
                {lv !== "ok" && <Pill level={lv} />}
              </div>
              <Meter fraction={fractionLeft(r)} level={lv} label={`${r.account}: share of the monthly allowance left`} />
              {pace && <p className={s.pace}>{pace}</p>}
              {r.status === "error" && r.note && <p className={s.note}>{r.note}</p>}
            </li>
          );
        })}
      </ul>
      {failed.map((r) => (
        <p key={seriesKey(r)} className={s.note}>
          {r.note}
        </p>
      ))}
    </>
  );
}
