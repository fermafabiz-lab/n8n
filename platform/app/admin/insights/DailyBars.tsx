"use client";

import { useState } from "react";
import s from "./insights.module.css";

export interface DailyPoint {
  /** Start of the day, epoch ms (UTC). */
  t: number;
  v: number;
}

/**
 * One series per day, as columns. Plain HTML rather than SVG so it is fluid at
 * any width without measuring itself. Every column is focusable and carries its
 * own tooltip (hover or keyboard), and the same numbers are one click away as a
 * table — the tooltip helps, it never gates.
 */

// The days are UTC day starts (ElevenLabs' buckets and lib/insights'
// dailyDrops both are), so they are labelled in UTC: a local zone would file
// midnight UTC under the day before.
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

/**
 * A round ceiling for the axis, close above the tallest column: 25,154 reads
 * against 30,000, not against 50,000 with half the plot left empty.
 */
const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  return (STEPS.find((st) => f <= st) ?? 10) * exp;
}

export default function DailyBars({
  points,
  unit,
  format = "count",
  label,
}: {
  points: DailyPoint[];
  unit: string;
  format?: "count" | "usd";
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const fmt = (v: number) =>
    format === "usd" ? `$${v.toFixed(v >= 100 ? 0 : 2)}` : Math.round(v).toLocaleString("en-US");
  const max = niceMax(Math.max(0, ...points.map((p) => p.v)));
  const h = hover === null ? null : points[hover];
  // First, middle and last day — each once: a one- or two-day series would
  // otherwise print the same date under the axis two or three times.
  const ticks = [...new Set(points.length ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [])].map((i) => points[i]);

  return (
    <div>
      <div className={s.chart}>
        <div className={s.yaxis} aria-hidden="true">
          <span>{fmt(max)}</span>
          <span>{fmt(max / 2)}</span>
          <span>0</span>
        </div>
        <div className={s.plot} role="group" aria-label={label} onPointerLeave={() => setHover(null)}>
          <span className={s.grid1} />
          <span className={s.grid2} />
          {points.map((p, i) => {
            const pct = (p.v / max) * 100;
            return (
              <div
                key={p.t}
                className={s.col}
                tabIndex={0}
                aria-label={`${dayFmt.format(new Date(p.t))}: ${fmt(p.v)} ${unit}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <span style={{ height: p.v > 0 ? `max(2px, ${pct}%)` : 0 }} />
              </div>
            );
          })}
          {h && hover !== null && (
            <div
              className={s.tooltip}
              style={{ left: `${((hover + 0.5) / points.length) * 100}%`, top: `${100 - (h.v / max) * 100}%` }}
            >
              <b>
                {fmt(h.v)} {unit}
              </b>
              <span>{dayFmt.format(new Date(h.t))}</span>
            </div>
          )}
        </div>
        <div className={s.xaxis} aria-hidden="true">
          {ticks.map((p, i) => (
            <span key={i}>{dayFmt.format(new Date(p.t))}</span>
          ))}
        </div>
      </div>
      <details className={s.tableTwin}>
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>{unit}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.t}>
                <td>{dayFmt.format(new Date(p.t))}</td>
                <td>{fmt(p.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
