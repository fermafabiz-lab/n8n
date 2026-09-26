"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { readOpenAiUsageNow } from "@/app/actions";

/**
 * "Update now" for the OpenAI ledger: reads whatever n8n has finished since
 * the last reading (the hourly run does the same), then re-renders the page.
 * Twenty-five seconds at most; a long backlog says so and the next press, or
 * the next hour, carries on from where this one stopped.
 */
export default function ReadNow() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () =>
    start(async () => {
      setMsg(null);
      const r = await readOpenAiUsageNow();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });

  return (
    <>
      <button type="button" className="btn" onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? "Reading n8n… (up to 25 s)" : "⟳ Update now"}
      </button>
      {msg && (
        <span role="status" style={{ color: msg.ok ? "var(--green-ink)" : "var(--red-ink)", fontWeight: 600 }}>
          {msg.text}
        </span>
      )}
    </>
  );
}
