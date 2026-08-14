"use client";

import { useEffect, useState } from "react";

/**
 * "You are not on the real site."
 *
 * The pre-Hetzner Vercel deployment is still live and still builds this
 * branch, so there are two copies of this app writing to ONE Airtable and one
 * n8n. They look identical, which is the danger: an approval clicked on one
 * and a regeneration flag set on the other, with `getAliveProduction()`
 * answering for both. It first surfaced as "the audio download is broken" —
 * that copy has no ffmpeg — and the host in the error page was the only thing
 * that distinguished them.
 *
 * Deliberately a CLIENT check on `location.host` rather than the Host header.
 * Reading `headers()` in the root layout would have been correct on the first
 * paint, but it opts the ENTIRE app out of static rendering — /login and /new
 * both stopped being prerendered. A temporary banner must not change how
 * every page in the app is served; a flash of one frame on the copy nobody
 * should be using is the cheaper side of that trade.
 */
export default function StaleCopyBanner() {
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    const h = window.location.host;
    if (/\.vercel\.app$/i.test(h)) setHost(h);
  }, []);

  if (!host) return null;

  return (
    <div
      style={{
        position: "relative",
        zIndex: 100,
        padding: "9px 16px",
        background: "#3a1d16",
        borderBottom: "1px solid #7a3a26",
        color: "#ffd9cc",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      You are on <b>{host}</b> — an old copy of this site. It writes to the same
      Airtable and n8n as the real one, so anything you change here is real, but
      some features need the live server. Use{" "}
      <a
        href="https://house-of-videos.com"
        style={{ color: "#fff", textDecoration: "underline" }}
      >
        house-of-videos.com
      </a>
      .
    </div>
  );
}
