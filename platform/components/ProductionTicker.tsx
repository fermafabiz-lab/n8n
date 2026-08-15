"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Pulse {
  run: number;
  wait: number;
  err: number;
  unavailable?: boolean;
}

/**
 * Tab badge: title prefix + a drawn favicon, so "the factory needs you" is
 * visible from any other tab. Coexists with StageChime's markTitle(): that
 * one prepends "● " while the tab is hidden and strips it on return, so the
 * badge writes AROUND an existing dot rather than over it.
 */
function updateTabBadge(pulse: Pulse) {
  try {
    const dot = document.title.startsWith("● ") ? "● " : "";
    const base = "House of Videos";
    document.title = pulse.wait > 0 ? `${dot}(${pulse.wait}) ${base}` : `${dot}${base}`;

    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    if (!g) return;
    // Dark rounded tile. This used to match the app's ground and no longer
    // does — the app is light now — but the tile stays dark on purpose: a
    // favicon sits on browser chrome, not on the page, and a near-white tile
    // disappears into a light tab strip exactly when the badge is trying to
    // say "the factory needs you". The status marks below carry the colour.
    g.beginPath();
    g.roundRect(0, 0, 64, 64, 16);
    g.fillStyle = "#141416";
    g.fill();
    if (pulse.wait > 0) {
      // Amber disc with the waiting count: the "needs you" state.
      g.beginPath();
      g.arc(32, 32, 23, 0, Math.PI * 2);
      g.fillStyle = "#7a4fd6";
      g.fill();
      g.fillStyle = "#f7f7f8";
      g.font = "700 32px -apple-system, 'Segoe UI', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(pulse.wait > 9 ? "9+" : String(pulse.wait), 32, 35);
    } else {
      // Idle mark: a small play wedge — amber when healthy, red when the only
      // news is failures.
      g.beginPath();
      g.moveTo(24, 18);
      g.lineTo(48, 32);
      g.lineTo(24, 46);
      g.closePath();
      g.fillStyle = pulse.err > 0 ? "#d8483d" : "#7a4fd6";
      g.fill();
    }
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = c.toDataURL("image/png");
  } catch {
    // A tab badge is never worth an error.
  }
}

/**
 * The factory's pulse, in the middle of the nav pill: one glance from any
 * page says whether production needs you. Amber (pulsing) when something
 * waits on a review, blue when the line is just working, dim when quiet.
 * Clicking it goes home, where the waiting projects are.
 */
export default function ProductionTicker() {
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Pulse;
        if (alive && !data.unavailable) {
          setPulse(data);
          updateTabBadge(data);
        }
      } catch {
        // Leave the last known value on screen; the ticker never errors.
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!pulse) return null;
  const parts: string[] = [];
  if (pulse.wait > 0) parts.push(`${pulse.wait} NEED${pulse.wait === 1 ? "S" : ""} YOU`);
  if (pulse.run > 0) parts.push(`${pulse.run} RENDERING`);
  if (pulse.err > 0) parts.push(`${pulse.err} FAILED`);
  const dot =
    pulse.wait > 0 ? "amber" : pulse.err > 0 ? "red" : pulse.run > 0 ? "blue" : "";

  return (
    <Link href="/" className="ticker" title="Production status — click for the floor">
      <span className={`tdot ${dot}`} />
      {parts.length ? parts.join(" · ") : "ALL QUIET"}
    </Link>
  );
}
