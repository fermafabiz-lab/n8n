"use client";

import { useState, useTransition } from "react";
import { approveScript, type ActionResult } from "@/app/actions";

export default function ScriptReview({
  projectId,
  script,
}: {
  projectId: string;
  script: string;
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Highlight [CHAPTER n] markers without dangerouslySetInnerHTML.
  const parts = script.split(/(\[CHAPTER \d+\])/g);

  return (
    <div className="script">
      <div className="sechead">
        <h2>Script review</h2>
        <button
          className="btn gold"
          disabled={pending}
          onClick={() =>
            startTransition(async () => setMsg(await approveScript(projectId)))
          }
        >
          {pending ? "Approving…" : "Approve script"}
        </button>
      </div>
      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}
      <pre>
        {parts.map((p, i) =>
          /^\[CHAPTER \d+\]$/.test(p) ? (
            <span className="chapter" key={i}>
              {p}
            </span>
          ) : (
            p
          ),
        )}
      </pre>
    </div>
  );
}
