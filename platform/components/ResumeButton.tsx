"use client";

import { useState, useTransition } from "react";
import { resumeProject, type ActionResult } from "@/app/actions";

/**
 * Restarts production for a project whose run died (rate limit, crash…).
 * The n8n resume flow skips every scene that already has its image/clip,
 * so this never regenerates finished work.
 */
export default function ResumeButton({ projectId }: { projectId: string }) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => setMsg(await resumeProject(projectId)))
        }
      >
        {pending ? "Resuming…" : "⟳ Resume production"}
      </button>
      {msg && (
        <span className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ margin: 0 }}>
          {msg.message}
        </span>
      )}
    </div>
  );
}
