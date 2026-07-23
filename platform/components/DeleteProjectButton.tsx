"use client";

import { useState, useTransition } from "react";
import { deleteProject, type ActionResult } from "@/app/actions";

/**
 * Two-step destructive delete: first click arms it, second click within 5s
 * actually deletes the project + its scenes + its scripts from Airtable.
 * Drive media is left untouched.
 */
export default function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {msg && !msg.ok && (
        <span className="formmsg err" style={{ margin: 0 }}>{msg.message}</span>
      )}
      <button
        className="abtn"
        disabled={pending}
        style={{
          borderColor: "rgba(240,101,91,0.45)",
          color: armed ? "#fff" : "#f5a8a2",
          background: armed ? "rgba(240,101,91,0.85)" : undefined,
          fontSize: 12,
          padding: "7px 14px",
        }}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            setTimeout(() => setArmed(false), 5000);
            return;
          }
          startTransition(async () => setMsg(await deleteProject(projectId)));
        }}
      >
        {pending ? "Deleting…" : armed ? "Click again to delete forever" : "🗑 Delete project"}
      </button>
    </div>
  );
}
