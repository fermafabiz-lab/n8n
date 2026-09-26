"use client";

import { useState } from "react";
import s from "./insights.module.css";

export interface DonutSlice {
  id: string;
  label: string;
  note?: string;
  value: number;
  calls: number;
}

/**
 * A part-to-whole ring for at most six slices (lib/openai-usage.ts capSlices
 * folds the rest into "Other"), in the chart series tokens in their fixed
 * order. The numbers never live in the colour alone: the legend beside the
 * ring names every slice with its value and share, the ring's middle answers
 * for whichever slice is pointed at or focused (Tab walks them), and the same
 * figures are one click away as a table.
 */

const R = 84; // outer radius, in a 200 × 200 box
const W = 30; // ring thickness

function arc(a0: number, a1: number): string {
  // Angles in turns, 0 at twelve o'clock, clockwise.
  const pt = (a: number, r: number) => {
    const t = (a - 0.25) * 2 * Math.PI;
    return `${(100 + r * Math.cos(t)).toFixed(3)} ${(100 + r * Math.sin(t)).toFixed(3)}`;
  };
  const large = a1 - a0 > 0.5 ? 1 : 0;
  const ri = R - W;
  return `M ${pt(a0, R)} A ${R} ${R} 0 ${large} 1 ${pt(a1, R)} L ${pt(a1, ri)} A ${ri} ${ri} 0 ${large} 0 ${pt(a0, ri)} Z`;
}

export default function Donut({
  slices,
  label,
  unit = "USD",
}: {
  slices: DonutSlice[];
  label: string;
  /** Dollars, or a plain count (captcha solves). */
  unit?: "USD" | "solves";
}) {
  const [on, setOn] = useState<number | null>(null);
  // Most single OpenAI calls cost a fraction of a cent: say so rather than "$0.00".
  const fmt = (v: number) =>
    unit === "USD" ? (v > 0 && v < 0.01 ? "<$0.01" : `$${v.toFixed(v >= 100 ? 0 : 2)}`) : Math.round(v).toLocaleString("en-US");
  const total = slices.reduce((n, x) => n + Math.max(0, x.value), 0);
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);
  const shown = slices.filter((x) => x.value > 0);
  let at = 0;
  const arcs = shown.map((x) => {
    const a0 = at;
    at += x.value / total;
    return { x, a0, a1: at, color: `var(--series-${slices.indexOf(x) + 1})` };
  });
  const hot = on === null ? null : slices[on];

  return (
    <div className={s.donutBox}>
    <div className={s.donut}>
      <div className={s.donutRing} onPointerLeave={() => setOn(null)}>
        <svg viewBox="0 0 200 200" role="group" aria-label={label}>
          {arcs.length === 1 ? (
            <circle
              cx="100"
              cy="100"
              r={R - W / 2}
              fill="none"
              // Inline, not the attribute: the stylesheet's slice gap sets
              // `stroke` on the ring's shapes, and CSS outranks an attribute.
              style={{ stroke: arcs[0].color, strokeWidth: W }}
              tabIndex={0}
              aria-label={`${arcs[0].x.label}: ${fmt(arcs[0].x.value)}, 100%`}
              onPointerEnter={() => setOn(slices.indexOf(arcs[0].x))}
              onFocus={() => setOn(slices.indexOf(arcs[0].x))}
              onBlur={() => setOn(null)}
            />
          ) : (
            arcs.map(({ x, a0, a1, color }) => (
              <path
                key={x.id}
                d={arc(a0, a1)}
                fill={color}
                className={on !== null && slices[on]?.id !== x.id ? s.dim : undefined}
                tabIndex={0}
                aria-label={`${x.label}: ${fmt(x.value)}, ${pct(x.value)}%${unit === "USD" ? `, ${x.calls} calls` : ""}`}
                onPointerEnter={() => setOn(slices.indexOf(x))}
                onFocus={() => setOn(slices.indexOf(x))}
                onBlur={() => setOn(null)}
              />
            ))
          )}
        </svg>
        <div className={s.donutMid} aria-live="polite">
          {hot ? (
            <>
              <b>{fmt(hot.value)}</b>
              <span>{pct(hot.value)}%</span>
              <span className={s.donutMidLabel}>{hot.label}</span>
            </>
          ) : (
            <>
              <b>{fmt(total)}</b>
              <span>in all</span>
            </>
          )}
        </div>
      </div>
      <ul className={s.legend}>
        {slices.map((x, i) => (
          <li
            key={x.id}
            className={on === i ? s.legendOn : undefined}
            onPointerEnter={() => setOn(i)}
            onPointerLeave={() => setOn(null)}
          >
            <span className={s.swatch} style={{ background: `var(--series-${i + 1})` }} aria-hidden="true" />
            <span className={s.legendLabel}>
              {x.label}
              {x.note ? <small>{x.note}</small> : null}
            </span>
            <b>{fmt(x.value)}</b>
            <span className={s.legendPct}>{pct(x.value)}%</span>
          </li>
        ))}
      </ul>
      <details className={s.tableTwin}>
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>{unit === "USD" ? "USD" : "Solves"}</th>
              <th>Share</th>
              {unit === "USD" && <th>Calls</th>}
            </tr>
          </thead>
          <tbody>
            {slices.map((x) => (
              <tr key={x.id}>
                <td>{x.label}</td>
                <td>{fmt(x.value)}</td>
                <td>{pct(x.value)}%</td>
                {unit === "USD" && <td>{x.calls.toLocaleString("en-US")}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
    </div>
  );
}
