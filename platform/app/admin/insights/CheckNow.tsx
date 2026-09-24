"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkCreditsNow } from "@/app/actions";

/**
 * "Check now": asks n8n to read every provider this minute instead of at the
 * next hourly run, then re-renders the page from what it wrote. A normal
 * check takes 5-10 seconds, so the button says so while it waits.
 */
export default function CheckNow() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () =>
    start(async () => {
      setMsg(null);
      const r = await checkCreditsNow();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        router.refresh();
        // The strip at the top of the page asks again now, not in five minutes.
        window.dispatchEvent(new Event("hov:credits-checked"));
      }
    });

  return (
    <>
      <button type="button" className="btn" onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? "Checking… (about 10 s)" : "⟳ Check now"}
      </button>
      {msg && (
        <span role="status" style={{ color: msg.ok ? "var(--green-ink)" : "var(--red-ink)", fontWeight: 600 }}>
          {msg.text}
        </span>
      )}
    </>
  );
}
