"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Alert {
  level: "out" | "critical";
  provider: string;
  account: string;
  text: string;
  href: string;
}

const HIDE_KEY = "hov-credits-alert-hidden";

/**
 * "You are about to wake up to zero" — on every page, not only on the page
 * that explains it.
 *
 * The producer's complaint (2026-09-24) was finding out a balance was empty
 * from a film that had died of it. A page nobody opens does not fix that, so
 * anything OUT or NEARLY OUT (lib/insights.ts decides) rides a strip above the
 * nav until it is fixed. It asks /api/insights/alert on load, every five
 * minutes, and whenever the tab comes back into view.
 *
 * A client check for the same reason StaleCopyBanner is one: reading the
 * database in the root layout would put a query in front of every page,
 * /login included. × hides the strip until the set of alerts CHANGES — a new
 * service running low brings it back.
 */
export default function CreditsAlert() {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(HIDE_KEY));
    } catch {
      // Private window or blocked storage: the strip simply cannot be hidden.
    }
    // Signed out there is nothing to ask for — the route would only answer
    // with the login page. Asking again on every navigation keeps it fresh.
    if (pathname === "/login") return;
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/insights/alert", { cache: "no-store" });
        // Signed out, the middleware answers with the login page: not JSON, not an alert.
        if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) return;
        const data = (await res.json()) as { alerts?: Alert[] };
        if (!stopped && Array.isArray(data.alerts)) setAlerts(data.alerts);
      } catch {
        // Offline for a moment: keep what is on screen.
      }
    };
    load();
    const timer = setInterval(load, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    // "Check now" on /admin/insights announces a fresh reading.
    window.addEventListener("hov:credits-checked", load);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("hov:credits-checked", load);
    };
  }, [pathname]);

  if (pathname === "/login" || alerts.length === 0) return null;
  const signature = alerts.map((a) => `${a.provider}|${a.account}|${a.level}`).join(",");
  if (hidden === signature) return null;

  const out = alerts.some((a) => a.level === "out");
  const first = alerts[0];
  const hide = () => {
    setHidden(signature);
    try {
      localStorage.setItem(HIDE_KEY, signature);
    } catch {
      // As above.
    }
  };

  return (
    <div
      role="alert"
      style={{
        position: "relative",
        zIndex: 100,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px 14px",
        padding: "9px 44px 9px 16px",
        // The warning pair from globals.css, which flips with the theme: red
        // when something is already out, amber when it is only close.
        background: out ? "var(--chip-red)" : "var(--chip-amber)",
        borderBottom: `1px solid ${out ? "rgba(216, 72, 61, 0.28)" : "rgba(138, 92, 13, 0.28)"}`,
        color: out ? "var(--red-ink)" : "var(--amber)",
        fontSize: 13.5,
        textAlign: "center",
      }}
    >
      <span>
        <b aria-hidden="true">{first.level === "out" ? "✕ " : "▲ "}</b>
        {first.text}
        {alerts.length > 1 && ` (+${alerts.length - 1} more)`}
      </span>
      <a href={first.href} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", fontWeight: 650, textDecoration: "underline" }}>
        Fix it ↗
      </a>
      <Link href="/admin/insights" style={{ color: "inherit", fontWeight: 650, textDecoration: "underline" }}>
        Developer insights
      </Link>
      <button
        type="button"
        onClick={hide}
        aria-label="Hide until something else changes"
        title="Hide until something else changes"
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          border: 0,
          background: "transparent",
          color: "inherit",
          fontSize: 18,
          lineHeight: 1,
          cursor: "pointer",
          padding: 6,
        }}
      >
        ×
      </button>
    </div>
  );
}
